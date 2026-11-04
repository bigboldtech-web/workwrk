// Everyone with a live seat in a workspace is offered and accepted wherever
// people are picked, assigned, messaged, mentioned or handed work, and shown
// in Workload, at THIS workspace's values (docs/plans/workspace-status-2.md
// E12 to E14, step 6). Run on the in-memory database (seat-test-db.ts),
// through the real routes and helpers.
//
// The case: Pat is anchored at her agency A, where she is a Manager in
// Operations giving 40 hours a week, and works at client B through a live
// membership: an Employee in B's Engineering, a Developer, 10 hours a week on
// Mondays and Tuesdays. Dana is a Manager in B. Rita is anchored at A and B
// deactivated her through her membership; Rex is anchored at A and B removed
// him. Bea is anchored at B. Zed is anchored at A with no seat in B. Gus is a
// Guest in B. Before this step every surface below read the people anchored
// in B only, so Pat, who last opened A, was nowhere in B.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";
import { WORK_SCHEDULE_DEFAULTS } from "@/lib/work-schedule";

const st = vi.hoisted(() => ({
  me: "dana",
  level: "MANAGER",
  /** Dana's report tree in B, as /api/users's team scope reads it. */
  team: [] as string[],
  /** Who Dana's Workload scope holds (teamScopeFor). */
  scope: [] as string[],
  /** The people a Space Workload reader may read people data of. */
  readable: new Set<string>(),
  spaceMembers: [] as string[],
  peopleCtx: {} as Record<string, unknown>,
  made: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession(st.me, st.level, "b") }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: legacyTestSession(st.me, st.level, "b") }),
  getOrgId: () => "b",
  getUserId: () => st.me,
}));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => st.team }));
vi.mock("@/lib/talk-gate", async (orig) => ({
  ...(await orig<typeof import("@/lib/talk-gate")>()),
  talkGate: async () => ({ error: null, gate: { userId: st.me, organizationId: "b", orgRole: "MEMBER", ...legacyLevelRow(st.level) } }),
  requireConversation: async (id: string) => ({ error: null, ctx: { conversation: { id, type: "GROUP" }, gate: { userId: st.me, organizationId: "b" } } }),
}));
vi.mock("@/lib/people/person-access.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/people/person-access.server")>()),
  peopleCtx: async () => st.peopleCtx,
  peopleCtxForViewer: async () => st.peopleCtx,
  readsPeopleDataOf: (_ctx: unknown, id: string) => st.readable.has(id),
  relationTo: (_ctx: unknown, id: string) => (st.readable.has(id) ? "chain" : "none"),
}));
vi.mock("@/lib/people/team-scope.server", () => ({
  teamScopeFor: async () => ({ orgWide: false, ids: st.scope, direct: new Set(st.scope), hasIndirect: false }),
}));
vi.mock("@/lib/people/team-boards.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/people/team-boards.server")>()),
  readableBoardsFor: async () => ({ ids: [], byId: new Map(), isDone: () => false }),
}));
vi.mock("@/lib/work-schedule-server", () => ({ readOrgWorkSchedule: async () => WORK_SCHEDULE_DEFAULTS }));
vi.mock("@/lib/item-gate", async (orig) => ({
  ...(await orig<typeof import("@/lib/item-gate")>()),
  itemCtx: async () => ({ userId: st.me, organizationId: "b", userName: null }),
  gateItem: async (id: string) => ({ item: { id, title: "Launch plan", metadata: {}, assigneeIds: [], ownerId: null, boardId: "l1", dueAt: null } }),
}));
vi.mock("@/lib/space", async (orig) => ({
  ...(await orig<typeof import("@/lib/space")>()),
  listSpaceMembers: async () => st.spaceMembers.map((userId) => ({ userId })),
  readableListsInSpace: async () => ({ lists: [{ id: "l1", slug: "l1", name: "Launch", statuses: null, canContribute: true }], folderCount: 0 }),
}));
vi.mock("@/lib/list-links-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/list-links-server")>()),
  spaceForViewer: async () => ({ id: "sp1" }),
  listReader: () => ({ canRead: async () => true, prime: () => {}, row: async () => null }),
  resolveListScope: async () => ({ lists: [{ id: "l1", name: "Launch" }], where: { boardId: { in: ["l1"] } }, listsByItem: new Map() }),
}));
// Who can read a node: the people the real loadPeople reads as able to sign
// in here, at the seat each holds here (so an ended seat reads nothing).
vi.mock("@/lib/access/node-access", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/node-access")>()),
  usersWhoCanRead: async (org: string, _ref: unknown, opts: { among?: Iterable<string> } = {}) => {
    const { loadPeople } = await import("@/lib/access/node-world");
    const people = await loadPeople(org, [...(opts.among ?? [])]);
    return new Map([...people.values()].filter((p) => p.active).map((p) => [p.id, "VIEW"] as const));
  },
  nodeRole: async () => ({ role: "VIEW" }),
  nodeRoleMap: async (_ctx: unknown, _kind: string, ids: Iterable<string>) => new Map([...ids].map((id) => [id, "VIEW"])),
}));
vi.mock("@/lib/notify-prefs", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify-prefs")>()),
  filterNotifyUsers: async (ids: string[]) => new Set(ids),
  filterUnmutedUsers: async (ids: string[]) => new Set(ids),
  shouldNotify: async () => true,
  shouldEmail: async () => false,
}));
vi.mock("@/lib/suites/auth", () => ({ resolveSuiteContext: async () => ({ userId: st.me, orgId: "b", ...legacyLevelRow(st.level) }) }));
vi.mock("@/lib/doc-access", () => ({ docAccessible: async () => true }));
vi.mock("@/lib/doc-sharing", async (orig) => ({ ...(await orig<typeof import("@/lib/doc-sharing")>()), requireDocRole: async () => true }));
vi.mock("@/lib/item-thread", async (orig) => ({ ...(await orig<typeof import("@/lib/item-thread")>()), createUpdate: async () => ({ id: "up1" }), logActivity: async () => undefined }));
vi.mock("@/lib/notify-realtime", () => ({ publishItemChanged: async () => undefined }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => undefined, queueEmail: async () => undefined }));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => undefined, calculatePerformanceScore: async () => undefined }));
vi.mock("@/services/slackNotifier", () => ({ notifyKudosPosted: async () => undefined }));
vi.mock("@/services/webhookDispatcher", () => ({ dispatchEvent: async () => undefined }));
vi.mock("@/lib/board", async (orig) => ({
  ...(await orig<typeof import("@/lib/board")>()),
  getOrCreatePersonalBoard: async (_org: string, userId: string) => ({ id: `personal-${userId}`, statuses: null }),
}));
vi.mock("@/lib/board-items", async (orig) => ({
  ...(await orig<typeof import("@/lib/board-items")>()),
  createBoardItem: async (input: Record<string, unknown>) => {
    st.made.push(input);
    return { id: "task-1", boardId: input.boardId, title: input.title, status: "TO_DO", ownerId: input.ownerId, assigneeIds: input.assigneeIds, dueAt: null, priority: "NORMAL", createdAt: new Date() };
  },
}));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { GET as pick } from "@/app/api/people/pick/route";
import { GET as users } from "@/app/api/users/route";
import { GET as conversations, POST as startConversation } from "@/app/api/conversations/route";
import { POST as addToConversation } from "@/app/api/conversations/[id]/members/route";
import { POST as mentionInDoc } from "@/app/api/docs/[id]/mention/route";
import { GET as teamWorkload } from "@/app/api/team/workload/route";
import { GET as membersWork } from "@/app/api/team/members-work/route";
import { GET as personWork } from "@/app/api/team/person-work/route";
import { GET as spaceWorkload } from "@/app/api/spaces/[id]/workload/route";
import { GET as listMembers } from "@/app/api/boards/[id]/members/route";
import { listAssignableUsersForBoard, unknownUserIds } from "@/lib/assignable";
import { notifyItemAssigned } from "@/lib/notify-item";
import { postItemCommentAs } from "@/lib/items/item-comment";
import { TOOLS, searchEmployeeRows } from "@/lib/agents/tools";
import { livePersonByEmail } from "@/lib/agents/teammate-tools";
import { computeWidget } from "@/lib/dashboards/widget-data";
import { newWidgetInput } from "@/lib/dashboards/widget-kinds";
import type { NodeCtx } from "@/lib/access/node-rules";

