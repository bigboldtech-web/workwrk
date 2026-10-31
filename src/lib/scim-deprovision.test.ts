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
  /** The deactivation's own move of the lines another workspace relies on (batch 8): its calls, and what it moved. */
  endCalls: [] as Array<{ input: Record<string, unknown>; statusWritten: boolean }>,
  endMoved: [] as Array<{ id: string; name: string | null }>,
  endFollowed: [] as Array<{ ids: string[]; actor: string }>,
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
  /** The check-in writes in the transaction, and where they fell (docs-found fixes batch 8). */
  checkInWrites: [] as Array<{ where: unknown; data: unknown; afterDelete: boolean; beforeUserUpdate: boolean }>,
  /** Each $transaction's options, in order (batch 9). */
  txOpts: [] as unknown[],
  /** Where the account is anchored as read inside the transaction (batch 9), when it differs from st.person. */
  anchorInTx: null as string | null,
}));
const busyError = () => Object.assign(new Error("busy"), { name: "OrgRolesBusy" });

vi.mock("@/lib/prisma", () => {
  const tx = {
    user: {
      update: async (a: { data: Record<string, unknown> }) => { st.updates += 1; st.userUpdates.push(a.data); return {}; },
      findUnique: async () => ({ organizationId: st.anchorInTx ?? st.person.organizationId }),
    },
    activityLog: { create: async (a: { data: Record<string, unknown> }) => { st.txLogs.push(a.data); return {}; } },
    // A membership here (batch 7).
    organizationMembership: {
      // No home elsewhere unless a test gives one (homeAfterRemoval).
      findMany: async () => [],
      count: async () => 0,
      findUnique: async () => (st.membership ? { id: "m1" } : null),
      delete: async () => { st.membershipDeleted += 1; st.membership = false; return {}; },
    },
    checkIn: {
      updateMany: async (a: { where: unknown; data: unknown }) => {
        st.checkInWrites.push({ where: a.where, data: a.data, afterDelete: st.membershipDeleted > 0, beforeUserUpdate: st.userUpdates.length === 0 });
        return { count: 2 };
      },
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
      $transaction: async (fn: (t: typeof tx) => unknown, opts?: unknown) => { st.txOpts.push(opts); return fn(tx); },
    },
  };
});
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
vi.mock("@/lib/people/handover.server", async (orig) => {
  const real = await orig<typeof import("@/lib/people/handover.server")>();
  return {
    HandoverWorkFailed: real.HandoverWorkFailed,
    isHandoverWorkFailed: real.isHandoverWorkFailed,
    // Batch 8: inside the deactivation's transaction, before status is written.
    moveReliedReportsAtEnd: async (_tx: unknown, input: Record<string, unknown>) => {
      st.endCalls.push({ input, statusWritten: st.userUpdates.some((u) => u.status === "INACTIVE") });
      return { reportsMoved: st.endMoved.length, reportsReassigned: st.endMoved.length, reportsRehomed: [], reportsAlsoElsewhere: [...st.endMoved], reportIds: st.endMoved.map((m) => m.id) };
    },
    followAccountEndLines: async (_org: string, done: { reportIds: string[] }, actor: string) => { st.endFollowed.push({ ids: done.reportIds, actor }); },
    runHandover: async (input: Record<string, unknown>) => {
      st.handovers += 1;
      st.handoverInput = input;
      if (st.busy) throw busyError();
      // The reports moved (and were logged); the work did not (batch 5).
      if (st.workFails) throw new real.HandoverWorkFailed({ reportsReassigned: 2, reportsRehomed: [], reportsStaying: [], reportsAlsoElsewhere: [], reportsMoved: 2 }, new Error("timeout"));
      return { tasksReassigned: 0, reportsReassigned: 0, containersReassigned: 0, reportsRehomed: [], reportsStaying: st.staying, reportsAtAccountEnd: [], reportsAlsoElsewhere: st.alsoElsewhere };
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
  st.endCalls = [];
  st.endMoved = [];
  st.endFollowed = [];
  st.logs = [];
  st.person = { id: "u1", status: "ACTIVE", firstName: "Max", lastName: "Chen", organizationId: "org" };
  st.membership = false;
  st.membershipDeleted = 0;
  st.userUpdates = [];
  st.txLogs = [];
  st.lastRow = { type: "membership.handover_pending" };
  st.lastOwner = false;
  st.checkInWrites = [];
  st.txOpts = [];
  st.anchorInTx = null;
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

// Docs-found fixes batch 8, from the batch 7 review: the lines another
// workspace relies on move with the deactivation itself, in its transaction,
// never in a step after it.
describe("scimDeprovision moves the lines another workspace relies on with the deactivation", () => {
  it("moves them inside the deactivation's transaction, before status is written, to the recipient, and counts them on the row", async () => {
    st.endMoved = [{ id: "r1", name: "Ida Ray" }];
    expect(await scimDeprovision("org", "u1")).toMatchObject({ ok: true, recipientId: "u-dana" });
    // Before: no such step; the handover after the deactivation moved them.
    expect(st.endCalls).toEqual([
      { input: { organizationId: "org", leaverId: "u1", recipientId: "u-dana", actorId: null, actorType: "scim", actorLabel: "Identity provider", ends: "deactivated" }, statusWritten: false },
    ]);
    expect(st.endFollowed).toEqual([{ ids: ["r1"], actor: "u-dana" }]);
    const row = st.logs.find((l) => l.type === "membership.changed");
    expect(row?.description).toBe("Your identity provider deactivated Max Chen. 0 open tasks, 1 direct reports and 0 Spaces, Folders and Lists went to Dana Lee. 1 of their reports also reported to them in another workspace, whose Audit log records the move.");
    expect(row?.metadata).toMatchObject({ reportsReassigned: 1, reportsAlsoElsewhere: 1 });
  });

  it("moves nothing for the last Owner, or when the lock is busy", async () => {
    st.lastOwner = true;
    await scimDeprovision("org", "u1");
    st.lastOwner = false;
    st.busy = true;
    await scimDeprovision("org", "u1");
    expect(st.endCalls).toEqual([]);
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

// Docs-found fixes batch 8 (the batch 7 review): the check-in reads rest on
// "a row written here is of someone who holds a level here", and this is the
// one code path that deletes a membership. Vic, anchored elsewhere, wrote
// check-ins here; once his membership ended, every Admin here still listed
// his mood and challenges while ?userId= answered 404.
describe("scimDeprovisionMember and the person's check-ins here", () => {
  beforeEach(() => {
    st.person = { id: "u1", status: "ACTIVE", firstName: "Max", lastName: "Chen", organizationId: "client" };
    st.membership = true;
    st.checkInWrites = [];
  });

  it("makes their check-ins written here theirs alone, in the membership's own transaction, right after its delete", async () => {
    expect(await scimDeprovisionMember("org", "u1")).toMatchObject({ ok: true });
    // Only theirs, only this workspace's, set to no workspace (read by their person alone).
    expect(st.checkInWrites).toEqual([{ where: { userId: "u1", organizationId: "org" }, data: { organizationId: null }, afterDelete: true, beforeUserUpdate: true }]);
  });

  it("touches no check-in when it ends no membership", async () => {
    st.lastOwner = true;
    await scimDeprovisionMember("org", "u1");
    st.lastOwner = false;
    st.busy = true;
    await scimDeprovisionMember("org", "u1");
    st.busy = false;
    st.person = { ...st.person, organizationId: "org" };
    await scimDeprovisionMember("org", "u1");
    expect(st.checkInWrites).toEqual([]);
  });
});

// Docs-found fixes batch 9, from the batch 8 review.
describe("scimDeprovisionMember, once the membership has ended, and its time", () => {
  beforeEach(() => {
    st.person = { id: "u1", status: "ACTIVE", firstName: "Max", lastName: "Chen", organizationId: "client" };
  });

  it("a retry that finds the membership gone makes their check-ins here theirs alone, under the lock, finished or not", async () => {
    // The build before batch 8 ended the membership and left the rows; the
    // identity provider retries against this one.
    st.membership = false;
    st.lastRow = { type: "membership.changed", metadata: { member: true } };
    expect(await scimDeprovisionMember("org", "u1")).toEqual({ ok: true, alreadyInactive: true, recipientId: null });
    // Before: the gone branch finished a handover at most, and the rows stayed this workspace's.
    expect(st.checkInWrites).toEqual([{ where: { userId: "u1", organizationId: "org" }, data: { organizationId: null }, afterDelete: false, beforeUserUpdate: true }]);
    st.checkInWrites = [];
    st.lastRow = { type: "membership.handover_pending", metadata: { member: true } };
    expect(await scimDeprovisionMember("org", "u1")).toEqual({ ok: true, alreadyInactive: true, recipientId: "u-dana" });
    expect(st.checkInWrites).toHaveLength(1);
    expect(st.membershipDeleted).toBe(0);
  });

  it("nulls nothing where they are anchored here by the time it looks", async () => {
    st.membership = false;
    st.anchorInTx = "org";
    await scimDeprovisionMember("org", "u1");
    expect(st.checkInWrites).toEqual([]);
  });

  it("gives the member path's transaction LOCKED_TX's time, as the anchored path's", async () => {
    st.membership = true;
    await scimDeprovisionMember("org", "u1");
    // Before: Prisma's default of 5 seconds, which the bounded role lock wait,
    // an unbounded wait on the membership's delete and two writes could pass.
    expect(st.txOpts[0]).toEqual({ timeout: 10_000 });
    st.txOpts = [];
    st.person = { ...st.person, organizationId: "org" };
    await scimDeprovision("org", "u1");
    expect(st.txOpts[0]).toEqual({ timeout: 10_000 });
  });
});
