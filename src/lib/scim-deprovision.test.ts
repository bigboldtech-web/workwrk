// SCIM deprovisioning and the bounded role lock (docs-found fixes batch 4).
// During an identity provider's layoff burst every deactivation queues on the
// workspace's role lock. A wait past the bound (membership.ts lockOrgRoles)
// is answered 503, which the identity provider retries, never a 500 thrown
// out of the route. Before the deactivation nothing was written; after it,
// the pending row stays the latest word and the retry finishes the handover.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ busy: false, updates: 0, handovers: 0 }));
const busyError = () => Object.assign(new Error("busy"), { name: "OrgRolesBusy" });

vi.mock("@/lib/prisma", () => {
  const tx = {
    user: { update: async () => { st.updates += 1; return {}; } },
    activityLog: { create: async () => ({}) },
  };
  return {
    prisma: {
      user: { findFirst: async () => ({ id: "u1", status: "ACTIVE", firstName: "Max", lastName: "Chen" }), findUnique: async () => ({ firstName: "Dana", lastName: "Lee" }) },
      activityLog: { create: async () => ({}), findFirst: async () => ({ type: "membership.handover_pending" }) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
vi.mock("@/lib/people/handover.server", () => ({
  runHandover: async () => {
    st.handovers += 1;
    if (st.busy) throw busyError();
    return { tasksReassigned: 0, reportsReassigned: 0, containersReassigned: 0, reportsRehomed: [] };
  },
}));
vi.mock("@/lib/access/membership", () => ({
  lockOrgRoles: async () => { if (st.busy) throw busyError(); },
  wouldRemoveLastOwner: async () => false,
  isLiveOwner: async () => false,
  unattendedRecipient: async () => "u-dana",
  liveAdminsOf: async () => [],
  liveOwnerIds: async () => [],
}));

import { scimDeprovision } from "./scim-deprovision";

beforeEach(() => {
  st.busy = false;
  st.updates = 0;
  st.handovers = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("scimDeprovision when the role lock is busy", () => {
  it("answers 503 with nothing written, for the identity provider to retry", async () => {
    st.busy = true;
    const out = await scimDeprovision("org", "u1");
    expect(out).toMatchObject({ ok: false, status: 503 });
    expect(st.updates).toBe(0);
    expect(st.handovers).toBe(0);
  });

  it("deactivates and hands over as before when it is free", async () => {
    const out = await scimDeprovision("org", "u1");
    expect(out).toEqual({ ok: true, alreadyInactive: false, recipientId: "u-dana" });
    expect(st.updates).toBe(1);
    expect(st.handovers).toBe(1);
  });
});
