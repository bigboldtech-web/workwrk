// Seats (src/lib/seats.ts): what counts, which limit applies, and the
// sentences a full workspace is shown.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { personFitsOnAccept, seatCapMessage, seatLimit, seatsFor, seatUse } from "./seats";

type Where = Record<string, unknown>;

function fakeDb(o: {
  plan?: string | null;
  anchored?: number;
  viaMembership?: number;
  pending?: number;
  sub?: { seats: number; status: string; billingMode: string; stripeSubscriptionId: string | null } | null;
}) {
  const seen: { user?: Where; membership?: Where; invitationSql?: string; invitationValues?: unknown[] } = {};
  const db = {
    organization: { findUnique: async () => (o.plan === null ? null : { plan: o.plan ?? "STARTER" }) },
    user: { count: async (a: { where: Where }) => { seen.user = a.where; return o.anchored ?? 0; } },
    organizationMembership: { count: async (a: { where: Where }) => { seen.membership = a.where; return o.viaMembership ?? 0; } },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      seen.invitationSql = strings.join("?");
      seen.invitationValues = values;
      return [{ n: o.pending ?? 0 }];
    },
    subscription: { findUnique: async () => o.sub ?? null },
  };
  return { db: db as never, seen };
}

describe("seatUse", () => {
  it("counts live people here, live people in through a membership, and open invitations", async () => {
    const { db, seen } = fakeDb({ anchored: 4, viaMembership: 2, pending: 3 });
    const use = await seatUse("org_1", db);
    expect(use).toEqual({ members: 6, pending: 3, limit: 10, plan: "STARTER", canBuyMore: false });
    // Removed and deactivated people hold no seat.
    expect(seen.user).toMatchObject({ organizationId: "org_1", deletedAt: null, status: { not: "INACTIVE" } });
    // A membership counts only for a live person anchored somewhere else
    // (someone anchored here is already counted once).
    expect(seen.membership).toMatchObject({ organizationId: "org_1", user: { deletedAt: null, status: { not: "INACTIVE" }, NOT: { organizationId: "org_1" } } });
    // Only invitations not accepted and not expired, one per address in any
    // case, and none for an address already among the people here.
    expect(seen.invitationSql).toContain(`i."accepted" = false`);
    expect(seen.invitationSql).toContain(`i."expiresAt" > (now() AT TIME ZONE 'UTC')`);
    expect(seen.invitationSql).toContain(`SELECT DISTINCT lower(i."email")`);
    expect(seen.invitationSql).toContain("NOT EXISTS (SELECT 1 FROM inside");
    expect(seen.invitationValues).toEqual(["org_1", "org_1", "org_1"]);
  });

  it("uses the plan's people limit with no subscription", async () => {
    expect((await seatUse("o", fakeDb({ plan: "GROWTH" }).db)).limit).toBe(50);
    expect((await seatUse("o", fakeDb({ plan: "SCALE" }).db)).limit).toBe(200);
  });

  it("an unknown plan, or no plan, falls back to Starter's limit", async () => {
    expect((await seatUse("o", fakeDb({ plan: "MYSTERY" }).db)).limit).toBe(10);
    expect((await seatUse("o", fakeDb({ plan: null }).db)).limit).toBe(10);
  });

  it("uses the seats bought on a live per-person Stripe subscription", async () => {
    for (const status of ["ACTIVE", "TRIALING", "PAST_DUE"]) {
      const use = await seatUse("o", fakeDb({ plan: "GROWTH", sub: { seats: 12, status, billingMode: "PER_USER", stripeSubscriptionId: "sub_1" } }).db);
      expect(use.limit).toBe(12);
      expect(use.canBuyMore).toBe(true);
    }
  });

  it("ignores a subscription that is over", async () => {
    expect((await seatUse("o", fakeDb({ plan: "GROWTH", sub: { seats: 12, status: "CANCELED", billingMode: "PER_USER", stripeSubscriptionId: "sub_1" } }).db)).limit).toBe(50);
  });
});

