// PATCH and DELETE /api/users/[id], the leaving half of AI teammates Phase 3
// (docs/plans/ai-teammates-phase3.md step 2, Decision 20): deactivating or
// removing someone ends their Google connection for AI teammates in this
// workspace, after the write commits, and a failure there never fails the
// edit (the cron sweep ends what it misses). Before step 2 nothing ended it:
// a deactivated person's tokens stayed until the person came back to remove
// them, which they no longer could.

import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  endConnectionsFor: vi.fn(async () => 1),
  updates: [] as Array<Record<string, unknown>>,
  /** The target's row, as findFirst answers it. */
  target: {} as Record<string, unknown>,
  /** The withdrawnAt of the target's newest erasure provenance record, or null (review rounds 8 and 9 of Phase 3). */
  erasedAt: null as Date | null,
  /** The target's deletedAt as the database holds it when the removal writes, when the route's read was stale (review round 9 of Phase 3). */
  dbDeletedAt: undefined as Date | null | undefined,
}));

const TARGET = { id: "u-max", ...legacyLevelRow("EMPLOYEE"), roleId: null, managerId: null, deletedAt: null, status: "ACTIVE", firstName: "Max", lastName: "Chen" };

vi.mock("@/lib/prisma", () => {
  const user = {
    findFirst: async () => ({ ...st.target }),
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
  return { prisma: { user, consentRecord, $transaction: async (fn: (tx: unknown) => unknown) => fn({ user }) } };
});
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "u-admin" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/connectors/connections", () => ({ endConnectionsFor: st.endConnectionsFor }));
vi.mock("@/lib/access/flags", () => ({ accessV2Resolver: () => false }));
vi.mock("@/lib/access/workspace-admin", () => ({ freshWorkspaceActor: async () => ({ ok: true, admin: true, owner: false }) }));
vi.mock("@/lib/access/membership", () => ({
  applyRoleChange: vi.fn(),
  isLiveOwner: async () => false,
  lockOrgRoles: async () => undefined,
  roleChangeSentence: () => "",
  wouldRemoveLastOwner: async () => false,
}));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));
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
  st.updates = [];
  st.target = { ...TARGET };
  st.erasedAt = null;
  st.dbDeletedAt = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("leaving ends the person's Google connection for AI teammates", () => {
  it("a deactivation calls endConnectionsFor(org, [id], deactivated, the admin), after the write", async () => {
    const res = await patch({ status: "INACTIVE" });
    expect(res.status).toBe(200);
    expect(st.updates[0]).toMatchObject({ status: "INACTIVE" });
    expect(st.endConnectionsFor).toHaveBeenCalledTimes(1);
    expect(st.endConnectionsFor).toHaveBeenCalledWith("org1", ["u-max"], "deactivated", "u-admin");
  });

  it("another status change ends nothing", async () => {
    const res = await patch({ status: "ON_LEAVE" });
    expect(res.status).toBe(200);
    expect(st.endConnectionsFor).not.toHaveBeenCalled();
  });

  it("never fails the deactivation when ending the connection fails", async () => {
    st.endConnectionsFor.mockRejectedValueOnce(new Error("database down"));
    const res = await patch({ status: "INACTIVE" });
    expect(res.status).toBe(200);
  });

  it("removing someone calls endConnectionsFor(org, [id], left, the admin)", async () => {
    const res = await DELETE(new NextRequest("https://app.test/api/users/u-max", { method: "DELETE" }), params);
    expect(res.status).toBe(200);
    expect(st.endConnectionsFor).toHaveBeenCalledWith("org1", ["u-max"], "left", "u-admin");
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
