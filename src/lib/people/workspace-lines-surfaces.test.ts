// Every surface that shows a manager line shows THIS workspace's
// (docs/plans/workspace-status-2.md E1, E2, E6, step 3). Run on the in-memory
// database (seat-test-db.ts), through the real routes and helpers.
//
// The case. Pat is anchored at her agency A, where she reports to Max, and
// works for client B through a membership, where Dana leads her. She has a
// dotted line to Kai in A and to Lee in B. Max contracts for B too (a
// Manager there, under Dana), where Bea reports to him; in A, Max reports to
// Ada and Kai reports to Max. Kai works in B through a membership, with no
// line there. Abe reports to Pat in A, Zoe in B; Lee reports to Dana in B.
// Ada owns A, Bo owns B.
//
// Before this step every one of these surfaces read the account's line
// (User.managerId, A's), the cross-workspace `directReports` relation and
// every workspace's dotted rows. So in B Pat's record, Members, the
// Directory, the chart, the export, /api/users, My team and "Who can see
// this record" named Max as her manager (he holds a seat in B), B's
// Reports to filters found her under Max and never under Dana, Dana's report
// counts left out the people here through a membership, and Pat's B review
// suggested Max's report Bea as a peer, never Dana.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";
import { WORK_SCHEDULE_DEFAULTS } from "@/lib/work-schedule";

const st = vi.hoisted(() => ({
  me: "bo",
  level: "COMPANY_ADMIN",
  org: "b",
  ctx: {} as Record<string, unknown>,
  /** The viewer's report tree, as getTeamUserIds walks it (report-tree-seat.test.ts holds the walk). */
  team: [] as string[],
  /** My team's scope (teamScopeFor). */
  scope: { orgWide: true, ids: [] as string[], direct: new Set<string>(), hasIndirect: false },
  /** The system prompt the Owner snapshot sent the model. */
  aiSystem: "",
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession(st.me, st.level, st.org) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined, logAuditEvent: async () => undefined }));
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async () => undefined }));
vi.mock("@/lib/access/role-change-after", () => ({ afterRoleChanges: async () => undefined }));
vi.mock("@/lib/access/flags", () => ({ accessV2Resolver: () => false }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => st.team }));
vi.mock("@/lib/user-tags", () => ({ getUserTagsMap: async () => new Map(), resolveUserIdsByTags: async () => [] }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: legacyTestSession(st.me, st.level, st.org) }),
  getOrgId: () => st.org,
  getUserId: () => st.me,
  hasPermission: async () => false,
}));
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));
vi.mock("@/lib/people/team-scope.server", () => ({ teamScopeFor: async () => st.scope }));
vi.mock("@/lib/people/team-boards.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/people/team-boards.server")>()),
  readableBoardsFor: async () => ({ ids: [], byId: new Map(), isDone: () => false }),
}));
vi.mock("@/services/performanceScoreService", () => ({ getLatestScore: async () => null, getScoreHistory: async () => [], triggerRecalculation: () => undefined }));
vi.mock("@/lib/work-schedule-server", () => ({ readOrgWorkSchedule: async () => WORK_SCHEDULE_DEFAULTS }));
// The peer suggestions' door (cycleViewerCtx) and reviewer (reviewWritersIn) are tested in review-cycle's own suites.
vi.mock("@/lib/performance/review-cycle.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/performance/review-cycle.server")>()),
  cycleViewerCtx: async () => ({ userId: st.me, organizationId: st.org, peopleTeamOrAdmin: true, isAgent: false, isGuest: false, chain: new Set<string>() }),
  reviewWritersIn: async () => new Map(),
}));
// The Owner snapshot (POST /api/ai): its gates, and the model, which hands back the prompt it was sent.
vi.mock("@/lib/ai/ai-off-gate", () => ({ aiOffResponse: async () => null }));
vi.mock("@/lib/app-gate", async (orig) => ({ ...(await orig<typeof import("@/lib/app-gate")>()), requireApp: async () => ({ viewer: {} }), isOwnerOrAdmin: () => true }));
vi.mock("@/lib/ai-allowance", () => ({ claimAiAction: async () => ({ ok: true, id: "q1" }), recordAiAnswer: async () => undefined, releaseAiQuestion: async () => undefined }));
vi.mock("@/lib/ai-client", () => ({
  getAnthropicForOrg: async () => ({
    source: "org",
    client: { messages: { create: async (a: { system: string }) => { st.aiSystem = a.system; return { content: [{ type: "text", text: "ok" }] }; } } },
  }),
  modelFor: () => "model",
}));
vi.mock("@/lib/access/node-access", async (orig) => ({ ...(await orig<typeof import("@/lib/access/node-access")>()), nodeCtxFromSession: async () => null }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { reanchorUser } from "@/lib/access/workspace-anchor";
import { listMembers } from "@/lib/access/members-list.server";
import { directoryList } from "./directory-list.server";
import { GET as record } from "@/app/api/users/[id]/route";
import { GET as dottedLines } from "@/app/api/users/[id]/dotted-lines/route";
import { GET as recordAccess } from "@/app/api/users/[id]/record-access/route";
import { GET as myTeam } from "@/app/api/my-team/route";
import { GET as exportDirectory } from "@/app/api/users/export/route";
import { GET as usersList } from "@/app/api/users/route";
import { GET as peers } from "@/app/api/reviews/[id]/peers/route";
import { POST as askAi } from "@/app/api/ai/route";
import { GET as membersWork } from "@/app/api/team/members-work/route";

type Row = Record<string, unknown> & { id: string };
const req = (url: string, init?: RequestInit) => new NextRequest(`https://app.test${url}`, init as ConstructorParameters<typeof NextRequest>[1]);
const ids = (rows: unknown) => (rows as Array<{ id: string }>).map((r) => r.id);
const idOf = (x: unknown) => (x as { id: string } | null)?.id ?? null;
const seatOf = (userId: string, organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId)!;

let made = 0;
function person(id: string, organizationId: string, level: string, managerId: string | null) {
  made += 1;
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", organizationId, ...legacyLevelRow(level),
    status: "ACTIVE", deletedAt: null, managerId, phone: null, avatar: null, departmentId: null, roleId: null, officeId: null,
    joinDate: new Date(Date.UTC(2025, 0, made)), createdAt: new Date(Date.UTC(2025, 0, made)), weeklyCapacityHours: null, workSchedule: null, customFields: null, presenceStatus: null,
  });
}
function membership(userId: string, organizationId: string, role: string, managerId: string | null) {
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role, managerId, createdAt: new Date("2026-06-01") });
}
const dotted = (userId: string, managerId: string, organizationId: string) =>
  db.seed("userDottedLine", { id: `d-${userId}-${managerId}-${organizationId}`, userId, managerId, organizationId });

