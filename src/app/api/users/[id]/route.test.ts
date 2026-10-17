// PATCH and DELETE /api/users/[id], the leaving half of AI teammates Phase 3
// (docs/plans/ai-teammates-phase3.md step 2, Decision 20): deactivating or
// removing someone ends their Google connection for AI teammates in this
// workspace, after the write commits, and a failure there never fails the
// edit (the cron sweep ends what it misses). Before step 2 nothing ended it:
// a deactivated person's tokens stayed until the person came back to remove
// them, which they no longer could. AI teammates Phase 4 (Decision 27): the
// same hook closes their teammates' browsers too (leaver-hooks.ts
// endTeammateAccessFor, its two halves mocked here as the modules they are).

import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  endConnectionsFor: vi.fn(async () => 1),
  endBrowserSessionsFor: vi.fn(async () => 1),
  // Phase 5 step 3 (Decision 14): a deactivation marks the person's skills here, a reactivation clears them.
  markSkillsOrphaned: vi.fn<(where: unknown, now: unknown) => Promise<number>>(async () => 1),
  skillsBackFor: vi.fn<(org: string, ids: readonly string[]) => Promise<void>>(async () => undefined),
  updates: [] as Array<Record<string, unknown>>,
  /** The target's row, as findFirst answers it. */
  target: {} as Record<string, unknown>,
  /** The withdrawnAt of the target's newest erasure provenance record, or null (review rounds 8 and 9 of Phase 3). */
  erasedAt: null as Date | null,
  /** The target's deletedAt as the database holds it when the removal writes, when the route's read was stale (review round 9 of Phase 3). */
  dbDeletedAt: undefined as Date | null | undefined,
  /** Other people, by id, as a manager lookup reads them (docs-found fixes batch 3). */
  people: {} as Record<string, { organizationId: string; accessLevel: string; status: string; deletedAt: Date | null; firstName: string; lastName: string }>,
  /** The target's dotted-line managers. */
  dotted: [] as string[],
  dottedDeleted: [] as string[][],
  logs: [] as Array<{ type: string; description: string; oldValue?: unknown; newValue?: unknown }>,
  locks: [] as string[],
  /** The role lock is busy (membership.ts lockOrgRoles throws OrgRolesBusy). */
  busy: false,
  /** The seat lock is busy (seats.ts lockWorkspaceSeats throws SeatsBusy, batch 5). */
  seatsBusy: false,
  /** People anchored elsewhere who hold a membership here, with its role (batch 5). */
  memberships: {} as Record<string, string>,
  /** Memberships in other workspaces, by person, with their role there (batch 6). */
  elsewhere: {} as Record<string, Record<string, string>>,
  /** The direct reports the handover would still move, as read under the role lock (batch 6). */
  reportsUnderLock: 0,
  /** The keys the field whitelist was asked about (batch 7). */
  checkedKeys: [] as string[],
  /** The step that ends the account (batch 8): its calls, and where they fell. */
  endCalls: [] as Array<{ input: Record<string, unknown>; locksBefore: number; updatesBefore: number }>,
  /** What moveReliedReportsAtEnd answers. */
  endMoved: [] as Array<{ id: string; name: string | null }>,
  /** pendingHandover's answer before the lock (batch 8: DELETE asks too). */
  pending: { openTasks: 0, directReports: 0, containers: 0 },
  /** Its open tasks and Spaces, Folders and Lists read again under the lock (batch 9); the reports are reportsUnderLock. */
  underLock: { openTasks: 0, containers: 0 },
  /** Its calls under the lock: the transaction it was given (batch 9). */
  pendingInTx: 0,
  /** The handover's rule (person-access.server.ts mayHandOverPerson, batch 9), as the actor here answers it. */
  mayHandOver: true,
  followed: [] as string[][],
  /** Live Owners (batch 8: an Owner's removal or deactivation is refused for an Admin who is none). */
  owners: new Set<string>(),
}));

const TARGET = { id: "u-max", organizationId: "org1", ...legacyLevelRow("EMPLOYEE"), roleId: null, managerId: null, deletedAt: null, status: "ACTIVE", firstName: "Max", lastName: "Chen" };

