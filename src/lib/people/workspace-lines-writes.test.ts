// Every write of a manager line writes THIS workspace's line
// (docs/plans/workspace-status-2.md E1, E2, E4 to E6, E9 iii, step 4). Run on
// the in-memory database (seat-test-db.ts), through the real routes, the real
// handover and the real SCIM paths.
//
// The case. Pat is anchored at her agency A, where she reports to Max, and
// works for client B through a membership, where Dana leads her. Max
// contracts for B too (a Manager there, under Dana). Kai, anchored in A,
// reports to Dana in A (Dana holds a seat in A too) and to Dana in B. Lee is
// anchored in B under Dana, and works in A too, under Max. Rita is anchored
// in A, live there, and B deactivated her through her membership. Ada is
// anchored in A, a Manager there, and an Agent in B, where Zoe and Cy are
// still listed under her from before rule 6 (Cy is anchored in A, where he
// reports to Ada too). Ari owns A, Bo owns B.
//
// Before this step every one of these writes wrote the account's line
// (User.managerId, the anchored workspace's since the swap) or every
// workspace's dotted rows, or kept a line "another workspace relies on"
// (E6): B's handover of Dana left Pat under Dana in B and rewrote Kai's A
// line, B's restore of Pat never checked her B line, B's dotted-line save
// kept Rita, and A's Reports to edit asked "changes it there too".

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  me: "bo",
  level: "SUPER_ADMIN",
  org: "b",
  ctx: {} as Record<string, unknown>,
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession(st.me, st.level, st.org) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async (row: Record<string, unknown>) => { st.logs.push(row); }, logAuditEvent: async () => undefined }));
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async () => undefined }));
vi.mock("@/lib/access/role-change-after", () => ({ afterRoleChanges: async () => undefined }));
vi.mock("@/lib/access/flags", () => ({ accessV2Resolver: () => false }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: legacyTestSession(st.me, st.level, st.org) }),
  getOrgId: () => st.org,
  getUserId: () => st.me,
}));
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));
vi.mock("@/lib/access/workspace-admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/workspace-admin")>()),
  freshWorkspaceActor: async () => ({ ok: true, admin: true, owner: true }),
}));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));
// Open reviews following the lines is review-cycle's own (tested there).
vi.mock("@/lib/performance/review-cycle.server", async (orig) => ({ ...(await orig<typeof import("@/lib/performance/review-cycle.server")>()), followReportingLine: async () => undefined }));
vi.mock("@/lib/goals/goal-source.server", () => ({ handOverGoalSources: async () => ({ moved: 0, paused: 0 }) }));
vi.mock("@/services/performanceScoreService", () => ({ getLatestScore: async () => null, getScoreHistory: async () => [] }));
vi.mock("@/lib/alignment-assign", () => ({ seedAlignmentForUser: async () => undefined }));
vi.mock("@/lib/people/directory-list.server", () => ({ presenceFor: async () => new Map() }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { reanchorUser } from "@/lib/access/workspace-anchor";
import { DELETE as userDelete, PATCH as userPatch } from "@/app/api/users/[id]/route";
import { PUT as dottedPut } from "@/app/api/users/[id]/dotted-lines/route";
import { GET as handoverGet, POST as handoverPost } from "@/app/api/users/[id]/handover/route";
import { GET as agentReportsGet, POST as agentReportsPost } from "@/app/api/users/[id]/agent-reports/route";
import { POST as bulkUpdate } from "@/app/api/people/bulk-update/route";
import { scimReactivateSeat } from "@/lib/scim-reactivate";
import { scimDeprovision } from "@/lib/scim-deprovision";
import { effectiveManagerOf } from "@/lib/access/manager-lines";

type Row = Record<string, unknown> & { id: string };
const req = (url: string, init?: { method: string; body?: unknown }) =>
  new NextRequest(`https://app.test${url}`, init ? { method: init.method, ...(init.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}) } : undefined);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) => userPatch(req(`/api/users/${id}`, { method: "PATCH", body }), params(id));
