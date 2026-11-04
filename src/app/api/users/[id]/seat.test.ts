// A person's status in each workspace, step 3 (docs/plans/workspace-status.md):
// PATCH and DELETE /api/users/[id] act on everyone who belongs here, at the
// seat they hold HERE, through endSeat and restoreSeat (D3 to D6, D11, D15).
// Run through the real seat writers, the real move between workspaces, the
// real Owner and Admin guards and the real role planner, on an in-memory
// database whose relations follow the rows (src/lib/access/seat-test-db.ts).
//
// Before step 3 a person who works here through a membership was a 404 on
// every one of these routes (they found people anchored here only), so a
// workspace could not deactivate or remove a departing contractor anchored in
// their own company; and a deactivation or removal of someone anchored here
// ended their account in every workspace, signed out everywhere.

import { NextRequest } from "next/server";
import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  ctx: {} as Record<string, unknown>,
  fresh: { ok: true, admin: true, owner: true } as Record<string, unknown>,
  teammateEnds: [] as unknown[][],
  skillsBack: [] as unknown[][],
  logs: [] as Array<{ type: string; description: string; metadata?: Record<string, unknown>; newValue?: unknown }>,
  seatChecks: 0,
  seatsFull: false,
  /** The score reads the record made, with their arguments. */
  scoreReads: [] as unknown[][],
  /** Run once between PATCH's first read and its transaction (a concurrent change, the step 3 review M1). */
  between: null as null | (() => void),
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "u-admin" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async (row: (typeof st.logs)[number]) => { st.logs.push(row); } }));
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async (...a: unknown[]) => { st.teammateEnds.push(a); } }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async (...a: unknown[]) => { st.skillsBack.push(a); } }));
vi.mock("@/lib/access/role-change-after", () => ({ afterRoleChanges: async () => undefined }));
vi.mock("@/lib/access/flags", () => ({ accessV2Resolver: () => false }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/access/workspace-admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/workspace-admin")>()),
  freshWorkspaceActor: async () => st.fresh,
}));
// The viewer each test sets; relationTo, mayRemovePerson and mayHandOverPerson are the real rules.
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));
vi.mock("@/lib/seats", () => ({
  lockWorkspaceSeats: async () => undefined,
  seatsFor: async () => {
    st.seatChecks += 1;
    return st.seatsFull ? { ok: false, message: "Your plan has no free seat." } : { ok: true };
  },
}));
// The handover's own reads are handover.server.test.ts's: here nothing is left to hand over.
// Since workspace-status-2 step 4 (E6) no end moves a line itself: the
// handover moved this workspace's reports first, and nothing is left for
// the end (moveReliedReportsAtEnd retired).
vi.mock("@/lib/people/handover.server", () => ({
  pendingHandover: async () => ({ openTasks: 0, directReports: 0, containers: 0 }),
}));
// A restore's line check is manager-candidate.ts's (tested there): no line is stale here.
vi.mock("@/lib/access/manager-candidate", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/manager-candidate")>()),
  staleLinesOf: async () => ({ manager: null, dotted: [] }),
}));
vi.mock("@/lib/performance/review-cycle.server", () => ({ followReportingLine: async () => undefined }));
// The erasure check PATCH reads between its first read of the person and its
// transaction: where a test makes another admin's change land (M1).
vi.mock("@/lib/compliance/erased-account", async (orig) => {
  const real = await orig<typeof import("@/lib/compliance/erased-account")>();
  return {
    ...real,
    isErasedAccount: async (...a: Parameters<typeof real.isErasedAccount>) => {
      const run = st.between;
      st.between = null;
      run?.();
      return real.isErasedAccount(...a);
    },
  };
});
vi.mock("@/services/performanceScoreService", () => ({
  getLatestScore: async (...a: unknown[]) => { st.scoreReads.push(["latest", ...a]); return null; },
  getScoreHistory: async (...a: unknown[]) => { st.scoreReads.push(["history", ...a]); return []; },
}));
vi.mock("@/lib/alignment-assign", () => ({ seedAlignmentForUser: async () => undefined }));
vi.mock("@/lib/people/directory-list.server", () => ({ presenceFor: async () => new Map() }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { ratingLabel } from "@/lib/people/skills-aggregate";
import { DELETE, GET, PATCH } from "./route";

const T0 = new Date("2026-01-01T00:00:00Z");
let made = 0;
function person(id: string, organizationId: string, accessLevel = "EMPLOYEE", extra: Record<string, unknown> = {}) {
  made += 1;
  return db.seed("user", { id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Lee", organizationId, ...legacyLevelRow(accessLevel), createdAt: new Date(T0.getTime() + made * 1000), managerId: null, ...extra });
}
function seat(userId: string, organizationId: string, role = "EMPLOYEE", extra: Record<string, unknown> = {}) {
  made += 1;
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role, createdAt: new Date(T0.getTime() + made * 1000), ...extra });
}
const user = (id: string) => db.row("user", id);
const seatOf = (userId: string, organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId);
const key = (id: string, organizationId: string, createdById: string) =>
  db.seed("apiKey", { id, name: `Key ${id}`, prefix: `wk_live_${id}`, organizationId, createdById, revokedAt: null });

/** The viewer: an Admin of B unless a test says otherwise (person-access.server.ts PeopleCtx). */
function viewer(extra: Record<string, unknown> = {}) {
  return { userId: "u-admin", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN"), orgRole: "ADMIN", isAgent: false, isAdmin: true, peopleTeam: false, orgWide: true, managerTier: true, chain: new Set<string>(), writeChain: new Set<string>(), viewer: {}, ...extra };
}
const req = (id: string, init: { method: string; body?: unknown; query?: string }) =>
  new NextRequest(`https://app.test/api/users/${id}${init.query ?? ""}`, { method: init.method, ...(init.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}) });
const patch = (id: string, body: unknown) => PATCH(req(id, { method: "PATCH", body }), { params: Promise.resolve({ id }) });
const remove = (id: string) => DELETE(req(id, { method: "DELETE" }), { params: Promise.resolve({ id }) });
const restore = (id: string) => DELETE(req(id, { method: "DELETE", query: "?restore=true" }), { params: Promise.resolve({ id }) });
const get = (id: string) => GET(req(id, { method: "GET" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  db.reset();
  made = 0;
  st.ctx = viewer();
  st.fresh = { ok: true, admin: true, owner: true };
  st.teammateEnds = [];
  st.skillsBack = [];
  st.logs = [];
  st.seatChecks = 0;
  st.seatsFull = false;
  st.scoreReads = [];
  st.between = null;
  for (const id of ["a", "b", "c"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  // B: Olga owns it, the acting Admin works there. Pat is anchored in A and
  // works in B through a membership (a Member there).
  person("olga", "b", "SUPER_ADMIN");
  person("u-admin", "b", "COMPANY_ADMIN");
  person("pat", "a", "COMPANY_ADMIN");
  seat("pat", "b");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("someone who works here through a membership (D5, D11)", () => {
  it("a deactivation writes only their membership here: their account, their home and their sessions are untouched", async () => {
    key("k-b", "b", "pat");
    key("k-a", "a", "pat");
    // A's department on the account, B's on the membership (D18).
    db.seed("department", { id: "dep-a", name: "A's Finance", organizationId: "a" });
    db.seed("department", { id: "dep-b", name: "B's Delivery", organizationId: "b" });
    user("pat").departmentId = "dep-a";
    seatOf("pat", "b")!.departmentId = "dep-b";
    const res = await patch("pat", { status: "INACTIVE" });
    // Before: 404 User not found.
    expect(res.status).toBe(200);
    expect(seatOf("pat", "b")).toMatchObject({ status: "INACTIVE", removedAt: null });
    expect(user("pat")).toMatchObject({ organizationId: "a", status: "ACTIVE", deletedAt: null, tokenVersion: 0, ...legacyLevelRow("COMPANY_ADMIN") });
    // This workspace's teammate access ends.
    expect(st.teammateEnds).toEqual([["b", ["pat"], "deactivated", "u-admin"]]);
    // The API keys they made HERE stop working (D15), with an audit row here; A's stays.
    expect(db.row("apiKey", "k-b").revokedAt).toBeInstanceOf(Date);
    expect(db.row("apiKey", "k-a").revokedAt).toBeNull();
    expect(db.tables.activityLog?.filter((r) => r.type === "api_key_revoked").map((r) => [r.organizationId, r.targetId, r.actorId])).toEqual([["b", "k-b", "u-admin"]]);
    const body = await res.json();
    expect(body).toMatchObject({ id: "pat", status: "INACTIVE", ...legacyLevelRow("EMPLOYEE"), profileHere: false, apiKeysRevoked: 1 });
    // Nothing of A's profile (the account's department) is sent: the
    // placement answered is the one their membership here holds
    // (workspace-status-2.md step 5).
    expect(body.departmentId).toBe("dep-b");
    expect(JSON.stringify(body)).not.toContain("dep-a");
    expect(st.logs.find((l) => l.type === "membership.changed")).toMatchObject({ description: "Deactivated Pat Lee", metadata: { seat: "membership", outcome: "membership_ended", accountMoved: false, apiKeysRevoked: 1 } });
  });

  it("a reactivation brings their membership back under the seat check, and no API key with it", async () => {
    key("k-b", "b", "pat");
    await patch("pat", { status: "INACTIVE" });
    st.seatChecks = 0;
    const res = await patch("pat", { status: "ACTIVE" });
    expect(res.status).toBe(200);
    expect(st.seatChecks).toBe(1);
    expect(seatOf("pat", "b")).toMatchObject({ status: "ACTIVE", removedAt: null });
    expect(user("pat")).toMatchObject({ status: "ACTIVE", tokenVersion: 0, organizationId: "a" });
    expect(st.skillsBack).toEqual([["b", ["pat"]]]);
    // Restoring brings no key back (D15).
    expect(db.row("apiKey", "k-b").revokedAt).toBeInstanceOf(Date);
    // A full plan refuses it, writing nothing.
    await patch("pat", { status: "INACTIVE" });
    st.seatsFull = true;
    const full = await patch("pat", { status: "ACTIVE" });
    expect(full.status).toBe(403);
    expect(seatOf("pat", "b")?.status).toBe("INACTIVE");
  });

  it("an HR label is written to the seat here, never to the account (whose status is A's)", async () => {
    const res = await patch("pat", { status: "ON_LEAVE" });
    expect(res.status).toBe(200);
    expect(seatOf("pat", "b")?.status).toBe("ON_LEAVE");
    expect(user("pat").status).toBe("ACTIVE");
    // A reactivation with a label sets that label on the seat.
    await patch("pat", { status: "INACTIVE" });
    await patch("pat", { status: "PROBATION" });
    expect(seatOf("pat", "b")?.status).toBe("PROBATION");
    expect(user("pat").status).toBe("ACTIVE");
  });

  it("a role change writes their membership's role here, never the account's level in A, and bumps nothing", async () => {
    const res = await patch("pat", { orgRole: "MEMBER", memberTier: "MANAGER" });
    expect(res.status).toBe(200);
    expect(seatOf("pat", "b")?.role).toBe("MANAGER");
    expect(user("pat")).toMatchObject({ ...legacyLevelRow("COMPANY_ADMIN"), tokenVersion: 0 });
    expect(st.logs.find((l) => l.type === "org_role.changed")).toMatchObject({ metadata: { tokenVersionBumped: false } });
  });

  // workspace-status-2.md step 5 (E7): their profile and line here are
  // written here, on their membership; only their shared identity is not.
  // Before step 5 every field but the role and the status was refused with
  // "their details here are read-only".
  it("refuses their name, phone, photo and birthday with the shared-identity sentence, writing nothing", async () => {
    for (const body of [{ firstName: "Patricia" }, { status: "INACTIVE", phone: "1" }, { dateOfBirth: "1990-01-01" }, { avatar: "x" }]) {
      const res = await patch("pat", body);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toMatchObject({ code: "identity_shared", error: "Their name, sign-in address, phone, photo and birthday are shared with another workspace, so only they can change them." });
      expect(json.error).not.toMatch(/--|—/);
    }
    expect(user("pat").firstName).toBe("Pat");
    expect(seatOf("pat", "b")?.status).toBe("ACTIVE");
  });

  // Reports to, the hours, the working week, the profile fields and the
  // dotted lines: src/lib/people/workspace-profile-writes.test.ts.
  it("writes their department on their membership here, never the account", async () => {
    db.seed("department", { id: "dep-b", name: "B's Delivery", organizationId: "b" });
    expect((await patch("pat", { departmentId: "dep-b" })).status).toBe(200);
    expect(seatOf("pat", "b")!.departmentId).toBe("dep-b");
    expect(user("pat").departmentId ?? null).toBeNull();
    expect((await patch("pat", { departmentId: null })).status).toBe(200);
    expect(seatOf("pat", "b")!.departmentId).toBeNull();
  });

  it("a removal ends their membership here and never deletes it; a restore brings it back under the seat check", async () => {
    const res = await remove("pat");
    // Before: 404 User not found.
    expect(res.status).toBe(200);
    expect(seatOf("pat", "b")).toMatchObject({ status: "INACTIVE", removedAt: expect.any(Date) });
    expect(user("pat")).toMatchObject({ organizationId: "a", status: "ACTIVE", deletedAt: null, tokenVersion: 0 });
    expect(st.teammateEnds).toEqual([["b", ["pat"], "left", "u-admin"]]);
    expect(st.logs.find((l) => l.type === "user_removed")).toMatchObject({ metadata: { seat: "membership", outcome: "membership_ended", accountMoved: false } });
    // A reactivation of a removed seat is refused: a restore brings it back.
    const reactivate = await patch("pat", { status: "ACTIVE" });
    expect(reactivate.status).toBe(409);
    expect(await reactivate.json()).toMatchObject({ code: "removed", error: "They were removed from this workspace. Restore them first." });
    const back = await restore("pat");
    expect(back.status).toBe(200);
    expect(st.seatChecks).toBe(1);
    expect(seatOf("pat", "b")).toMatchObject({ status: "ACTIVE", removedAt: null });
    expect(st.skillsBack).toEqual([["b", ["pat"]]]);
    expect(st.logs.find((l) => l.type === "user_restored")).toMatchObject({ metadata: { seat: "membership", accountMoved: false } });
  });

  it("the record answers identity, role and status here, and nothing of A's profile", async () => {
    db.seed("department", { id: "dep-a", name: "A's Finance", organizationId: "a" });
    user("pat").departmentId = "dep-a";
    seatOf("pat", "b")!.status = "INACTIVE";
    const res = await get("pat");
    // Before: 404.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "pat", email: "pat@x.test", isDeactivated: true, deletedAt: null, department: null, role: null, minimal: true, profileHere: false });
    expect(body.access).toMatchObject({ peopleData: false, remove: true, restore: false, profileHere: false });
    // An Admin edits their profile here (step 5), never their shared identity.
    expect(body.access.editable).toEqual(expect.arrayContaining(["roleId", "departmentId", "officeId", "managerId", "weeklyCapacityHours", "status"]));
    for (const f of ["firstName", "lastName", "phone", "avatar", "dateOfBirth"]) expect(body.access.editable).not.toContain(f);
    expect(JSON.stringify(body)).not.toContain("Finance");
    // Nobody here at all: still a 404.
    person("ned", "a");
    expect((await get("ned")).status).toBe(404);
  });

  // The step 4 review H1 (access/joined-here.ts): a membership row that is
  // the person's home row (the workspace their account was made in, left
  // first) was made at the move; they joined here when the account was made.
  it("the record's join date is when they joined here, the home row dated by the account", async () => {
    user("pat").createdAt = new Date("2019-01-01T00:00:00Z");
    seatOf("pat", "b")!.createdAt = new Date("2026-06-01T00:00:00Z");
    expect((await (await get("pat")).json()).joinDate).toBe("2026-06-01T00:00:00.000Z");
    seatOf("pat", "b")!.isPrimary = true;
    // Before: 2026-06-01, the moment Pat's account left B.
    expect((await (await get("pat")).json()).joinDate).toBe("2019-01-01T00:00:00.000Z");
  });
});

// The final review, security H1: a name shared with another workspace
// (the account holds a membership there, in any state) is the person's
// everywhere, so a workspace Admin no longer rewrites it; the person does.
describe("a name shared with another workspace (security H1)", () => {
  it("an Admin's rename of someone anchored here who also belongs elsewhere is refused with one sentence, writing nothing", async () => {
    person("lee", "b");
    seat("lee", "c", "EMPLOYEE", { status: "INACTIVE", removedAt: T0 });
    const res = await patch("lee", { firstName: "Mallory", lastName: "Evil" });
    // Before: 200, the name every workspace reads rewritten by this one's Admin.
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toEqual({ error: "Their name, sign-in address, phone, photo and birthday are shared with another workspace, so only they can change them.", code: "identity_shared", fields: ["firstName", "lastName"] });
    expect(user("lee")).toMatchObject({ firstName: "Lee", lastName: "Lee" });
  });

  it("the person renames themselves, and an Admin renames someone who belongs here only, as before", async () => {
    person("lee", "b");
    seat("lee", "c");
    st.ctx = viewer({ userId: "lee", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", isAdmin: false, orgWide: false });
    expect((await patch("lee", { firstName: "Leigh" })).status).toBe(200);
    expect(user("lee").firstName).toBe("Leigh");
    st.ctx = viewer();
    person("ivy", "b");
    expect((await patch("ivy", { lastName: "Moss" })).status).toBe(200);
    expect(user("ivy").lastName).toBe("Moss");
  });

  it("a membership elsewhere made between the first read and the write is seen under the lock", async () => {
    person("lee", "b");
    st.between = () => void seat("lee", "c");
    const res = await patch("lee", { firstName: "Mallory" });
    expect(res.status).toBe(403);
    expect(user("lee").firstName).toBe("Lee");
  });
});

// The fixes review L8: the phone, photo and date of birth are on the same
// account every workspace reads (the SQL header keeps them there), so B's
// managers, People team and Admins set the photo and phone A and C show.
// Now the same rule as the name: only the person changes them.
describe("a phone, photo and birthday shared with another workspace (fixes review L8)", () => {
  const SHARED = "Their name, sign-in address, phone, photo and birthday are shared with another workspace, so only they can change them.";
  const BIRTHDAY = new Date("1990-04-02T12:00:00Z");

  it("anyone but the person is refused each of them with the one sentence, writing nothing", async () => {
    person("lee", "b", "EMPLOYEE", { phone: "+44 1", avatar: "/a.png", dateOfBirth: BIRTHDAY });
    seat("lee", "c");
    for (const [field, value] of [["phone", "+1 555 0100"], ["avatar", "/api/uploads/b.png"], ["dateOfBirth", "1991-05-03"]] as const) {
      const res = await patch("lee", { [field]: value });
      // Before: 200, the value every workspace reads rewritten by this one's Admin.
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: SHARED, code: "identity_shared", fields: [field] });
    }
    // A People team member is refused the same way, and so is a manager filling in a missing birthday.
    st.ctx = viewer({ ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", isAdmin: false, peopleTeam: true, orgWide: false });
    expect(await (await patch("lee", { phone: null })).json()).toMatchObject({ code: "identity_shared" });
    expect(user("lee")).toMatchObject({ phone: "+44 1", avatar: "/a.png", dateOfBirth: BIRTHDAY });
    person("kim", "b", "EMPLOYEE", { dateOfBirth: null });
    seat("kim", "a");
    st.ctx = viewer({ userId: "mo", ...legacyLevelRow("MANAGER"), orgRole: "MEMBER", isAdmin: false, orgWide: false, managerTier: true, chain: new Set(["kim"]), writeChain: new Set(["kim"]) });
    const filled = await patch("kim", { dateOfBirth: "1992-06-04" });
    expect(filled.status).toBe(403);
    expect(await filled.json()).toMatchObject({ code: "identity_shared", fields: ["dateOfBirth"] });
    expect(user("kim").dateOfBirth).toBeNull();
  });

  it("the person changes their own, and an Admin changes them for someone who belongs here only, as before", async () => {
    person("lee", "b");
    seat("lee", "c", "EMPLOYEE", { status: "INACTIVE", removedAt: T0 });
    st.ctx = viewer({ userId: "lee", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", isAdmin: false, orgWide: false });
    expect((await patch("lee", { phone: "+1 555 0100", avatar: "/api/uploads/l.png", dateOfBirth: "1991-05-03" })).status).toBe(200);
    expect(user("lee")).toMatchObject({ phone: "+1 555 0100", avatar: "/api/uploads/l.png" });
    st.ctx = viewer();
    person("ivy", "b");
    expect((await patch("ivy", { phone: "+1 555 0199" })).status).toBe(200);
    expect(user("ivy").phone).toBe("+1 555 0199");
  });

  it("a membership elsewhere made between the first read and the write is seen under the lock", async () => {
    person("lee", "b", "EMPLOYEE", { phone: "+44 1" });
    st.between = () => void seat("lee", "c");
    const res = await patch("lee", { phone: "+1 555 0100" });
    expect(res.status).toBe(403);
    expect(user("lee").phone).toBe("+44 1");
  });
});

describe("someone anchored here (D3, D4)", () => {
  it("with a usable seat elsewhere, a deactivation moves them there: this workspace keeps the ended seat, nobody is signed out", async () => {
    person("max", "b", "MANAGER");
    seat("max", "c", "EMPLOYEE");
    key("k-b", "b", "max");
    const res = await patch("max", { status: "INACTIVE" });
    expect(res.status).toBe(200);
    // Before: User.status INACTIVE and tokenVersion bumped, so Max lost C too.
    expect(user("max")).toMatchObject({ organizationId: "c", status: "ACTIVE", ...legacyLevelRow("EMPLOYEE"), tokenVersion: 0 });
    expect(seatOf("max", "b")).toMatchObject({ status: "INACTIVE", removedAt: null, role: "MANAGER" });
    // His lines in C are C's own rows (workspace-status-2 E1): untouched.
    expect(db.row("apiKey", "k-b").revokedAt).toBeInstanceOf(Date);
    // The answer is the seat here, not the account in C.
    expect(await res.json()).toMatchObject({ status: "INACTIVE", profileHere: false });
    expect(st.logs.find((l) => l.type === "membership.changed")).toMatchObject({ metadata: { seat: "anchor", outcome: "moved", accountMoved: true } });
    // That it moved, never where: C's id stays out of B's log (the step 3 review L5).
    expect(JSON.stringify(st.logs)).not.toContain('"c"');
    // B reactivates him: the membership comes back; he stays anchored in C.
    expect((await patch("max", { status: "ACTIVE" })).status).toBe(200);
    expect(seatOf("max", "b")?.status).toBe("ACTIVE");
    expect(user("max")).toMatchObject({ organizationId: "c", tokenVersion: 0 });
  });

  it("with nowhere else, a deactivation ends the account as before and signs them out, moving no line itself", async () => {
    person("solo", "b");
    // A tab from before workspace-status-2 step 4 still sends handoverTo: ignored.
    const res = await patch("solo", { status: "INACTIVE", handoverTo: "olga" });
    expect(res.status).toBe(200);
    expect(user("solo")).toMatchObject({ organizationId: "b", status: "INACTIVE", deletedAt: null, tokenVersion: 1 });
    expect(await res.json()).not.toHaveProperty("reportsAlsoElsewhere");
    expect(st.logs.find((l) => l.type === "membership.changed")).toMatchObject({ metadata: { seat: "anchor", outcome: "account_ended", accountMoved: false } });
    // And a reactivation brings it back, signed out still (no new bump), under the seat check.
    expect((await patch("solo", { status: "ACTIVE" })).status).toBe(200);
    expect(user("solo")).toMatchObject({ status: "ACTIVE", tokenVersion: 1 });
  });

  it("a removal with a usable seat elsewhere moves them there, removed here; a restore here brings the seat back", async () => {
    person("max", "b");
    seat("max", "c");
    expect((await remove("max")).status).toBe(200);
    expect(user("max")).toMatchObject({ organizationId: "c", status: "ACTIVE", deletedAt: null, tokenVersion: 0 });
    expect(seatOf("max", "b")).toMatchObject({ status: "INACTIVE", removedAt: expect.any(Date) });
    expect(st.logs.find((l) => l.type === "user_removed")).toMatchObject({ metadata: { outcome: "moved", accountMoved: true } });
    expect(st.logs.find((l) => l.type === "user_removed")?.metadata).not.toHaveProperty("movedTo");
    // Now he works in B through the membership the move left: B restores it.
    expect((await restore("max")).status).toBe(200);
    expect(seatOf("max", "b")).toMatchObject({ status: "ACTIVE", removedAt: null });
    expect(user("max").organizationId).toBe("c");
  });

  it("a removal with nowhere else ends the account as before; the restore brings it back", async () => {
    person("solo", "b");
    const gone = await remove("solo");
    expect(gone.status).toBe(200);
    expect(user("solo")).toMatchObject({ status: "INACTIVE", deletedAt: expect.any(Date), tokenVersion: 1 });
    expect(await gone.json()).toEqual({ message: "Solo Lee has been removed" });
    expect((await restore("solo")).status).toBe(200);
    expect(user("solo")).toMatchObject({ status: "ACTIVE", deletedAt: null });
  });

  it("restoring a membership whose account is ended at home moves the account here (D6), and says where from", async () => {
    // Pat was removed in A, her home, with nowhere else then; B had removed her too.
    user("pat").deletedAt = new Date("2026-09-01");
    user("pat").status = "INACTIVE";
    seatOf("pat", "b")!.status = "INACTIVE";
    seatOf("pat", "b")!.removedAt = new Date("2026-08-01");
    expect((await restore("pat")).status).toBe(200);
    expect(user("pat")).toMatchObject({ organizationId: "b", status: "ACTIVE", deletedAt: null });
    expect(st.logs.find((l) => l.type === "user_restored")).toMatchObject({ metadata: { seat: "membership", accountMoved: true } });
    expect(st.logs.find((l) => l.type === "user_restored")?.metadata).not.toHaveProperty("movedFrom");
  });
});

describe("restoreSeat's refusals are plain sentences", () => {
  it("refuses a restore when another account with the address is live here, and names it to an Admin", async () => {
    seatOf("pat", "b")!.status = "INACTIVE";
    seatOf("pat", "b")!.removedAt = new Date("2026-08-01");
    person("pat2", "b", "EMPLOYEE", { email: "PAT@x.test", firstName: "Patty", lastName: "Two" });
    const res = await restore("pat");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "Another account with this address is already active here: Patty Two (PAT@x.test). The two accounts need to be merged first.", code: "duplicate_account" });
    expect(body.error).not.toMatch(/--|—/);
    expect(seatOf("pat", "b")?.removedAt).toBeInstanceOf(Date);
    // To someone who is no Admin, the other account is not named.
    person("mgr", "b", "MANAGER");
    st.ctx = viewer({ userId: "mgr", ...legacyLevelRow("MANAGER"), orgRole: "MEMBER", isAdmin: false, orgWide: false, writeChain: new Set(["pat"]), chain: new Set(["pat"]) });
    const plain = await restore("pat");
    expect(await plain.json()).toEqual({ error: "Another account with this address is already active here.", code: "duplicate_account" });
  });

  it("refuses a restore of someone who is not removed, and of an erased account", async () => {
    const res = await DELETE(req("pat", { method: "DELETE", query: "?restore=true" }), { params: Promise.resolve({ id: "pat" }) });
    // Not removed: Restore is not offered (403), as for anyone anchored here.
    expect(res.status).toBe(403);
    // Erased by their own person: never brought back.
    person("gone", "b", "EMPLOYEE", { status: "INACTIVE", deletedAt: new Date("2026-10-01T09:00:00Z") });
    db.seed("consentRecord", { id: "c1", userId: "gone", method: "erasure", withdrawnAt: new Date("2026-10-01T09:00:00Z") });
    const erased = await restore("gone");
    expect(erased.status).toBe(409);
    expect((await erased.json()).code).toBe("account_erased");
  });
});

describe("the Owner and Admin guards count the people who work here through a membership", () => {
  it("a membership Owner is guarded like any Owner: only an Owner deactivates them, never the last one", async () => {
    seatOf("pat", "b")!.role = "SUPER_ADMIN";
    st.fresh = { ok: true, admin: true, owner: false };
    st.ctx = viewer({ userId: "u-admin" });
    const notOwner = await patch("pat", { status: "INACTIVE" });
    expect(notOwner.status).toBe(403);
    expect((await notOwner.json()).code).toBe("owner_only");
    expect(seatOf("pat", "b")?.status).toBe("ACTIVE");
    // Olga, an Owner, is the actor: Pat is not the last Owner, so it goes.
    st.fresh = { ok: true, admin: true, owner: true };
    st.ctx = viewer({ userId: "olga", ...legacyLevelRow("SUPER_ADMIN"), orgRole: "OWNER" });
    expect((await patch("pat", { status: "INACTIVE" })).status).toBe(200);
    // Pat's seat here is ended now, so she is no Owner here: an Admin may
    // act on her as on a Member (the last-Owner count itself is
    // membership-seat.test.ts's).
    st.fresh = { ok: true, admin: true, owner: false };
    st.ctx = viewer({ userId: "u-admin" });
    expect((await remove("pat")).status).toBe(200);
  });

  it("the last Company Admin guard counts a membership Admin, and refuses removing the last one", async () => {
    // u-admin is anchored here; Pat is an Admin here through her membership.
    seatOf("pat", "b")!.role = "COMPANY_ADMIN";
    st.ctx = viewer({ userId: "olga", ...legacyLevelRow("SUPER_ADMIN"), orgRole: "OWNER" });
    // Before: refused ("the last Company Admin"), Pat not counted.
    expect((await remove("u-admin")).status).toBe(200);
    // Now Pat is the last Company Admin, through her membership: refused.
    const res = await remove("pat");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This is the last Company Admin. Make someone else an Admin first.");
    expect(seatOf("pat", "b")?.removedAt).toBeNull();
  });
});

describe("a viewer who is no Admin keeps exactly today's gates", () => {
  it("someone outside their reporting line is refused everything, and nothing is written", async () => {
    person("ann", "b");
    st.ctx = viewer({ userId: "ann", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", isAdmin: false, orgWide: false, managerTier: false });
    expect((await patch("pat", { status: "INACTIVE" })).status).toBe(403);
    expect((await patch("pat", { orgRole: "ADMIN" })).status).toBe(403);
    expect((await remove("pat")).status).toBe(403);
    expect(seatOf("pat", "b")).toMatchObject({ status: "ACTIVE", removedAt: null, role: "EMPLOYEE" });
  });

  it("a manager over their solid line may deactivate them, as anyone in their tree, never change their role", async () => {
    person("mgr", "b", "MANAGER");
    st.ctx = viewer({ userId: "mgr", ...legacyLevelRow("MANAGER"), orgRole: "MEMBER", isAdmin: false, orgWide: false, writeChain: new Set(["pat"]), chain: new Set(["pat"]) });
    st.fresh = { ok: true, admin: false, owner: false };
    expect((await patch("pat", { orgRole: "ADMIN" })).status).toBe(403);
    expect((await patch("pat", { status: "INACTIVE" })).status).toBe(200);
    expect(seatOf("pat", "b")?.status).toBe("INACTIVE");
    // Never on an Admin here.
    seatOf("pat", "b")!.status = "ACTIVE";
    seatOf("pat", "b")!.role = "COMPANY_ADMIN";
    expect((await remove("pat")).status).toBe(403);
  });
});

// The step 3 review H2 and D18: the record of someone anchored here reads
// only this workspace's own department, job role and office, and the
// history tied to them only through this workspace's own parents (its KPIs,
// review cycles, kudos and scores). Before, a person moved here from another
// company (D3, D6, the switcher) showed that company's title and department,
// KPI history and review outcomes here.
describe("the record of someone anchored here is this workspace's alone (D18)", () => {
  it("names no other workspace's department or job role, and reads its KPIs, reviews, kudos and scores only", async () => {
    person("max", "b", "MANAGER", { departmentId: "dep-a", roleId: "role-a", officeId: "off-b", joinDate: new Date("2026-06-01"), phone: null, dateOfBirth: null });
    db.seed("department", { id: "dep-a", name: "A Finance", color: null, organizationId: "a" });
    db.seed("role", { id: "role-a", title: "A Controller", description: null, level: "MANAGER", organizationId: "a" });
    db.seed("office", { id: "off-b", name: "B London", city: "London", country: "UK", isHeadquarters: true, organizationId: "b" });
    db.seed("kPI", { id: "k-a", name: "A revenue", unit: "GBP", organizationId: "a" });
    db.seed("kPI", { id: "k-b", name: "B tickets", unit: null, organizationId: "b" });
    for (const [id, kpiId] of [["r-a", "k-a"], ["r-b", "k-b"]]) {
      db.seed("kPIRecord", { id, kpiId, userId: "max", period: "2026-10", actualValue: 1, targetValue: 2, score: 50, status: "SUBMITTED", reviewedById: null, updatedAt: new Date() });
    }
    db.seed("reviewCycle", { id: "c-a", name: "A H1", startDate: new Date(), endDate: new Date(), status: "COMPLETED", organizationId: "a" });
    db.seed("reviewCycle", { id: "c-b", name: "B H1", startDate: new Date(), endDate: new Date(), status: "ACTIVE", organizationId: "b" });
    for (const [id, cycleId] of [["rv-a", "c-a"], ["rv-b", "c-b"]]) {
      db.seed("review", { id, cycleId, subjectId: "max", reviewerId: "olga", status: "COMPLETED", outcome: "EXCEEDS", overallScore: 4.5, calibratedScore: null, createdAt: new Date() });
    }
    for (const [id, organizationId] of [["ku-a", "a"], ["ku-b", "b"]]) db.seed("kudos", { id, message: `from ${organizationId}`, companyValue: null, giverId: "olga", receiverId: "max", organizationId, createdAt: new Date() });
    const res = await get("max");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Before: A's Finance and A's Controller.
    expect(body.department).toBeNull();
    expect(body.role).toBeNull();
    expect(body.office).toMatchObject({ id: "off-b", name: "B London" });
    expect(body.office).not.toHaveProperty("organizationId");
    // Before: both KPI records, both reviews (A's outcome and score) and both kudos.
    expect(body.kpiHistory.map((r: { id: string }) => r.id)).toEqual(["r-b"]);
    expect(body.kpiHistoryTotal).toBe(1);
    expect(body.reviews.map((r: { id: string }) => r.id)).toEqual(["rv-b"]);
    expect(body.reviewsTotal).toBe(1);
    expect(body.kudosReceived.map((k: { id: string }) => k.id)).toEqual(["ku-b"]);
    expect(body.kudosCount).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(/A Finance|A Controller|A revenue|A H1|from a/);
    // The scores are read for this workspace only.
    expect(st.scoreReads).toEqual([["latest", "max", "b"], ["history", "max", 6, "b"]]);
  });
});

// The final review (security M1 and M2, product H1 and M3): what a record
// names of the people around it, and of a membership person, is what THIS
// workspace holds.
describe("the record names what this workspace holds (the final review)", () => {
  function placements() {
    db.seed("department", { id: "dep-a", name: "A Platform", color: null, organizationId: "a" });
    db.seed("role", { id: "role-a", title: "A Senior Engineer", description: null, level: "EMPLOYEE", organizationId: "a" });
    db.seed("department", { id: "dep-b", name: "B Delivery", color: null, organizationId: "b" });
    db.seed("role", { id: "role-b", title: "B Contractor", description: "Works with B", level: "EMPLOYEE", organizationId: "b" });
    db.seed("office", { id: "off-b", name: "B Leeds", city: "Leeds", country: "UK", isHeadquarters: false, organizationId: "b" });
  }

  it("a report who works here through a membership shows the title and department this workspace holds, never the account's (security M1)", async () => {
    placements();
    person("mo", "b", "MANAGER", { phone: null, dateOfBirth: null });
    // Pat reports to Mo HERE, by her membership's line (workspace-status-2
    // E1); her account's line is A's, to Ann.
    person("ann", "a", "MANAGER");
    Object.assign(user("pat"), { managerId: "ann", departmentId: "dep-a", roleId: "role-a" });
    Object.assign(seatOf("pat", "b")!, { managerId: "mo", departmentId: "dep-b", roleId: "role-b" });
    const body = await (await get("mo")).json();
    // Before: { role: { title: "A Senior Engineer" }, department: { name: "A Platform" } }, A's, to every Member of B.
    expect(body.directReports).toEqual([{ id: "pat", firstName: "Pat", lastName: "Lee", avatar: null, role: { id: "role-b", title: "B Contractor" }, department: { id: "dep-b", name: "B Delivery" } }]);
    expect(JSON.stringify(body)).not.toMatch(/A Platform|A Senior Engineer/);
  });

  it("a skill's manager rating on the record is this workspace's own (security M2)", async () => {
    person("max", "b", "EMPLOYEE", { phone: null, dateOfBirth: null });
    db.seed("userSkill", { id: "s1", userId: "max", name: "Excel", selfRating: 3, managerRating: 1, managerRatings: { a: 1 } });
    let body = await (await get("max")).json();
    // Before: 1, A's.
    expect(body.skills).toEqual([{ id: "s1", name: "Excel", selfRating: 3, managerRating: null }]);
    db.row("userSkill", "s1").managerRatings = { a: 1, b: 4 };
    body = await (await get("max")).json();
    expect(body.skills[0].managerRating).toBe(4);
  });

  it("a manager rating on the old 10-point scale shows on the record as it did before the deploy, 7/10 (fixes review M1)", async () => {
    person("max", "b", "EMPLOYEE", { phone: null, dateOfBirth: null });
    // Rated 7 of 10 in B; the deploy keyed the old column's value by B as it was.
    db.seed("userSkill", { id: "s1", userId: "max", name: "Excel", selfRating: 3, managerRating: 7, managerRatings: { b: 7 } });
    const body = await (await get("max")).json();
    // Before: managerRating null, so the record said "Not rated".
    expect(body.skills).toEqual([{ id: "s1", name: "Excel", selfRating: 3, managerRating: 7 }]);
    expect(ratingLabel(body.skills[0].managerRating)).toBe("7/10");
  });

  it("a membership person's record shows the placement their membership here holds, their manager and reports here, the kudos given here and their join date here (product H1, M3)", async () => {
    placements();
    person("mo", "b", "MANAGER");
    person("ria", "b", "EMPLOYEE", { managerId: "pat" });
    person("abe", "a", "EMPLOYEE", { managerId: "pat" });
    // Her line here is her membership's (workspace-status-2 E1), to Mo; her
    // account's is A's, to Ann.
    person("ann", "a", "MANAGER");
    Object.assign(user("pat"), { managerId: "ann", departmentId: "dep-a", roleId: "role-a" });
    Object.assign(seatOf("pat", "b")!, { managerId: "mo", departmentId: "dep-b", roleId: "role-b", officeId: "off-b", joinDate: new Date("2026-07-01T00:00:00Z") });
    for (const [id, organizationId] of [["ku-a", "a"], ["ku-b", "b"]]) db.seed("kudos", { id, message: `from ${organizationId}`, companyValue: null, giverId: "olga", receiverId: "pat", organizationId, createdAt: new Date() });
    const body = await (await get("pat")).json();
    expect(body).toMatchObject({
      profileHere: false,
      // Before: null, null, null, "Nobody", no reports, no kudos, the row's creation.
      role: { id: "role-b", title: "B Contractor", description: "Works with B" },
      department: { id: "dep-b", name: "B Delivery" },
      office: { id: "off-b", name: "B Leeds", city: "Leeds" },
      manager: { id: "mo" },
      joinDate: "2026-07-01T00:00:00.000Z",
      kudosCount: 1,
    });
    expect(body.directReports.map((r: { id: string }) => r.id)).toEqual(["ria"]);
    expect(body.kudosReceived.map((k: { id: string }) => k.id)).toEqual(["ku-b"]);
    expect(body.access.peopleData).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/A Platform|A Senior Engineer|from a/);
    // A manager with no seat here is never named.
    seatOf("pat", "b")!.managerId = "abe";
    expect((await (await get("pat")).json()).manager).toBeNull();
  });
});

// The step 3 review M1: a status label and a profile write act on the seat
// read before the transaction, so a deactivation landing in between was
// undone by the label (the seat live again, no seat check), or, for someone
// it moved to another workspace (D3), the label and the profile were written
// onto that workspace's account. Now the person's row lock and a second read
// under it refuse a seat that changed, writing nothing.
describe("a label or a profile write never lands on a seat that changed meanwhile (M1)", () => {
  it("refuses a label when the membership was deactivated between the first read and the write", async () => {
    st.between = () => { seatOf("pat", "b")!.status = "INACTIVE"; };
    const res = await patch("pat", { status: "ON_LEAVE" });
    // Before: 200, and the seat ON_LEAVE, live again.
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "seat_changed", error: "Their status here changed a moment ago, so nothing was saved. Reload and try again." });
    expect(seatOf("pat", "b")?.status).toBe("INACTIVE");
  });

  it("refuses a label and a profile field when the person was moved to another workspace meanwhile (D3)", async () => {
    person("max", "b");
    seat("max", "c");
    st.between = () => {
      // Another admin's deactivation moved Max to C: B keeps the ended seat.
      user("max").organizationId = "c";
      db.seed("organizationMembership", { id: "m-max-b", userId: "max", organizationId: "b", role: "EMPLOYEE", status: "INACTIVE" });
    };
    // Weekly hours, not a name or a phone: Max also belongs to C, so those
    // are refused before anything as shared (the final review, security H1,
    // and the fixes review L8, tested above).
    const res = await patch("max", { status: "ON_LEAVE", weeklyCapacityHours: 20 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("seat_changed");
    // Before: C's account got B's label and B's weekly hours.
    expect(user("max")).toMatchObject({ status: "ACTIVE" });
    expect(user("max").weeklyCapacityHours ?? null).toBeNull();
  });

  it("refuses a profile write alone when the person was moved to another workspace meanwhile: B's department never lands on C's account", async () => {
    person("max", "b");
    seat("max", "c");
    db.seed("department", { id: "dep-b", name: "Design", organizationId: "b" });
    st.between = () => {
      user("max").organizationId = "c";
      db.seed("organizationMembership", { id: "m-max-b", userId: "max", organizationId: "b", role: "EMPLOYEE", status: "INACTIVE" });
    };
    const res = await patch("max", { departmentId: "dep-b" });
    // Before: 200, and B's department on the account now anchored in C.
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("seat_changed");
    expect(user("max").departmentId ?? null).toBeNull();
  });

  it("takes the person's row lock before it reads the seat again, and a guarded label refuses when it touches nothing", async () => {
    db.log.length = 0;
    expect((await patch("pat", { status: "PROBATION" })).status).toBe(200);
    const lock = db.log.indexOf("tx.lock:pat");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(db.log.lastIndexOf("tx.organizationMembership.updateMany"));
    expect(seatOf("pat", "b")?.status).toBe("PROBATION");
  });
});

// The step 3 review L1: endSeatWould and endSeat read the plan apart, so a
// workspace elsewhere suspended or reopened in between made the end differ
// from the plan the lines were moved for. Now endSeat refuses, the moved
// lines roll back, and the route says try again.
describe("an end whose plan changed under the lock is refused, and nothing stays (L1)", () => {
  it("a deactivation planned as a move to C, with C suspended meanwhile, answers try again and writes nothing", async () => {
    person("max", "b");
    seat("max", "c");
    // The plan reads a move to C (usable); C is suspended right after it,
    // before the end is written (as the staff console could).
    const ws = await import("@/lib/access/workspace-status");
    const real = ws.endSeatWould;
    const would = vi.spyOn(ws, "endSeatWould").mockImplementation(async (tx, input) => {
      const out = await real(tx, input);
      db.row("organization", "c").status = "SUSPENDED";
      return out;
    });
    const res = await patch("max", { status: "INACTIVE" });
    would.mockRestore();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "seat_plan_changed", error: "Their workspaces changed a moment ago, so nothing was done. Try again." });
    expect(user("max")).toMatchObject({ organizationId: "b", status: "ACTIVE", tokenVersion: 0 });
  });
});
