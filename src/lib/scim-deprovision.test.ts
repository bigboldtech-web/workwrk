// SCIM deprovisioning (src/lib/scim-deprovision.ts).
//
// Docs-found fixes batch 4: during an identity provider's layoff burst every
// deactivation queues on the workspace's role lock. A wait past the bound
// (membership.ts lockOrgRoles) is answered 503, which the identity provider
// retries, never a 500 thrown out of the route. Before the end nothing was
// written; after it, the pending row stays the latest word and the retry
// finishes the handover.
//
// docs/plans/workspace-status.md D14 (step 4): the identity provider acts on
// THIS workspace's seat only, through workspace-status.ts endSeat. Someone
// anchored here with a usable seat elsewhere moves there (D3), someone with
// nowhere else ends (D4, the only account-wide sign out), someone here
// through a membership has that membership deactivated (D5), never deleted
// (D8). Before, the member path deleted the membership, nulled their
// check-ins here and bumped the account's tokenVersion (signing them out of
// their own company), and the anchored path ended the account everywhere.
// Those tests are rewritten below to the new rule, each saying what it was.
//
// Run on the in-memory database (seat-test-db.ts) with the real endSeat;
// the handover and the Owner guards are scripted, as before.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOfRow, legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  busy: false,
  handovers: 0,
  workFails: false,
  handoverInput: null as Record<string, unknown> | null,
  /** The reports the handover left, as runHandover answers them (batch 6). */
  staying: [] as Array<{ id: string; name: string | null }>,
  /** The moved reports who also reported to the leaver elsewhere (batch 7). */
  alsoElsewhere: [] as Array<{ id: string; name: string | null }>,
  /** The end's own move of the lines another workspace relies on (batch 8): its calls, and whether the seat was already written. */
  endCalls: [] as Array<{ input: Record<string, unknown>; seatWritten: boolean }>,
  endMoved: [] as Array<{ id: string; name: string | null }>,
  endFollowed: [] as Array<{ ids: string[]; actor: string }>,
  teammateEnds: [] as Array<[string, string[], string]>,
  lastOwner: false,
  owner: false,
  /** Each $transaction's options, in order (batch 9). */
  txOpts: [] as unknown[],
  /** Set to move the person's anchor here when the role lock is taken (a race, batch 9). */
  anchorOnLock: null as string | null,
}));
const busyError = () => Object.assign(new Error("busy"), { name: "OrgRolesBusy" });