/** The viewer: someone of `org`, an Admin unless said otherwise (person-access.server.ts PeopleCtx). */
function viewAs(me: string, org: string, extra: Record<string, unknown> = {}) {
  const admin = extra.isAdmin !== false;
  st.me = me;
  st.org = org;
  st.level = admin ? "COMPANY_ADMIN" : "EMPLOYEE";
  st.ctx = {
    userId: me, organizationId: org, ...legacyLevelRow(st.level), orgRole: admin ? "ADMIN" : "MEMBER", isAgent: false, isAdmin: admin, peopleTeam: false,
    orgWide: admin, managerTier: admin, chain: new Set<string>(), writeChain: new Set<string>(), viewer: { userId: me, organizationId: org }, ...extra,
  };
}

const getRecord = async (id: string) => {
  const res = await record(req(`/api/users/${id}`), { params: Promise.resolve({ id }) });
  expect(res.status, id).toBe(200);
  return (await res.json()) as Record<string, unknown>;
};
const lines = async (id: string) => {
  const r = await getRecord(id);
  return { manager: idOf(r.manager), dotted: ids(r.dottedManagers), reports: ids(r.directReports) };
};
const directory = async (qs = "") => (await (await directoryList(req(`/api/users?scope=directory${qs}`))).json()) as { data: Row[] };
const chart = async () => ((await (await directoryList(req("/api/users?fields=chart"))).json()) as { data: Row[] }).data;
const rowOf = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;

