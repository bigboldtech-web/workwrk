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
}));

const TARGET = { id: "u-max", ...legacyLevelRow("EMPLOYEE"), roleId: null, managerId: null, deletedAt: null, status: "ACTIVE", firstName: "Max", lastName: "Chen" };

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
  return { prisma: { user, consentRecord, userDottedLine, $transaction: async (fn: (tx: unknown) => unknown) => fn({ user, userDottedLine }) } };
});
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "u-admin" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async (row: { type: string; description: string }) => { st.logs.push(row); } }));
vi.mock("@/lib/connectors/connections", () => ({ endConnectionsFor: st.endConnectionsFor }));
vi.mock("@/lib/browser/sessions", () => ({ endBrowserSessionsFor: st.endBrowserSessionsFor }));
vi.mock("@/lib/access/flags", () => ({ accessV2Resolver: () => false }));
vi.mock("@/lib/access/workspace-admin", () => ({ freshWorkspaceActor: async () => ({ ok: true, admin: true, owner: false }) }));
vi.mock("@/lib/access/membership", () => ({
  applyRoleChange: vi.fn(),
  isLiveOwner: async () => false,
  lockOrgRoles: async () => {
    st.locks.push("roles");
    if (st.busy) throw Object.assign(new Error("busy"), { name: "OrgRolesBusy" });
  },
  roleChangeSentence: () => "",
  wouldRemoveLastOwner: async () => false,
}));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => { st.locks.push("seats"); }, seatsFor: async () => ({ ok: true }) }));
vi.mock("@/lib/people/person-access.server", () => ({
  peopleCtx: async () => ({ userId: "u-admin", organizationId: "org1", isAdmin: true, managerTier: true, peopleTeam: false }),
  relationTo: () => "admin",
  checkManagerCandidate: async () => "ok",
  managerMapFor: async () => new Map(),
}));
vi.mock("@/lib/people/person-fields", () => ({
  PERSON_FIELD_GROUP: { status: "membership" },
  PERSON_FIELD_LABEL: {},
  canWritePersonField: () => true,
  checkPersonPatch: () => ({ unknown: [], forbidden: [] }),
  dobOverwriteAllowed: () => true,
  seesFullBirthday: () => true,
  visibleStatus: (s: string) => s,
}));
vi.mock("@/lib/people/handover.server", () => ({ pendingHandover: async () => ({ openTasks: 0, directReports: 0, containers: 0 }) }));
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
import { DELETE, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "u-max" }) };

function patch(body: unknown) {
  return PATCH(new NextRequest("https://app.test/api/users/u-max", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params);
}

beforeEach(() => {
  st.endConnectionsFor.mockReset().mockResolvedValue(1);
  st.endBrowserSessionsFor.mockReset().mockResolvedValue(1);
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

  it("checks under the role lock, taken before the seats (rule 6's race)", async () => {
    st.people.x = person("MANAGER");
    await restore();
    expect(st.locks).toEqual(["roles", "seats"]);
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