vi.mock("@/lib/prisma", async () => {
  const { seatDb } = await import("@/lib/access/seat-test-db");
  const real = seatDb.prisma as Record<string, unknown>;
  // The in-memory database, its $transaction's options recorded.
  return {
    prisma: new Proxy({}, {
      get: (_t, k: string) => (k === "$transaction"
        ? async (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => { st.txOpts.push(opts); return (real.$transaction as (f: typeof fn) => Promise<unknown>)(fn); }
        : real[k]),
    }),
  };
});
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async (org: string, ids: string[], why: string) => { st.teammateEnds.push([org, ids, why]); } }));
vi.mock("@/lib/people/handover.server", async (orig) => {
  const real = await orig<typeof import("@/lib/people/handover.server")>();
  const { seatDb } = await import("@/lib/access/seat-test-db");
  return {
    HandoverWorkFailed: real.HandoverWorkFailed,
    isHandoverWorkFailed: real.isHandoverWorkFailed,
    // Batch 8: inside the end's transaction, before the seat is written.
    moveReliedReportsAtEnd: async (_tx: unknown, input: Record<string, unknown>) => {
      const u = seatDb.row("user", "u1");
      st.endCalls.push({ input, seatWritten: u.status === "INACTIVE" });
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
vi.mock("@/lib/access/membership", async () => {
  const { seatDb } = await import("@/lib/access/seat-test-db");
  return {
    lockOrgRoles: async () => {
      if (st.busy) throw busyError();
      if (st.anchorOnLock) seatDb.row("user", "u1").organizationId = st.anchorOnLock;
    },
    wouldRemoveLastOwner: async () => st.lastOwner,
    isLiveOwner: async () => st.owner,
    unattendedRecipient: async () => "u-dana",
    liveAdminsOf: async () => [{ id: "u-owner", firstName: "Olive", lastName: "Ng" }],
    liveOwnerIds: async () => ["u-owner"],
  };
});

import { seatDb as db } from "@/lib/access/seat-test-db";
import { scimDeprovision, scimDeprovisionMember } from "./scim-deprovision";

const logs = (type?: string) => (db.tables.activityLog ?? []).filter((l) => !type || l.type === type) as Array<{ type?: string; description?: string; metadata?: Record<string, unknown> }>;

beforeEach(() => {
  db.reset();
  st.busy = false;
  st.handovers = 0;
  st.workFails = false;
  st.handoverInput = null;
  st.staying = [];
  st.alsoElsewhere = [];
  st.endCalls = [];
  st.endMoved = [];
  st.endFollowed = [];
  st.teammateEnds = [];
  st.lastOwner = false;
  st.owner = false;
  st.txOpts = [];
  st.anchorOnLock = null;
  for (const id of ["org", "client", "c2"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  // Max, anchored here, with nowhere else to work: a deprovision ends his account (D4).
  db.seed("user", { id: "u1", email: "max@x.test", firstName: "Max", lastName: "Chen", organizationId: "org", ...legacyLevelRow("EMPLOYEE") });
  db.seed("user", { id: "u-dana", email: "dana@x.test", firstName: "Dana", lastName: "Lee", organizationId: "org", ...legacyLevelRow("MANAGER") });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("scimDeprovision when the role lock is busy", () => {
  it("answers 503 with nothing written, for the identity provider to retry", async () => {
    st.busy = true;
    const out = await scimDeprovision("org", "u1");
    expect(out).toMatchObject({ ok: false, status: 503 });
    expect(db.row("user", "u1")).toMatchObject({ status: "ACTIVE", tokenVersion: 0 });
    expect(st.handovers).toBe(0);
  });

  it("deactivates and hands over as before when it is free", async () => {
    const out = await scimDeprovision("org", "u1");
    expect(out).toEqual({ ok: true, alreadyInactive: false, recipientId: "u-dana" });
    // D4: nowhere else to work, so the account ends, and its sessions with it.
    expect(db.row("user", "u1")).toMatchObject({ status: "INACTIVE", deletedAt: null, tokenVersion: 1 });
    expect(st.handovers).toBe(1);
    expect(st.teammateEnds).toEqual([["org", ["u1"], "deactivated"]]);
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
    expect(db.row("user", "u1").status).toBe("INACTIVE");
    expect(logs("membership.handover_pending")).toHaveLength(1);
  });

  it("names the identity provider on the handover's own audit rows", async () => {
    await scimDeprovision("org", "u1");
    expect(st.handoverInput).toMatchObject({ actorId: null, actorType: "scim", actorLabel: "Identity provider" });
  });

  it("a retry finds the seat deactivated with the pending row the latest word, and finishes the handover", async () => {
    st.workFails = true;
    await scimDeprovision("org", "u1");
    st.workFails = false;
    expect(await scimDeprovision("org", "u1")).toEqual({ ok: true, alreadyInactive: true, recipientId: "u-dana" });
    expect(st.handovers).toBe(2);
    expect(db.row("user", "u1").tokenVersion).toBe(1);
  });
});

// Docs-found fixes batch 7: when the account ends, the handover moves every
// report, and the identity provider's row counts the ones who also reported
// to them in another workspace.
describe("scimDeprovision names the reports who also reported to them elsewhere", () => {
  it("moves every report and counts them on the audit row, in plain words", async () => {
    st.alsoElsewhere = [{ id: "r1", name: "Ida Ray" }];
    const out = await scimDeprovision("org", "u1");
    expect(out).toMatchObject({ ok: true });
    // The account ends (D4): no report is left.
    expect(st.handoverInput?.leavesOnlyHere).toBeUndefined();
    const row = logs("membership.changed")[0];
    expect(row?.description).toBe("Your identity provider deactivated Max Chen. 0 open tasks, 0 direct reports and 0 Spaces, Folders and Lists went to Dana Lee. 1 of their reports also reported to them in another workspace, whose Audit log records the move.");
    expect(row?.description).not.toMatch(/stay|--|\u2014/);
  });
});

// Docs-found fixes batch 8, from the batch 7 review: the lines another
// workspace relies on move with the end itself, in its transaction, never in
// a step after it. Step 4: only when the account ends (D4).
describe("scimDeprovision moves the lines another workspace relies on with the end of the account", () => {
  it("moves them inside the end's transaction, before the seat is written, to the recipient, and counts them on the row", async () => {
    st.endMoved = [{ id: "r1", name: "Ida Ray" }];
    expect(await scimDeprovision("org", "u1")).toMatchObject({ ok: true, recipientId: "u-dana" });
    expect(st.endCalls).toEqual([
      { input: { organizationId: "org", leaverId: "u1", recipientId: "u-dana", actorId: null, actorType: "scim", actorLabel: "Identity provider", ends: "deactivated" }, seatWritten: false },
    ]);
    expect(st.endFollowed).toEqual([{ ids: ["r1"], actor: "u-dana" }]);
    const row = logs("membership.changed")[0];
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
    expect(db.row("user", "u1").status).toBe("ACTIVE");
  });
});

// D14 with D3: before, the identity provider of the workspace Max is
// anchored in ended his account, so his other workspace lost him too, and
// every session he had ended.
describe("scimDeprovision of someone who also works in another workspace (D3)", () => {
  beforeEach(() => {
    db.seed("organizationMembership", { id: "m-u1-client", userId: "u1", organizationId: "client", role: "MANAGER" });
  });

  it("moves their account there, keeps the deactivated seat here, and signs them out of nothing", async () => {
    st.staying = [{ id: "r2", name: "Ola Kim" }];
    expect(await scimDeprovision("org", "u1")).toEqual({ ok: true, alreadyInactive: false, recipientId: "u-dana" });
    // Before: { organizationId: "org", status: "INACTIVE", tokenVersion: 1 }.
    expect(db.row("user", "u1")).toMatchObject({ organizationId: "client", status: "ACTIVE", tokenVersion: 0 });
    expect(legacyLevelOfRow(db.row("user", "u1"))).toBe("MANAGER");
    const left = db.tables.organizationMembership.find((m) => m.userId === "u1" && m.organizationId === "org");
    expect(left).toMatchObject({ status: "INACTIVE", removedAt: null });
    // They still manage their reports there: no line moves with the end, and the handover is this workspace's only.
    expect(st.endCalls).toEqual([]);
    expect(st.handoverInput).toMatchObject({ leavesOnlyHere: true });
    expect(logs("membership.handover_pending")[0]?.metadata).toEqual({ recipientId: "u-dana", leavesOnlyHere: true });
    const row = logs("membership.changed")[0];
    expect(row?.description).toBe("Your identity provider deactivated Max Chen in this workspace. 0 open tasks, 0 direct reports and 0 Spaces, Folders and Lists went to Dana Lee. 1 direct report stays listed under them: another workspace they both work in relies on that line, and their open reviews here went to the same person.");
  });

  it("revokes the API keys they made here and ends their open invitations here, as any end of a seat does", async () => {
    db.seed("apiKey", { id: "k1", name: "Sync", prefix: "wk_live_abcd", organizationId: "org", createdById: "u1", revokedAt: null });
    db.seed("apiKey", { id: "k2", name: "Theirs", prefix: "wk_live_efgh", organizationId: "client", createdById: "u1", revokedAt: null });
    db.seed("invitation", { id: "i1", token: "t1", email: "MAX@x.test", organizationId: "org", accepted: false, expiresAt: new Date(Date.now() + 86_400_000) });
    await scimDeprovision("org", "u1");
    expect(db.row("apiKey", "k1").revokedAt).toBeInstanceOf(Date);
    expect(db.row("apiKey", "k2").revokedAt).toBeNull();
    expect((db.row("invitation", "i1").expiresAt as Date).getTime()).toBeLessThanOrEqual(Date.now());
    expect(logs("api_key_revoked")[0]).toMatchObject({ actorId: null, actorType: "scim", actorLabel: "Identity provider" });
  });

  it("a retry comes in by the membership door, finds the seat deactivated, and finishes a pending handover there only", async () => {
    st.workFails = true;
    expect(await scimDeprovision("org", "u1")).toMatchObject({ ok: false, status: 503 });
    st.workFails = false;
    expect(await scimDeprovisionMember("org", "u1")).toEqual({ ok: true, alreadyInactive: true, recipientId: "u-dana" });
    expect(st.handoverInput).toMatchObject({ leavesOnlyHere: true });
  });
});

// Docs-found fixes batch 7, from the batch 6 review: someone who works here
// through a membership could never be found by the identity provider. Step
// 4 (D5, D8): their membership here is deactivated, never deleted, and
// nothing about their account changes.
describe("scimDeprovisionMember", () => {
  beforeEach(() => {
    db.row("user", "u1").organizationId = "client";
    db.seed("organizationMembership", { id: "m-u1-org", userId: "u1", organizationId: "org", role: "EMPLOYEE" });
  });

  it("deactivates the membership here, never the account, and hands their work here over, keeping lines another workspace relies on", async () => {
    st.staying = [{ id: "r1", name: "Ida Ray" }];
    const out = await scimDeprovisionMember("org", "u1");
    expect(out).toEqual({ ok: true, alreadyInactive: false, recipientId: "u-dana" });
    // Before: the row deleted, and the account's tokenVersion bumped.
    expect(db.row("organizationMembership", "m-u1-org")).toMatchObject({ status: "INACTIVE", removedAt: null });
    expect(db.row("user", "u1")).toMatchObject({ organizationId: "client", status: "ACTIVE", tokenVersion: 0 });
    expect(st.handoverInput).toMatchObject({ organizationId: "org", fromId: "u1", toId: "u-dana", actorId: null, actorType: "scim", leavesOnlyHere: true });
    expect(logs("membership.handover_pending")[0]).toMatchObject({ metadata: { recipientId: "u-dana", leavesOnlyHere: true, member: true } });
    const row = logs("membership.changed")[0];
    expect(row?.description).toBe("Your identity provider deactivated Max Chen in this workspace. 0 open tasks, 0 direct reports and 0 Spaces, Folders and Lists went to Dana Lee. 1 direct report stays listed under them: another workspace they both work in relies on that line, and their open reviews here went to the same person.");
    expect(row?.description).not.toMatch(/--|\u2014/);
    expect(row?.metadata).toMatchObject({ member: true, reportsStaying: 1 });
    expect(st.teammateEnds).toEqual([["org", ["u1"], "deactivated"]]);
  });

  it("a retry once the seat has ended finishes a pending handover, else answers a harmless success", async () => {
    db.row("organizationMembership", "m-u1-org").status = "INACTIVE";
    db.seed("activityLog", { id: "p1", type: "membership.handover_pending", organizationId: "org", targetType: "user", targetId: "u1", actorType: "scim", metadata: { member: true }, createdAt: new Date() });
    expect(await scimDeprovisionMember("org", "u1")).toEqual({ ok: true, alreadyInactive: true, recipientId: "u-dana" });
    expect(st.handovers).toBe(1);
    expect(st.handoverInput).toMatchObject({ leavesOnlyHere: true });
    db.seed("activityLog", { id: "p2", type: "membership.changed", organizationId: "org", targetType: "user", targetId: "u1", actorType: "scim", metadata: { member: true }, createdAt: new Date(Date.now() + 1000) });
    expect(await scimDeprovisionMember("org", "u1")).toEqual({ ok: true, alreadyInactive: true, recipientId: null });
    expect(st.handovers).toBe(1);
  });

  it("refuses the workspace's last Owner, ending nothing", async () => {
    st.lastOwner = true;
    const out = await scimDeprovisionMember("org", "u1");
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(db.row("organizationMembership", "m-u1-org").status).toBe("ACTIVE");
    expect(db.row("user", "u1").tokenVersion).toBe(0);
    expect(st.handovers).toBe(0);
    expect(logs("membership.refused")[0]).toMatchObject({ metadata: { member: true } });
  });

  it("answers 503 when the role lock is busy, ending nothing", async () => {
    st.busy = true;
    expect(await scimDeprovisionMember("org", "u1")).toMatchObject({ ok: false, status: 503 });
    expect(db.row("organizationMembership", "m-u1-org").status).toBe("ACTIVE");
  });

  // The step 4 review L4: the door is a hint. A switch landing between the
  // route's read and this call changes which row holds the seat here; both
  // doors end the same seat, so the call ends the seat held here now.
  // Before step 4's review fixes: 409 "User not found", and some identity
  // providers never retry a 409, so the fired person kept the seat.
  it("ends the seat held here now when a switch raced the call, whichever door it came by", async () => {
    db.row("user", "u1").organizationId = "org";
    expect(await scimDeprovisionMember("org", "u1")).toMatchObject({ ok: true, alreadyInactive: false });
    // Anchored here with nowhere else to work: the account ends (D4).
    expect(db.row("user", "u1")).toMatchObject({ status: "INACTIVE", tokenVersion: 1 });
    expect(logs("membership.handover_pending")[0]?.metadata).toEqual({ recipientId: "u-dana", leavesOnlyHere: false });
  });

  it("the anchored door ends a membership seat when the person switched away a moment before", async () => {
    expect(await scimDeprovision("org", "u1")).toMatchObject({ ok: true, alreadyInactive: false });
    expect(db.row("organizationMembership", "m-u1-org")).toMatchObject({ status: "INACTIVE", removedAt: null });
    expect(db.row("user", "u1")).toMatchObject({ organizationId: "client", status: "ACTIVE", tokenVersion: 0 });
    expect(logs("membership.handover_pending")[0]?.metadata).toEqual({ recipientId: "u-dana", leavesOnlyHere: true, member: true });
  });

  it("an Owner here through a membership is deactivated with their work left with them, the row naming who holds Owner", async () => {
    st.owner = true;
    expect(await scimDeprovisionMember("org", "u1")).toEqual({ ok: true, alreadyInactive: false, recipientId: null });
    expect(db.row("organizationMembership", "m-u1-org").status).toBe("INACTIVE");
    expect(st.handovers).toBe(0);
    expect(logs("membership.changed")[0]?.description).toBe("Your identity provider deactivated Max Chen in this workspace, an Owner. Owner is now held by Olive Ng. Their work stays with them: hand it over from Members when you are sure they have left.");
  });
});

// Docs-found fixes batch 8 nulled a member's check-ins here when SCIM deleted
// their membership, the one delete of a membership in the code. Step 4 (D8):
// the membership is kept, deactivated, so their rows stay this workspace's,
// as a deactivated person's anchored here do (check-in-access.server.ts THE
// LEAVING), and come back with a reactivation.
describe("scimDeprovisionMember and the person's check-ins here", () => {
  beforeEach(() => {
    db.row("user", "u1").organizationId = "client";
    db.seed("organizationMembership", { id: "m-u1-org", userId: "u1", organizationId: "org", role: "EMPLOYEE" });
    db.seed("checkIn", { id: "c1", userId: "u1", organizationId: "org", mood: 3 });
  });

  it("leaves their check-ins written here this workspace's (the seat is kept)", async () => {
    expect(await scimDeprovisionMember("org", "u1")).toMatchObject({ ok: true });
    // Before: { organizationId: null }.
    expect(db.row("checkIn", "c1").organizationId).toBe("org");
  });
});

// Docs-found fixes batch 9, from the batch 8 review: old data, a membership
// row a build before step 4 deleted.
describe("scimDeprovisionMember, once the membership row is gone (old data), and its time", () => {
  beforeEach(() => {
    db.row("user", "u1").organizationId = "client";
    db.seed("checkIn", { id: "c1", userId: "u1", organizationId: "org", mood: 3 });
  });

  it("a retry that finds the membership gone makes their check-ins here theirs alone, under the lock, finished or not", async () => {
    db.seed("activityLog", { id: "p1", type: "membership.changed", organizationId: "org", targetType: "user", targetId: "u1", actorType: "scim", metadata: { member: true }, createdAt: new Date() });
    expect(await scimDeprovisionMember("org", "u1")).toEqual({ ok: true, alreadyInactive: true, recipientId: null });
    expect(db.row("checkIn", "c1").organizationId).toBeNull();
    db.row("checkIn", "c1").organizationId = "org";
    db.seed("activityLog", { id: "p2", type: "membership.handover_pending", organizationId: "org", targetType: "user", targetId: "u1", actorType: "scim", metadata: { member: true }, createdAt: new Date(Date.now() + 1000) });
    expect(await scimDeprovisionMember("org", "u1")).toEqual({ ok: true, alreadyInactive: true, recipientId: "u-dana" });
    expect(db.row("checkIn", "c1").organizationId).toBeNull();
    expect(st.handoverInput).toMatchObject({ leavesOnlyHere: true });
  });

  it("nulls nothing where they are anchored here by the time it looks", async () => {
    st.anchorOnLock = "org";
    await scimDeprovisionMember("org", "u1");
    expect(db.row("checkIn", "c1").organizationId).toBe("org");
  });

  it("gives both doors' transactions LOCKED_TX's time", async () => {
    db.seed("organizationMembership", { id: "m-u1-org", userId: "u1", organizationId: "org", role: "EMPLOYEE" });
    await scimDeprovisionMember("org", "u1");
    // Before batch 9: Prisma's default of 5 seconds.
    expect(st.txOpts[0]).toEqual({ timeout: 10_000 });
    st.txOpts = [];
    db.seed("user", { id: "u2", email: "ann@x.test", firstName: "Ann", lastName: "Bo", organizationId: "org", ...legacyLevelRow("EMPLOYEE") });
    await scimDeprovision("org", "u2");
    expect(st.txOpts[0]).toEqual({ timeout: 10_000 });
  });
});
