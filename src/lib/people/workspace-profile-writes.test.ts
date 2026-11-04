// A membership person's profile and lines are edited HERE
// (docs/plans/workspace-status-2.md E7, E8, E9 ii, E10, step 5), through the
// same doors as anyone's, on the row that holds their seat here. Run on the
// in-memory database (seat-test-db.ts), through the real routes: PATCH and
// GET /api/users/[id], PUT /api/users/[id]/dotted-lines, the bulk update,
// SCIM Groups, Members and the Directory.
//
// The case. Pat is anchored at her agency A, where she reports to Max, is in
// A's Operations as an Analyst in A's London office on 40 hours, Monday to
// Friday, with A's badge; she has a dotted line to Ari in A. She works for
// client B through a membership, where Dana leads her, in B's Delivery as a
// Developer in B's Leeds office, with B's shirt size on file; she has a
// dotted line to Max in B (Max contracts for B too). Her A membership row is
// the stale one of the workspace she is anchored to (never read, never
// written). In B: Bo owns it, Hana is the People team, Dana and Kim are
// Managers, Lee is anchored in B under Dana with a dotted line to Max, and
// Zed is outside everyone's chain.
//
// Before this step every write of Pat's B profile or lines was refused
// ("their details here are read-only"), the dotted-lines PUT was a 404 for
// her, bulk and SCIM Groups skipped her, and Workload offered no edit.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  me: "hana",
  level: "HR",
  org: "b",
  ctx: {} as Record<string, unknown>,
  logs: [] as Array<Record<string, unknown>>,
  seeded: [] as Array<Record<string, unknown>>,
  /** Run once between PATCH's first read of the person and its transaction (a move landing meanwhile). */
  between: null as null | (() => Promise<void>),
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession(st.me, st.level, st.org) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async (row: Record<string, unknown>) => { st.logs.push(row); }, logAuditEvent: async () => undefined }));
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async () => undefined }));
vi.mock("@/lib/access/role-change-after", () => ({ afterRoleChanges: async () => undefined }));
vi.mock("@/lib/access/flags", async (orig) => ({ ...(await orig<typeof import("@/lib/access/flags")>()), accessV2Resolver: () => false }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/user-tags", () => ({ getUserTagsMap: async () => new Map(), resolveUserIdsByTags: async () => [] }));
// The permission matrix is its own module's (tested there): the KRA door's gate passes here.
vi.mock("@/lib/api-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/api-helpers")>()), hasPermission: async () => false, requirePermission: async () => null }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => undefined, queueEmail: async () => undefined }));
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));
vi.mock("@/lib/access/workspace-admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/workspace-admin")>()),
  freshWorkspaceActor: async () => ({ ok: true, admin: true, owner: true }),
}));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));
vi.mock("@/lib/performance/review-cycle.server", async (orig) => ({ ...(await orig<typeof import("@/lib/performance/review-cycle.server")>()), followReportingLine: async () => undefined }));
vi.mock("@/services/performanceScoreService", () => ({ getLatestScore: async () => null, getScoreHistory: async () => [] }));
// A new job title seeds its KRAs and SOPs (alignment-assign.ts): the real seed, each call recorded.
vi.mock("@/lib/alignment-assign", async (orig) => {
  const real = await orig<typeof import("@/lib/alignment-assign")>();
  return { ...real, seedAlignmentForUser: async (a: Parameters<typeof real.seedAlignmentForUser>[0]) => { st.seeded.push(a); return real.seedAlignmentForUser(a); } };
});
// An Agent's stored reports are manager-lines.ts's own (tested there).
vi.mock("@/lib/access/manager-lines", async (orig) => ({ ...(await orig<typeof import("@/lib/access/manager-lines")>()), agentsWithStoredReports: async () => new Map() }));
// The erasure check PATCH reads between its first read of the person and its transaction: where a move lands.
vi.mock("@/lib/compliance/erased-account", async (orig) => {
  const real = await orig<typeof import("@/lib/compliance/erased-account")>();
  return {
    ...real,
    isErasedAccount: async (...a: Parameters<typeof real.isErasedAccount>) => {
      const run = st.between;
      st.between = null;
      await run?.();
      return real.isErasedAccount(...a);
    },
  };
});
// Teams > Workload's scope and readable Lists are their own modules' (tested there): Pat and Lee, no Lists.
vi.mock("@/lib/people/team-scope.server", () => ({ teamScopeFor: async () => ({ orgWide: true, ids: ["lee", "pat"], direct: new Set(["lee", "pat"]), hasIndirect: false }) }));
vi.mock("@/lib/people/team-boards.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/people/team-boards.server")>()),
  readableBoardsFor: async () => ({ ids: [], byId: new Map(), isDone: () => false }),
}));
vi.mock("@/lib/scim-auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/scim-auth")>()),
  authenticateScim: async () => ({ ok: true, organizationId: "b", workspaceInactive: false }),
}));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { reanchorUser } from "@/lib/access/workspace-anchor";
import { SHARED_IDENTITY_REFUSAL } from "@/lib/access/shared-identity";
import { GET as userGet, PATCH as userPatch } from "@/app/api/users/[id]/route";
import { PUT as dottedPut } from "@/app/api/users/[id]/dotted-lines/route";
import { POST as bulkUpdate } from "@/app/api/people/bulk-update/route";
import { GET as groupGet, PATCH as groupPatch, PUT as groupPut, DELETE as groupDelete } from "@/app/api/scim/v2/Groups/[id]/route";
import { POST as groupsPost } from "@/app/api/scim/v2/Groups/route";
import { listMembers } from "@/lib/access/members-list.server";
import { directoryList } from "@/lib/people/directory-list.server";
import { GET as teamWorkload } from "@/app/api/team/workload/route";
import { GET as myKras } from "@/app/api/me/kras/route";
import { POST as sopAssign } from "@/app/api/sop-assignments/route";
import { POST as kraAssign } from "@/app/api/kra-assignments/route";
import { POST as seedAlignmentRoute } from "@/app/api/users/[id]/seed-alignment/route";
import { DELETE as deptDelete } from "@/app/api/departments/[id]/route";
import { DELETE as officeDelete } from "@/app/api/offices/route";
import { DELETE as roleDelete } from "@/app/api/roles/[id]/route";
import { ALIGNMENT_NOT_HERE } from "@/lib/people/person-fields";