/** Pat switches into B (reanchorUser's swap, E3), and her stale B row is given Lee, which no reader may take. */
async function patSwitchesToB() {
  expect(await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
  expect(db.row("user", "pat")).toMatchObject({ organizationId: "b", managerId: "dana" });
  expect(seatOf("pat", "a")).toMatchObject({ managerId: "max" });
  seatOf("pat", "b").managerId = "lee";
}

beforeEach(() => {
  db.reset();
  made = 0;
  db.onQueryRaw = () => [];
  st.aiSystem = "";
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
  // A.
  person("ada", "a", "COMPANY_ADMIN", null);
  person("max", "a", "MANAGER", "ada");
  person("kai", "a", "MANAGER", "max");
  person("pat", "a", "EMPLOYEE", "max");
  person("abe", "a", "EMPLOYEE", "pat");
  // B.
  person("bo", "b", "COMPANY_ADMIN", null);
  person("dana", "b", "MANAGER", null);
  person("lee", "b", "MANAGER", "dana");
  person("zoe", "b", "EMPLOYEE", "pat");
  person("bea", "b", "EMPLOYEE", "max");
  // Their seats in B through a membership, each with B's own line (E1).
  membership("pat", "b", "EMPLOYEE", "dana");
  membership("max", "b", "MANAGER", "dana");
  membership("kai", "b", "MANAGER", null);
  // Pat's dotted lines, each its workspace's (E2).
  dotted("pat", "kai", "a");
  dotted("pat", "lee", "b");
  viewAs("bo", "b");
});

describe("the person record (GET /api/users/[id])", () => {
  it("names Dana, Lee and Zoe on Pat's record in B, and Max, Kai and Abe in A", async () => {
    // Before, in B: Max (her account's line, and he holds a seat in B), no dotted line.
    expect(await lines("pat")).toEqual({ manager: "dana", dotted: ["lee"], reports: ["zoe"] });
    viewAs("ada", "a");
    expect(await lines("pat")).toEqual({ manager: "max", dotted: ["kai"], reports: ["abe"] });
  });

  it("lists each manager's reports here: Dana's in B are Lee, Max and Pat; Max's are Bea in B and Kai and Pat in A", async () => {
    // Before: Dana's reports were Lee only (the one account line naming
    // her); Max's in B were Bea, Kai and Pat (every account line naming him,
    // each person holding a seat in B).
    expect(await lines("dana")).toEqual({ manager: null, dotted: [], reports: ["lee", "max", "pat"] });
    expect(await lines("max")).toEqual({ manager: "dana", dotted: [], reports: ["bea"] });
    // Bea and Zoe, anchored in B, work in A too: Bea under Ada there, Zoe
    // with no line there. Their account lines are B's (Max, Pat).
    membership("bea", "a", "EMPLOYEE", "ada");
    membership("zoe", "a", "EMPLOYEE", null);
    viewAs("ada", "a");
    // Before: Bea, Kai and Pat (Bea's account line, B's, names Max, and she holds a seat in A).
    expect(await lines("max")).toEqual({ manager: "ada", dotted: [], reports: ["kai", "pat"] });
    // Before: Abe and Zoe (Zoe's account line, B's, names Pat, and she holds a seat in A).
    expect((await lines("pat")).reports).toEqual(["abe"]);
  });

  it("says nothing about another workspace's line (E6)", async () => {
    const body = await getRecord("pat");
    expect(body).not.toHaveProperty("managerElsewhere");
    expect(body).not.toHaveProperty("dottedElsewhere");
    expect(JSON.stringify(body)).not.toMatch(/Max|Kai|Abe/);
  });

  it("holds both workspaces' lines after Pat switches into B, never the stale row", async () => {
    await patSwitchesToB();
    // B: her account now; A: her membership. Before, A named nobody (the account's B line).
    expect(await lines("pat")).toEqual({ manager: "dana", dotted: ["lee"], reports: ["zoe"] });
    viewAs("ada", "a");
    expect(await lines("pat")).toEqual({ manager: "max", dotted: ["kai"], reports: ["abe"] });
    expect((await lines("max")).reports).toEqual(["kai", "pat"]);
  });

  it("a viewer who may not read people data reads the same card and no more; a Guest no reports", async () => {
    viewAs("zed", "b", { isAdmin: false });
    const body = await getRecord("pat");
    expect(body).toMatchObject({ minimal: true, access: { peopleData: false } });
    expect(body).not.toHaveProperty("phone");
    expect({ manager: idOf(body.manager), dotted: ids(body.dottedManagers), reports: ids(body.directReports) }).toEqual({ manager: "dana", dotted: ["lee"], reports: ["zoe"] });
    expect((await lines("dana")).reports).toEqual(["lee", "max", "pat"]);
    viewAs("gus", "b", { isAdmin: false, orgRole: "GUEST" });
    expect(await lines("pat")).toEqual({ manager: "dana", dotted: ["lee"], reports: [] });
    expect(await lines("dana")).toEqual({ manager: null, dotted: [], reports: [] });
  });
});

// The step 3 review L5: every surface names and counts at KEPT seats here
// (levelsHeldIn and managersWithSeatHere with kept seats, reportsHereOf's
// "kept"), as phase 1 does: a manager deactivated here, or on leave, is
// still named and still counted as a report; a removed one is neither. A
// reader switched to live seats fails the first test, one switched to
// active seats fails it on Dana's leave, and one that kept a removed seat
// fails the second.
describe("the kept-seat rule on every surface that names a manager or counts reports", () => {
  /** Bea's manager, Pat's manager and Dana's report count in B, on the record, Members, the Directory, the export and /api/users. */
  async function onEverySurface() {
    const members = (await listMembers("b", { orgWide: true, ids: [] }, {})).rows;
    const dir = (await directory()).data;
    const csv = await (await exportDirectory(req("/api/users/export"))).text();
    const list = ((await (await usersList(req("/api/users?scope=all"))).json()) as { data: Row[] }).data;
    // The export's "Reports to email" (the tenth column) of the row with this address.
    const exported = (email: string) => {
      const cells = csv.split("\n").find((l) => l.split(",")[2]?.replace(/"/g, "") === email)!.split(",").map((c) => c.replace(/"/g, ""));
      return cells[9] ? cells[9].split("@")[0] : null;
    };
    const managerOf = async (id: string) => [
      (await lines(id)).manager,
      idOf(members.find((r) => r.id === id)?.manager ?? null),
      rowOf(dir, id).managerId ?? null,
      exported(`${id}@x.test`),
      rowOf(list, id).managerId ?? null,
    ];
    return {
      bea: await managerOf("bea"),
      pat: await managerOf("pat"),
      danaReports: [(await lines("dana")).reports, rowOf(dir, "dana").directReports, (rowOf(list, "dana")._count as { directReports: number }).directReports],
    };
  }

  it("names a manager deactivated here, and one on leave, and counts a deactivated report", async () => {
    // B deactivates Max through his membership; Dana goes on leave.
    seatOf("max", "b").status = "INACTIVE";
    db.row("user", "dana").status = "ON_LEAVE";
    expect(await onEverySurface()).toEqual({
      bea: ["max", "max", "max", "max", "max"],
      pat: ["dana", "dana", "dana", "dana", "dana"],
      danaReports: [["lee", "max", "pat"], 3, 3],
    });
  });

  it("never names or counts a manager this workspace removed", async () => {
    seatOf("max", "b").removedAt = new Date("2026-10-01");
    expect(await onEverySurface()).toEqual({
      bea: [null, null, null, null, null],
      pat: ["dana", "dana", "dana", "dana", "dana"],
      danaReports: [["lee", "pat"], 2, 2],
    });
  });
});

describe("the dotted lines (GET /api/users/[id]/dotted-lines)", () => {
  const list = async (id: string) => {
    const res = await dottedLines(req(`/api/users/${id}/dotted-lines`), { params: Promise.resolve({ id }) });
    return { status: res.status, body: (await res.json()) as { managers?: Array<{ id: string }>; keptElsewhere?: number } };
  };

  it("answers this workspace's rows, for someone here through a membership too, and counts none of another's", async () => {
    // Before: a 404 in B (Pat is anchored in A).
    const b = await list("pat");
    expect(b.status).toBe(200);
    expect(ids(b.body.managers)).toEqual(["lee"]);
    expect(b.body).not.toHaveProperty("keptElsewhere");
    viewAs("ada", "a");
    expect(ids((await list("pat")).body.managers)).toEqual(["kai"]);
  });

  it("after Pat switches into B, B never lists A's line to Kai, who has a seat in B", async () => {
    await patSwitchesToB();
    // Before: B listed Kai (A's row) beside Lee, and A answered 404.
    expect(ids((await list("pat")).body.managers)).toEqual(["lee"]);
    viewAs("ada", "a");
    expect(ids((await list("pat")).body.managers)).toEqual(["kai"]);
    viewAs("gus", "b", { isAdmin: false, orgRole: "GUEST" });
    expect((await list("pat")).status).toBe(404);
  });
});

describe("Who can see this record (GET /api/users/[id]/record-access)", () => {
  const groups = async (id: string) => {
    const res = await recordAccess(req(`/api/users/${id}/record-access`), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: Array<{ key: string; people: Array<{ id: string }> }> };
    return { chain: ids(body.groups.find((g) => g.key === "chain")?.people), dotted: ids(body.groups.find((g) => g.key === "dotted")?.people) };
  };

  it("walks the line here and lists this workspace's dotted lines, as the engine reads them", async () => {
    // Before, in B: Max on the line (whom B's engine gives no reach), Dana left out, and A's Kai listed.
    expect(await groups("pat")).toEqual({ chain: ["dana"], dotted: ["lee"] });
    // Max's line here is Dana's too.
    expect((await groups("max")).chain).toEqual(["dana"]);
    viewAs("ada", "a");
    expect(await groups("pat")).toEqual({ chain: ["max", "ada"], dotted: ["kai"] });
  });

  it("after Pat switches, each workspace still walks its own line", async () => {
    await patSwitchesToB();
    expect(await groups("pat")).toEqual({ chain: ["dana"], dotted: ["lee"] });
    viewAs("ada", "a");
    // Before: nobody, the account's line (Dana's) holding no seat in A.
    expect(await groups("pat")).toEqual({ chain: ["max", "ada"], dotted: ["kai"] });
  });
});

describe("My team (GET /api/my-team)", () => {
  it("files Pat and Max under Dana in B, and Pat and Kai under Max in A", async () => {
    viewAs("dana", "b", { isAdmin: false });
    st.team = ["dana", "lee", "max", "pat", "bea", "zoe"];
    let body = (await (await myTeam()).json()) as { directReportIds: string[]; members: Array<{ id: string; managerId: string | null }> };
    // Before: [lee] only, and Pat filed under Max.
    expect(body.directReportIds).toEqual(["lee", "max", "pat"]);
    expect(Object.fromEntries(body.members.map((m) => [m.id, m.managerId]))).toEqual({ dana: null, bea: "max", lee: "dana", max: "dana", pat: "dana", zoe: "pat" });
    viewAs("max", "a", { isAdmin: false });
    st.team = ["max", "kai", "pat", "abe"];
    body = await (await myTeam()).json();
    expect(body.directReportIds).toEqual(["kai", "pat"]);
    expect(rowOf(body.members as unknown as Row[], "pat").managerId).toBe("max");
  });
});

describe("Members (Settings > Members)", () => {
  const members = (org: string, query: Parameters<typeof listMembers>[2] = {}) => listMembers(org, { orgWide: true, ids: [] }, query);

  it("names each row's manager here, and No manager reads the same lines", async () => {
    const b = (await members("b")).rows;
    // Before: Pat under Max (her account's line), Max under nobody (Ada holds no seat in B).
    expect(b.find((r) => r.id === "pat")?.manager).toEqual({ id: "dana", name: "Dana Ng" });
    expect(b.find((r) => r.id === "max")?.manager).toEqual({ id: "dana", name: "Dana Ng" });
    expect(b.find((r) => r.id === "kai")?.manager).toBeNull();
    // Before: Max listed (no manager), Kai not (his account's line, Max, holds a seat in B).
    expect(ids((await members("b", { noManager: true })).rows).sort()).toEqual(["bo", "dana", "kai"]);
    const a = (await members("a")).rows;
    expect(a.find((r) => r.id === "pat")?.manager).toEqual({ id: "max", name: "Max Ng" });
  });

  it("after Pat switches, A names her A line and B her B line", async () => {
    await patSwitchesToB();
    expect((await members("b")).rows.find((r) => r.id === "pat")?.manager).toEqual({ id: "dana", name: "Dana Ng" });
    // Before: Dana, the account's line, who holds no seat in A, so nobody.
    expect((await members("a")).rows.find((r) => r.id === "pat")?.manager).toEqual({ id: "max", name: "Max Ng" });
  });
});

describe("the Directory and the Org chart", () => {
  it("each row names its manager here and counts its reports here", async () => {
    const rows = (await directory()).data;
    // Before: Pat under Max; Dana 1 report (Lee), Max 0 in B, Pat 1 (Zoe) and 2 in A with Abe.
    expect(rowOf(rows, "pat")).toMatchObject({ managerId: "dana", manager: { id: "dana", firstName: "Dana" }, directReports: 1 });
    expect(rowOf(rows, "max")).toMatchObject({ managerId: "dana", directReports: 1 });
    expect(rowOf(rows, "dana")).toMatchObject({ managerId: null, manager: null, directReports: 3 });
    viewAs("ada", "a");
    const a = (await directory()).data;
    expect(rowOf(a, "pat")).toMatchObject({ managerId: "max", manager: { id: "max" }, directReports: 1 });
    expect(rowOf(a, "max")).toMatchObject({ managerId: "ada", directReports: 2 });
  });

  it("Reports to, No manager and the sort by reports read the lines here", async () => {
    // Before: Reports to Dana listed Lee only; Reports to Max listed Bea and Pat.
    expect(ids((await directory("&reportsTo=dana")).data)).toEqual(["lee", "max", "pat"]);
    expect(ids((await directory("&reportsTo=max")).data)).toEqual(["bea"]);
    expect(ids((await directory("&view=nomanager")).data)).toEqual(["bo", "dana", "kai"]);
    // Before: Max (0) and Pat sorted by their accounts' counts across workspaces.
    expect(ids((await directory("&sort=reports")).data).slice(0, 3)).toEqual(["dana", "max", "pat"]);
    viewAs("ada", "a");
    expect(ids((await directory("&reportsTo=max")).data)).toEqual(["kai", "pat"]);
    expect(ids((await directory("&reportsTo=dana")).data)).toEqual([]);
  });

  it("the chart draws each person under their manager here, with this workspace's dotted lines", async () => {
    const b = await chart();
    // Before: Pat under Max with Kai (A's) and Lee as dotted managers; Max under nobody.
    expect(rowOf(b, "pat")).toMatchObject({ managerId: "dana", dottedManagerIds: ["lee"] });
    expect(rowOf(b, "max")).toMatchObject({ managerId: "dana", dottedManagerIds: [] });
    expect(rowOf(b, "kai")).toMatchObject({ managerId: null });
    viewAs("ada", "a");
    expect(rowOf(await chart(), "pat")).toMatchObject({ managerId: "max", dottedManagerIds: ["kai"] });
  });

  it("after Pat switches, each workspace still draws its own line", async () => {
    await patSwitchesToB();
    expect(rowOf((await directory()).data, "pat")).toMatchObject({ managerId: "dana" });
    viewAs("ada", "a");
    // Before: nobody (the account's B line), and Dana's line in nobody's tree.
    expect(rowOf((await directory()).data, "pat")).toMatchObject({ managerId: "max" });
    expect(rowOf(await chart(), "pat")).toMatchObject({ managerId: "max", dottedManagerIds: ["kai"] });
  });
});

describe("the Directory's export (GET /api/users/export)", () => {
  it("writes each row's Reports to here", async () => {
    // The row whose own address (the third column) is this one.
    const line = (csv: string, email: string) => csv.split("\n").find((l) => l.split(",")[2]?.replace(/"/g, "") === email)!;
    let csv = await (await exportDirectory(req("/api/users/export"))).text();
    // Before: Max Ng, max@x.test.
    expect(line(csv, "pat@x.test")).toContain("dana@x.test");
    expect(line(csv, "max@x.test")).toContain("dana@x.test");
    expect(line(csv, "pat@x.test")).not.toContain("max@x.test");
    viewAs("ada", "a");
    csv = await (await exportDirectory(req("/api/users/export"))).text();
    expect(line(csv, "pat@x.test")).toContain("max@x.test");
  });
});

describe("the people list (GET /api/users)", () => {
  it("answers each person's manager and report count here", async () => {
    const rows = ((await (await usersList(req("/api/users?scope=all"))).json()) as { data: Row[] }).data;
    // Before: Pat under Max; Dana's count 1, Max's 0.
    expect(rowOf(rows, "pat")).toMatchObject({ managerId: "dana", manager: { id: "dana", firstName: "Dana" }, _count: { directReports: 1 } });
    expect(rowOf(rows, "max")).toMatchObject({ managerId: "dana", _count: { directReports: 1 } });
    expect(rowOf(rows, "dana")).toMatchObject({ managerId: null, manager: null, _count: { directReports: 3 } });
    // A sort by manager reads each seat's line here (Kai's none sorts last).
    const sorted = ids(((await (await usersList(req("/api/users?scope=all&sortBy=managerId&sortOrder=asc"))).json()) as { data: Row[] }).data);
    expect(sorted.slice(-3)).toEqual(["bo", "dana", "kai"]);
    viewAs("ada", "a");
    const a = ((await (await usersList(req("/api/users?scope=all"))).json()) as { data: Row[] }).data;
    // Before: Pat's count 2, Zoe's B line counted in A.
    expect(rowOf(a, "pat")).toMatchObject({ managerId: "max", _count: { directReports: 1 } });
    expect(rowOf(a, "max")).toMatchObject({ _count: { directReports: 2 } });
  });
});

describe("peer suggestions (GET /api/reviews/[id]/peers)", () => {
  beforeEach(() => {
    for (const org of ["a", "b"]) {
      db.seed("reviewCycle", { id: `c-${org}`, name: `${org} H2`, organizationId: org, status: "ACTIVE", startDate: new Date(), endDate: new Date() });
      db.seed("review", { id: `r-${org}`, cycleId: `c-${org}`, subjectId: "pat", reviewerId: null, status: "PENDING" });
    }
  });
  const suggest = async (cycleId: string) => {
    const res = await peers(req(`/api/reviews/${cycleId}/peers?subjectId=pat`), { params: Promise.resolve({ id: cycleId }) });
    expect(res.status).toBe(200);
    return ((await res.json()).data as Array<{ id: string; why: string }>).map((p) => [p.id, p.why]);
  };

  it("suggests the people around Pat's line here", async () => {
    // Before: Bea "Same manager" (Max's report, by Pat's account line) and Zoe, never Dana or Lee.
    expect(await suggest("c-b")).toEqual([["dana", "Their manager"], ["lee", "Same manager"], ["zoe", "Reports to them"]]);
    viewAs("ada", "a");
    expect(await suggest("c-a")).toEqual([["abe", "Reports to them"], ["kai", "Same manager"], ["max", "Their manager"]]);
  });
});

describe("the Owner snapshot (POST /api/ai)", () => {
  const ask = async () => {
    const res = await askAi(req("/api/ai", { method: "POST", body: JSON.stringify({ query: "Who has the biggest team?" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(200);
    return st.aiSystem;
  };

  it("counts each person's reports here", async () => {
    // Before: Dana "Reports: 1" (Lee, the one account line naming her).
    expect(await ask()).toMatch(/- Dana Ng: [^\n]*, Reports: 3/);
    viewAs("ada", "a");
    const a = await ask();
    // Before: Pat "Reports: 2", Zoe's B line counted in A.
    expect(a).toMatch(/- Pat Ng: [^\n]*, Reports: 1/);
    expect(a).toMatch(/- Max Ng: [^\n]*, Reports: 2/);
  });
});

describe("My team's table (GET /api/team/members-work)", () => {
  it("the Reports to filter reads each seat's line here", async () => {
    const work = async (qs: string) => ids(((await (await membersWork(req(`/api/team/members-work?${qs}`))).json()) as { rows: Row[] }).rows);
    st.scope = { orgWide: true, ids: ["bo", "dana", "lee", "zoe", "bea", "pat", "max", "kai"], direct: new Set(), hasIndirect: false };
    // Before: Reports to Dana gave Lee only, Reports to Max gave Bea and Pat.
    expect(await work("manager=dana")).toEqual(["lee", "max", "pat"]);
    expect(await work("manager=max")).toEqual(["bea"]);
    viewAs("ada", "a");
    st.scope = { orgWide: true, ids: ["ada", "max", "kai", "pat", "abe"], direct: new Set(), hasIndirect: false };
    expect(await work("manager=max")).toEqual(["kai", "pat"]);
  });
});