const req = (url: string, init?: RequestInit) => new NextRequest(`https://app.test${url}`, init as ConstructorParameters<typeof NextRequest>[1]);
// A route's answer (some handlers type theirs as possibly undefined).
const json = async (res: Response | undefined) => (await res!.json()) as Record<string, unknown>;
const post = (url: string, body: unknown) => req(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ids = (rows: unknown) => (rows as Array<{ id: string }>).map((r) => r.id);
const DANA: NodeCtx = { userId: "dana", organizationId: "b", orgAdmin: false, orgGuest: false, isAgent: false, denied: false };

function person(id: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Lee", organizationId,
    ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE", deletedAt: null, phone: null, managerId: null,
    departmentId: null, roleId: null, officeId: null, joinDate: new Date("2025-01-01"), createdAt: new Date("2025-01-01"),
    weeklyCapacityHours: null, workSchedule: null, ...over,
  });
}
function seat(userId: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, createdAt: new Date("2026-06-01"), ...over });
}

beforeEach(() => {
  db.reset();
  db.onQueryRaw = () => [];
  st.me = "dana";
  st.level = "MANAGER";
  st.team = ["pat", "rita", "rex", "bea"];
  st.scope = ["pat", "rita", "bea"];
  st.readable = new Set(["pat", "bea"]);
  st.spaceMembers = [];
  st.made = [];
  st.peopleCtx = { userId: "dana", organizationId: "b", ...legacyLevelRow("MANAGER"), orgRole: "MEMBER", isAgent: false, isAdmin: false, peopleTeam: false, orgWide: false, managerTier: true, chain: new Set(["pat", "bea"]), writeChain: new Set(["pat", "bea"]), viewer: { userId: "dana", organizationId: "b" } };
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}` });
  db.seed("department", { id: "dep-a-ops", name: "Operations", color: null, organizationId: "a" });
  db.seed("department", { id: "dep-b-eng", name: "Engineering", color: null, organizationId: "b" });
  db.seed("role", { id: "role-a-lead", title: "Lead", level: "MANAGER", description: null, organizationId: "a" });
  db.seed("role", { id: "role-b-dev", title: "Developer", level: "EMPLOYEE", description: null, organizationId: "b" });
  person("dana", "b", { ...legacyLevelRow("MANAGER") });
  person("pat", "a", { ...legacyLevelRow("MANAGER"), departmentId: "dep-a-ops", roleId: "role-a-lead", weeklyCapacityHours: 40, workSchedule: { workdays: [1, 2, 3, 4, 5], hoursPerDay: 8 } });
  seat("pat", "b", { role: "EMPLOYEE", departmentId: "dep-b-eng", roleId: "role-b-dev", weeklyCapacityHours: 10, workSchedule: { workdays: [1, 2], hoursPerDay: 5 }, joinDate: new Date("2026-06-15") });
  person("rita", "a");
  seat("rita", "b", { status: "INACTIVE" });
  person("rex", "a");
  seat("rex", "b", { status: "INACTIVE", removedAt: new Date("2026-10-01") });
  person("bea", "b", { departmentId: "dep-b-eng", weeklyCapacityHours: 32 });
  person("zed", "a");
  person("gus", "b");
});

describe("the people pickers (GET /api/people/pick)", () => {
  it("offer Pat to Dana in B, with B's job title, and nobody B ended", async () => {
    const list = (await json(await pick(req("/api/people/pick")))).people as Array<{ id: string; role: unknown }>;
    expect(ids(list)).toEqual(["bea", "gus", "pat"]);
    expect(list.find((p) => p.id === "pat")?.role).toEqual({ title: "Developer" });
    expect(ids((await json(await pick(req("/api/people/pick?q=pat%20lee")))).people)).toEqual(["pat"]);
    expect(ids((await json(await pick(req("/api/people/pick?reach=signin")))).people)).toEqual(["bea", "gus", "pat"]);
    // A saved choice that names them: Pat reads by name; Rita, Rex and Zed never.
    expect(ids((await json(await pick(req("/api/people/pick?ids=pat,rita,rex,zed")))).people)).toEqual(["pat"]);
    // A filter's picker for someone who is not privileged: who can sign in here.
    expect(ids((await json(await pick(req("/api/people/pick?reach=all&q=rita")))).people)).toEqual([]);
  });

  it("offer Pat as a manager by the level she holds in B, never as an Agent here", async () => {
    expect(ids((await json(await pick(req("/api/people/pick?managers=1&q=pat")))).people)).toEqual(["pat"]);
    db.row("organizationMembership", "m-pat-b").role = "AGENT";
    expect(ids((await json(await pick(req("/api/people/pick?managers=1&q=pat")))).people)).toEqual([]);
  });

  it("keep a Guest's picker to the people they share a conversation with", async () => {
    st.me = "gus";
    st.level = "GUEST";
    db.seed("conversation", { id: "c-g", organizationId: "b", type: "DM" });
    db.seed("conversationMember", { id: "cm-g1", conversationId: "c-g", userId: "gus" });
    db.seed("conversationMember", { id: "cm-g2", conversationId: "c-g", userId: "bea" });
    expect(ids((await json(await pick(req("/api/people/pick")))).people)).toEqual(["bea"]);
    expect(ids((await json(await pick(req("/api/people/pick?ids=pat,bea")))).people)).toEqual(["bea"]);
  });
});

describe("the people list (GET /api/users)", () => {
  it("lists Pat in Dana's team with B's status, level, department, job title and join date", async () => {
    const body = await json(await users(req("/api/users?scope=all&employed=1")));
    const rows = body.data as Array<Record<string, unknown>>;
    expect(ids(rows)).toEqual(["bea", "pat"]);
    const pat = rows.find((r) => r.id === "pat")!;
    expect(pat).toMatchObject({ status: "ACTIVE", department: { id: "dep-b-eng", name: "Engineering" }, role: { id: "role-b-dev", title: "Developer" }, deletedAt: null });
    expect(new Date(pat.joinDate as string)).toEqual(new Date("2026-06-15"));
    expect(JSON.stringify(pat)).not.toMatch(/Operations|Lead|MANAGER/);
    expect((body.pagination as { total: number }).total).toBe(2);
  });

  it("reads B's statuses: Rita as deactivated here, Rex not at all", async () => {
    const rows = (await json(await users(req("/api/users?scope=all")))).data as Array<{ id: string; status: string }>;
    expect(rows.map((r) => [r.id, r.status])).toEqual([["bea", "ACTIVE"], ["pat", "ACTIVE"], ["rita", "INACTIVE"]]);
    expect(ids((await json(await users(req("/api/users?scope=all&status=INACTIVE")))).data)).toEqual(["rita"]);
  });

  it("pages both halves by name, and sorts by a seat's column in memory", async () => {
    const page1 = await json(await users(req("/api/users?scope=all&limit=2&page=1")));
    const page2 = await json(await users(req("/api/users?scope=all&limit=2&page=2")));
    expect([...ids(page1.data), ...ids(page2.data)]).toEqual(["bea", "pat", "rita"]);
    expect((page1.pagination as { total: number }).total).toBe(3);
    // Rita's status in B (INACTIVE) sorts after the ACTIVE ones, though her account is ACTIVE in A.
    expect(ids((await json(await users(req("/api/users?scope=all&sortBy=status&sortOrder=asc")))).data)).toEqual(["bea", "pat", "rita"]);
    expect(ids((await json(await users(req("/api/users?scope=all&sortBy=status&sortOrder=desc")))).data)).toEqual(["rita", "bea", "pat"]);
  });
});

describe("assigning (the List roster and the assignee check)", () => {
  beforeEach(() => {
    db.seed("space", { id: "sp1", organizationId: "b", name: "Client", slug: "client", icon: null, color: null, visibility: "PRIVATE", ownerId: "dana", description: null, parentSpaceId: null, displayOrder: 0 });
    db.seed("board", { id: "l1", organizationId: "b", spaceId: "sp1", folderId: null, name: "Launch", slug: "launch", icon: null, color: null, visibility: "WORKSPACE", ownerId: "dana", settings: {}, archivedAt: null });
    db.seed("spaceMember", { id: "sm1", spaceId: "sp1", userId: "dana", role: "OWNER", createdAt: new Date() });
    db.seed("boardMember", { id: "bm1", boardId: "l1", userId: "pat", role: "MEMBER", rung: null, createdAt: new Date() });
    db.seed("boardMember", { id: "bm2", boardId: "l1", userId: "rita", role: "MEMBER", rung: null, createdAt: new Date() });
  });

  it("offers Pat on a List she was given, and never Rita, whom B deactivated", async () => {
    const roster = await listAssignableUsersForBoard("l1", "b", {}, DANA);
    expect(ids(roster)).toEqual(["dana", "pat"]);
    expect(ids(await listAssignableUsersForBoard("l1", "b", { ids: ["pat", "rita"] }, DANA))).toEqual(["pat"]);
  });

  it("offers Pat on a List open to everyone here, with the live people anchored here", async () => {
    db.row("space", "sp1").visibility = "ORG";
    expect(ids(await listAssignableUsersForBoard("l1", "b", {}, DANA))).toEqual(["bea", "dana", "gus", "pat"]);
  });

  it("accepts Pat as an assignee; refuses Rex (removed here) and Zed (no seat here)", async () => {
    expect(await unknownUserIds(["pat"], "b")).toEqual([]);
    expect(await unknownUserIds(["rex", "zed"], "b")).toEqual(["rex", "zed"]);
    // A seat deactivated here stays known, as a deactivated person anchored
    // here does, so a task that still holds Rita can be edited.
    person("dee", "b", { status: "INACTIVE" });
    expect(await unknownUserIds(["rita", "dee"], "b")).toEqual([]);
  });

  it("tells Pat she was assigned, and never Rita", async () => {
    db.seed("item", { id: "t1", organizationId: "b", boardId: "l1", title: "Launch plan", ownerId: "pat", assigneeIds: ["pat"], dueAt: null, archivedAt: null });
    expect(await notifyItemAssigned({ organizationId: "b", item: { id: "t1", title: "Launch plan", dueAt: null }, ownerId: "pat", actorId: "dana" })).toBe(1);
    db.seed("item", { id: "t2", organizationId: "b", boardId: "l1", title: "Old plan", ownerId: "rita", assigneeIds: ["rita"], dueAt: null, archivedAt: null });
    expect(await notifyItemAssigned({ organizationId: "b", item: { id: "t2", title: "Old plan", dueAt: null }, ownerId: "rita", actorId: "dana" })).toBe(0);
    expect((db.tables.notification ?? []).map((n) => n.userId)).toEqual(["pat"]);
  });

  it("the AI tools assign Pat by her address, and never Rita or Zed", async () => {
    const ok = await TOOLS.create_task.handler({ orgId: "b", userId: "dana" }, { title: "Review the spec", assigneeEmail: "PAT@x.test" });
    expect(ok).toMatchObject({ ok: true });
    expect(st.made[0]).toMatchObject({ organizationId: "b", ownerId: "pat", assigneeIds: ["pat"] });
    for (const email of ["rita@x.test", "zed@x.test"]) {
      expect(await TOOLS.create_task.handler({ orgId: "b", userId: "dana" }, { title: "No", assigneeEmail: email })).toHaveProperty("error");
    }
    expect(st.made).toHaveLength(1);
  });
});

describe("messaging (Talk)", () => {
  it("starts a DM and a group with Pat, and refuses Rita, Rex and Zed", async () => {
    expect((await startConversation(post("/api/conversations", { type: "DM", memberIds: ["pat"] }))).status).toBe(201);
    for (const who of ["rita", "rex", "zed"]) {
      expect((await startConversation(post("/api/conversations", { type: "DM", memberIds: [who] }))).status).toBe(400);
    }
    expect((await addToConversation(post("/api/conversations/g1/members", { userIds: ["pat"] }), { params: Promise.resolve({ id: "g1" }) })).status).toBe(200);
    expect((await addToConversation(post("/api/conversations/g1/members", { userIds: ["pat", "rita"] }), { params: Promise.resolve({ id: "g1" }) })).status).toBe(400);
    // Someone deactivated who is anchored here is still added, as before.
    person("dee", "b", { status: "INACTIVE" });
    expect((await startConversation(post("/api/conversations", { type: "DM", memberIds: ["dee"] }))).status).toBe(201);
  });

  it("seeds #general with Pat, never with Rita, Rex or Zed", async () => {
    await conversations();
    const general = (db.tables.conversation ?? []).find((c) => c.name === "general")!;
    const members = (db.tables.conversationMember ?? []).filter((m) => m.conversationId === general.id).map((m) => m.userId).sort();
    expect(members).toEqual(["bea", "dana", "gus", "pat"]);
  });

  it("finds Pat for the teammate and MCP tools by her address, and nobody B ended", async () => {
    expect(await livePersonByEmail("b", "Pat@X.test")).toMatchObject({ id: "pat", name: "Pat Lee", email: "pat@x.test" });
    for (const e of ["rita@x.test", "rex@x.test", "zed@x.test"]) expect(await livePersonByEmail("b", e)).toBeNull();
  });

  it("thanks Pat through Ask AI's send_kudos, and never Rita", async () => {
    expect(await TOOLS.send_kudos.handler({ orgId: "b", userId: "dana" }, { receiverEmail: "pat@x.test", message: "Great launch" })).toMatchObject({ ok: true, receiver: "Pat Lee" });
    expect((db.tables.kudos ?? []).map((k) => k.receiverId)).toEqual(["pat"]);
    expect(await TOOLS.send_kudos.handler({ orgId: "b", userId: "dana" }, { receiverEmail: "rita@x.test", message: "Thanks" })).toHaveProperty("error");
  });
});

describe("mentioning", () => {
  it("tells Pat she was mentioned in a doc; Rita is never told, and Zed is no one here", async () => {
    db.seed("doc", { id: "d1", organizationId: "b", title: "Spec", archivedAt: null, entityType: null, entityId: null, createdById: "dana" });
    const pat = await mentionInDoc(post("/api/docs/d1/mention", { userId: "pat" }), { params: Promise.resolve({ id: "d1" }) });
    expect(await json(pat)).toEqual({ ok: true });
    const rita = await mentionInDoc(post("/api/docs/d1/mention", { userId: "rita" }), { params: Promise.resolve({ id: "d1" }) });
    expect(await json(rita)).toEqual({ ok: true, skipped: "no_access" });
    expect((await mentionInDoc(post("/api/docs/d1/mention", { userId: "zed" }), { params: Promise.resolve({ id: "d1" }) }))!.status).toBe(400);
    expect((db.tables.notification ?? []).map((n) => n.userId)).toEqual(["pat"]);
  });

  it("tells Pat she was mentioned in a task comment, and never Rita", async () => {
    db.seed("item", { id: "t1", organizationId: "b", boardId: "l1", title: "Launch plan", ownerId: null, assigneeIds: [], dueAt: null, archivedAt: null, metadata: {} });
    const c = { userId: "dana", organizationId: "b", userName: "Dana Lee", ...legacyLevelRow("MANAGER") };
    const res = await postItemCommentAs(c as never, "t1", { body: "@Pat Lee and @Rita Lee please look", mentionedUserIds: ["pat", "rita"] });
    expect(res.status).toBe(201);
    expect((db.tables.notification ?? []).filter((n) => n.type === "mention").map((n) => n.userId)).toEqual(["pat"]);
  });
});

describe("the AI and MCP people search (searchEmployeeRows)", () => {
  it("finds Pat with B's department and job title, and filters by B's department", async () => {
    const all = await searchEmployeeRows({ orgId: "b", userId: "dana" }, { limit: 20, levels: false });
    expect(all.map((r) => r.id)).toEqual(["bea", "dana", "gus", "pat"]);
    expect(all.find((r) => r.id === "pat")).toEqual({ id: "pat", name: "Pat Lee", email: "pat@x.test", department: "Engineering", role: "Developer" });
    expect((await searchEmployeeRows({ orgId: "b", userId: "dana" }, { department: "engineering", limit: 20, levels: false })).map((r) => r.id)).toEqual(["bea", "pat"]);
    // A's Operations is not one of B's departments: nobody.
    expect(await searchEmployeeRows({ orgId: "b", userId: "dana" }, { department: "Operations", limit: 20, levels: false })).toEqual([]);
  });
});

describe("Workload", () => {
  it("Teams > Workload shows Pat with B's hours, working week and department, and never Rita", async () => {
    const body = await json(await teamWorkload(req("/api/team/workload?from=2026-11-02&to=2026-11-15")));
    const people = body.people as Array<Record<string, unknown>>;
    expect(ids(people)).toEqual(["bea", "pat"]);
    // Dana writes Pat's hours here, PATCH's own door (workspace-status-2.md
    // step 5, E7); before step 5 the grid offered no edit for her.
    expect(people.find((p) => p.id === "pat")).toMatchObject({ departmentId: "dep-b-eng", weeklyCapacityHours: 10, workSchedule: { workdays: [1, 2], hoursPerDay: 5 }, canEditCapacity: true });
    expect(people.find((p) => p.id === "bea")).toMatchObject({ canEditCapacity: true });
    expect(ids((await json(await teamWorkload(req("/api/team/workload?from=2026-11-02&to=2026-11-15&dept=dep-a-ops")))).people)).toEqual([]);
    expect(ids((await json(await teamWorkload(req("/api/team/workload?from=2026-11-02&to=2026-11-15&dept=dep-b-eng")))).people)).toEqual(["bea", "pat"]);
  });

  it("My team's rows show Pat with B's job title and department, filter by B's, and never Rita", async () => {
    const body = await json(await membersWork(req("/api/team/members-work")));
    const rows = body.rows as Array<Record<string, unknown>>;
    expect(ids(rows).sort()).toEqual(["bea", "pat"]);
    expect(rows.find((r) => r.id === "pat")).toMatchObject({ role: { id: "role-b-dev", title: "Developer" }, department: { id: "dep-b-eng", name: "Engineering" } });
    expect(ids((await json(await membersWork(req("/api/team/members-work?title=role-b-dev")))).rows)).toEqual(["pat"]);
    expect(ids((await json(await membersWork(req("/api/team/members-work?dept=dep-a-ops")))).rows)).toEqual([]);
    // Her open work opens from her row (the "+2"), as anyone's does.
    expect((await personWork(req("/api/team/person-work?userId=pat"))).status).toBe(200);
    // Someone with no seat here is no one here, whatever the relation says.
    st.readable.add("zed");
    expect((await personWork(req("/api/team/person-work?userId=zed"))).status).toBe(404);
  });

  it("the Space's Workload tab shows Pat with B's hours, and never Rita", async () => {
    st.spaceMembers = ["pat", "rita", "bea", "zed"];
    const body = await json(await spaceWorkload(new Request("https://app.test/api/spaces/sp1/workload?from=2026-11-02&to=2026-11-15"), { params: Promise.resolve({ id: "sp1" }) }));
    const people = body.people as Array<Record<string, unknown>>;
    expect(ids(people)).toEqual(["bea", "pat"]);
    expect(people.find((p) => p.id === "pat")).toMatchObject({ weeklyCapacityHours: 10, ownCapacity: true });
  });

  it("the List's WORKLOAD view reads only the members who can still work here", async () => {
    db.seed("boardMember", { id: "bm1", boardId: "l1", userId: "pat", role: "MEMBER", rung: null, createdAt: new Date("2026-01-01") });
    db.seed("boardMember", { id: "bm2", boardId: "l1", userId: "rita", role: "MEMBER", rung: null, createdAt: new Date("2026-01-02") });
    const live = await json(await listMembers(new Request("https://app.test/api/boards/l1/members?live=1"), { params: Promise.resolve({ id: "l1" }) }));
    expect((live.members as Array<{ userId: string }>).map((m) => m.userId)).toEqual(["pat"]);
    // The Share dialog still reads every member, to manage them.
    const all = await json(await listMembers(new Request("https://app.test/api/boards/l1/members"), { params: Promise.resolve({ id: "l1" }) }));
    expect((all.members as Array<{ userId: string }>).map((m) => m.userId)).toEqual(["pat", "rita"]);
  });

  it("the dashboard Workload card measures Pat by B's hours, and never counts Rita", async () => {
    db.seed("board", { id: "l1", organizationId: "b", spaceId: null, folderId: null, name: "Launch", slug: "launch", itemType: "studio-item", settings: {}, statuses: null, schema: { fields: [] }, archivedAt: null });
    const base = { organizationId: "b", boardId: "l1", archivedAt: null, itemType: "studio-item", status: "TO_DO", priority: null, startAt: null, itemTypeId: null, createdAt: new Date(), updatedAt: new Date(), metadata: { timeEstimate: 120 } };
    db.seed("item", { ...base, id: "w1", title: "Spec", ownerId: "pat", assigneeIds: ["pat"], dueAt: new Date() });
    db.seed("item", { ...base, id: "w2", title: "Old", ownerId: "rita", assigneeIds: ["rita"], dueAt: new Date() });
    const w = { ...newWidgetInput("workload", { id: "wl", layout: { x: 0, y: 0, w: 6, h: 7 } }), source: { kind: "all" as const }, mode: "hours" as const };
    const r = { ctx: { userId: "dana", organizationId: "b", ...legacyLevelRow("MANAGER") }, viewer: { userId: "dana", organizationId: "b", orgRole: "MEMBER" }, zone: "UTC", now: new Date("2026-11-04T12:00:00Z") };
    const out = (await computeWidget(w as never, r as never)) as { kind: string; people: Array<{ id: string; capacity: number; ownCapacity: boolean }> };
    expect(out.kind).toBe("workload");
    expect(ids(out.people)).toEqual(["pat"]);
    // Ten hours a week over Mondays and Tuesdays (5 a day): two such days in
    // each of the card's two weeks, 20 hours, never A's 40-hour week.
    expect(out.people[0]).toMatchObject({ ownCapacity: true, capacity: 20 });
  });
});