const remove = (id: string) => userDelete(req(`/api/users/${id}`, { method: "DELETE" }), params(id));
const restore = (id: string) => userDelete(req(`/api/users/${id}?restore=true`, { method: "DELETE" }), params(id));
const putDotted = (id: string, managerIds: string[]) => dottedPut(req(`/api/users/${id}/dotted-lines`, { method: "PUT", body: { managerIds } }), params(id));
const handOver = (id: string, reassignToId: string) => handoverPost(req(`/api/users/${id}/handover`, { method: "POST", body: { reassignToId } }), params(id));
const summary = async (id: string) => (await (await handoverGet(req(`/api/users/${id}/handover`), params(id))).json()) as { directReports: { count: number; items: Array<{ id: string }> } };

const account = (id: string) => db.row("user", id);
const seatOf = (userId: string, organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId)!;
/** Each person's line as each workspace holds it: the account's where anchored, the membership's elsewhere. */
const lineIn = (userId: string, organizationId: string) => (account(userId).organizationId === organizationId ? account(userId).managerId : seatOf(userId, organizationId)?.managerId) ?? null;
const dottedIn = (userId: string, organizationId: string) =>
  (db.tables.userDottedLine ?? []).filter((d) => d.userId === userId && d.organizationId === organizationId).map((d) => d.managerId as string).sort();
const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });

let made = 0;
function person(id: string, organizationId: string, level: string, managerId: string | null, extra: Record<string, unknown> = {}) {
  made += 1;
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", organizationId, ...legacyLevelRow(level),
    managerId, phone: null, departmentId: null, roleId: null, officeId: null, joinDate: new Date(Date.UTC(2025, 0, made)), createdAt: new Date(Date.UTC(2025, 0, made)),
    weeklyCapacityHours: null, workSchedule: null, customFields: null, ...extra,
  });
}
function membership(userId: string, organizationId: string, role: string, managerId: string | null, extra: Record<string, unknown> = {}) {
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role, managerId, createdAt: new Date("2026-06-01"), ...extra });
}
const dotted = (userId: string, managerId: string, organizationId: string) =>
  db.seed("userDottedLine", { id: `d-${userId}-${managerId}-${organizationId}`, userId, managerId, organizationId });

/** The viewer: an Owner of `org` (person-access.server.ts PeopleCtx). */
function viewAs(me: string, org: string) {
  st.me = me;
  st.org = org;
  st.level = "SUPER_ADMIN";
  st.ctx = {
    userId: me, organizationId: org, ...legacyLevelRow("SUPER_ADMIN"), orgRole: "OWNER", isAgent: false, isAdmin: true, peopleTeam: false,
    orgWide: true, managerTier: true, chain: new Set<string>(), writeChain: new Set<string>(), viewer: { userId: me, organizationId: org },
  };
}

/** A seat here, in the state that counts: anchored here and not removed, or a membership here not removed. */
const keptHere = (u: Row, org: string, activeOnly: boolean) => {
  if (u.deletedAt) return null;
  if (u.organizationId === org) return activeOnly && u.status === "INACTIVE" ? null : { managerId: (u.managerId as string | null) ?? null };
  const m = seatOf(u.id, org);
  if (!m || m.removedAt || (activeOnly && (m.status === "INACTIVE" || u.status === "INACTIVE"))) return null;
  return { managerId: (m.managerId as string | null) ?? null };
};

