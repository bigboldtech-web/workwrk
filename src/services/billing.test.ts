// Stripe subscription events (src/services/billing.ts applySubscriptionEvent):
// the workspace's own plan follows a paying subscription, goes back to
// Starter when it ends, waits while the first payment is incomplete, and an
// event older than the one already applied changes nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const db = vi.hoisted(() => ({
  existing: false,
  stale: false,
  subWrites: [] as Array<{ kind: "update" | "create"; data: Record<string, unknown>; where?: Record<string, unknown> }>,
  orgWrites: [] as Array<{ plan: string }>,
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    subscription: {
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!db.existing || db.stale) return { count: 0 };
        db.subWrites.push({ kind: "update", data: a.data, where: a.where });
        return { count: 1 };
      },
      findUnique: async () => (db.existing ? { id: "s1" } : null),
      create: async (a: { data: Record<string, unknown> }) => {
        db.subWrites.push({ kind: "create", data: a.data });
        return { id: "s1" };
      },
    },
    organization: {
      update: async (a: { data: { plan: string } }) => {
        db.orgWrites.push({ plan: a.data.plan });
        return {};
      },
    },
  };
  return { prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

import { applySubscriptionEvent } from "./billing";

const sub = (status: string): Stripe.Subscription =>
  ({
    id: "sub_1",
    status,
    customer: "cus_1",
    metadata: { organizationId: "org_1" },
    items: { data: [{ price: { id: "price_unknown" }, quantity: 12 }] },
    trial_end: null,
    canceled_at: null,
  }) as unknown as Stripe.Subscription;

beforeEach(() => {
  db.existing = true;
  db.stale = false;
  db.subWrites.length = 0;
  db.orgWrites.length = 0;
});

describe("applySubscriptionEvent", () => {
  it("puts a paying workspace on the price's plan", async () => {
    for (const status of ["active", "trialing", "past_due"]) {
      db.orgWrites.length = 0;
      await applySubscriptionEvent(sub(status), new Date("2026-10-05T10:00:00Z"));
      expect(db.orgWrites).toEqual([{ plan: "GROWTH" }]);
    }
  });

  it("moves the workspace back to Starter when the subscription ends", async () => {
    for (const status of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
      db.orgWrites.length = 0;
      await applySubscriptionEvent(sub(status), new Date("2026-10-05T10:00:00Z"));
      expect(db.orgWrites).toEqual([{ plan: "STARTER" }]);
    }
  });

  it("changes nothing on the workspace while the first payment is incomplete", async () => {
    await applySubscriptionEvent(sub("incomplete"), new Date("2026-10-05T10:00:00Z"));
    expect(db.orgWrites).toEqual([]);
    expect(db.subWrites).toHaveLength(1);
  });

  it("writes only when this event is not older than the one applied, and records its time", async () => {
    const at = new Date("2026-10-05T10:00:00Z");
    await applySubscriptionEvent(sub("active"), at);
    expect(db.subWrites[0].where).toEqual({ organizationId: "org_1", OR: [{ stripeEventAt: null }, { stripeEventAt: { lte: at } }] });
    expect(db.subWrites[0].data.stripeEventAt).toEqual(at);
  });

  it("skips an event older than the one already applied: a late 'updated' never revives a cancelled subscription", async () => {
    db.stale = true;
    await applySubscriptionEvent(sub("active"), new Date("2026-10-05T09:00:00Z"));
    expect(db.subWrites).toEqual([]);
    expect(db.orgWrites).toEqual([]);
  });

  it("creates the subscription row the first time, with the customer", async () => {
    db.existing = false;
    await applySubscriptionEvent(sub("active"), new Date("2026-10-05T10:00:00Z"));
    expect(db.subWrites).toHaveLength(1);
    expect(db.subWrites[0]).toMatchObject({ kind: "create", data: { organizationId: "org_1", stripeCustomerId: "cus_1", seats: 12 } });
    expect(db.orgWrites).toEqual([{ plan: "GROWTH" }]);
  });
});
