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
  /** The moved reports who also reported to the leaver elsewhere (batch 7). */
  alsoElsewhere: [] as Array<{ id: string; name: string | null }>,
  logs: [] as Array<{ type?: string; description?: string; metadata?: Record<string, unknown> }>,
  /** The person, as their row says (batch 7: anchored in another workspace for a member here). */
  person: { id: "u1", status: "ACTIVE", firstName: "Max", lastName: "Chen", organizationId: "org" },
  /** They hold a membership here (batch 7). */
  membership: false,
  membershipDeleted: 0,
  userUpdates: [] as Array<Record<string, unknown>>,
  txLogs: [] as Array<{ type?: string; description?: string; metadata?: Record<string, unknown> }>,
  /** The latest identity-provider row about them here. */
  lastRow: { type: "membership.handover_pending" } as { type: string; metadata?: Record<string, unknown> } | null,
  lastOwner: false,
}));
const busyError = () => Object.assign(new Error("busy"), { name: "OrgRolesBusy" });

vi.mock("@/lib/prisma", () => {
  const tx = {
    user: { update: async (a: { data: Record<string, unknown> }) => { st.updates += 1; st.userUpdates.push(a.data); return {}; } },
    activityLog: { create: async (a: { data: Record<string, unknown> }) => { st.txLogs.push(a.data); return {}; } },
    // A membership here (batch 7).
    organizationMembership: {
      findUnique: async () => (st.membership ? { id: "m1" } : null),
      delete: async () => { st.membershipDeleted += 1; st.membership = false; return {}; },
    },
  };
  return {
    prisma: {
      user: {
        findFirst: async (a: { where: { organizationId?: string } }) =>
          a.where.organizationId && a.where.organizationId !== st.person.organizationId ? null : { ...st.person },
        findUnique: async () => ({ firstName: "Dana", lastName: "Lee" }),
      },
      activityLog: { create: async (a: { data: { type?: string; description?: string } }) => { st.logs.push(a.data); return {}; }, findFirst: async () => st.lastRow },
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
      if (st.workFails) throw new real.HandoverWorkFailed({ reportsReassigned: 2, reportsRehomed: [], reportsStaying: [], reportsAlsoElsewhere: [], reportsMoved: 2 }, new Error("timeout"));
      return { tasksReassigned: 0, reportsReassigned: 0, containersReassigned: 0, reportsRehomed: [], reportsStaying: st.staying, reportsAlsoElsewhere: st.alsoElsewhere };
    },
  };
});
vi.mock("@/lib/access/membership", () => ({
  lockOrgRoles: async () => { if (st.busy) throw busyError(); },
  wouldRemoveLastOwner: async () => st.lastOwner,
  isLiveOwner: async () => false,
  unattendedRecipient: async () => "u-dana",
  liveAdminsOf: async () => [],
  liveOwnerIds: async () => [],
}));

import { scimDeprovision, scimDeprovisionMember } from "./scim-deprovision";

