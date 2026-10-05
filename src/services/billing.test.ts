// Stripe subscription events (src/services/billing.ts applySubscriptionEvent):
// the workspace's own plan follows a paying subscription, goes back to
// Starter when it ends, waits while the first payment is incomplete, and an
// event older than the one already applied changes nothing. A lifetime code's
// row is never overwritten, a second live subscription is never applied, and
// a plan staff set or a code gave is not Stripe's to change.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

type Row = { plan: string; status: string; billingMode: string; stripeSubscriptionId: string | null; stripeEventAt: Date | null };

const db = vi.hoisted(() => ({
  orgPlan: "STARTER" as string,
  orgStatus: "TRIAL" as string,
  row: null as Row | null,
  subWrites: [] as Array<{ kind: "update" | "create"; data: Record<string, unknown> }>,
  orgWrites: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async () => [{ plan: db.orgPlan, status: db.orgStatus }],
    subscription: {
      findUnique: async () => db.row,
      update: async (a: { data: Record<string, unknown> }) => {
        db.subWrites.push({ kind: "update", data: a.data });
        db.row = { ...(db.row as Row), ...(a.data as Partial<Row>) };
        return {};
      },
      create: async (a: { data: Record<string, unknown> }) => {
        db.subWrites.push({ kind: "create", data: a.data });
        db.row = a.data as unknown as Row;
        return {};
      },
    },
    organization: {
      update: async (a: { data: { plan: string } }) => {
        db.orgWrites.push(a.data);
        db.orgPlan = a.data.plan;
        return {};
      },
      updateMany: async (a: { where: { status: string }; data: { status: string } }) => {
        if (db.orgStatus === a.where.status) {
          db.orgWrites.push(a.data);
          db.orgStatus = a.data.status;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };
  return { prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

import { applySubscriptionEvent } from "./billing";

const sub = (status: string, id = "sub_1"): Stripe.Subscription =>
  ({
    id,
    status,
    customer: "cus_1",
    metadata: { organizationId: "org_1" },
    items: { data: [{ price: { id: "price_unknown" }, quantity: 12 }] },
    trial_end: null,
    canceled_at: null,
  }) as unknown as Stripe.Subscription;

const AT = new Date("2026-10-05T10:00:00Z");
const tracked = (over: Partial<Row> = {}): Row => ({ plan: "STARTER", status: "TRIALING", billingMode: "PER_USER", stripeSubscriptionId: null, stripeEventAt: null, ...over });

beforeEach(() => {
  db.orgPlan = "STARTER";
  db.orgStatus = "TRIAL";
  // The row checkout leaves before payment (ensureStripeCustomer).
  db.row = tracked();
  db.subWrites.length = 0;
  db.orgWrites.length = 0;
});

describe("applySubscriptionEvent", () => {
  it("puts a paying workspace on the price's plan, and ends its trial status", async () => {
    for (const status of ["active", "trialing", "past_due"]) {
      db.orgPlan = "STARTER";
      db.orgStatus = "TRIAL";
      db.row = tracked();
      db.orgWrites.length = 0;
      expect(await applySubscriptionEvent(sub(status), AT)).toBe("applied");
      expect(db.orgWrites).toEqual([{ plan: "GROWTH" }, { status: "ACTIVE" }]);
      expect(db.row?.plan).toBe("GROWTH");
    }
  });

  it("moves the workspace back to Starter when the subscription ends", async () => {
    for (const status of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
      db.orgPlan = "GROWTH";
      db.row = tracked({ plan: "GROWTH", status: "ACTIVE", stripeSubscriptionId: "sub_1" });
      db.orgWrites.length = 0;
      await applySubscriptionEvent(sub(status), AT);
      expect(db.orgWrites).toEqual([{ plan: "STARTER" }]);
      expect(db.row?.plan).toBe("STARTER");
    }
  });

  it("changes nothing on the workspace while the first payment is incomplete, then applies once it is paid", async () => {
    await applySubscriptionEvent(sub("incomplete"), AT);
    expect(db.orgWrites).toEqual([]);
    expect(db.subWrites).toHaveLength(1);
    // The row still says Stripe gave Starter, so the payment's event raises the plan.
    expect(db.row?.plan).toBe("STARTER");
    await applySubscriptionEvent(sub("active"), new Date("2026-10-05T10:05:00Z"));
    expect(db.orgPlan).toBe("GROWTH");
  });

  it("records the event's time on the row", async () => {
    await applySubscriptionEvent(sub("active"), AT);
    expect(db.subWrites[0].data.stripeEventAt).toEqual(AT);
  });

  it("skips an event older than the one already applied: a late 'updated' never revives a cancelled subscription", async () => {
    db.row = tracked({ plan: "STARTER", status: "CANCELED", stripeSubscriptionId: "sub_1", stripeEventAt: new Date("2026-10-05T10:00:00Z") });
    expect(await applySubscriptionEvent(sub("active"), new Date("2026-10-05T09:00:00Z"))).toBe("older");
    expect(db.subWrites).toEqual([]);
    expect(db.orgWrites).toEqual([]);
  });

  it("creates the subscription row the first time, with the customer", async () => {
    db.row = null;
    await applySubscriptionEvent(sub("active"), AT);
    expect(db.subWrites).toHaveLength(1);
    expect(db.subWrites[0]).toMatchObject({ kind: "create", data: { organizationId: "org_1", stripeCustomerId: "cus_1", seats: 12, plan: "GROWTH" } });
    expect(db.orgWrites[0]).toEqual({ plan: "GROWTH" });
  });

  it("never overwrites a lifetime code's row, whatever Stripe sends", async () => {
    db.orgPlan = "GROWTH";
    db.row = tracked({ plan: "GROWTH", status: "ACTIVE", billingMode: "FLAT_TIER", stripeSubscriptionId: null });
    for (const status of ["canceled", "active"]) expect(await applySubscriptionEvent(sub(status), AT)).toBe("lifetime");
    expect(db.subWrites).toEqual([]);
    expect(db.orgWrites).toEqual([]);
  });

  it("never applies a second subscription while the row follows another live one", async () => {
    db.orgPlan = "GROWTH";
    db.row = tracked({ plan: "GROWTH", status: "ACTIVE", stripeSubscriptionId: "sub_first" });
    // Neither the duplicate's payment nor, later, its cancellation touches the workspace.
    expect(await applySubscriptionEvent(sub("active", "sub_second"), AT)).toBe("duplicate");
    expect(await applySubscriptionEvent(sub("canceled", "sub_second"), new Date("2026-10-05T11:00:00Z"))).toBe("duplicate");
    expect(db.subWrites).toEqual([]);
    expect(db.orgWrites).toEqual([]);
    expect(db.orgPlan).toBe("GROWTH");
  });

  it("leaves a plan staff set since alone, when the subscription renews or ends", async () => {
    db.orgPlan = "ENTERPRISE";
    db.row = tracked({ plan: "GROWTH", status: "ACTIVE", stripeSubscriptionId: "sub_1" });
    await applySubscriptionEvent(sub("active"), AT);
    await applySubscriptionEvent(sub("canceled"), new Date("2026-10-05T11:00:00Z"));
    expect(db.orgPlan).toBe("ENTERPRISE");
    expect(db.orgWrites.filter((w) => "plan" in w)).toEqual([]);
  });

  it("keeps on the row the plan Stripe now gives while staff hold another, so a later subscription applies", async () => {
    db.orgPlan = "ENTERPRISE";
    db.row = tracked({ plan: "GROWTH", status: "ACTIVE", stripeSubscriptionId: "sub_1" });
    await applySubscriptionEvent(sub("canceled"), AT);
    expect(db.row?.plan).toBe("STARTER");
    expect(db.orgPlan).toBe("ENTERPRISE");
    // The contract ends: staff set Starter, and the Owner buys Growth.
    db.orgPlan = "STARTER";
    await applySubscriptionEvent(sub("active", "sub_2"), new Date("2026-10-06T10:00:00Z"));
    expect(db.orgPlan).toBe("GROWTH");
  });

  it("applies nothing to a workspace that is being deleted", async () => {
    db.orgStatus = "CANCELLED";
    expect(await applySubscriptionEvent(sub("active"), AT)).toBe("closed");
    expect(db.subWrites).toEqual([]);
    expect(db.orgWrites).toEqual([]);
  });

  it("applies a new subscription bought after a cancelled one", async () => {
    db.row = tracked({ plan: "STARTER", status: "CANCELED", stripeSubscriptionId: "sub_old", stripeEventAt: new Date("2026-09-01T00:00:00Z") });
    expect(await applySubscriptionEvent(sub("active", "sub_new"), AT)).toBe("applied");
    expect(db.orgPlan).toBe("GROWTH");
    expect(db.row?.stripeSubscriptionId).toBe("sub_new");
  });
});