vi.mock("@/lib/prisma", () => {
  const user = {
    // A manager lookup (managerCandidateIn) names someone in st.people, with
    // its where checked; anything else reads the target.
    findFirst: async (a: { where?: { id?: string; organizationId?: string; deletedAt?: null } } = {}) => {
      const p = a.where?.id ? st.people[a.where.id] : undefined;
      if (!p) return { ...st.target };
      if (a.where?.organizationId && p.organizationId !== a.where.organizationId) return null;
      if (a.where && "deletedAt" in a.where && p.deletedAt) return null;
      return { id: a.where?.id, ...p };
    },
    findMany: async (a: { where: { id: { in: string[] } } }) => a.where.id.in.filter((id) => st.people[id]).map((id) => ({ id, ...st.people[id] })),
    findUnique: async () => ({ ...st.target }),
    update: async (a: { data: Record<string, unknown> }) => {
      st.updates.push(a.data);
      return { ...st.target, status: typeof a.data.status === "string" ? a.data.status : st.target.status };
    },
    // As Postgres answers it: a where on deletedAt is checked against the row as it is now.
    updateMany: async (a: { where: { id: string; deletedAt?: null }; data: Record<string, unknown> }) => {
      const now = st.dbDeletedAt === undefined ? st.target.deletedAt : st.dbDeletedAt;
      if ("deletedAt" in a.where && a.where.deletedAt === null && now != null) return { count: 0 };
      st.updates.push(a.data);
      return { count: 1 };
    },
    count: async () => 2,
  };
  const consentRecord = {
    findFirst: async (a: { where: { userId: string; method: string; withdrawnAt: unknown } }) =>
      st.erasedAt && a.where.method === "erasure" && JSON.stringify(a.where.withdrawnAt) === JSON.stringify({ not: null }) ? { id: "c1", withdrawnAt: st.erasedAt } : null,
  };
  const userDottedLine = {
    findMany: async () => st.dotted.map((managerId) => ({ managerId })),
    deleteMany: async (a: { where: { managerId: { in: string[] } } }) => { st.dottedDeleted.push(a.where.managerId.in); return { count: a.where.managerId.in.length }; },
  };
  // A person anchored elsewhere works here through a membership (acting-workspace.ts levelHeldIn).
  const organizationMembership = {
    findUnique: async (a: { where: { userId_organizationId: { userId: string } } }) => {
      const role = st.memberships[a.where.userId_organizationId.userId];
      return role ? { role } : null;
    },
    findMany: async (a: { where: { userId: { in: string[] }; organizationId?: string | { not?: string; in?: string[] } } }) => {
      const w = a.where.organizationId;
      // Memberships in other workspaces (batch 6), read with { not } or { in }.
      if (w && typeof w === "object") {
        return a.where.userId.in.flatMap((userId) =>
          Object.entries(st.elsewhere[userId] ?? {})
            .filter(([org]) => (w.not === undefined || org !== w.not) && (w.in === undefined || w.in.includes(org)))
            .map(([organizationId, role]) => ({ userId, organizationId, role })),
        );
      }
      return a.where.userId.in.filter((id) => st.memberships[id]).map((userId) => ({ userId, organizationId: "org1", role: st.memberships[userId] }));
    },
  };
  // As Postgres runs it: a callback that throws rolls back what it wrote (batch 7).
  const $transaction = async (fn: (tx: unknown) => unknown) => {
    const before = { updates: st.updates.length, dotted: st.dottedDeleted.length };
    try {
      return await fn({ user, userDottedLine, organizationMembership });
    } catch (e) {
      st.updates.length = before.updates;
      st.dottedDeleted.length = before.dotted;
      throw e;
    }
  };
  // The record GET's other reads (batch 7).
  const organization = { findUnique: async () => ({ settings: {} }) };
  const kudos = { findMany: async () => [] };
  return { prisma: { user, consentRecord, userDottedLine, organizationMembership, organization, kudos, $transaction } };
});
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "u-admin" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async (row: { type: string; description: string }) => { st.logs.push(row); } }));
vi.mock("@/lib/connectors/connections", () => ({ endConnectionsFor: st.endConnectionsFor }));
vi.mock("@/lib/browser/sessions", () => ({ endBrowserSessionsFor: st.endBrowserSessionsFor }));
vi.mock("@/lib/skills/store", () => ({ markSkillsOrphaned: st.markSkillsOrphaned, skillsBackFor: st.skillsBackFor }));
vi.mock("@/lib/access/flags", () => ({ accessV2Resolver: () => false }));
vi.mock("@/lib/access/workspace-admin", () => ({ freshWorkspaceActor: async () => ({ ok: true, admin: true, owner: false }) }));
vi.mock("@/lib/access/membership", () => ({
  applyRoleChange: vi.fn(),
  isLiveOwner: async (_org: string, id: string) => st.owners.has(id),
  lockOrgRoles: async () => {
    st.locks.push("roles");
    if (st.busy) throw Object.assign(new Error("busy"), { name: "OrgRolesBusy" });
  },
  roleChangeSentence: () => "",
  wouldRemoveLastOwner: async () => false,
}));
vi.mock("@/lib/seats", () => ({
  lockWorkspaceSeats: async (_tx: unknown, _org: string, opts?: { bounded?: boolean }) => {
    st.locks.push(opts?.bounded ? "seats-bounded" : "seats");
    if (st.seatsBusy) throw Object.assign(new Error("Someone else is adding people or changing seats in this workspace right now. Try again in a moment."), { name: "SeatsBusy" });
  },
  seatsFor: async () => ({ ok: true }),
}));
vi.mock("@/lib/people/person-access.server", () => ({
  peopleCtx: async () => ({ userId: "u-admin", organizationId: "org1", isAdmin: true, managerTier: true, peopleTeam: false }),
  relationTo: () => "admin",
  checkManagerCandidate: async () => "ok",
  managerMapFor: async () => new Map(),
  // The Admin acting here may remove anyone but themselves (batch 8: the rule is person-access-anchor.test.ts's).
  mayRemovePerson: (_ctx: unknown, relation: string) => relation !== "self",
  // The handover's narrower rule (batch 9), tested in person-access-anchor.test.ts.
  mayHandOverPerson: () => st.mayHandOver,
}));
vi.mock("@/lib/people/person-fields", () => ({
  PERSON_FIELD_GROUP: { status: "membership" },
  PERSON_FIELD_LABEL: {},
  canWritePersonField: () => true,
  checkPersonPatch: (body: Record<string, unknown>) => { st.checkedKeys = Object.keys(body); return { unknown: [], forbidden: [] }; },
  dobOverwriteAllowed: () => true,
  seesFullBirthday: () => true,
  visibleStatus: (s: string) => s,
}));
vi.mock("@/lib/people/handover.server", () => ({
  // Before the lock it reads prisma; under it, the caller's transaction (batch 9).
  pendingHandover: async (_org: string, _id: string, db?: unknown) => {
    if (!db) return { ...st.pending };
    st.pendingInTx += 1;
    return { openTasks: st.underLock.openTasks, directReports: st.reportsUnderLock, containers: st.underLock.containers };
  },
  handoverReportCount: async () => st.reportsUnderLock,
  // The step that ends the account (batch 8): its move is a user write in
  // the caller's transaction, so a rollback takes it back.
  moveReliedReportsAtEnd: async (_tx: unknown, input: Record<string, unknown>) => {
    st.endCalls.push({ input, locksBefore: st.locks.length, updatesBefore: st.updates.length });
    if (st.endMoved.length) st.updates.push({ movedReports: st.endMoved.map((m) => m.id) });
    return { reportsMoved: st.endMoved.length, reportsReassigned: st.endMoved.length, reportsRehomed: [], reportsAlsoElsewhere: [...st.endMoved], reportIds: st.endMoved.map((m) => m.id) };
  },
  followAccountEndLines: async (_org: string, done: { reportIds: string[] }) => { if (done.reportIds.length) st.followed.push(done.reportIds); },
}));
vi.mock("@/lib/performance/review-cycle.server", () => ({ followReportingLine: async () => undefined }));
vi.mock("@/services/performanceScoreService", () => ({ getLatestScore: async () => null, getScoreHistory: async () => [] }));
vi.mock("@/lib/alignment-assign", () => ({ seedAlignmentForUser: async () => undefined }));
vi.mock("@/lib/people/reporting-lines", () => ({ wouldCreateCycle: () => false }));
vi.mock("@/lib/people/directory-list.server", () => ({ presenceFor: async () => new Map() }));
vi.mock("@/lib/review-cadence", () => ({ getScoringBands: async () => [] }));
vi.mock("@/lib/people/score-band", () => ({ scoreBand: () => null }));
vi.mock("@/lib/people/review-visibility", () => ({ subjectRowView: (r: unknown) => r }));
vi.mock("@/lib/people/profile-fields", () => ({ profileFieldRows: () => [], readProfileFieldDefs: () => [], validateProfileValues: () => ({ ok: true, set: {}, remove: [] }) }));
vi.mock("@/lib/work-schedule", () => ({
  effectivePersonSchedule: () => ({}),
  nominalWeekHours: () => 40,
  readPersonScheduleOverride: () => null,
  validatePersonScheduleOverride: () => ({ ok: true, value: null }),
}));
vi.mock("@/lib/work-schedule-server", () => ({ readOrgWorkSchedule: async () => ({ workdays: [1, 2, 3, 4, 5], hoursPerDay: 8 }) }));

import { applyRoleChange } from "@/lib/access/membership";
import { DELETE, GET, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "u-max" }) };