beforeEach(() => {
  st.busy = false;
  st.updates = 0;
  st.handovers = 0;
  st.workFails = false;
  st.handoverInput = null;
  st.staying = [];
  st.alsoElsewhere = [];
  st.logs = [];
  st.person = { id: "u1", status: "ACTIVE", firstName: "Max", lastName: "Chen", organizationId: "org" };
  st.membership = false;
  st.membershipDeleted = 0;
  st.userUpdates = [];
  st.txLogs = [];
  st.lastRow = { type: "membership.handover_pending" };
  st.lastOwner = false;
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

// Docs-found fixes batch 7: a deactivation is every workspace's, so the
// handover moves every report, and the identity provider's row counts the
// ones who also reported to them in another workspace. Batch 6 said they
// stayed "listed under them", under an account the deactivation had ended.
describe("scimDeprovision names the reports who also reported to them elsewhere", () => {
  it("moves every report and counts them on the audit row, in plain words", async () => {
    st.alsoElsewhere = [{ id: "r1", name: "Ida Ray" }];
    const out = await scimDeprovision("org", "u1");
    expect(out).toMatchObject({ ok: true });
    // A deactivation is every workspace's: no report is left.
    expect(st.handoverInput?.leavesOnlyHere).toBeUndefined();
    const row = st.logs.find((l) => l.type === "membership.changed");
    expect(row?.description).toBe("Your identity provider deactivated Max Chen. 0 open tasks, 0 direct reports and 0 Spaces, Folders and Lists went to Dana Lee. 1 of their reports also reported to them in another workspace, whose Audit log records the move.");
    expect(row?.description).not.toMatch(/stay/);
  });
});

// Docs-found fixes batch 7, from the batch 6 review: someone who works here
// through a membership could never be found by the identity provider (SCIM
// GET read only people anchored here) while POST answered 409 for them, so it
// could never deprovision them. Their status is one column every workspace
// reads, so deprovisioning them here ends their membership here, never their
// account.
describe("scimDeprovisionMember", () => {
  beforeEach(() => {
    st.person = { id: "u1", status: "ACTIVE", firstName: "Max", lastName: "Chen", organizationId: "client" };
    st.membership = true;
  });

  it("ends the membership here, never the account, and hands their work here over, keeping lines another workspace relies on", async () => {
    st.staying = [{ id: "r1", name: "Ida Ray" }];
    const out = await scimDeprovisionMember("org", "u1");
    expect(out).toEqual({ ok: true, alreadyInactive: false, recipientId: "u-dana" });
    expect(st.membershipDeleted).toBe(1);
    // Their sessions end (a tokenVersion bump); their status is untouched.
    expect(st.userUpdates).toEqual([{ tokenVersion: { increment: 1 } }]);
    expect(st.handoverInput).toMatchObject({ organizationId: "org", fromId: "u1", toId: "u-dana", actorId: null, actorType: "scim", leavesOnlyHere: true });
    expect(st.txLogs).toEqual([expect.objectContaining({ type: "membership.handover_pending", metadata: { recipientId: "u-dana", member: true } })]);
    const row = st.logs.find((l) => l.type === "membership.changed");
    expect(row?.description).toBe("Your identity provider removed Max Chen from this workspace. 0 open tasks, 0 direct reports and 0 Spaces, Folders and Lists went to Dana Lee. 1 direct report stays listed under them: another workspace they both work in relies on that line, and their open reviews here went to the same person.");
    expect(row?.description).not.toMatch(/--|\u2014/);
    expect(row?.metadata).toMatchObject({ member: true, reportsStaying: 1 });
  });

  it("a retry once the membership has ended finishes a pending handover, else answers a harmless success", async () => {
    st.membership = false;
    st.lastRow = { type: "membership.handover_pending", metadata: { member: true } };
    expect(await scimDeprovisionMember("org", "u1")).toEqual({ ok: true, alreadyInactive: true, recipientId: "u-dana" });
    expect(st.handovers).toBe(1);
    expect(st.membershipDeleted).toBe(0);
    st.lastRow = { type: "membership.changed", metadata: { member: true } };
    expect(await scimDeprovisionMember("org", "u1")).toEqual({ ok: true, alreadyInactive: true, recipientId: null });
    expect(st.handovers).toBe(1);
  });

  it("refuses the workspace's last Owner, ending nothing", async () => {
    st.lastOwner = true;
    const out = await scimDeprovisionMember("org", "u1");
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(st.membershipDeleted).toBe(0);
    expect(st.userUpdates).toEqual([]);
    expect(st.handovers).toBe(0);
  });

  it("answers 503 when the role lock is busy, ending nothing", async () => {
    st.busy = true;
    expect(await scimDeprovisionMember("org", "u1")).toMatchObject({ ok: false, status: 503 });
    expect(st.membershipDeleted).toBe(0);
  });

  it("never acts for someone anchored here: that is scimDeprovision's", async () => {
    st.person = { ...st.person, organizationId: "org" };
    expect(await scimDeprovisionMember("org", "u1")).toMatchObject({ ok: false, status: 409 });
    expect(st.membershipDeleted).toBe(0);
  });
});
