// SCIM deprovisioning and the bounded role lock (docs-found fixes batch 4).
// During an identity provider's layoff burst every deactivation queues on the
// workspace's role lock. A wait past the bound (membership.ts lockOrgRoles)
// is answered 503, which the identity provider retries, never a 500 thrown
// out of the route. Before the deactivation nothing was written; after it,
// the pending row stays the latest word and the retry finishes the handover.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  busy: false,
  updates: 0,
  handovers: 0,
  workFails: false,
  handoverInput: null as Record<string, unknown> | null,
  /** The reports the handover left, as runHandover answers them (batch 6). */
  staying: [] as Array<{ id: string; name: string | null }>,
  logs: [] as Array<{ type?: string; description?: string }>,
}));
const busyError = () => Object.assign(new Error("busy"), { name: "OrgRolesBusy" });

vi.mock("@/lib/prisma", () => {
  const tx = {
    user: { update: async () => { st.updates += 1; return {}; } },
    activityLog: { create: async () => ({}) },
  };
  return {
    prisma: {
      user: { findFirst: async () => ({ id: "u1", status: "ACTIVE", firstName: "Max", lastName: "Chen" }), findUnique: async () => ({ firstName: "Dana", lastName: "Lee" }) },
      activityLog: { create: async (a: { data: { type?: string; description?: string } }) => { st.logs.push(a.data); return {}; }, findFirst: async () => ({ type: "membership.handover_pending" }) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
vi.mock("@/lib/people/handover.server", async (orig) => {
  const real = await orig<typeof import("@/lib/people/handover.server")>();
  return {
    HandoverWorkFailed: real.HandoverWorkFailed,
    isHandoverWorkFailed: real.isHandoverWorkFailed,
    runHandover: async (input: Record<string, unknown>) => {
      st.handovers += 1;
      st.handoverInput = input;
      if (st.busy) throw busyError();
      // The reports moved (and were logged); the work did not (batch 5).
      if (st.workFails) throw new real.HandoverWorkFailed({ reportsReassigned: 2, reportsRehomed: [], reportsStaying: [], reportsMoved: 2 }, new Error("timeout"));
      return { tasksReassigned: 0, reportsReassigned: 0, containersReassigned: 0, reportsRehomed: [], reportsStaying: st.staying };
    },
  };
});
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
  st.workFails = false;
  st.handoverInput = null;
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

// Docs-found fixes batch 5: when the reports moved and the work did not, the
// identity provider got the bare error (a 500) and nothing said the reports
// had moved. Now a 503 that says so, which it retries; the pending row stays
// the latest word, so the retry moves the rest.
describe("scimDeprovision when the handover's work fails after the reports moved", () => {
  it("answers 503, saying the person is deactivated and the reports moved", async () => {
    st.workFails = true;
    const out = await scimDeprovision("org", "u1");
    expect(out).toEqual({
      ok: false,
      status: 503,
      error: "This person is deactivated. Their 2 direct reports moved, but their open tasks and their Spaces, Folders and Lists didn't. Try again to move the rest.",
    });
    expect(st.updates).toBe(1);
  });

  it("names the identity provider on the handover's own audit rows", async () => {
    await scimDeprovision("org", "u1");
    expect(st.handoverInput).toMatchObject({ actorId: null, actorType: "scim", actorLabel: "Identity provider" });
  });
});

// Docs-found fixes batch 6: a report whose line another workspace relies on
// stays with the leaver, and the identity provider's audit row says so.
describe("scimDeprovision names the reports a handover left", () => {
  beforeEach(() => {
    st.busy = false;
    st.workFails = false;
    st.staying = [{ id: "r1", name: "Ida Ray" }];
    st.logs = [];
  });

  it("counts them on the audit row, in plain words", async () => {
    const out = await scimDeprovision("org", "u1");
    expect(out).toMatchObject({ ok: true });
    const row = st.logs.find((l) => l.type === "membership.changed");
    expect(row?.description).toBe("Your identity provider deactivated Max Chen. 0 open tasks, 0 direct reports and 0 Spaces, Folders and Lists went to Dana Lee. 1 direct report stays listed under them: another workspace they work in relies on that line.");
  });
});