describe("seatLimit", () => {
  const live = (seats: number, billingMode: string, stripeSubscriptionId: string | null) => ({ seats, status: "ACTIVE", billingMode, stripeSubscriptionId });

  it("a flat Stripe price's quantity (1) is not a seat count: the plan's limit applies", () => {
    expect(seatLimit("GROWTH", live(1, "FLAT_TIER", "sub_1"))).toEqual({ limit: 50, canBuyMore: false });
    expect(seatLimit("SCALE", live(1, "FLAT_TIER", "sub_1"))).toEqual({ limit: 200, canBuyMore: false });
  });

  it("a lifetime (AppSumo) subscription's seats are the cap, and more are not bought in the portal", () => {
    expect(seatLimit("GROWTH", live(25, "FLAT_TIER", null))).toEqual({ limit: 25, canBuyMore: false });
    // Never fewer than free Starter's 10: a 5-seat code does not take seats away.
    expect(seatLimit("GROWTH", live(5, "FLAT_TIER", null))).toEqual({ limit: 10, canBuyMore: false });
  });

  it("unlimited lifetime seats (the staff console's empty field, AppSumo Tier 3) mean no limit", () => {
    expect(seatLimit("GROWTH", live(0, "FLAT_TIER", null)).limit).toBe(99_999);
    expect(seatLimit("GROWTH", live(999_999, "FLAT_TIER", null)).limit).toBe(99_999);
  });

  it("a checkout that never finished (no Stripe subscription, no seats) uses the plan's limit", () => {
    expect(seatLimit("STARTER", { seats: 0, status: "TRIALING", billingMode: "PER_USER", stripeSubscriptionId: null })).toEqual({ limit: 10, canBuyMore: false });
  });

  it("no subscription uses the plan's limit", () => {
    expect(seatLimit("GROWTH", null)).toEqual({ limit: 50, canBuyMore: false });
  });
});

describe("seatsFor", () => {
  it("fits while people plus open invitations plus the new ones stay within the limit", async () => {
    expect((await seatsFor("o", 1, fakeDb({ anchored: 8, pending: 1 }).db)).ok).toBe(true);
    expect((await seatsFor("o", 2, fakeDb({ anchored: 8, pending: 0 }).db)).ok).toBe(true);
  });

  it("refuses the one that would go past it, and says how many are in use", async () => {
    const one = await seatsFor("o", 1, fakeDb({ anchored: 9, pending: 1 }).db);
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.message).toBe("This workspace has used all 10 seats (people and open invitations) on the Starter plan. An Owner or Admin can change the plan in Settings, Plan & billing.");
    const many = await seatsFor("o", 3, fakeDb({ anchored: 7, pending: 1 }).db);
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.message).toBe("This workspace has 8 of its 10 seats in use (people and open invitations), so 3 more do not fit on the Starter plan. An Owner or Admin can change the plan in Settings, Plan & billing.");
  });
});

describe("personFitsOnAccept", () => {
  it("lets an invited person in while the PEOPLE fit, whatever the open invitations", async () => {
    // Their own invitation is one of the open ones, so it adds no seat.
    expect((await personFitsOnAccept("o", fakeDb({ anchored: 9, pending: 5 }).db)).ok).toBe(true);
  });

  it("refuses when the plan was lowered below the people already in", async () => {
    const r = await personFitsOnAccept("o", fakeDb({ anchored: 10, pending: 1 }).db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no free seat for you right now/);
  });
});

describe("seatCapMessage", () => {
  it("names the plan the way pricing does", () => {
    expect(seatCapMessage({ members: 50, pending: 0, limit: 50, plan: "GROWTH", canBuyMore: false }, 1)).toMatch(/on the Growth plan\. An Owner or Admin can change the plan/);
  });

  it("points a per-person plan at buying seats", () => {
    expect(seatCapMessage({ members: 12, pending: 0, limit: 12, plan: "GROWTH", canBuyMore: true }, 1)).toMatch(/can add seats in Settings, Plan & billing \(Manage billing\)\.$/);
  });
});