type Row = Record<string, unknown> & { id: string };
const req = (url: string, init?: { method: string; body?: unknown }) =>
  new NextRequest(`https://app.test${url}`, init ? { method: init.method, ...(init.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}) } : undefined);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) => userPatch(req(`/api/users/${id}`, { method: "PATCH", body }), params(id));
const record = async (id: string) => (await (await userGet(req(`/api/users/${id}`), params(id))).json()) as Record<string, unknown> & { access: Record<string, unknown> };
const putDotted = (id: string, managerIds: string[]) => dottedPut(req(`/api/users/${id}/dotted-lines`, { method: "PUT", body: { managerIds } }), params(id));
const bulk = async (userIds: string[], action: string, payload: Record<string, unknown>) =>
  (await (await bulkUpdate(req("/api/people/bulk-update", { method: "POST", body: { userIds, action, payload } }))).json()) as Record<string, unknown>;
const scim = (method: string, url: string, body?: unknown) => new NextRequest(`https://app.test${url}`, { method, headers: { authorization: "Bearer t", "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

const account = (id: string) => db.row("user", id);
const seatOf = (userId: string, organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId)!;
const dottedIn = (userId: string, organizationId: string) =>
  (db.tables.userDottedLine ?? []).filter((d) => d.userId === userId && d.organizationId === organizationId).map((d) => d.managerId as string).sort();
/** Everything A holds of Pat (her account, anchored there) and her A stale row, to prove B's writes never touch it. */
const PROFILE = ["organizationId", "managerId", "departmentId", "roleId", "officeId", "weeklyCapacityHours", "workSchedule", "customFields", "firstName", "lastName", "phone", "avatar", "dateOfBirth"] as const;
const pick = (r: Record<string, unknown>) => Object.fromEntries(PROFILE.map((k) => [k, r[k] ?? null]));
const aSide = () => ({ account: pick(account("pat")), staleA: pick(seatOf("pat", "a")), dottedA: dottedIn("pat", "a") });

let made = 0;
function person(id: string, organizationId: string, level: string, managerId: string | null, extra: Record<string, unknown> = {}) {
  made += 1;
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", organizationId, ...legacyLevelRow(level),
    managerId, phone: null, avatar: null, dateOfBirth: null, departmentId: null, roleId: null, officeId: null, joinDate: new Date(Date.UTC(2025, 0, made)), createdAt: new Date(Date.UTC(2025, 0, made)),
    weeklyCapacityHours: null, workSchedule: null, customFields: null, presenceStatus: null, ...extra,
  });
}
function membership(userId: string, organizationId: string, role: string, managerId: string | null, extra: Record<string, unknown> = {}) {
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role, managerId, createdAt: new Date("2026-06-01"), ...extra });
}
const dotted = (userId: string, managerId: string, organizationId: string) =>
  db.seed("userDottedLine", { id: `d-${userId}-${managerId}-${organizationId}`, userId, managerId, organizationId });

/** The viewer in B (person-access.server.ts PeopleCtx). */
function viewAs(me: string, opts: { level: string; orgRole?: string; isAdmin?: boolean; peopleTeam?: boolean; managerTier?: boolean; chain?: string[]; writeChain?: string[] }) {
  st.me = me;
  st.level = opts.level;
  st.org = "b";
  const isAdmin = opts.isAdmin ?? false;
  const peopleTeam = opts.peopleTeam ?? false;
  st.ctx = {
    userId: me, organizationId: "b", ...legacyLevelRow(opts.level), orgRole: opts.orgRole ?? "MEMBER", isAgent: false, isAdmin, peopleTeam,
    orgWide: isAdmin || peopleTeam, managerTier: opts.managerTier ?? false, chain: new Set(opts.chain ?? []), writeChain: new Set(opts.writeChain ?? []), viewer: { userId: me, organizationId: "b" },
  };
}
const asHana = () => viewAs("hana", { level: "HR", peopleTeam: true });
const asBo = () => viewAs("bo", { level: "SUPER_ADMIN", orgRole: "OWNER", isAdmin: true, managerTier: true });
// Dana leads Pat, Max and Lee in B: her solid tree here.
const asDana = () => viewAs("dana", { level: "MANAGER", managerTier: true, chain: ["pat", "max", "lee"], writeChain: ["pat", "max", "lee"] });
// Max reads Pat and Lee in B through their dotted lines to him only: chain-view.
const asMax = () => viewAs("max", { level: "MANAGER", managerTier: true, chain: ["pat", "lee"], writeChain: [] });
const asZed = () => viewAs("zed", { level: "EMPLOYEE" });