beforeEach(() => {
  db.reset();
  made = 0;
  st.logs = [];
  // The two whole-workspace statements (acting-workspace.ts
  // workspacePeopleLines and workspaceDottedLines), answered from the
  // tables as their two indexed halves would; WORK's row locks find nothing.
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
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id.toUpperCase()}`, status: "ACTIVE", settings: {} });
  // A.
  person("ari", "a", "SUPER_ADMIN", null);
  person("max", "a", "MANAGER", "ari");
  person("pat", "a", "EMPLOYEE", "max");
  person("kai", "a", "EMPLOYEE", "dana");
  person("rita", "a", "MANAGER", "ari");
  person("ada", "a", "MANAGER", "ari");
  person("cy", "a", "EMPLOYEE", "ada");
  // B.
  person("bo", "b", "SUPER_ADMIN", null);
  person("dana", "b", "MANAGER", "bo");
  person("lee", "b", "EMPLOYEE", "dana");
  person("zoe", "b", "EMPLOYEE", "ada");
  // Seats through a membership, each with that workspace's own line (E1).
  membership("pat", "b", "EMPLOYEE", "dana");
  membership("max", "b", "MANAGER", "dana");
  membership("kai", "b", "EMPLOYEE", "dana");
  membership("dana", "a", "MANAGER", "ari");
  membership("lee", "a", "EMPLOYEE", "max");
  membership("rita", "b", "MANAGER", "bo", { status: "INACTIVE" });
  membership("ada", "b", "AGENT", "bo");
  membership("cy", "b", "EMPLOYEE", "ada");
  // Dotted lines, each its workspace's (E2).
  dotted("pat", "ada", "a");
  dotted("pat", "ada", "b");
  dotted("lee", "rita", "b");
  dotted("lee", "max", "b");
  dotted("lee", "max", "a");
  viewAs("bo", "b");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("B's handover of Dana moves B's reports only (the step 2 review's pairings 1 to 3)", () => {
  it("the summary, the gate and the run count every report in B, and nobody's line in A", async () => {
    // Before: the account lines naming Dana with a seat in B, Kai (his A
    // line) and Lee; never Pat or Max, whose B lines name her.
    const s = await summary("dana");
    expect(s.directReports.count).toBe(4);
    expect(s.directReports.items.map((r) => r.id).sort()).toEqual(["kai", "lee", "max", "pat"]);
    // The gate refuses her deactivation while any of them is hers in B.
    const early = await patch("dana", { status: "INACTIVE" });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ code: "handover_first", pending: { directReports: 4 } });
  });

  it("moves Pat, Max, Kai and Lee in B to Bo, and Pat's, Kai's and Dana's lines in A stay", async () => {
    const res = await handOver("dana", "bo");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reportsReassigned: 4 });
    for (const id of ["pat", "max", "kai", "lee"]) expect(lineIn(id, "b"), id).toBe("bo");
    // A's lines: before, Kai's (his account's, naming Dana) was rewritten by B.
    expect(lineIn("pat", "a")).toBe("max");
    expect(lineIn("kai", "a")).toBe("dana");
    expect(lineIn("lee", "a")).toBe("max");
    expect(lineIn("dana", "a")).toBe("ari");
    // B's record of the moves, one row each, in B's log only.
    const rows = (db.tables.activityLog ?? []).filter((r) => r.type === "reporting_line_changed");
    expect(rows.map((r) => r.targetId).sort()).toEqual(["kai", "lee", "max", "pat"]);
    expect(new Set(rows.map((r) => r.organizationId))).toEqual(new Set(["b"]));
    // Nothing is left for the deactivation, which now goes through.
    expect((await summary("dana")).directReports.count).toBe(0);
    expect((await patch("dana", { status: "INACTIVE" })).status).toBe(200);
    expect(lineIn("kai", "a")).toBe("dana");
  });

  it("a deadlock Postgres breaks in the move is the 503 roles_busy, never a 500, with nothing moved", async () => {
    db.onCall = async (entry) => { if (entry === "tx.lock:lee") throw deadlock(); };
    const res = await handOver("dana", "bo");
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("roles_busy");
    expect(lineIn("pat", "b")).toBe("dana");
    expect(lineIn("lee", "b")).toBe("dana");
  });
});

describe("an end of a seat in B never moves A's lines (E4, the case (c) worst case)", () => {
  it("Max's D4 end in B, A suspended: B's handover moves his B reports, and A keeps its team", async () => {
    // Max switched into B (the swap: his account holds B's line, A's waits on
    // his A membership), and A is suspended: B is his only usable seat.
    expect(await reanchorUser({ userId: "max", to: { organizationId: "b", role: "MANAGER" } })).toBe(true);
    db.row("organization", "a").status = "SUSPENDED";
    // Kai reports to Max in B too; in A he reports to Dana.
    seatOf("kai", "b").managerId = "max";
    expect((await handOver("max", "bo")).status).toBe(200);
    expect(lineIn("kai", "b")).toBe("bo");
    // A's lines naming Max stay: Pat and Lee in A.
    expect(lineIn("pat", "a")).toBe("max");
    expect(lineIn("lee", "a")).toBe("max");
    const gone = await remove("max");
    expect(gone.status).toBe(200);
    // The account ended (D4); still nothing of A's moved.
    expect(account("max")).toMatchObject({ status: "INACTIVE" });
    expect(lineIn("pat", "a")).toBe("max");
    expect(lineIn("lee", "a")).toBe("max");
    expect(lineIn("kai", "a")).toBe("dana");
  });
});

describe("SCIM's deprovision hands over this workspace's reports only (E9 iii)", () => {
  it("B's identity provider ends Dana in B: her B reports go to Bo, and Kai's A line to her stays", async () => {
    const out = await scimDeprovision("b", "dana");
    expect(out).toMatchObject({ ok: true });
    for (const id of ["pat", "max", "kai", "lee"]) expect(lineIn(id, "b"), id).toBe("bo");
    expect(lineIn("kai", "a")).toBe("dana");
    expect(lineIn("pat", "a")).toBe("max");
  });
});

describe("A's Reports to edit writes A's line, and B's stays (PATCH, pairing 8)", () => {
  it("replaces Pat's A line off an Agent in A who manages her in B, with no question", async () => {
    // Gus manages Pat in B and is an Agent in A, where her A line names him
    // from before rule 6. Before: 409 manager_elsewhere, "changes it there
    // too", untrue since E1.
    person("gus", "b", "MANAGER", "bo");
    membership("gus", "a", "AGENT", null);
    account("pat").managerId = "gus";
    seatOf("pat", "b").managerId = "gus";
    viewAs("ari", "a");
    const res = await patch("pat", { managerId: "max" });
    expect(res.status).toBe(200);
    expect(lineIn("pat", "a")).toBe("max");
    expect(lineIn("pat", "b")).toBe("gus");
    // And the other way round: B's edit of Lee's line in B leaves her A line.
    viewAs("bo", "b");
    expect((await patch("lee", { managerId: "bo" })).status).toBe(200);
    expect(lineIn("lee", "b")).toBe("bo");
    expect(lineIn("lee", "a")).toBe("max");
  });

  it("a deadlock Postgres breaks under the person's lock is the 503 roles_busy, never a 500, with nothing written", async () => {
    viewAs("ari", "a");
    db.onCall = async (entry) => { if (entry === "tx.lock:pat") throw deadlock(); };
    const res = await patch("pat", { managerId: "rita" });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("roles_busy");
    expect(lineIn("pat", "a")).toBe("max");
  });
});

describe("A's bulk change of managers writes A's lines, each under the person's lock (pairing 9)", () => {
  it("skips Pat when she switched into B between the read and the write, and B's line stays", async () => {
    viewAs("ari", "a");
    let fired = false;
    // Pat switches into B right after the bulk edit takes A's role lock.
    db.onCall = async (entry) => {
      if (!fired && entry === "tx.SET LOCAL lock_timeout TO DEFAULT") {
        fired = true;
        await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
      }
    };
    const res = await bulkUpdate(req("/api/people/bulk-update", { method: "POST", body: { userIds: ["pat", "kai"], action: "change_manager", payload: { managerId: "rita" } } }));
    expect(res.status).toBe(200);
    expect(fired).toBe(true);
    expect(await res.json()).toMatchObject({ updated: 1 });
    // Kai's A line moved; Pat's did not, in either workspace. Before: the
    // one updateMany wrote Pat's account, which by then held B's line.
    expect(lineIn("kai", "a")).toBe("rita");
    expect(account("pat").organizationId).toBe("b");
    expect(lineIn("pat", "b")).toBe("dana");
    expect(lineIn("pat", "a")).toBe("max");
  });
});

describe("a dotted-line save in B replaces B's rows only (pairing 10, the step 3 review item 3)", () => {
  it("takes Rita off Lee's B lines though she is live in A where Lee works, and Lee's A row stays", async () => {
    const res = await putDotted("lee", ["max"]);
    expect(res.status).toBe(200);
    // Before: { managerIds: ["max"], keptElsewhere: 1 }, Rita's B row kept.
    expect(await res.json()).toEqual({ managerIds: ["max"] });
    expect(dottedIn("lee", "b")).toEqual(["max"]);
    expect(dottedIn("lee", "a")).toEqual(["max"]);
  });

  it("never makes a new line in B to Rita, whom B deactivated (E4)", async () => {
    await putDotted("lee", ["max"]);
    const res = await putDotted("lee", ["max", "rita"]);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("manager_inactive");
    expect(dottedIn("lee", "b")).toEqual(["max"]);
  });
});

describe("the Agent move in B moves B's lines only (pairing 6, the step 3 review item 5)", () => {
  it("counts and moves Zoe and Cy in B and Pat's B dotted row, and leaves Cy's and Pat's lines in A", async () => {
    const plan = await (await agentReportsGet(req("/api/users/ada/agent-reports"), params("ada"))).json();
    // Before: solid 1 and dotted 0, Cy and Pat named as "staying".
    expect(plan).toEqual({ agent: true, solid: 2, dotted: 1, rehomed: [{ to: "Bo Ng", toId: "bo", count: 2 }] });
    const res = await agentReportsPost(req("/api/users/ada/agent-reports", { method: "POST", body: { expect: plan } }), params("ada"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ moved: 2, dottedRemoved: 1, rehomed: [{ to: "Bo Ng", toId: "bo", count: 2 }] });
    expect(lineIn("zoe", "b")).toBe("bo");
    expect(lineIn("cy", "b")).toBe("bo");
    expect(lineIn("cy", "a")).toBe("ada");
    expect(dottedIn("pat", "b")).toEqual([]);
    expect(dottedIn("pat", "a")).toEqual(["ada"]);
  });
});

describe("a restore or a reactivation in B checks B's lines and never clears A's (pairing 7, the step 3 review item 6)", () => {
  beforeEach(() => {
    // While Pat was away, B put Rita over her in B (deactivated since).
    seatOf("pat", "b").managerId = "rita";
  });

  it("B's restore of Pat clears her B line to Rita and her B dotted row to Ada, and A's line and row stay", async () => {
    expect((await remove("pat")).status).toBe(200);
    const back = await restore("pat");
    expect(back.status).toBe(200);
    expect((await back.json()).linesCleared).toEqual([{ managerId: "rita", kind: "manager", reason: "inactive" }, { managerId: "ada", kind: "dotted", reason: "agent" }]);
    // Before: her account's line (A's, Max) was the one checked, Rita's never.
    expect(lineIn("pat", "b")).toBeNull();
    expect(lineIn("pat", "a")).toBe("max");
    expect(dottedIn("pat", "b")).toEqual([]);
    expect(dottedIn("pat", "a")).toEqual(["ada"]);
  });

  it("B's reactivation of Pat does the same", async () => {
    expect((await patch("pat", { status: "INACTIVE" })).status).toBe(200);
    const back = await patch("pat", { status: "ACTIVE" });
    expect(back.status).toBe(200);
    expect((await back.json()).linesCleared).toEqual([{ managerId: "rita", kind: "manager", reason: "inactive" }, { managerId: "ada", kind: "dotted", reason: "agent" }]);
    expect(lineIn("pat", "b")).toBeNull();
    expect(lineIn("pat", "a")).toBe("max");
    expect(dottedIn("pat", "a")).toEqual(["ada"]);
  });

  it("B's identity provider reactivating Pat does the same", async () => {
    seatOf("pat", "b").status = "INACTIVE";
    const out = await scimReactivateSeat("b", "pat");
    expect(out).toMatchObject({ ok: true, restored: true });
    expect(lineIn("pat", "b")).toBeNull();
    expect(lineIn("pat", "a")).toBe("max");
    expect(dottedIn("pat", "a")).toEqual(["ada"]);
  });

  it("A's restore of Pat checks A's lines only: A's stale dotted row goes, B's row of the same pair and B's line stay", async () => {
    // Ola is an Agent in A (a membership there) and a Manager in B, and Pat
    // has a dotted line to her in both. Before: the restore read every
    // workspace's rows, judged Ola "relied on" by B, and kept A's stale row
    // (or, had it cleared, deleted B's row too).
    person("ola", "b", "MANAGER", "bo");
    membership("ola", "a", "AGENT", null);
    dotted("pat", "ola", "a");
    dotted("pat", "ola", "b");
    viewAs("ari", "a");
    expect((await remove("pat")).status).toBe(200);
    const back = await restore("pat");
    expect(back.status).toBe(200);
    expect((await back.json()).linesCleared).toEqual([{ managerId: "ola", kind: "dotted", reason: "agent" }]);
    expect(dottedIn("pat", "a")).toEqual(["ada"]);
    expect(dottedIn("pat", "b")).toEqual(["ada", "ola"]);
    // Max is fine in A; Pat's B line to Rita is B's to check.
    expect(lineIn("pat", "a")).toBe("max");
    expect(lineIn("pat", "b")).toBe("rita");
  });
});

// The final review (integrity M1): a restore at the anchor brings back seats
// in other workspaces with the account, and those workspaces' lines are
// checked there, as a restore checks its own, in the same transaction.
describe("a restore at the anchor checks the lines of the seats it brings back elsewhere (the final review, integrity M1)", () => {
  /** The rows B's Audit log holds for Pat's lines, written in the transaction (the table, never the after-commit logger). */
  const bRows = () => (db.tables.activityLog ?? []).filter((r) => r.type === "reporting_line_changed" && r.organizationId === "b" && r.targetId === "pat");

  it("Pat, removed in A before each workspace had a status, is restored in A: her B seat comes back without Dana, whom B removed meanwhile", async () => {
    // The one-time step of phase 1 ended her B seat with the account (D16), so Dana's handover never saw her.
    Object.assign(account("pat"), { status: "INACTIVE", deletedAt: new Date("2026-10-01") });
    Object.assign(seatOf("pat", "b"), { status: "INACTIVE", removedAt: new Date("2026-10-01"), endedWithAccount: true });
    Object.assign(account("dana"), { status: "INACTIVE", deletedAt: new Date("2026-10-15") });
    viewAs("ari", "a");
    const res = await restore("pat");
    expect(res.status).toBe(200);
    // A's answer says nothing of B's lines (they name B's people).
    expect((await res.json()).linesCleared).toEqual([]);
    expect(seatOf("pat", "b")).toMatchObject({ status: "ACTIVE", removedAt: null, endedWithAccount: false });
    // Before: Dana came back as Pat's B line and her B dotted line to Ada (an Agent in B) with it, unchecked.
    expect(lineIn("pat", "b")).toBeNull();
    expect(dottedIn("pat", "b")).toEqual([]);
    expect(await effectiveManagerOf("b", "pat")).toBeNull();
    // A's own lines stand.
    expect(lineIn("pat", "a")).toBe("max");
    expect(dottedIn("pat", "a")).toEqual(["ada"]);
    // Each clear has its row in B, actor the system (nobody in B acted), in the restore's transaction.
    expect(bRows()).toEqual([
      expect.objectContaining({ actorId: null, actorType: "system", description: "Restored Pat Ng with no manager: Dana Ng is no longer in the workspace", oldValue: { managerId: "dana" }, newValue: { managerId: null }, metadata: { onRestore: true, reason: "removed", withAccount: true } }),
      expect.objectContaining({ actorId: null, actorType: "system", oldValue: { dottedManagerId: "ada" }, newValue: { dottedManagerId: null }, metadata: { onRestore: true, reason: "agent", withAccount: true } }),
    ]);
    expect(st.logs.filter((r) => r.organizationId === "b")).toEqual([]);
  });

  it("a kept B seat of an account a D4 end removed in A comes back with the account, and B's lines are checked: B removed Dana meanwhile, and her handover skipped Pat", async () => {
    // B is suspended, so A's removal of Pat ends the account (D4) and leaves her B seat as it was.
    db.row("organization", "b").status = "SUSPENDED";
    viewAs("ari", "a");
    expect((await remove("pat")).status).toBe(200);
    expect(account("pat")).toMatchObject({ organizationId: "a", status: "INACTIVE" });
    expect(account("pat").deletedAt).not.toBeNull();
    expect(seatOf("pat", "b")).toMatchObject({ status: "ACTIVE", removedAt: null });
    // B comes back and removes Dana: her handover moves B's reports, never Pat, whose account is removed.
    db.row("organization", "b").status = "ACTIVE";
    viewAs("bo", "b");
    expect((await handOver("dana", "bo")).status).toBe(200);
    expect(lineIn("pat", "b")).toBe("dana");
    expect((await remove("dana")).status).toBe(200);
    // A restores Pat: her B seat works again, and its line to Dana is cleared in B.
    viewAs("ari", "a");
    expect((await restore("pat")).status).toBe(200);
    // Before: Pat came back in B reporting to Dana, removed there, and her B review and timesheets went to her.
    expect(lineIn("pat", "b")).toBeNull();
    expect(await effectiveManagerOf("b", "pat")).toBeNull();
    expect(bRows().map((r) => [r.oldValue, (r.metadata as Record<string, unknown>).reason])).toEqual([[{ managerId: "dana" }, "removed"], [{ dottedManagerId: "ada" }, "agent"]]);
  });

  it("A's reactivation of Pat (PATCH) checks the B seat that comes back with her account", async () => {
    Object.assign(account("pat"), { status: "INACTIVE" });
    Object.assign(seatOf("pat", "b"), { status: "INACTIVE", endedWithAccount: true });
    // Her B line names Ari, who holds no seat in B: a line no workspace reads.
    seatOf("pat", "b").managerId = "ari";
    viewAs("ari", "a");
    expect((await patch("pat", { status: "ACTIVE" })).status).toBe(200);
    expect(seatOf("pat", "b")).toMatchObject({ status: "ACTIVE" });
    expect(lineIn("pat", "b")).toBeNull();
    expect(bRows()[0]).toMatchObject({ actorType: "system", description: "Reactivated Pat Ng with no manager: the manager on their record doesn't work in this workspace", metadata: { onReactivate: true, reason: "elsewhere", withAccount: true } });
  });

  it("A's identity provider reactivating Pat does the same, in its transaction", async () => {
    Object.assign(account("pat"), { status: "INACTIVE" });
    Object.assign(seatOf("pat", "b"), { status: "INACTIVE", endedWithAccount: true });
    seatOf("pat", "b").managerId = "ari";
    const out = await scimReactivateSeat("a", "pat");
    expect(out).toMatchObject({ ok: true, restored: true });
    expect(lineIn("pat", "b")).toBeNull();
    expect(dottedIn("pat", "b")).toEqual([]);
    expect(bRows().map((r) => (r.metadata as Record<string, unknown>).reason)).toEqual(["elsewhere", "agent"]);
  });

  it("a restore in B of Pat's B seat alone brings nothing back elsewhere, and never writes in A", async () => {
    seatOf("pat", "b").managerId = "rita";
    expect((await remove("pat")).status).toBe(200);
    expect((await restore("pat")).status).toBe(200);
    expect((db.tables.activityLog ?? []).filter((r) => r.organizationId === "a")).toEqual([]);
    expect(lineIn("pat", "a")).toBe("max");
  });
});

// The final review (integrity M2): a manager whose account has ended
// (removed or deactivated where it is anchored) is nobody's manager here.
describe("a manager whose account has ended is answered as none (the final review, integrity M2)", () => {
  it("Max's D4 end in B while A was suspended: A keeps Pat's and Lee's lines to him (E4), and no read of A takes him as their manager", async () => {
    expect(await effectiveManagerOf("a", "pat")).toBe("max");
    expect(await reanchorUser({ userId: "max", to: { organizationId: "b", role: "MANAGER" } })).toBe(true);
    db.row("organization", "a").status = "SUSPENDED";
    seatOf("kai", "b").managerId = "max";
    expect((await handOver("max", "bo")).status).toBe(200);
    expect((await remove("max")).status).toBe(200);
    expect(account("max")).toMatchObject({ status: "INACTIVE" });
    // The lines stay, for a restore to bring back under its check.
    expect(lineIn("pat", "a")).toBe("max");
    expect(lineIn("lee", "a")).toBe("max");
    // Before: "max" for both, so Pat's A review went to a removed reviewer and her timesheets waited for him.
    expect(await effectiveManagerOf("a", "pat")).toBeNull();
    expect(await effectiveManagerOf("a", "lee")).toBeNull();
    // A line to a live manager stands.
    expect(await effectiveManagerOf("a", "kai")).toBe("dana");
    // B restores Max: his A seat works again, and he is their manager in A again.
    db.row("organization", "a").status = "ACTIVE";
    expect((await restore("max")).status).toBe(200);
    expect(await effectiveManagerOf("a", "pat")).toBe("max");
  });

  it("a manager deactivated where their account is anchored is nobody's manager in the workspace they work in through a membership", async () => {
    // Dana, anchored in B, manages Kai in A through her A membership; B deactivates her account.
    expect(await effectiveManagerOf("a", "kai")).toBe("dana");
    account("dana").status = "INACTIVE";
    expect(await effectiveManagerOf("a", "kai")).toBeNull();
  });
});

// The final review (integrity L2): the restore's and the reactivation's
// clears are logged in their transaction, and the dotted-line save logs the
// lines it took off, as they stood.
describe("a clear's and a dotted-line save's Audit rows are written in the transaction (the final review, integrity L2)", () => {
  beforeEach(() => {
    seatOf("pat", "b").managerId = "rita";
  });
  const bRows = () => (db.tables.activityLog ?? []).filter((r) => r.type === "reporting_line_changed" && r.organizationId === "b" && r.targetId === "pat");

  it("B's restore of Pat writes its clears' rows in the restore's transaction", async () => {
    expect((await remove("pat")).status).toBe(200);
    expect((await restore("pat")).status).toBe(200);
    // Before: written after the commit (the logger), so a failed write left a cleared line with no record.
    expect(bRows().map((r) => [r.actorId, r.description, r.oldValue])).toEqual([
      ["bo", "Restored Pat Ng with no manager: Rita Ng is deactivated", { managerId: "rita" }],
      ["bo", "Restored Pat Ng without their dotted line to Ada Ng: Ada Ng is on the Agent tier, and an Agent can't be anyone's manager", { dottedManagerId: "ada" }],
    ]);
    expect(st.logs.filter((r) => r.type === "reporting_line_changed")).toEqual([]);
  });

  it("a reactivation whose transaction fails after the clears leaves neither the clears nor their rows", async () => {
    expect((await patch("pat", { status: "INACTIVE" })).status).toBe(200);
    // A read or a write runs onCall synchronously (seat-test-db.ts): the throw lands as the row's write starts.
    db.onCall = (entry) => { if (entry === "tx.activityLog.create") throw deadlock(); };
    const res = await patch("pat", { status: "ACTIVE" });
    // Postgres ended it: the 503 "try again", with nothing written.
    expect(res.status).toBe(503);
    expect(seatOf("pat", "b")).toMatchObject({ status: "INACTIVE", managerId: "rita" });
    expect(dottedIn("pat", "b")).toEqual(["ada"]);
    expect(bRows()).toEqual([]);
    db.onCall = null;
    expect((await patch("pat", { status: "ACTIVE" })).status).toBe(200);
    expect(bRows().map((r) => (r.metadata as Record<string, unknown>).reason)).toEqual(["inactive", "agent"]);
  });

  it("a dotted-line save in B logs the lines it took off, with their notes, weights and dates, in its transaction", async () => {
    Object.assign(db.row("userDottedLine", "d-lee-rita-b"), { role: "launch lead", weight: 0.5, startDate: new Date("2026-09-01T00:00:00Z"), endDate: null, createdAt: new Date("2026-08-01T00:00:00Z") });
    expect((await putDotted("lee", ["max"])).status).toBe(200);
    const rows = (db.tables.activityLog ?? []).filter((r) => r.type === "reporting_line_changed" && r.targetId === "lee");
    // Before: { dottedManagerIds: ["max"] } only, after the commit, so what Rita's line was went unrecorded.
    expect(rows).toEqual([
      expect.objectContaining({
        organizationId: "b",
        actorId: "bo",
        metadata: { dottedManagerIds: ["max"], added: [], removed: [{ managerId: "rita", note: "launch lead", weight: 0.5, startDate: "2026-09-01T00:00:00.000Z", endDate: null, createdAt: "2026-08-01T00:00:00.000Z" }] },
      }),
    ]);
    expect(st.logs.filter((r) => r.targetId === "lee")).toEqual([]);
  });
});