function patch(body: unknown) {
  return PATCH(new NextRequest("https://app.test/api/users/u-max", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params);
}

beforeEach(() => {
  st.endConnectionsFor.mockReset().mockResolvedValue(1);
  st.endBrowserSessionsFor.mockReset().mockResolvedValue(1);
  st.markSkillsOrphaned.mockReset().mockResolvedValue(1);
  st.skillsBackFor.mockReset().mockResolvedValue(undefined);
  st.updates = [];
  st.target = { ...TARGET };
  st.erasedAt = null;
  st.dbDeletedAt = undefined;
  st.people = {};
  st.dotted = [];
  st.dottedDeleted = [];
  st.logs = [];
  st.locks = [];
  st.busy = false;
  st.seatsBusy = false;
  st.memberships = {};
  st.elsewhere = {};
  st.reportsUnderLock = 0;
  st.checkedKeys = [];
  st.endCalls = [];
  st.endMoved = [];
  st.pending = { openTasks: 0, directReports: 0, containers: 0 };
  st.underLock = { openTasks: 0, containers: 0 };
  st.pendingInTx = 0;
  st.mayHandOver = true;
  st.followed = [];
  st.owners = new Set();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("leaving ends the person's Google connection for AI teammates", () => {
  it("a deactivation calls endConnectionsFor(org, [id], deactivated, the admin), after the write", async () => {
    const res = await patch({ status: "INACTIVE" });
    expect(res.status).toBe(200);
    expect(st.updates[0]).toMatchObject({ status: "INACTIVE" });
    expect(st.endConnectionsFor).toHaveBeenCalledTimes(1);
    expect(st.endConnectionsFor).toHaveBeenCalledWith("org1", ["u-max"], "deactivated", "u-admin");
    // Phase 4: endTeammateAccessFor closes their teammates' browsers here too.
    expect(st.endBrowserSessionsFor).toHaveBeenCalledTimes(1);
    expect(st.endBrowserSessionsFor).toHaveBeenCalledWith("org1", ["u-max"], "deactivated", "u-admin");
    // Phase 5 step 3: and their skills here begin their 30 days; nothing is cleared.
    expect(st.markSkillsOrphaned).toHaveBeenCalledTimes(1);
    expect(st.markSkillsOrphaned.mock.calls[0][0]).toEqual({ organizationId: "org1", userIds: ["u-max"] });
    expect(st.skillsBackFor).not.toHaveBeenCalled();
  });

  it("a reactivation clears the person's skills' 30 days here, after the write; another edit clears nothing (Phase 5 step 3)", async () => {
    st.target = { ...TARGET, status: "INACTIVE" };
    const res = await patch({ status: "ACTIVE" });
    expect(res.status).toBe(200);
    // Before: nothing cleared, so a skill was deleted 30 days after the deactivation it outlived.
    expect(st.skillsBackFor.mock.calls).toEqual([["org1", ["u-max"]]]);
    expect(st.markSkillsOrphaned).not.toHaveBeenCalled();
    st.skillsBackFor.mockClear();
    st.target = { ...TARGET };
    expect((await patch({ status: "ON_LEAVE" })).status).toBe(200);
    expect(st.skillsBackFor).not.toHaveBeenCalled();
  });

  it("another status change ends nothing", async () => {
    const res = await patch({ status: "ON_LEAVE" });
    expect(res.status).toBe(200);
    expect(st.endConnectionsFor).not.toHaveBeenCalled();
    expect(st.endBrowserSessionsFor).not.toHaveBeenCalled();
  });

  it("never fails the deactivation when ending the connection fails, and still closes the browsers", async () => {
    st.endConnectionsFor.mockRejectedValueOnce(new Error("database down"));
    const res = await patch({ status: "INACTIVE" });
    expect(res.status).toBe(200);
    expect(st.endBrowserSessionsFor).toHaveBeenCalledWith("org1", ["u-max"], "deactivated", "u-admin");
  });

  it("never fails the deactivation when closing the browsers fails", async () => {
    st.endBrowserSessionsFor.mockRejectedValueOnce(new Error("provider down"));
    const res = await patch({ status: "INACTIVE" });
    expect(res.status).toBe(200);
  });

  it("removing someone calls endConnectionsFor(org, [id], left, the admin)", async () => {
    const res = await DELETE(new NextRequest("https://app.test/api/users/u-max", { method: "DELETE" }), params);
    expect(res.status).toBe(200);
    expect(st.endConnectionsFor).toHaveBeenCalledWith("org1", ["u-max"], "left", "u-admin");
    expect(st.endBrowserSessionsFor).toHaveBeenCalledWith("org1", ["u-max"], "left", "u-admin");
  });

  // Review of step 2: an agent account can hold no connection (Decision 27).
  // Before, a role change ran no hook and the tokens stayed for good.
  it("making someone an agent account ends their connection (no_access), after the role change", async () => {
    vi.mocked(applyRoleChange).mockResolvedValueOnce({
      ok: true,
      changed: true,
      targetName: "Max Chen",
      before: { level: "EMPLOYEE", role: "MEMBER" },
      after: { level: "AGENT", role: "MEMBER" },
      bumped: true,
    });
    const res = await patch({ orgRole: "MEMBER", memberTier: "AGENT" });
    expect(res.status).toBe(200);
    expect(st.endConnectionsFor).toHaveBeenCalledWith("org1", ["u-max"], "no_access", "u-admin");
    expect(st.endBrowserSessionsFor).toHaveBeenCalledWith("org1", ["u-max"], "no_access", "u-admin");
  });

  it("another role change ends nothing", async () => {
    vi.mocked(applyRoleChange).mockResolvedValueOnce({
      ok: true,
      changed: true,
      targetName: "Max Chen",
      before: { level: "EMPLOYEE", role: "MEMBER" },
      after: { level: "MANAGER", role: "MEMBER" },
      bumped: false,
    });
    const res = await patch({ orgRole: "MEMBER", memberTier: "MANAGER" });
    expect(res.status).toBe(200);
    expect(st.endConnectionsFor).not.toHaveBeenCalled();
  });

  // Docs-found fixes batch 2: the planner refuses an Agent with reports
  // (membership.ts rule 6), and the drawer shows the route's answer on the
  // Tier row. Before, every 409 was coded last_owner.
  it("answers a refused Agent change with the planner's own code and sentence, writing nothing", async () => {
    const sentence = "An Agent can't be anyone's manager, and 2 people report to them. Move their reports to someone else first.";
    vi.mocked(applyRoleChange).mockResolvedValueOnce({ ok: false, status: 409, error: sentence, code: "agent_has_reports" });
    const res = await patch({ orgRole: "MEMBER", memberTier: "AGENT" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: sentence, code: "agent_has_reports", fields: ["orgRole"] });
    expect(st.updates).toEqual([]);
    expect(st.endConnectionsFor).not.toHaveBeenCalled();
  });
});

// Review round 8 of Phase 3: an Admin's restore set deletedAt back to null on
// an account its own person erased, and an edit could name the "Deleted User"
// again; the erasure sweep then never recognised the account, so their AI
// teammates' words stayed for good, and the account was named again.
describe("an account its own person erased is never restored or edited", () => {
  const ERASED = { ...TARGET, firstName: "Deleted", lastName: "User", email: "deleted-u-max@workwrk.anon", status: "INACTIVE", deletedAt: new Date("2026-10-01T09:00:00Z") };
  const restore = () => DELETE(new NextRequest("https://app.test/api/users/u-max?restore=true", { method: "DELETE" }), params);

  it("refuses the restore with account_erased, and writes nothing", async () => {
    st.target = { ...ERASED };
    st.erasedAt = ERASED.deletedAt;
    const res = await restore();
    // Before: 200, deletedAt null and status ACTIVE.
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "This person deleted their own account, so it can't be changed or restored. Invite them again if they're coming back.",
      code: "account_erased",
    });
    expect(st.updates).toEqual([]);
  });

  it("refuses an edit of their name, or any field, with account_erased", async () => {
    st.target = { ...ERASED };
    st.erasedAt = ERASED.deletedAt;
    for (const body of [{ firstName: "Max", lastName: "Chen" }, { phone: "+44 7700 900000" }, { status: "ACTIVE" }, { status: "INACTIVE", firstName: "Max" }]) {
      const res = await patch(body);
      // Before: 200, the name written onto the anonymised row.
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("account_erased");
    }
    expect(st.updates).toEqual([]);
  });

  it("still lets an Admin deactivate an erased account restored before this fix", async () => {
    st.target = { ...ERASED, deletedAt: null, status: "ACTIVE" };
    st.erasedAt = ERASED.deletedAt;
    const res = await patch({ status: "INACTIVE" });
    expect(res.status).toBe(200);
    expect(st.updates[0]).toMatchObject({ status: "INACTIVE" });
  });

  it("still restores an account an Admin removed, which no erasure of its own marks", async () => {
    st.target = { ...TARGET, deletedAt: new Date("2026-10-01T09:00:00Z"), status: "INACTIVE" };
    const res = await restore();
    expect(res.status).toBe(200);
    expect(st.updates[0]).toEqual({ deletedAt: null, status: "ACTIVE" });
  });

  it("still edits a normal account's name", async () => {
    const res = await patch({ firstName: "Maxine" });
    expect(res.status).toBe(200);
    expect(st.updates[0]).toMatchObject({ firstName: "Maxine" });
  });
});

// Review round 9 of Phase 3: round 8 called an account erased whenever its
// erasure record existed, so an erased account an Admin restored before
// round 8, in use again, could not be edited at all (a role change included),
// nor restored after an Admin removed it. Now an account is erased only while
// its deletedAt is within a minute of its newest erasure record.
describe("an erased account no longer in the state its erasure left it is an ordinary account", () => {
  const ERASED_AT = new Date("2026-10-01T09:00:00Z");
  const restore = () => DELETE(new NextRequest("https://app.test/api/users/u-max?restore=true", { method: "DELETE" }), params);
  const remove = () => DELETE(new NextRequest("https://app.test/api/users/u-max", { method: "DELETE" }), params);

  it("edits an erased account an Admin restored before round 8, every field and its role", async () => {
    st.target = { ...TARGET, firstName: "Deleted", lastName: "User", deletedAt: null, status: "ACTIVE" };
    st.erasedAt = ERASED_AT;
    vi.mocked(applyRoleChange).mockClear();
    vi.mocked(applyRoleChange).mockResolvedValueOnce({
      ok: true,
      changed: true,
      targetName: "Max Chen",
      before: { level: "EMPLOYEE", role: "MEMBER" },
      after: { level: "MANAGER", role: "MEMBER" },
      bumped: false,
    });
    for (const body of [{ firstName: "Max", lastName: "Chen" }, { phone: "+44 7700 900000" }, { status: "ON_LEAVE" }, { orgRole: "MEMBER", memberTier: "MANAGER" }]) {
      const res = await patch(body);
      // Before: 409 account_erased on every one.
      expect(res.status).toBe(200);
    }
    expect(st.updates.slice(0, 3)).toEqual([{ firstName: "Max", lastName: "Chen" }, { phone: "+44 7700 900000" }, { status: "ON_LEAVE" }]);
    expect(vi.mocked(applyRoleChange).mock.calls[0]?.[1]).toMatchObject({ targetId: "u-max", next: { role: "MEMBER", tier: "MANAGER" } });
  });

  it("restores one an Admin removed after such a restore, and removes it again", async () => {
    st.target = { ...TARGET, deletedAt: new Date("2026-10-20T09:00:00Z"), status: "INACTIVE" };
    st.erasedAt = ERASED_AT;
    const res = await restore();
    // Before: 409 account_erased.
    expect(res.status).toBe(200);
    expect(st.updates[0]).toEqual({ deletedAt: null, status: "ACTIVE" });
    st.target = { ...TARGET, deletedAt: null };
    const again = await remove();
    expect(again.status).toBe(200);
    expect(st.updates[1]).toMatchObject({ status: "INACTIVE", deletedAt: expect.any(Date) });
  });

  it("goes by the minute's edge: a restore 60 seconds from the erasure is refused, 60.001 seconds from it goes through", async () => {
    st.erasedAt = ERASED_AT;
    st.target = { ...TARGET, deletedAt: new Date(ERASED_AT.getTime() + 60_000), status: "INACTIVE" };
    expect((await restore()).status).toBe(409);
    st.target = { ...TARGET, deletedAt: new Date(ERASED_AT.getTime() - 60_000), status: "INACTIVE" };
    expect((await restore()).status).toBe(409);
    expect(st.updates).toEqual([]);
    st.target = { ...TARGET, deletedAt: new Date(ERASED_AT.getTime() + 60_001), status: "INACTIVE" };
    // Before: 409, any erasure record refused it.
    expect((await restore()).status).toBe(200);
    expect(st.updates).toEqual([{ deletedAt: null, status: "ACTIVE" }]);
  });

  it("a second removal of an account in the erased state leaves its deletedAt where the erasure put it", async () => {
    // Already removed: People offers no Remove, and the route refuses it, writing nothing.
    st.target = { ...TARGET, firstName: "Deleted", lastName: "User", deletedAt: ERASED_AT, status: "INACTIVE" };
    st.erasedAt = ERASED_AT;
    expect((await remove()).status).toBe(403);
    expect(st.updates).toEqual([]);
    // A removal whose read came just before the person's own erasure
    // committed: the database holds the erasure's deletedAt by the write.
    st.target = { ...TARGET };
    st.dbDeletedAt = ERASED_AT;
    const res = await remove();
    // Before: deletedAt moved to the removal's moment, so the account left
    // the erased state and the sweep never blanked its words.
    expect(res.status).toBe(200);
    expect(st.updates).toEqual([]);
    expect(st.endConnectionsFor).not.toHaveBeenCalled();
  });
});

// Docs-found fixes batch 3. Removal keeps a person's manager and dotted
// lines, and while they were gone that manager may have moved to the Agent
// tier (rule 6 never counted them: removed people are left out of
// reportCountOf), been deactivated, or left. A restore used to write
// { deletedAt: null, status: "ACTIVE" } and nothing else, so the person came
// back under an Agent, who then read their people data and was their manager
// reviewer. The restore now checks the lines again under the role lock,
// clears what fails, and logs it.
describe("a restore re-checks the person's reporting lines", () => {
  const restore = () => DELETE(new NextRequest("https://app.test/api/users/u-max?restore=true", { method: "DELETE" }), params);
  const person = (level: string, extra: Partial<{ status: string; deletedAt: Date | null; organizationId: string }> = {}) => ({
    organizationId: "org1", ...legacyLevelRow(level), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray", ...extra,
  });
  beforeEach(() => {
    st.target = { ...TARGET, deletedAt: new Date("2026-03-01"), managerId: "x" };
  });

  it("comes back with no manager when the manager has since become an Agent, and says so in the log", async () => {
    st.people.x = person("AGENT");
    const res = await restore();
    expect(res.status).toBe(200);
    expect(st.updates).toContainEqual({ deletedAt: null, status: "ACTIVE", managerId: null });
    expect(st.logs).toContainEqual(expect.objectContaining({
      type: "reporting_line_changed",
      description: "Restored Max Chen with no manager: Dana Ray is on the Agent tier, and an Agent can't be anyone's manager",
      oldValue: { managerId: "x" },
    }));
    expect((await res.json()).message).toBe("Max Chen has been restored with no manager, because Dana Ray is on the Agent tier, and an Agent can't be anyone's manager. Set who they report to in Members.");
  });

  it("also drops a manager who is deactivated or has left, and keeps one who may still manage them", async () => {
    st.people.x = person("MANAGER", { status: "INACTIVE" });
    await restore();
    expect(st.updates.at(-1)).toEqual({ deletedAt: null, status: "ACTIVE", managerId: null });
    st.people.x = person("MANAGER", { deletedAt: new Date("2026-05-01") });
    await restore();
    expect(st.updates.at(-1)).toEqual({ deletedAt: null, status: "ACTIVE", managerId: null });
    st.people.x = person("MANAGER");
    await restore();
    expect(st.updates.at(-1)).toEqual({ deletedAt: null, status: "ACTIVE" });
  });

  it("takes off a dotted line to an Agent or a removed person, and keeps the rest", async () => {
    st.people.x = person("MANAGER");
    st.people.agent = person("AGENT");
    st.people.left = person("MANAGER", { deletedAt: new Date("2026-05-01") });
    st.people.keep = person("DIRECTOR", { status: "INACTIVE" });
    st.dotted = ["agent", "left", "keep"];
    await restore();
    expect(st.dottedDeleted).toEqual([["agent", "left"]]);
    expect(st.logs.filter((l) => l.type === "reporting_line_changed").map((l) => l.description)).toEqual([
      "Restored Max Chen without their dotted line to Dana Ray: Dana Ray is on the Agent tier, and an Agent can't be anyone's manager",
      "Restored Max Chen without their dotted line to Dana Ray: Dana Ray is no longer in the workspace",
    ]);
  });

  it("checks under the role lock, taken before the seats (rule 6's race), and the seat wait is bounded (batch 5)", async () => {
    st.people.x = person("MANAGER");
    await restore();
    expect(st.locks).toEqual(["roles", "seats-bounded"]);
  });
});

describe("a new Reports to is checked again under the role lock (rule 6's race)", () => {
  it("refuses a manager who became an Agent after the first check, and writes nothing", async () => {
    // checkManagerCandidate (mocked) answered "ok" before the lock; under it
    // the manager reads as an Agent now.
    st.people.x = { organizationId: "org1", ...legacyLevelRow("AGENT"), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray" };
    const res = await patch({ managerId: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("agent_cannot_manage");
    expect(st.locks).toContain("roles");
    expect(st.updates).toEqual([]);
  });
});

// Docs-found fixes batch 4.
describe("a new Reports to, checked again under the role lock (batch 4)", () => {
  const manager = (extra: Record<string, unknown> = {}) =>
    ({ organizationId: "org1", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray", ...extra }) as (typeof st.people)[string];

  it("refuses a deactivated manager: a deactivated person holds no reports (invariant 13)", async () => {
    st.people.x = manager({ status: "INACTIVE" });
    const res = await patch({ managerId: "x" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("manager_inactive");
    expect(body.error).not.toMatch(/--|\u2014/);
    expect(st.updates).toEqual([]);
  });

  it("refuses a loop a crossing edit made after the first check", async () => {
    // The first check saw no loop (managerMapFor, mocked); under the lock,
    // x reports to Max now, so Max reporting to x would close a loop.
    st.people.x = manager({ managerId: "u-max" });
    const res = await patch({ managerId: "x" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("manager_cycle");
    expect(st.updates).toEqual([]);
  });

  it("answers 503 roles_busy when the role lock is busy, and writes nothing", async () => {
    st.people.x = manager();
    st.busy = true;
    const res = await patch({ managerId: "x" });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    expect((await res.json()).code).toBe("roles_busy");
    expect(st.updates).toEqual([]);
  });

  it("a restore answers 503 roles_busy the same way", async () => {
    st.target = { ...TARGET, deletedAt: new Date("2026-03-01") };
    st.busy = true;
    const res = await DELETE(new NextRequest("https://app.test/api/users/u-max?restore=true", { method: "DELETE" }), params);
    expect(res.status).toBe(503);
    expect(st.updates).toEqual([]);
  });
});

// Docs-found fixes batch 5, from the batch 4 review.
describe("someone who works here through a membership is still in the workspace", () => {
  const restore = () => DELETE(new NextRequest("https://app.test/api/users/u-max?restore=true", { method: "DELETE" }), params);
  const elsewhere = (level: string) => ({ organizationId: "client", ...legacyLevelRow(level), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray" });

  it("a restore keeps a manager anchored in another workspace who manages here, and says nothing untrue", async () => {
    // Dana last switched to a client workspace; her membership here is a Manager.
    st.target = { ...TARGET, deletedAt: new Date("2026-03-01"), managerId: "dana" };
    st.people.dana = elsewhere("EMPLOYEE");
    st.memberships = { dana: "MANAGER" };
    st.dotted = ["dana"];
    const res = await restore();
    expect(res.status).toBe(200);
    // Before: managerId cleared, the dotted line deleted, and "Max Chen has
    // been restored with no manager, because Dana Ray is no longer in the
    // workspace".
    expect(st.updates).toEqual([{ deletedAt: null, status: "ACTIVE" }]);
    expect(st.dottedDeleted).toEqual([]);
    expect((await res.json()).message).toBe("Max Chen has been restored");
    expect(st.logs.filter((l) => l.type === "reporting_line_changed")).toEqual([]);
  });

  it("a restore still drops a manager who holds no level here, or holds the Agent tier here", async () => {
    st.target = { ...TARGET, deletedAt: new Date("2026-03-01"), managerId: "dana" };
    st.people.dana = elsewhere("MANAGER");
    await restore();
    expect(st.updates.at(-1)).toEqual({ deletedAt: null, status: "ACTIVE", managerId: null });
    st.memberships = { dana: "AGENT" };
    await restore();
    expect(st.updates.at(-1)).toEqual({ deletedAt: null, status: "ACTIVE", managerId: null });
    expect(st.logs.at(-1)?.description).toBe("Restored Max Chen with no manager: Dana Ray is on the Agent tier, and an Agent can't be anyone's manager");
  });

  it("PATCH clears Reports to under the role lock too, as every write of a line is (batch 5)", async () => {
    st.target = { ...TARGET, managerId: "x" };
    const res = await patch({ managerId: null });
    expect(res.status).toBe(200);
    // Before: no lock, so a handover planned under it could log a move that a clear had overtaken.
    expect(st.locks).toEqual(["roles"]);
    expect(st.updates[0]).toEqual({ managerId: null });
  });

  it("PATCH takes a new Reports to who works here through a membership", async () => {
    st.people.dana = elsewhere("EMPLOYEE");
    st.memberships = { dana: "MANAGER" };
    const res = await patch({ managerId: "dana" });
    // Before: 400 "That person isn't in this workspace".
    expect(res.status).toBe(200);
    expect(st.updates[0]).toMatchObject({ managerId: "dana" });
  });
});

describe("a reactivation re-checks the person's lines, as a restore does", () => {
  const person = (level: string, extra: Partial<{ status: string; deletedAt: Date | null; organizationId: string }> = {}) => ({
    organizationId: "org1", ...legacyLevelRow(level), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray", ...extra,
  });
  beforeEach(() => {
    st.target = { ...TARGET, status: "INACTIVE", managerId: "x" };
  });

  it("comes back with no manager when the manager was deactivated meanwhile, logged and said", async () => {
    st.people.x = person("MANAGER", { status: "INACTIVE" });
    const res = await patch({ status: "ACTIVE" });
    expect(res.status).toBe(200);
    // Before: { status: "ACTIVE" } alone, back under a deactivated manager.
    expect(st.updates[0]).toEqual({ status: "ACTIVE", managerId: null });
    const body = await res.json();
    expect(body.message).toBe("Max Chen has been reactivated with no manager, because Dana Ray is deactivated. Set who they report to in Members.");
    expect(body.linesCleared).toEqual([{ managerId: "x", kind: "manager", reason: "inactive" }]);
    expect(st.logs).toContainEqual(expect.objectContaining({ type: "reporting_line_changed", description: "Reactivated Max Chen with no manager: Dana Ray is deactivated", oldValue: { managerId: "x" } }));
  });

  it("takes off a dotted line to an Agent, keeps a live manager, and checks under the role lock then a bounded seat lock", async () => {
    st.people.x = person("MANAGER");
    st.people.agent = person("AGENT");
    st.dotted = ["agent"];
    const res = await patch({ status: "ACTIVE" });
    expect(res.status).toBe(200);
    expect(st.updates[0]).toEqual({ status: "ACTIVE" });
    expect(st.dottedDeleted).toEqual([["agent"]]);
    expect(st.locks).toEqual(["roles", "seats-bounded"]);
  });

  it("leaves a Reports to sent in the same edit to its own check", async () => {
    st.people.x = person("MANAGER", { status: "INACTIVE" });
    st.people.y = person("MANAGER");
    const res = await patch({ status: "ACTIVE", managerId: "y" });
    expect(res.status).toBe(200);
    expect(st.updates[0]).toEqual({ status: "ACTIVE", managerId: "y" });
  });
});

describe("the seat lock after the role lock answers busy, never a 500", () => {
  it("a reactivation answers 503 roles_busy when the seat lock is busy, and writes nothing", async () => {
    st.target = { ...TARGET, status: "INACTIVE" };
    st.seatsBusy = true;
    const res = await patch({ status: "ACTIVE" });
    // Before: the unbounded wait ran into the transaction's timeout, a 500.
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    expect(await res.json()).toEqual({ error: "Someone else is adding people or changing seats in this workspace right now. Try again in a moment.", code: "roles_busy" });
    expect(st.updates).toEqual([]);
  });

  it("so does a restore", async () => {
    st.target = { ...TARGET, deletedAt: new Date("2026-03-01") };
    st.seatsBusy = true;
    const res = await DELETE(new NextRequest("https://app.test/api/users/u-max?restore=true", { method: "DELETE" }), params);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("roles_busy");
    expect(st.updates).toEqual([]);
  });
});

// Docs-found fixes batch 6, from the batch 5 review.
describe("a restore and a reactivation clear only the lines this workspace owns", () => {
  const restore = () => DELETE(new NextRequest("https://app.test/api/users/u-max?restore=true", { method: "DELETE" }), params);
  // Dana works only in the client workspace, where Max works too.
  const dana = (level = "MANAGER", extra: Record<string, unknown> = {}) =>
    ({ organizationId: "client", ...legacyLevelRow(level), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray", ...extra }) as (typeof st.people)[string];

  it("a restore keeps a manager and a dotted line the person's other workspace relies on, and says nothing untrue", async () => {
    st.target = { ...TARGET, deletedAt: new Date("2026-03-01"), managerId: "dana" };
    st.people.dana = dana();
    st.dotted = ["dana"];
    st.elsewhere = { "u-max": { client: "EMPLOYEE" } };
    const res = await restore();
    expect(res.status).toBe(200);
    // Before: managerId cleared, the dotted line deleted, and "Max Chen has
    // been restored with no manager, because Dana Ray is no longer in the
    // workspace", though Dana was never here and the client workspace reads both.
    expect(st.updates).toEqual([{ deletedAt: null, status: "ACTIVE" }]);
    expect(st.dottedDeleted).toEqual([]);
    expect((await res.json()).message).toBe("Max Chen has been restored");
  });

  it("a reactivation keeps them too", async () => {
    st.target = { ...TARGET, status: "INACTIVE", managerId: "dana" };
    st.people.dana = dana();
    st.dotted = ["dana"];
    st.elsewhere = { "u-max": { client: "EMPLOYEE" } };
    const res = await patch({ status: "ACTIVE" });
    expect(res.status).toBe(200);
    expect(st.updates[0]).toEqual({ status: "ACTIVE" });
    expect(st.dottedDeleted).toEqual([]);
    expect(await res.json()).not.toHaveProperty("linesCleared");
  });

  it("a line no workspace reads is cleared with a true sentence that never names them (batch 7)", async () => {
    st.target = { ...TARGET, deletedAt: new Date("2026-03-01"), managerId: "dana" };
    st.people.dana = dana();
    const res = await restore();
    expect(st.updates.at(-1)).toEqual({ deletedAt: null, status: "ACTIVE", managerId: null });
    expect((await res.json()).message).toBe("Max Chen has been restored with no manager, because the manager on their record doesn't work in this workspace. Set who they report to in Members.");
    expect(st.logs.at(-1)?.description).toBe("Restored Max Chen with no manager: the manager on their record doesn't work in this workspace");
  });

  it("a removed account that never held a level here is asked nothing about: cleared, and never named (batch 7)", async () => {
    st.target = { ...TARGET, deletedAt: new Date("2026-03-01"), managerId: "dana" };
    st.people.dana = dana("MANAGER", { deletedAt: new Date("2026-05-01") });
    // Batch 8: removed (a removal sets INACTIVE too). Only deactivated, the
    // client workspace keeps the line, and so does a restore here (below).
    st.people.gil = dana("MANAGER", { status: "INACTIVE", deletedAt: new Date("2026-05-01") });
    st.dotted = ["gil"];
    st.elsewhere = { "u-max": { client: "EMPLOYEE" } };
    const res = await restore();
    expect(st.updates.at(-1)).toEqual({ deletedAt: null, status: "ACTIVE", managerId: null });
    // Before: "Dana Ray is no longer in the workspace", untrue (she was never
    // here), and telling this workspace who she is and that she was removed.
    const said = st.logs.filter((l) => l.type === "reporting_line_changed").map((l) => l.description);
    expect(said).toEqual([
      "Restored Max Chen with no manager: the manager on their record doesn't work in this workspace",
      "Restored Max Chen without a dotted line to someone who doesn't work in this workspace",
    ]);
    const body = await res.json();
    expect(JSON.stringify({ said, body })).not.toContain("Dana");
    expect(body.linesCleared).toEqual([{ managerId: "dana", kind: "manager", reason: "elsewhere" }, { managerId: "gil", kind: "dotted", reason: "elsewhere" }]);
  });
});

describe("the reactivation and deactivation lows of the batch 5 review", () => {
  const manager = (extra: Record<string, unknown> = {}) =>
    ({ organizationId: "org1", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray", ...extra }) as (typeof st.people)[string];

  it("a reactivation that sends the manager they already have still never brings them back under a deactivated manager", async () => {
    st.target = { ...TARGET, status: "INACTIVE", managerId: "x" };
    st.people.x = manager({ status: "INACTIVE" });
    const res = await patch({ status: "ACTIVE", managerId: "x" });
    expect(res.status).toBe(200);
    // Before: the unchanged Reports to was checked with live: false and left
    // to "its own check", so they came back under a deactivated manager.
    expect(st.updates[0]).toEqual({ status: "ACTIVE", managerId: null });
    expect((await res.json()).message).toBe("Max Chen has been reactivated with no manager, because Dana Ray is deactivated. Set who they report to in Members.");
  });

  it("a deactivation checks for reports again under the role lock, and writes nothing when one landed meanwhile", async () => {
    // pendingHandover (before the lock) saw nothing; a Reports to naming
    // Max landed before this edit took the lock.
    st.reportsUnderLock = 1;
    const res = await patch({ status: "INACTIVE" });
    // Before: the first check was the only one, so Max was deactivated holding a report.
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("handover_first");
    expect(st.locks[0]).toBe("roles");
    expect(st.updates).toEqual([]);
    expect(st.endConnectionsFor).not.toHaveBeenCalled();
  });
});

// Docs-found fixes batch 7, from the batch 6 review.
describe("a line another workspace counts is shown as such, and asked about before it is replaced", () => {
  // Max also works in the client workspace, where he reports to Dana. Dana
  // holds no level here.
  const dana = (extra: Record<string, unknown> = {}) =>
    ({ organizationId: "client", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray", ...extra }) as (typeof st.people)[string];
  const here = (extra: Record<string, unknown> = {}) =>
    ({ organizationId: "org1", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null, firstName: "Sam", lastName: "Lo", ...extra }) as (typeof st.people)[string];
  beforeEach(() => {
    st.target = { ...TARGET, managerId: "dana" };
    st.people.dana = dana();
    st.people.sam = here();
    st.elsewhere = { "u-max": { client: "EMPLOYEE" } };
  });
  const get = () => GET(new NextRequest("https://app.test/api/users/u-max"), params);
  const card = (dotted: string[]) => ({
    ...st.target,
    email: "max@acme.test",
    avatar: null,
    joinDate: new Date("2026-01-01"),
    role: null,
    department: null,
    office: null,
    manager: { id: "dana", firstName: "Dana", lastName: "Ray", avatar: null },
    dottedLineToManagers: dotted.map((id) => ({ manager: { id, firstName: id, lastName: "", avatar: null, deletedAt: null } })),
    directReports: [],
    skills: [],
    _count: { kudosReceived: 0, kpiRecords: 0, reviewsAsSubject: 0 },
  });

  it("the record says Reports to someone in another workspace, never who", async () => {
    st.target = card([]);
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Before: manager null and nothing else, so the card said "Nobody".
    expect(body.manager).toBeNull();
    expect(body.managerElsewhere).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Dana");
  });

  it("the record leaves out a dotted line kept for another workspace, and counts it", async () => {
    // ava is an Agent here and a manager where Max also works.
    st.people.ava = here({ organizationId: "client", firstName: "ava" });
    st.memberships = { ava: "AGENT" };
    st.elsewhere = { "u-max": { client: "EMPLOYEE" } };
    st.target = card(["ava", "sam"]);
    const body = await (await get()).json();
    // Before: ava listed, and the dialog let her be taken off while the PUT kept her.
    expect(body.dottedManagers.map((d: { id: string }) => d.id)).toEqual(["sam"]);
    expect(body.dottedElsewhere).toBe(1);
  });

  it("PATCH asks before replacing it: 409 manager_elsewhere, nothing written", async () => {
    for (const managerId of ["sam", null]) {
      const res = await patch({ managerId });
      // Before: 200, and the client workspace's line rewritten unseen.
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toMatchObject({ code: "manager_elsewhere", field: "managerId", confirmWith: "replaceOtherWorkspaceLine" });
      expect(body.error).toBe("Max Chen reports to someone in another workspace they work in, and that workspace still counts the line. Changing who they report to here changes it there too.");
      expect(body.error).not.toMatch(/Dana|--|\u2014/);
    }
    expect(st.updates).toEqual([]);
  });

  it("PATCH replaces it once the request confirms, and the confirmation is no field", async () => {
    const res = await patch({ managerId: "sam", replaceOtherWorkspaceLine: true });
    expect(res.status).toBe(200);
    expect(st.updates[0]).toEqual({ managerId: "sam" });
    expect(st.checkedKeys).toEqual(["managerId"]);
  });

  it("PATCH asks nothing when no other workspace relies on the line, or the manager works here", async () => {
    st.elsewhere = {};
    expect((await patch({ managerId: "sam" })).status).toBe(200);
    st.elsewhere = { "u-max": { client: "EMPLOYEE" } };
    st.memberships = { dana: "MANAGER" };
    expect((await patch({ managerId: "sam" })).status).toBe(200);
    st.memberships = {};
    // The same manager sent again is no change.
    expect((await patch({ managerId: "dana", firstName: "Maxine" })).status).toBe(200);
  });
});

describe("a PATCH is one outcome (batch 7)", () => {
  it("a refused role change in a reactivation rolls back the dotted lines it took off", async () => {
    st.target = { ...TARGET, status: "INACTIVE", managerId: null };
    st.people.agent = { organizationId: "org1", ...legacyLevelRow("AGENT"), status: "ACTIVE", deletedAt: null, firstName: "Ava", lastName: "Bot" };
    st.dotted = ["agent"];
    vi.mocked(applyRoleChange).mockResolvedValueOnce({ ok: false, status: 409, error: "An Agent can't be anyone's manager, and 2 people report to them. Move their reports to someone else first.", code: "agent_has_reports" });
    const res = await patch({ status: "ACTIVE", orgRole: "MEMBER", memberTier: "AGENT" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("agent_has_reports");
    // Before: the dotted line to the Agent was deleted and committed, while
    // the person stayed deactivated.
    expect(st.dottedDeleted).toEqual([]);
    expect(st.updates).toEqual([]);
  });
});

// Docs-found fixes batch 8, from the batch 7 review: a deactivation and a
// removal end the account in every workspace, so the reports whose line
// another workspace relies on move with them, in their own role-locked
// transaction, never with the handover before them (which moved them before
// a step that could still be refused).
describe("the lines another workspace relies on move with the deactivation or the removal itself", () => {
  const remove = (query = "") => DELETE(new NextRequest(`https://app.test/api/users/u-max${query}`, { method: "DELETE" }), params);

  it("a deactivation moves them in its locked transaction, before status is written, to the person picked, and says so", async () => {
    st.endMoved = [{ id: "r1", name: "Ida Ray" }];
    const res = await patch({ status: "INACTIVE", handoverTo: "u-rae" });
    expect(res.status).toBe(200);
    // Before: this step moved nothing (the handover had, before it).
    expect(st.endCalls).toHaveLength(1);
    expect(st.endCalls[0].input).toMatchObject({ organizationId: "org1", leaverId: "u-max", recipientId: "u-rae", actorId: "u-admin", ends: "deactivated" });
    expect(st.endCalls[0].locksBefore).toBe(1);
    expect(st.updates).toEqual([{ movedReports: ["r1"] }, expect.objectContaining({ status: "INACTIVE" })]);
    // The recipient writes nothing on the person: it is no field.
    expect(st.checkedKeys).toEqual(["status"]);
    expect((await res.json()).reportsAlsoElsewhere).toEqual([{ id: "r1", name: "Ida Ray" }]);
    expect(st.followed).toEqual([["r1"]]);
    expect(st.logs.find((l) => l.type === "membership.changed")?.description).toBe(
      "Deactivated Max Chen. 1 of their reports also reported to them in another workspace: that line moved with the deactivation, and that workspace's Audit log records it",
    );
  });

  it("a refused or busy deactivation moves nothing", async () => {
    st.endMoved = [{ id: "r1", name: "Ida Ray" }];
    st.owners = new Set(["u-max"]);
    expect((await patch({ status: "INACTIVE", handoverTo: "u-rae" })).status).toBe(403);
    expect(st.updates).toEqual([]);
    st.owners = new Set();
    st.busy = true;
    expect((await patch({ status: "INACTIVE", handoverTo: "u-rae" })).status).toBe(503);
    expect(st.updates).toEqual([]);
    expect(st.endCalls).toEqual([]);
  });

  it("a removal waits for the handover, as a deactivation does", async () => {
    st.pending = { openTasks: 2, directReports: 0, containers: 1 };
    const res = await remove();
    // Before: removed, with two open tasks and a Space left under a removed account.
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "handover_first", pending: { openTasks: 2, containers: 1 } });
    st.pending = { openTasks: 0, directReports: 0, containers: 0 };
    // A Reports to naming them that landed after the first check.
    st.reportsUnderLock = 1;
    expect((await remove()).status).toBe(409);
    expect(st.updates).toEqual([]);
    expect(st.endConnectionsFor).not.toHaveBeenCalled();
  });

  it("a removal moves them in its locked transaction, before deletedAt is written, to ?handoverTo, and says so", async () => {
    st.endMoved = [{ id: "r1", name: "Ida Ray" }];
    const res = await remove("?handoverTo=u-rae");
    expect(res.status).toBe(200);
    expect(st.endCalls[0].input).toMatchObject({ leaverId: "u-max", recipientId: "u-rae", ends: "removed" });
    expect(st.endCalls[0].locksBefore).toBe(1);
    expect(st.updates).toEqual([{ movedReports: ["r1"] }, expect.objectContaining({ deletedAt: expect.any(Date) })]);
    expect((await res.json()).reportsAlsoElsewhere).toEqual([{ id: "r1", name: "Ida Ray" }]);
    expect(st.followed).toEqual([["r1"]]);
  });

  it("a removal refused under the lock moves nothing, and one that finds them removed meanwhile takes its moves back", async () => {
    st.endMoved = [{ id: "r1", name: "Ida Ray" }];
    st.owners = new Set(["u-max"]);
    expect((await remove("?handoverTo=u-rae")).status).toBe(403);
    expect(st.endCalls).toEqual([]);
    st.owners = new Set();
    st.dbDeletedAt = new Date("2026-10-01");
    const res = await remove("?handoverTo=u-rae");
    expect(res.status).toBe(200);
    expect(st.updates).toEqual([]);
    expect(st.followed).toEqual([]);
  });
});

describe("PATCH asks before replacing a Reports to an Agent here manages elsewhere (batch 8)", () => {
  beforeEach(() => {
    st.target = { ...TARGET, managerId: "dana" };
    // Dana is on the Agent tier here and a Manager in the client workspace, where Max also works.
    st.people.dana = { organizationId: "org1", ...legacyLevelRow("AGENT"), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray" };
    st.people.sam = { organizationId: "org1", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null, firstName: "Sam", lastName: "Lo" };
    st.elsewhere = { "u-max": { client: "EMPLOYEE" }, dana: { client: "MANAGER" } };
  });

  it("answers 409 manager_elsewhere, naming the Agent, and writes nothing until confirmed", async () => {
    const res = await patch({ managerId: "sam" });
    // Before: 200, and the client workspace's live line rewritten with no question.
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ code: "manager_elsewhere", field: "managerId", confirmWith: "replaceOtherWorkspaceLine" });
    expect(body.error).toBe("Max Chen also reports to Dana Ray in another workspace they work in, and that workspace still counts the line. Changing who they report to here changes it there too.");
    expect(body.error).not.toMatch(/--|\u2014/);
    expect(st.updates).toEqual([]);
    expect((await patch({ managerId: "sam", replaceOtherWorkspaceLine: true })).status).toBe(200);
  });

  it("asks nothing when the Agent is an Agent there too, or no other workspace relies on the line", async () => {
    st.elsewhere = { "u-max": { client: "EMPLOYEE" }, dana: { client: "AGENT" } };
    expect((await patch({ managerId: "sam" })).status).toBe(200);
    st.elsewhere = {};
    expect((await patch({ managerId: null })).status).toBe(200);
  });
});

describe("a restore keeps a line to a manager deactivated in the person's other workspace (batch 8)", () => {
  const restore = () => DELETE(new NextRequest("https://app.test/api/users/u-max?restore=true", { method: "DELETE" }), params);

  it("keeps the solid line and the dotted line there, where they wait for that workspace's own handover, and says nothing about them", async () => {
    // Dana is an Owner in the client workspace, where Max also works; the
    // identity provider deactivated her there and kept her reports on purpose.
    st.target = { ...TARGET, deletedAt: new Date("2026-03-01"), managerId: "dana" };
    st.people.dana = { organizationId: "client", ...legacyLevelRow("SUPER_ADMIN"), status: "INACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray" };
    st.dotted = ["dana"];
    st.elsewhere = { "u-max": { client: "EMPLOYEE" } };
    const res = await restore();
    expect(res.status).toBe(200);
    // Before: both cleared as "doesn't work in this workspace", so when the
    // client workspace handed Dana's reports over, Max was no longer one.
    expect(st.updates).toEqual([{ deletedAt: null, status: "ACTIVE" }]);
    expect(st.dottedDeleted).toEqual([]);
    expect(await res.json()).toMatchObject({ message: "Max Chen has been restored", linesCleared: [] });
  });
});

// Docs-found fixes batch 9, from the batch 8 review.
describe("the handover's rule and the whole gate under the lock (batch 9)", () => {
  const remove = (query = "") => DELETE(new NextRequest(`https://app.test/api/users/u-max${query}`, { method: "DELETE" }), params);

  it("counts open tasks and Spaces, Folders and Lists again under the lock, not the reports alone, and writes nothing when one landed", async () => {
    // The first check, before the lock, saw nothing; a task given to Max landed before the lock.
    st.underLock = { openTasks: 1, containers: 0 };
    const res = await patch({ status: "INACTIVE", handoverTo: "u-rae" });
    // Before: only the reports were counted under the lock, so Max was deactivated holding the task.
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("handover_first");
    expect(st.pendingInTx).toBe(1);
    expect(st.updates).toEqual([]);
    expect(st.endCalls).toEqual([]);
    // A List given to them, for a removal.
    st.underLock = { openTasks: 0, containers: 1 };
    const del = await remove("?handoverTo=u-rae");
    expect(del.status).toBe(409);
    expect((await del.json()).code).toBe("handover_first");
    expect(st.updates).toEqual([]);
    expect(st.endCalls).toEqual([]);
    expect(st.endConnectionsFor).not.toHaveBeenCalled();
  });

  it("reads the person picked only from someone who may hand the work over: from anyone else the reports go up the line", async () => {
    st.mayHandOver = false;
    st.endMoved = [{ id: "r1", name: "Ida Ray" }];
    expect((await remove("?handoverTo=u-dir")).status).toBe(200);
    // Before: a Director outside their own tree named themselves to take the reports.
    expect(st.endCalls[0].input).toMatchObject({ leaverId: "u-max", recipientId: null, ends: "removed" });
    st.endCalls = [];
    expect((await patch({ status: "INACTIVE", handoverTo: "u-dir" })).status).toBe(200);
    expect(st.endCalls[0].input).toMatchObject({ recipientId: null, ends: "deactivated" });
    // Someone who may hand it over still names the recipient.
    st.mayHandOver = true;
    st.endCalls = [];
    st.updates = [];
    expect((await remove("?handoverTo=u-rae")).status).toBe(200);
    expect(st.endCalls[0].input).toMatchObject({ recipientId: "u-rae" });
  });

  it("tells a viewer who may remove but not hand over who can, never \"hand over their work first\"", async () => {
    st.mayHandOver = false;
    st.pending = { openTasks: 2, directReports: 0, containers: 0 };
    const res = await remove();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("handover_first");
    expect(body.error).toBe("They still own open tasks, direct reports or Spaces, Folders and Lists, and only an Admin or a manager above them can hand those over. Ask one of them to, then try again.");
    expect(body.error).not.toMatch(/--|\u2014/);
    // Someone who may still reads the old words.
    st.mayHandOver = true;
    expect((await (await remove()).json()).error).toBe("Hand over their work first: they still own open tasks, direct reports or Spaces, Folders and Lists.");
  });

  it("the record answers whether this viewer may hand the work over, apart from Remove", async () => {
    st.mayHandOver = false;
    // The record GET reads (the batch 7 tests' card, with no line elsewhere).
    st.target = {
      ...TARGET,
      email: "max@acme.test",
      avatar: null,
      joinDate: new Date("2026-01-01"),
      role: null,
      department: null,
      office: null,
      manager: null,
      dottedLineToManagers: [],
      directReports: [],
      skills: [],
      _count: { kudosReceived: 0, kpiRecords: 0, reviewsAsSubject: 0 },
    };
    const res = await GET(new NextRequest("https://app.test/api/users/u-max"), params);
    const body = await res.json();
    expect(body.access.remove).toBe(true);
    // Before: no such answer, so the Remove dialog asked for a summary the handover refused.
    expect(body.access.handover).toBe(false);
    st.mayHandOver = true;
    expect((await (await GET(new NextRequest("https://app.test/api/users/u-max"), params)).json()).access.handover).toBe(true);
  });
});