/** A seat here, in the state that counts: anchored here and not removed, or a membership here not removed. */
const keptHere = (u: Row, org: string, activeOnly: boolean) => {
  if (u.deletedAt) return null;
  if (u.organizationId === org) return activeOnly && u.status === "INACTIVE" ? null : { managerId: (u.managerId as string | null) ?? null };
  const m = db.tables.organizationMembership.find((x) => x.userId === u.id && x.organizationId === org);
  if (!m || m.removedAt || (activeOnly && (m.status === "INACTIVE" || u.status === "INACTIVE"))) return null;
  return { managerId: (m.managerId as string | null) ?? null };
};

beforeEach(() => {
  db.reset();
  made = 0;
  st.logs = [];
  st.seeded = [];
  st.between = null;
  // The two whole-workspace statements (acting-workspace.ts
  // workspacePeopleLines and workspaceDottedLines), answered from the
  // tables as their two indexed halves would.
  db.onQueryRaw = (sql, values) => {
    const org = values[0] as string;
    const users = (db.tables.user ?? []) as Row[];
    if (sql.includes('JOIN "UserDottedLine" d')) {
      return (db.tables.userDottedLine ?? [])
        .filter((d) => d.organizationId === org && users.some((u) => u.id === d.userId && keptHere(u, org, false)))
        .map((d) => ({ userId: d.userId, managerId: d.managerId }));
    }
    if (sql.includes('SELECT u."id", u."managerId"')) {
      const activeOnly = sql.includes("'INACTIVE'");
      return users.flatMap((u) => { const k = keptHere(u, org, activeOnly); return k ? [{ id: u.id, managerId: k.managerId }] : []; });
    }
    return [];
  };
  const fields = { people: { profileFields: [{ key: "badge", label: "Badge" }, { key: "shirt", label: "Shirt size" }] } };
  db.seed("organization", { id: "a", name: "Org A", status: "ACTIVE", settings: fields });
  db.seed("organization", { id: "b", name: "Org B", status: "ACTIVE", settings: fields });
  for (const [id, organizationId, name] of [["dep-a-ops", "a", "Operations"], ["dep-b-del", "b", "Delivery"], ["dep-b-eng", "b", "Engineering"]]) db.seed("department", { id, name, color: null, organizationId });
  for (const [id, organizationId, title] of [["role-a-an", "a", "Analyst"], ["role-b-dev", "b", "Developer"], ["role-b-lead", "b", "Tech Lead"]]) db.seed("role", { id, title, description: null, level: null, organizationId });
  for (const [id, organizationId, name] of [["off-a-lon", "a", "London"], ["off-b-lds", "b", "Leeds"], ["off-b-yrk", "b", "York"]]) db.seed("office", { id, name, city: name, country: null, isHeadquarters: false, organizationId });
  // A.
  person("ari", "a", "SUPER_ADMIN", null);
  person("max", "a", "MANAGER", "ari");
  person("pat", "a", "EMPLOYEE", "max", {
    departmentId: "dep-a-ops", roleId: "role-a-an", officeId: "off-a-lon", weeklyCapacityHours: 40,
    workSchedule: { workdays: [1, 2, 3, 4, 5], hoursPerDay: 8 }, customFields: { badge: "A-1" }, phone: "+44 1", dateOfBirth: new Date("1990-05-01T12:00:00Z"),
  });
  // B.
  person("bo", "b", "SUPER_ADMIN", null);
  person("hana", "b", "HR", "bo");
  person("dana", "b", "MANAGER", "bo");
  person("kim", "b", "MANAGER", "bo");
  person("lee", "b", "EMPLOYEE", "dana", { departmentId: "dep-b-del" });
  person("zed", "b", "EMPLOYEE", "bo");
  // Pat's B seat: her membership, with B's own line and profile (E1, D18).
  membership("pat", "b", "EMPLOYEE", "dana", { departmentId: "dep-b-del", roleId: "role-b-dev", officeId: "off-b-lds", weeklyCapacityHours: null, workSchedule: null, customFields: { shirt: "M" } });
  // Her A row: the stale one of the workspace she is anchored to.
  membership("pat", "a", "EMPLOYEE", "ari", { isPrimary: true, departmentId: "dep-a-ops", roleId: "role-a-an", officeId: "off-a-lon", weeklyCapacityHours: 32, customFields: { badge: "A-0" } });
  membership("max", "b", "MANAGER", "dana");
  dotted("pat", "ari", "a");
  dotted("pat", "max", "b");
  dotted("lee", "max", "b");
  asHana();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("B's People team edits Pat in B, and every write lands on her B membership only (E7)", () => {
  it("job title, department and office: on her B membership; A's values and the account untouched", async () => {
    const before = aSide();
    const res = await patch("pat", { roleId: "role-b-lead", departmentId: "dep-b-eng", officeId: "off-b-yrk" });
    // Before: 403 profile_elsewhere, "their details here are read-only".
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "pat", roleId: "role-b-lead", departmentId: "dep-b-eng", officeId: "off-b-yrk", managerId: "dana", profileHere: false });
    expect(seatOf("pat", "b")).toMatchObject({ roleId: "role-b-lead", departmentId: "dep-b-eng", officeId: "off-b-yrk" });
    expect(aSide()).toEqual(before);
  });

  it("weekly hours, working week and profile fields: on her B membership, the fields merged key by key; A's and the account's untouched", async () => {
    const before = aSide();
    expect((await patch("pat", { weeklyCapacityHours: 10 })).status).toBe(200);
    expect((await patch("pat", { workSchedule: { workdays: [1, 2], hoursPerDay: 5 } })).status).toBe(200);
    expect((await patch("pat", { customFields: { badge: "B-7" } })).status).toBe(200);
    expect(seatOf("pat", "b")).toMatchObject({ weeklyCapacityHours: 10, workSchedule: { workdays: [1, 2], hoursPerDay: 5 }, customFields: { shirt: "M", badge: "B-7" } });
    // A field taken off leaves the others.
    expect((await patch("pat", { customFields: { shirt: null } })).status).toBe(200);
    expect(seatOf("pat", "b").customFields).toEqual({ badge: "B-7" });
    expect(aSide()).toEqual(before);
    // A key B does not define is refused, as for anyone.
    expect((await patch("pat", { customFields: { pager: "1" } })).status).toBe(400);
  });

  it("Reports to: her B line moves to Kim under the role lock, and A's line to Max stays", async () => {
    const before = aSide();
    db.log.length = 0;
    const res = await patch("pat", { managerId: "kim" });
    expect(res.status).toBe(200);
    expect(seatOf("pat", "b").managerId).toBe("kim");
    expect(aSide()).toEqual(before);
    expect(account("pat").managerId).toBe("max");
    // The role lock, then her row lock, then the write.
    const lock = db.log.findIndex((e) => e.includes("pg_advisory_xact_lock"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(db.log.indexOf("tx.lock:pat"));
    expect(st.logs.find((l) => l.type === "reporting_line_changed")).toMatchObject({ organizationId: "b", oldValue: { managerId: "dana" }, newValue: { managerId: "kim" } });
    // A loop here is refused, as for anyone: Kim cannot report to Pat, who reports to her here now.
    expect((await patch("kim", { managerId: "pat" })).status).toBe(409);
  });

  it("dotted lines: B's set is replaced, Max (her A manager) kept in it, her B manager left out, and A's row stays", async () => {
    const before = aSide();
    const res = await putDotted("pat", ["max", "kim", "dana"]);
    // Before: 404, a membership subject. And the old filter dropped Max, her
    // account's line (A's), while it kept Dana, her line here.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ managerIds: ["max", "kim"] });
    expect(dottedIn("pat", "b")).toEqual(["kim", "max"]);
    expect(aSide()).toEqual(before);
    expect(dottedIn("pat", "a")).toEqual(["ari"]);
  });

  it("name, photo, phone and birthday are refused with the shared-identity sentence, and nothing is written", async () => {
    const before = aSide();
    const seatBefore = { ...seatOf("pat", "b") };
    for (const body of [{ firstName: "Patricia" }, { lastName: "Ngu" }, { avatar: "https://x.test/p.png" }, { phone: "+44 2" }, { dateOfBirth: "1991-01-01" }, { firstName: "Patricia", departmentId: "dep-b-eng" }]) {
      const res = await patch("pat", body);
      // Before: 403 profile_elsewhere, "their details here are read-only".
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(await res.json()).toMatchObject({ code: "identity_shared", error: SHARED_IDENTITY_REFUSAL });
    }
    expect(SHARED_IDENTITY_REFUSAL).not.toMatch(/-{2}|\u2014|\u2013/);
    expect(aSide()).toEqual(before);
    expect(seatOf("pat", "b")).toEqual(seatBefore);
  });

  it("Bo and Dana edit her B profile and line through the same doors, and A's values stay", async () => {
    const before = aSide();
    asBo();
    expect((await patch("pat", { departmentId: "dep-b-eng" })).status).toBe(200);
    asDana();
    expect((await patch("pat", { officeId: "off-b-yrk", weeklyCapacityHours: 20, managerId: "kim" })).status).toBe(200);
    expect(seatOf("pat", "b")).toMatchObject({ departmentId: "dep-b-eng", officeId: "off-b-yrk", weeklyCapacityHours: 20, managerId: "kim" });
    expect(aSide()).toEqual(before);
  });
});

describe("the record, Members and the Directory open the existing controls for her (E8)", () => {
  it("the record sends B's weekly hours, working week and profile fields to readers, and Edit details and dotted lines to writers", async () => {
    Object.assign(seatOf("pat", "b"), { weeklyCapacityHours: 10, workSchedule: { workdays: [1, 2], hoursPerDay: 5 } });
    const body = await record("pat");
    // Before: editable [], dottedLines false, and no hours or fields at all.
    expect(body).toMatchObject({
      profileHere: false,
      weeklyCapacityHours: 10,
      workSchedule: { workdays: [1, 2], hoursPerDay: 5 },
      defaultWeeklyHours: 10,
      profileFields: [{ key: "badge", label: "Badge", value: null }, { key: "shirt", label: "Shirt size", value: "M" }],
    });
    expect(body.access).toMatchObject({ peopleData: false, profileData: true, dottedLines: true });
    expect([...(body.access.editable as string[])].sort()).toEqual(["customFields", "departmentId", "managerId", "officeId", "roleId", "status", "weeklyCapacityHours", "workSchedule"]);
    // Nothing of A's: her A hours, schedule, badge, phone and birthday.
    expect(JSON.stringify(body)).not.toMatch(/A-1|\+44 1|1990|"weeklyCapacityHours":40/);
    // Max reads her through a dotted line: the data, no edit.
    asMax();
    const read = await record("pat");
    expect(read).toMatchObject({ weeklyCapacityHours: 10 });
    expect(read.access).toMatchObject({ profileData: true, editable: [], dottedLines: false });
    // Zed reads nothing of it.
    asZed();
    const none = await record("pat");
    expect(none.access).toMatchObject({ profileData: false, editable: [], dottedLines: false });
    expect("weeklyCapacityHours" in none).toBe(false);
  });

  it("Members and the Directory show her B hours, and the Directory row is editable and selectable for HR", async () => {
    expect((await patch("pat", { weeklyCapacityHours: 12 })).status).toBe(200);
    const members = await listMembers("b", { orgWide: true, ids: [] }, {});
    expect(members.rows.find((r) => r.id === "pat")).toMatchObject({ weeklyCapacityHours: 12, profileHere: false });
    const dir = (await (await directoryList(req("/api/users?scope=directory"))).json()) as { data: Row[] };
    // Before: canEdit false for everyone here through a membership.
    expect(dir.data.find((r) => r.id === "pat")).toMatchObject({ canEdit: true, profileHere: false });
    expect(dir.data.find((r) => r.id === "lee")).toMatchObject({ canEdit: true });
    asMax();
    const read = (await (await directoryList(req("/api/users?scope=directory"))).json()) as { data: Row[] };
    expect(read.data.find((r) => r.id === "pat")).toMatchObject({ canEdit: false });
  });
});

describe("Teams > Workload reads the hours B gives her, and offers their edit by PATCH's door (E13)", () => {
  it("after Dana sets Pat's B hours, Workload shows them, Dana may edit them, and Max may not", async () => {
    asDana();
    expect((await patch("pat", { weeklyCapacityHours: 12, workSchedule: { workdays: [1, 2, 3], hoursPerDay: 4 } })).status).toBe(200);
    const grid = async () => ((await (await teamWorkload(req("/api/team/workload?from=2026-11-02&to=2026-11-15"))).json()) as { people: Row[] }).people;
    const rows = await grid();
    // Before: canEditCapacity false for her (PATCH refused her hours).
    expect(rows.find((r) => r.id === "pat")).toMatchObject({ weeklyCapacityHours: 12, workSchedule: { workdays: [1, 2, 3], hoursPerDay: 4 }, canEditCapacity: true });
    expect(rows.find((r) => r.id === "lee")).toMatchObject({ canEditCapacity: true });
    // Her A hours (40 on the account) are never B's.
    expect(account("pat").weeklyCapacityHours).toBe(40);
    asMax();
    const read = await grid();
    expect(read.find((r) => r.id === "pat")).toMatchObject({ weeklyCapacityHours: 12, canEditCapacity: false });
    expect(read.find((r) => r.id === "lee")).toMatchObject({ canEditCapacity: false });
  });
});

describe("someone who may not write gets the refusals anyone would", () => {
  it("Max (a dotted line only) and Zed (outside the chain) are refused for Pat exactly as for Lee, who is anchored here", async () => {
    const before = aSide();
    const seatBefore = { ...seatOf("pat", "b") };
    for (const viewer of [asMax, asZed]) {
      viewer();
      for (const body of [{ roleId: "role-b-lead" }, { managerId: "kim" }, { weeklyCapacityHours: 5 }]) {
        const forPat = await patch("pat", body);
        const forLee = await patch("lee", body);
        // Before, for Max: profile_elsewhere for Pat, field_forbidden for Lee.
        expect(forPat.status).toBe(403);
        expect(await forPat.json()).toEqual(await forLee.json());
        expect(forLee.status).toBe(403);
      }
      const dPat = await putDotted("pat", ["kim"]);
      const dLee = await putDotted("lee", ["kim"]);
      // Before: a 404 for Pat.
      expect(dPat.status).toBe(403);
      expect(await dPat.json()).toEqual(await dLee.json());
    }
    expect(aSide()).toEqual(before);
    expect(seatOf("pat", "b")).toEqual(seatBefore);
    expect(dottedIn("pat", "b")).toEqual(["max"]);
  });
});

describe("a move landing between the read and the write writes nothing", () => {
  it("Pat switching into B while HR's edit is on its way: 409 seat_changed, and her B profile moves with her as it was", async () => {
    st.between = async () => {
      await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    };
    const res = await patch("pat", { departmentId: "dep-b-eng", weeklyCapacityHours: 10 });
    // Before: 403 profile_elsewhere.
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("seat_changed");
    // The swap carried B's own values onto the account and A's onto A's row; HR's edit is nowhere.
    expect(account("pat")).toMatchObject({ organizationId: "b", departmentId: "dep-b-del", managerId: "dana" });
    expect(account("pat").weeklyCapacityHours ?? null).toBeNull();
    expect(seatOf("pat", "a")).toMatchObject({ departmentId: "dep-a-ops", weeklyCapacityHours: 40, managerId: "max" });
    expect(seatOf("pat", "b").departmentId).toBe("dep-b-del");
  });

  it("a bulk change skips Pat when she switches into B as her row lock is taken, and writes Lee", async () => {
    db.onCall = async (entry) => {
      if (entry !== "tx.lock:pat") return;
      db.onCall = null;
      await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    };
    const body = await bulk(["pat", "lee"], "change_department", { departmentId: "dep-b-eng" });
    expect(body).toMatchObject({ updated: 1, skipped: 1, skippedElsewhere: 0 });
    expect(account("lee").departmentId).toBe("dep-b-eng");
    // Her B department moved onto the account with her, as it was.
    expect(account("pat")).toMatchObject({ organizationId: "b", departmentId: "dep-b-del" });
    expect(seatOf("pat", "a").departmentId).toBe("dep-a-ops");
  });
});

describe("bulk placement and SCIM Groups reach Pat in B only (E9 ii, E10)", () => {
  it("bulk change department, office and manager write her B membership, and her A values and line stay", async () => {
    const before = aSide();
    // Before: { updated: 1, skipped: 1, skippedElsewhere: 1 }, Pat skipped.
    expect(await bulk(["pat", "lee"], "change_department", { departmentId: "dep-b-eng" })).toMatchObject({ updated: 2, skipped: 0, skippedElsewhere: 0 });
    expect(await bulk(["pat", "lee"], "change_office", { officeId: "off-b-yrk" })).toMatchObject({ updated: 2 });
    expect(await bulk(["pat", "lee"], "change_manager", { managerId: "kim" })).toMatchObject({ updated: 2 });
    expect(seatOf("pat", "b")).toMatchObject({ departmentId: "dep-b-eng", officeId: "off-b-yrk", managerId: "kim" });
    expect(account("lee")).toMatchObject({ departmentId: "dep-b-eng", officeId: "off-b-yrk", managerId: "kim" });
    expect(aSide()).toEqual(before);
    // A manager's bulk reaches their chain here only: Dana's, Pat and Lee; never Zed.
    asDana();
    expect(await bulk(["pat", "zed"], "change_office", { officeId: "off-b-lds" })).toMatchObject({ updated: 1, skipped: 1 });
    expect(seatOf("pat", "b").officeId).toBe("off-b-lds");
    expect(account("zed").officeId ?? null).toBeNull();
  });

  it("SCIM Groups place her in B's Engineering on her B membership, list her, count her, take her out, and never touch A", async () => {
    const before = aSide();
    const add = await groupPatch(scim("PATCH", "/api/scim/v2/Groups/dep-b-eng", { Operations: [{ op: "add", path: "members", value: [{ value: "pat" }, { value: "lee" }, { value: "ari" }] }] }), params("dep-b-eng"));
    expect(add.status).toBe(200);
    // Before: Lee only; Pat skipped.
    expect(((await add.json()) as { members: Array<{ value: string }> }).members.map((m) => m.value)).toEqual(["lee", "pat"]);
    expect(seatOf("pat", "b").departmentId).toBe("dep-b-eng");
    expect(account("lee").departmentId).toBe("dep-b-eng");
    // Ari holds no seat in B: nothing of his is written.
    expect(account("ari").departmentId ?? null).toBeNull();
    // The group lists both kinds, and its delete counts both.
    expect(((await (await groupGet(scim("GET", "/api/scim/v2/Groups/dep-b-eng"), params("dep-b-eng"))).json()) as { members: Array<{ value: string }> }).members.map((m) => m.value)).toEqual(["lee", "pat"]);
    await groupPatch(scim("PATCH", "/api/scim/v2/Groups/dep-b-eng", { Operations: [{ op: "remove", path: 'members[value eq "lee"]' }] }), params("dep-b-eng"));
    expect(account("lee").departmentId ?? null).toBeNull();
    expect((await groupDelete(scim("DELETE", "/api/scim/v2/Groups/dep-b-eng"), params("dep-b-eng"))).status).toBe(409);
    // A full replace without her takes her out of it, and only out of it.
    expect((await groupPut(scim("PUT", "/api/scim/v2/Groups/dep-b-eng", { members: [{ value: "lee" }] }), params("dep-b-eng"))).status).toBe(200);
    expect(seatOf("pat", "b").departmentId ?? null).toBeNull();
    expect(account("lee").departmentId).toBe("dep-b-eng");
    // A remove from a group she is no longer in leaves her department here as it is.
    await groupPatch(scim("PATCH", "/api/scim/v2/Groups/dep-b-del", { Operations: [{ op: "add", path: "members", value: [{ value: "pat" }] }] }), params("dep-b-del"));
    await groupPatch(scim("PATCH", "/api/scim/v2/Groups/dep-b-eng", { Operations: [{ op: "remove", path: "members", value: [{ value: "pat" }] }] }), params("dep-b-eng"));
    expect(seatOf("pat", "b").departmentId).toBe("dep-b-del");
    // A new group's members are placed in it here.
    const made = await groupsPost(scim("POST", "/api/scim/v2/Groups", { displayName: "Support", members: [{ value: "pat" }] }));
    expect(made.status).toBe(201);
    const group = (await made.json()) as { id: string; members: Array<{ value: string }> };
    expect(group.members.map((m) => m.value)).toEqual(["pat"]);
    expect(seatOf("pat", "b").departmentId).toBe(group.id);
    expect(aSide()).toEqual(before);
  });
});

// The step 5 review fixes (docs/plans/workspace-status-2.md, "Step 5, review fixes").
describe("KRAs and SOPs are never assigned here to someone who works here from another workspace's account (the step 5 review M1)", () => {
  const seedAlignment = () => {
    db.seed("kRA", { id: "kra-b", name: "Ship B's releases", description: null, category: null, roleId: "role-b-lead", organizationId: "b", weight: 50, createdAt: new Date() });
    db.seed("sOP", { id: "sop-b", title: "B's release checklist", kraId: "kra-b", organizationId: "b", status: "PUBLISHED", sopType: "CHECKLIST", content: { sections: [] }, createdAt: new Date() });
  };
  const rowsOf = (userId: string) => ({
    kras: (db.tables.kRAAssignment ?? []).filter((r) => r.userId === userId).map((r) => r.kraId),
    sops: (db.tables.sOPAssignment ?? []).filter((r) => r.userId === userId).map((r) => r.sopId),
  });

  it("B gives Pat a new job title: it is saved, nothing is assigned, the answer says so, and A's My KRAs shows nothing of B's", async () => {
    seedAlignment();
    const res = await patch("pat", { roleId: "role-b-lead" });
    expect(res.status).toBe(200);
    // Before this fix: B's KRA and SOP rows were made for Pat, and A read them.
    expect(await res.json()).toMatchObject({ roleId: "role-b-lead", alignmentNote: ALIGNMENT_NOT_HERE });
    expect(seatOf("pat", "b").roleId).toBe("role-b-lead");
    expect(st.seeded).toEqual([]);
    expect(rowsOf("pat")).toEqual({ kras: [], sops: [] });
    // A's reader of Pat's KRAs (her My KRAs, in the session acting in A).
    st.me = "pat";
    st.org = "a";
    st.level = "EMPLOYEE";
    expect(((await (await myKras()).json()) as { kras: unknown[] }).kras).toEqual([]);
    // Lee, anchored here, still gets the job title's KRA and SOP, as anyone does.
    asHana();
    const lee = await patch("lee", { roleId: "role-b-lead" });
    expect(lee.status).toBe(200);
    expect(await lee.json()).not.toHaveProperty("alignmentNote");
    expect(st.seeded).toEqual([{ userId: "lee", roleId: "role-b-lead", organizationId: "b", assignedBy: "hana" }]);
    expect(rowsOf("lee")).toEqual({ kras: ["kra-b"], sops: ["sop-b"] });
    expect(ALIGNMENT_NOT_HERE).not.toMatch(/-{2}|\u2014|\u2013/);
  });

  it("the SOP, KRA and seed doors refuse Pat with the same sentence, writing nothing, and still serve Lee", async () => {
    seedAlignment();
    asBo();
    // An SOP to Pat, alone or among others: refused whole (before: assigned, and noticed in A).
    for (const userIds of [["pat"], ["lee", "pat"]]) {
      const res = await sopAssign(req("/api/sop-assignments", { method: "POST", body: { sopId: "sop-b", userIds } }));
      expect(res.status, userIds.join()).toBe(400);
      expect(await res.json()).toMatchObject({ error: ALIGNMENT_NOT_HERE, code: "alignment_elsewhere", userIds: ["pat"] });
    }
    expect(rowsOf("pat").sops).toEqual([]);
    expect(rowsOf("lee").sops).toEqual([]);
    expect((await sopAssign(req("/api/sop-assignments", { method: "POST", body: { sopId: "sop-b", userIds: ["lee"] } }))).status).toBe(201);
    expect(rowsOf("lee").sops).toEqual(["sop-b"]);
    // A KRA to Pat: the sentence (before: "User not found", for someone B's pickers offer).
    const kra = await kraAssign(req("/api/kra-assignments", { method: "POST", body: { userId: "pat", kraId: "kra-b", weightage: 40 } }));
    expect(kra.status).toBe(400);
    expect(((await kra.json()) as { error: string }).error).toBe(ALIGNMENT_NOT_HERE);
    expect(rowsOf("pat").kras).toEqual([]);
    // Seeding her job title's KRAs by hand: the same.
    const seed = await seedAlignmentRoute(req("/api/users/pat/seed-alignment", { method: "POST", body: { roleId: "role-b-lead" } }), params("pat"));
    expect(seed.status).toBe(400);
    expect(((await seed.json()) as { error: string }).error).toBe(ALIGNMENT_NOT_HERE);
    expect(rowsOf("pat")).toEqual({ kras: [], sops: [] });
    // Someone with no seat here is still not found.
    expect((await kraAssign(req("/api/kra-assignments", { method: "POST", body: { userId: "ari", kraId: "kra-b", weightage: 40 } }))).status).toBe(404);
  });
});

describe("a department, office or job title Pat holds here is never deleted under her (the step 5 review M2)", () => {
  it("the Settings deletes count her, as the SCIM Group delete does", async () => {
    asBo();
    // Pat alone holds B's Engineering, York and Tech Lead, through her membership.
    Object.assign(seatOf("pat", "b"), { departmentId: "dep-b-eng", officeId: "off-b-yrk", roleId: "role-b-lead" });
    const dept = await deptDelete(req("/api/departments/dep-b-eng", { method: "DELETE" }), params("dep-b-eng"));
    // Before: deleted, Pat's membership left with a dead id.
    expect(dept.status).toBe(409);
    expect(await dept.json()).toMatchObject({ code: "not_empty", error: "Move 1 person out of this department first." });
    const office = await officeDelete(req("/api/offices", { method: "DELETE", body: { id: "off-b-yrk" } }));
    expect(office.status).toBe(400);
    expect(((await office.json()) as { error: string }).error).toBe("Cannot delete office with assigned members");
    const title = await roleDelete(req("/api/roles/role-b-lead", { method: "DELETE" }), params("role-b-lead"));
    expect(title.status).toBe(409);
    expect(((await title.json()) as { error: string }).error).toBe("1 person holds this job title. Give them another title first.");
    expect(db.tables.department.some((d) => d.id === "dep-b-eng")).toBe(true);
    expect(db.tables.office.some((o) => o.id === "off-b-yrk")).toBe(true);
    expect(db.tables.role.some((r) => r.id === "role-b-lead")).toBe(true);
    // Once B removes her, she no longer holds them here: each delete goes through.
    seatOf("pat", "b").removedAt = new Date("2026-10-01");
    expect((await deptDelete(req("/api/departments/dep-b-eng", { method: "DELETE" }), params("dep-b-eng"))).status).toBe(200);
    expect((await officeDelete(req("/api/offices", { method: "DELETE", body: { id: "off-b-yrk" } }))).status).toBe(200);
    expect((await roleDelete(req("/api/roles/role-b-lead", { method: "DELETE" }), params("role-b-lead"))).status).toBe(200);
  });
});

describe("the step 5 review lows", () => {
  it("L1: Pat changing her own name from a session acting here through her membership is told her session is out of date", async () => {
    viewAs("pat", { level: "EMPLOYEE" });
    const res = await patch("pat", { firstName: "Patricia" });
    expect(res.status).toBe(409);
    // Before: "Their name, ... so only they can change them", to Pat herself.
    expect(await res.json()).toMatchObject({ code: "session_out_of_date", error: "Your session is out of date, so nothing was saved. Refresh the page and try again." });
    expect(account("pat").firstName).toBe("Pat");
  });

  it("L2: a profile or Reports to edit of a seat removed here is refused in words, for both kinds, and nothing is written", async () => {
    asBo();
    seatOf("pat", "b").removedAt = new Date("2026-10-01");
    account("lee").deletedAt = new Date("2026-10-01");
    const before = { pat: { ...seatOf("pat", "b") }, lee: { ...account("lee") }, a: aSide() };
    for (const id of ["pat", "lee"]) {
      for (const body of [{ departmentId: "dep-b-eng" }, { managerId: "kim" }, { weeklyCapacityHours: 5 }]) {
        const res = await patch(id, body);
        expect(res.status, `${id} ${JSON.stringify(body)}`).toBe(409);
        expect(await res.json()).toMatchObject({ code: "removed", error: "They were removed from this workspace. Restore them first." });
      }
    }
    expect(seatOf("pat", "b")).toEqual(before.pat);
    expect(account("lee")).toEqual(before.lee);
    expect(aSide()).toEqual(before.a);
  });

  it("L2: SCIM Groups neither list, write nor count a seat removed here, so the group deletes", async () => {
    Object.assign(seatOf("pat", "b"), { departmentId: "dep-b-eng", removedAt: new Date("2026-10-01") });
    const listed = (await (await groupGet(scim("GET", "/api/scim/v2/Groups/dep-b-eng"), params("dep-b-eng"))).json()) as { members: Array<{ value: string }> };
    expect(listed.members).toEqual([]);
    // An add for her is a harmless no-op: her ended seat keeps what it held.
    expect((await groupPatch(scim("PATCH", "/api/scim/v2/Groups/dep-b-del", { Operations: [{ op: "add", path: "members", value: [{ value: "pat" }] }] }), params("dep-b-del"))).status).toBe(200);
    expect(seatOf("pat", "b").departmentId).toBe("dep-b-eng");
    // Nobody here holds Engineering any more: the delete goes through.
    expect((await groupDelete(scim("DELETE", "/api/scim/v2/Groups/dep-b-eng"), params("dep-b-eng"))).status).toBe(204);
    expect(db.tables.department.some((d) => d.id === "dep-b-eng")).toBe(false);
  });

  it("L3: the record offers B's tags of Pat to the people who may tag her, as for anyone", async () => {
    const hana = await record("pat");
    // Before: tags false, and the Tags row hidden with her people data.
    expect(hana.access).toMatchObject({ tags: true, profileData: true });
    asMax();
    expect((await record("pat")).access).toMatchObject({ tags: false });
  });

  it("L5: a bulk batch past its time, and a deadlock in a SCIM Group write, are the 503 try again, writing nothing", async () => {
    const failInside = (entry: string, code: string, message: string) => {
      db.onCall = (e) => {
        if (e !== entry) return;
        db.onCall = null;
        db.failWith = { code, message };
        db.failing.add(entry.split(".")[1]);
      };
    };
    failInside("tx.organizationMembership.updateMany", "P2028", "Transaction already closed: A query cannot be executed on an expired transaction.");
    const res = await bulkUpdate(req("/api/people/bulk-update", { method: "POST", body: { userIds: ["pat", "lee"], action: "change_department", payload: { departmentId: "dep-b-eng" } } }));
    db.failing.clear();
    // Before: a 500.
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "roles_busy", error: "That took too long, so nothing was saved. Try again in a moment." });
    expect(account("lee").departmentId).toBe("dep-b-del");
    expect(seatOf("pat", "b").departmentId).toBe("dep-b-del");
    // The group's writes are one transaction since step 9 (seat-writes.ts
    // placeDepartmentHere): Lee's account half is written, then the
    // membership half meets the deadlock, and the whole batch rolls back.
    failInside("tx.organizationMembership.updateManyAndReturn", "40P01", "deadlock detected");
    const scimRes = await groupPatch(scim("PATCH", "/api/scim/v2/Groups/dep-b-eng", { Operations: [{ op: "add", path: "members", value: [{ value: "pat" }, { value: "lee" }] }] }), params("dep-b-eng"));
    db.failing.clear();
    expect(scimRes.status).toBe(503);
    expect(db.log).toContain("tx.user.updateManyAndReturn");
    expect(seatOf("pat", "b").departmentId).toBe("dep-b-del");
    expect(account("lee").departmentId).toBe("dep-b-del");
  });
});
