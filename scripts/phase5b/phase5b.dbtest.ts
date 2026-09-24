// Phase 5b handler-level checks, against the LOCAL database, through the real
// route handlers with a mocked session. See vitest.db.config.mts for how to
// run it. It builds one throwaway organization and removes it afterwards.
//
// A test harness: its mocked session carries accessLevel exactly as a real
// JWT does, and it reads route answers as loose JSON, so the rule below
// does not apply to it.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const LOCAL = /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1):5432\//;
if (!LOCAL.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("phase5b.dbtest refuses to run: DATABASE_URL is not the local database on port 5432 (use the URL from .env.local).");
}

type SessionUser = { id: string; accessLevel: string; organizationId: string; name: string; email: string };
const session: { user: SessionUser | null } = { user: null };
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => (session.user ? { user: session.user } : null)) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("server-only", () => ({}));

import { prisma } from "@/lib/prisma";
import { createBoardItem, listBoardItems } from "@/lib/board-items";
import { markListLinksMissing, resetListLinksAvailability } from "@/lib/list-links-server";
import { moveToTrash, restoreFromTrash } from "@/lib/trash";
import { runDueReports } from "@/lib/reports/report-server";
import * as linksRoute from "@/app/api/boards/[id]/links/route";
import * as linkItemRoute from "@/app/api/boards/[id]/links/[itemId]/route";
import * as boardItemsRoute from "@/app/api/boards/[id]/items/route";
import * as itemRoute from "@/app/api/items/[id]/route";
import * as itemListsRoute from "@/app/api/items/[id]/lists/route";
import * as subtasksRoute from "@/app/api/items/[id]/subtasks/route";
import * as activityRoute from "@/app/api/items/[id]/activity/route";
import * as duplicateRoute from "@/app/api/items/[id]/duplicate/route";
import * as bulkRoute from "@/app/api/items/bulk/route";
import * as fieldsRoute from "@/app/api/boards/[id]/fields/route";
import * as fieldKeyRoute from "@/app/api/boards/[id]/fields/[key]/route";
import * as candidatesRoute from "@/app/api/boards/[id]/fields/[key]/candidates/route";
import * as boardRoute from "@/app/api/boards/[id]/route";
import * as settingsRoute from "@/app/api/boards/[id]/settings/route";
import * as viewRoute from "@/app/api/boards/[id]/views/[viewId]/route";
import * as dashboardsRoute from "@/app/api/dashboards/route";
import * as dashboardRoute from "@/app/api/dashboards/[id]/route";
import * as dashboardDataRoute from "@/app/api/dashboards/[id]/data/route";
import * as schedulesRoute from "@/app/api/report-schedules/route";
import * as scheduleRoute from "@/app/api/report-schedules/[id]/route";
import * as unsubscribeRoute from "@/app/api/report-schedules/[id]/recipients/me/route";
import * as cronRoute from "@/app/api/cron/report-schedules/route";
import * as everythingRoute from "@/app/api/me/everything/route";
import * as previewWidgetRoute from "@/app/api/dashboards/widget-preview/route";
import * as schedulePreviewRoute from "@/app/api/report-schedules/[id]/preview/route";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(handler: unknown, url: string, init: { method?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const req = new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve(init.params ?? {}) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ids = {} as Record<string, string>;
const users = {} as Record<"admin" | "member" | "outsider" | "stranger", SessionUser>;
function as(who: keyof typeof users) { session.user = users[who]; }
/** The same person as the LinkViewer the server helpers take. */
function lv(who: keyof typeof users) {
  const u = users[who];
  return { userId: u.id, accessLevel: u.accessLevel, organizationId: u.organizationId };
}

const STATUSES_A = [
  { value: "TO_DO", label: "To Do", color: "#98A2B3", group: "ACTIVE" },
  { value: "SHIPPED", label: "Shipped", color: "#15803D", group: "DONE" },
];

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `P5B ${suffix}`, slug: `p5b-${suffix}` } });
  const org2 = await prisma.organization.create({ data: { name: `P5B other ${suffix}`, slug: `p5b-o-${suffix}` } });
  ids.org = org.id;
  ids.org2 = org2.id;
  const mk = async (key: string, orgId: string, accessLevel: "COMPANY_ADMIN" | "EMPLOYEE", first: string) => {
    const email = `${key}-${suffix}@p5b.test`;
    const u = await prisma.user.create({ data: { email, passwordHash: "x", firstName: first, lastName: "Test", organizationId: orgId, accessLevel } });
    return { id: u.id, accessLevel, organizationId: orgId, name: `${first} Test`, email };
  };
  users.admin = await mk("admin", org.id, "COMPANY_ADMIN", "Ada");
  users.member = await mk("member", org.id, "EMPLOYEE", "Mia");
  users.outsider = await mk("outsider", org.id, "EMPLOYEE", "Oli");
  users.stranger = await mk("stranger", org2.id, "EMPLOYEE", "Sam");

  const space = (name: string, members: Array<[string, "OWNER" | "MEMBER"]>) =>
    prisma.space.create({
      data: {
        organizationId: org.id, slug: `${name}-${suffix}`, name, visibility: "WORKSPACE", ownerId: users.member.id,
        members: { create: members.map(([userId, role]) => ({ userId, role })) },
      },
    });
  const sA = await space("space-a", [[users.member.id, "OWNER"]]);
  const sB = await space("space-b", [[users.member.id, "OWNER"], [users.outsider.id, "MEMBER"]]);
  const sC = await space("space-c", [[users.member.id, "OWNER"]]);
  ids.spaceA = sA.id;
  ids.spaceB = sB.id;
  const board = (slug: string, spaceId: string, fields: unknown[], statuses?: unknown) =>
    prisma.board.create({
      data: {
        organizationId: org.id, spaceId, slug: `${slug}-${suffix}`, name: slug, itemType: "studio-item", ownerId: users.member.id,
        schema: { fields } as object, ...(statuses ? { statuses: statuses as object } : {}),
      },
    });
  const A = await board("list-a", sA.id, [
    { key: "budget", label: "Budget", type: "NUMBER", position: 0 },
    { key: "secret", label: "Secret", type: "TEXT", position: 1 },
  ], STATUSES_A);
  const B = await board("list-b", sB.id, [
    { key: "budget", label: "Budget", type: "NUMBER", position: 0 },
    { key: "stage", label: "Stage", type: "TEXT", position: 1 },
  ]);
  const C = await board("list-c", sC.id, []);
  ids.A = A.id;
  ids.B = B.id;
  ids.C = C.id;
  const view = await prisma.view.create({ data: { boardId: A.id, name: "List", type: "TABLE", isShared: true, isDefault: true, ownerId: users.member.id, config: { groupBy: "status" } } });
  ids.viewA = view.id;

  const t = (boardId: string, title: string, extra: Record<string, unknown> = {}) =>
    createBoardItem({ organizationId: org.id, boardId, title, status: "TO_DO", actorId: users.member.id, ...extra } as never);
  ids.tA1 = (await t(A.id, "A one", { metadata: { budget: 100, secret: "home only", description: "shared body" } })).id;
  ids.tA1sub = (await t(A.id, "A one child", { parentItemId: ids.tA1 })).id;
  ids.tA2 = (await t(A.id, "A two")).id;
  ids.tB1 = (await t(B.id, "B one")).id;
  const otherBoard = await prisma.board.create({ data: { organizationId: org2.id, slug: `x-${suffix}`, name: "x", itemType: "studio-item" } });
  ids.otherBoard = otherBoard.id;
  ids.tOther = (await createBoardItem({ organizationId: org2.id, boardId: otherBoard.id, title: "elsewhere", actorId: users.stranger.id })).id;
}, 180_000);

afterAll(async () => {
  session.user = null;
  resetListLinksAvailability();
  // The throwaway orgs, and everything they own, go.
  for (const id of [ids.org, ids.org2].filter(Boolean)) {
    await prisma.emailLog.deleteMany({ where: { organizationId: id } }).catch(() => {});
    await prisma.trashItem.deleteMany({ where: { organizationId: id } }).catch(() => {});
    await prisma.item.deleteMany({ where: { organizationId: id } }).catch(() => {});
    await prisma.board.deleteMany({ where: { organizationId: id } }).catch(() => {});
    await prisma.space.deleteMany({ where: { organizationId: id } }).catch(() => {});
    await prisma.organization.delete({ where: { id } }).catch((e) => console.error("cleanup", e));
  }
  await prisma.$disconnect();
}, 180_000);

describe("tasks in more than one List", () => {
  it("adds a readable top-level task and answers every other task without revealing it", async () => {
    as("member");
    const r = await call(linksRoute.POST, `/api/boards/${ids.B}/links`, {
      method: "POST", params: { id: ids.B },
      body: { itemIds: [ids.tA1, ids.tA1sub, "nope", ids.tOther, ids.tB1] },
    });
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.json.results.map((x: any) => [x.itemId, x]));
    expect(byId[ids.tA1]).toMatchObject({ ok: true, created: true });
    expect(byId[ids.tA1sub]).toEqual({ itemId: ids.tA1sub, ok: false, reason: "is_subtask" });
    expect(byId.nope).toEqual({ itemId: "nope", ok: false, reason: "item_not_found" });
    expect(byId[ids.tOther]).toEqual({ itemId: ids.tOther, ok: false, reason: "item_not_found" });
    expect(byId[ids.tB1]).toEqual({ itemId: ids.tB1, ok: false, reason: "already_home" });
    const again = await call(linksRoute.POST, `/api/boards/${ids.B}/links`, { method: "POST", params: { id: ids.B }, body: { itemIds: [ids.tA1] } });
    expect(again.json.results[0]).toMatchObject({ ok: true, created: false });
  });

  it("refuses a task the caller cannot read as item_not_found, and a readable one whose home they cannot write", async () => {
    as("outsider");
    const r = await call(linksRoute.POST, `/api/boards/${ids.B}/links`, { method: "POST", params: { id: ids.B }, body: { itemIds: [ids.tA2, ids.tA1] } });
    const byId = Object.fromEntries(r.json.results.map((x: any) => [x.itemId, x]));
    expect(byId[ids.tA2].reason).toBe("item_not_found");
    // tA1 is readable to the outsider now (it is in List B), and still not
    // theirs to share: they cannot write its home.
    expect(byId[ids.tA1]).toEqual({ itemId: ids.tA1, ok: false, reason: "home_list_read_only" });
  });

  it("keeps the List read exactly as today without ?links=1, and unions with it", async () => {
    as("outsider");
    const plain = await call(boardItemsRoute.GET, `/api/boards/${ids.B}/items`, { params: { id: ids.B } });
    expect(plain.json.items.map((i: any) => i.id)).toEqual([ids.tB1]);
    const union = await call(boardItemsRoute.GET, `/api/boards/${ids.B}/items?links=1`, { params: { id: ids.B } });
    const got = Object.fromEntries(union.json.items.map((i: any) => [i.id, i]));
    expect(Object.keys(got).sort()).toEqual([ids.tA1, ids.tA1sub, ids.tB1].sort());
    const root = got[ids.tA1];
    expect(root.listLink).toMatchObject({ boardId: ids.B, rootId: ids.tA1, homeList: null, homeStatus: { value: "TO_DO", label: "To Do" } });
    expect(root.listLink.homeStatuses).toBeUndefined();
    expect(root.boardId).toBe(ids.B);
    expect(root.groupKey).toBeNull();
    expect(root.metadata).toEqual({ description: "shared body" });
    expect(JSON.stringify(union.json)).not.toContain("home only");
    expect(JSON.stringify(union.json)).not.toContain(ids.A);
    expect(got[ids.tA1sub].listLink).toEqual({ boardId: ids.B, position: null, rootId: ids.tA1 });
    expect(root.subtaskCount).toBe(1);
  });

  it("opens a shared task to a linked-only reader with the linked body and nothing of its home", async () => {
    as("outsider");
    const r = await call(itemRoute.GET, `/api/items/${ids.tA1}`, { params: { id: ids.tA1 } });
    expect(r.status).toBe(200);
    expect(r.json.decision).toMatchObject({ role: "VIEW", via: "linked-list" });
    expect(r.json.context).toMatchObject({ boardId: ids.B, kind: "linked", home: { readable: false } });
    expect(r.json.context.homeStatuses).toBeUndefined();
    expect(r.json.item.boardId).toBe(ids.B);
    expect(r.json.board.id).toBe(ids.B);
    expect(r.json.board.statuses).toEqual([{ value: "TO_DO", label: "To Do", color: "#98A2B3", group: "ACTIVE" }]);
    expect(r.json.breadcrumb).toEqual({ space: null, folder: null, list: { id: ids.B, slug: `list-b-${suffix}`, name: "list-b", readable: true } });
    expect(r.json.listOwner).toBeNull();
    expect(JSON.stringify(r.json)).not.toContain(ids.A);
    expect(JSON.stringify(r.json)).not.toContain("home only");
    const lists = await call(itemListsRoute.GET, `/api/items/${ids.tA1}/lists`, { params: { id: ids.tA1 } });
    expect(lists.json).toMatchObject({ home: { readable: false }, canShare: false, canUnshareAll: false });
    expect(lists.json.home.id).toBeUndefined();
    expect(lists.json.linked.map((l: any) => l.boardId)).toEqual([ids.B]);
    const subs = await call(subtasksRoute.GET, `/api/items/${ids.tA1}/subtasks`, { params: { id: ids.tA1 } });
    expect(subs.json.subtasks.map((s: any) => s.id)).toEqual([ids.tA1sub]);
    expect(await call(itemRoute.PATCH, `/api/items/${ids.tA1}`, { method: "PATCH", params: { id: ids.tA1 }, body: { title: "x" } })).toMatchObject({ status: 403 });
  });

  it("gives a home reader the home body unless they name the linked List", async () => {
    as("member");
    const home = await call(itemRoute.GET, `/api/items/${ids.tA1}`, { params: { id: ids.tA1 } });
    expect(home.json.context).toMatchObject({ kind: "home", boardId: ids.A, home: { readable: true, id: ids.A } });
    expect(home.json.item.metadata).toMatchObject({ budget: 100, secret: "home only" });
    const linked = await call(itemRoute.GET, `/api/items/${ids.tA1}?list=${ids.B}`, { params: { id: ids.tA1 } });
    expect(linked.json.context.kind).toBe("linked");
    expect(linked.json.context.homeStatuses?.map((s: any) => s.value)).toEqual(["TO_DO", "SHIPPED"]);
    const other = await call(itemRoute.GET, `/api/items/${ids.tA1}?list=${ids.C}`, { params: { id: ids.tA1 } });
    expect(other.json.context.kind).toBe("home");
    const lists = await call(itemListsRoute.GET, `/api/items/${ids.tA1}/lists`, { params: { id: ids.tA1 } });
    expect(lists.json).toMatchObject({ home: { id: ids.A, readable: true }, canShare: true, canUnshareAll: true });
  });

  it("writes a secondary List's values into its own namespace and refuses what is not that List's", async () => {
    as("member");
    const ok = await call(itemRoute.PATCH, `/api/items/${ids.tA1}`, {
      method: "PATCH", params: { id: ids.tA1 },
      body: { contextBoardId: ids.B, metadataPatch: { budget: 7, stage: "review", description: "edited body" } },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.item.metadata).toMatchObject({ budget: 7, stage: "review", description: "edited body" });
    const stored = (await prisma.item.findUnique({ where: { id: ids.tA1 }, select: { metadata: true } }))!.metadata as any;
    expect(stored.budget).toBe(100);
    expect(stored.description).toBe("edited body");
    expect(stored.$lists[ids.B]).toEqual({ budget: 7, stage: "review" });
    const bad = async (body: unknown) => (await call(itemRoute.PATCH, `/api/items/${ids.tA1}`, { method: "PATCH", params: { id: ids.tA1 }, body })).json;
    expect(await bad({ contextBoardId: ids.B, metadataPatch: { secret: "x" } })).toEqual({ error: "unknown_field", key: "secret" });
    expect(await bad({ metadataPatch: { $lists: {} } })).toEqual({ error: "reserved_key", key: "$lists" });
    expect(await bad({ contextBoardId: ids.C, title: "x" })).toEqual({ error: "invalid_context" });
    expect(await bad({ contextBoardId: ids.B, boardId: ids.C })).toEqual({ error: "use_list_link" });
    expect(await bad({ contextBoardId: ids.B, metadata: {} })).toEqual({ error: "use_metadata_patch" });
    // A whole-blob save from home keeps List B's namespace.
    await call(itemRoute.PATCH, `/api/items/${ids.tA1}`, { method: "PATCH", params: { id: ids.tA1 }, body: { metadata: { budget: 101, secret: "home only", description: "edited body" } } });
    const after = (await prisma.item.findUnique({ where: { id: ids.tA1 }, select: { metadata: true } }))!.metadata as any;
    expect(after.budget).toBe(101);
    expect(after.$lists[ids.B]).toEqual({ budget: 7, stage: "review" });
  });

  it("holds a linked task to its HOME status set, and leaves an unlinked task as today", async () => {
    as("member");
    const refused = await call(itemRoute.PATCH, `/api/items/${ids.tA1}`, { method: "PATCH", params: { id: ids.tA1 }, body: { status: "IN_PROGRESS" } });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ error: "invalid_status", reason: "not_in_home_list" });
    expect((await call(itemRoute.PATCH, `/api/items/${ids.tA1}`, { method: "PATCH", params: { id: ids.tA1 }, body: { status: "SHIPPED" } })).status).toBe(200);
    expect((await call(itemRoute.PATCH, `/api/items/${ids.tA2}`, { method: "PATCH", params: { id: ids.tA2 }, body: { status: "WHATEVER" } })).status).toBe(200);
    const bulk = await call(bulkRoute.POST, `/api/items/bulk`, { method: "POST", body: { ids: [ids.tA1, ids.tA2], patch: { status: "NOPE" } } });
    expect(bulk.json.results).toEqual([{ id: ids.tA1, ok: false, reason: "invalid_status" }, { id: ids.tA2, ok: true }]);
    const inB = await call(bulkRoute.POST, `/api/items/bulk`, { method: "POST", body: { ids: [ids.tA1], patch: { archive: true }, contextBoardId: ids.B } });
    expect(inB.json.results).toEqual([{ id: ids.tA1, ok: false, reason: "use_list_link" }]);
    expect((await call(itemRoute.DELETE, `/api/items/${ids.tA1}?list=${ids.B}`, { method: "DELETE", params: { id: ids.tA1 } })).json).toEqual({ error: "use_list_link", hint: "remove_from_list" });
  });

  it("counts shared tasks into their List, done by the home set", async () => {
    as("member");
    const rows = await listBoardItems(ids.B, { view: { viewer: lv("member"), contextBoardId: ids.B }, includeLinked: true });
    const shared = rows.find((r) => r.id === ids.tA1);
    expect(shared?.listLink?.homeStatus?.group).toBe("DONE");
    // A reader of the home is told the home and its status set; the row keeps its real home id.
    expect(shared?.listLink?.homeList).toEqual({ id: ids.A, slug: `list-a-${suffix}`, name: "list-a" });
    expect(shared?.listLink?.homeStatuses?.map((x) => x.value)).toEqual(["TO_DO", "SHIPPED"]);
    expect(shared?.boardId).toBe(ids.A);
    // With no viewer the row is stripped of every reserved key and connect value.
    const bare = await listBoardItems(ids.B, {});
    expect(bare.every((r) => !JSON.stringify(r.metadata).includes("$lists"))).toBe(true);
  });

  it("reorders a link without touching the home order, and moves it between secondary Lists", async () => {
    as("member");
    const before = (await prisma.item.findUnique({ where: { id: ids.tA1 }, select: { position: true } }))!.position;
    const r = await call(linkItemRoute.PATCH, `/api/boards/${ids.B}/links/${ids.tA1}`, { method: "PATCH", params: { id: ids.B, itemId: ids.tA1 }, body: { position: 5 } });
    expect(r.json).toEqual({ ok: true, position: 5 });
    expect((await prisma.item.findUnique({ where: { id: ids.tA1 }, select: { position: true } }))!.position).toBe(before);
    const moved = await call(linkItemRoute.PATCH, `/api/boards/${ids.B}/links/${ids.tA1}`, { method: "PATCH", params: { id: ids.B, itemId: ids.tA1 }, body: { moveToBoardId: ids.C } });
    expect(moved.json.ok).toBe(true);
    const links = await prisma.itemListLink.findMany({ where: { itemId: ids.tA1 }, select: { boardId: true } });
    expect(links.map((l) => l.boardId)).toEqual([ids.C]);
    expect((await prisma.item.findUnique({ where: { id: ids.tA1 }, select: { boardId: true } }))!.boardId).toBe(ids.A);
    // Back into B for the rest of the run.
    await call(linkItemRoute.PATCH, `/api/boards/${ids.C}/links/${ids.tA1}`, { method: "PATCH", params: { id: ids.C, itemId: ids.tA1 }, body: { moveToBoardId: ids.B } });
  });

  it("answers a List the caller cannot read with 404 whatever the link state", async () => {
    as("outsider");
    await prisma.itemListLink.create({ data: { itemId: ids.tA2, boardId: ids.C, position: 1 } });
    expect((await call(linkItemRoute.DELETE, `/api/boards/${ids.C}/links/${ids.tA2}`, { method: "DELETE", params: { id: ids.C, itemId: ids.tA2 } })).status).toBe(404);
    expect((await call(linkItemRoute.DELETE, `/api/boards/${ids.C}/links/nothing`, { method: "DELETE", params: { id: ids.C, itemId: "nothing" } })).status).toBe(404);
    as("member");
    expect((await call(linkItemRoute.DELETE, `/api/boards/${ids.C}/links/${ids.tA2}`, { method: "DELETE", params: { id: ids.C, itemId: ids.tA2 } })).json).toEqual({ ok: true });
    expect(await prisma.item.findUnique({ where: { id: ids.tA2 }, select: { id: true } })).not.toBeNull();
  });

  it("redacts the activity a linked-only reader sees", async () => {
    as("outsider");
    const r = await call(activityRoute.GET, `/api/items/${ids.tA1}/activity`, { params: { id: ids.tA1 } });
    expect(r.status).toBe(200);
    for (const row of r.json.activity.filter((a: any) => a.action === "FIELDS_UPDATED")) {
      for (const k of row.meta.fields) expect(["description", "checklist", "timeEstimate", "kraId", "kpiId", "watchers", "unwatchers", "followers"]).toContain(k);
      expect(Object.keys(row.meta.listFields ?? {}).every((k) => k === ids.B)).toBe(true);
    }
  });

  it("copies a duplicate's links only where the duplicator may write", async () => {
    as("member");
    const r = await call(duplicateRoute.POST, `/api/items/${ids.tA1}/duplicate`, { method: "POST", params: { id: ids.tA1 } });
    expect(r.status).toBe(201);
    const copyId = r.json.item.id as string;
    const links = await prisma.itemListLink.findMany({ where: { itemId: copyId }, select: { boardId: true } });
    expect(links.map((l) => l.boardId)).toEqual([ids.B]);
    const md = (await prisma.item.findUnique({ where: { id: copyId }, select: { metadata: true } }))!.metadata as any;
    expect(Object.keys(md.$lists ?? {})).toEqual([ids.B]);
    expect(JSON.stringify(r.json.item.metadata)).not.toContain("$lists");
    ids.copy = copyId;
  });

  it("puts a trashed task's links back when it is restored", async () => {
    await moveToTrash("item", ids.copy, { organizationId: ids.org, userId: users.member.id });
    expect(await prisma.itemListLink.count({ where: { itemId: ids.copy } })).toBe(0);
    const trash = await prisma.trashItem.findFirst({ where: { organizationId: ids.org, entityType: "item", entityId: ids.copy } });
    expect(((trash!.snapshot as any).children.listLinks ?? []).map((l: any) => l.boardId)).toEqual([ids.B]);
    await restoreFromTrash({ id: trash!.id, entityType: trash!.entityType, snapshot: trash!.snapshot });
    expect((await prisma.itemListLink.findMany({ where: { itemId: ids.copy } })).map((l) => l.boardId)).toEqual([ids.B]);
  });

  it("re-homes a task into a List it was linked into: the link goes and the namespaces swap", async () => {
    as("member");
    const r = await call(itemRoute.PATCH, `/api/items/${ids.tA1}`, { method: "PATCH", params: { id: ids.tA1 }, body: { boardId: ids.B } });
    expect(r.status).toBe(200);
    const row = (await prisma.item.findUnique({ where: { id: ids.tA1 }, select: { boardId: true, metadata: true } }))!;
    expect(row.boardId).toBe(ids.B);
    const md = row.metadata as any;
    expect(md.budget).toBe(7);
    expect(md.stage).toBe("review");
    expect(md.$lists[ids.A]).toMatchObject({ budget: 101, secret: "home only" });
    expect(await prisma.itemListLink.count({ where: { itemId: ids.tA1, boardId: ids.B } })).toBe(0);
    // The subtask followed its parent.
    expect((await prisma.item.findUnique({ where: { id: ids.tA1sub }, select: { boardId: true } }))!.boardId).toBe(ids.B);
  });

  it("degrades to today's home-only read while the link table is absent", async () => {
    markListLinksMissing();
    try {
      as("member");
      const rows = await listBoardItems(ids.B, { view: { viewer: lv("member"), contextBoardId: ids.B }, includeLinked: true });
      expect(rows.every((r) => !r.listLink)).toBe(true);
      const post = await call(linksRoute.POST, `/api/boards/${ids.B}/links`, { method: "POST", params: { id: ids.B }, body: { itemIds: [ids.tA2] } });
      expect(post.status).toBe(503);
      expect(post.json).toEqual({ error: "needs_database_update", file: "prisma/sql/2026-09-24-phase5b-data.sql" });
    } finally {
      resetListLinksAvailability();
    }
  });
});

describe("connect and mirror columns", () => {
  it("creates a connect field over readable task Lists only, and a mirror over it", async () => {
    as("member");
    const c = await call(fieldsRoute.POST, `/api/boards/${ids.A}/fields`, { method: "POST", params: { id: ids.A }, body: { label: "Depends on", type: "RELATIONSHIP", options: { targetBoardIds: [ids.B] } } });
    expect(c.status).toBe(201);
    ids.connectKey = c.json.field.key;
    const bad = await call(fieldsRoute.POST, `/api/boards/${ids.A}/fields`, { method: "POST", params: { id: ids.A }, body: { label: "X", type: "RELATIONSHIP", options: { targetBoardIds: [ids.otherBoard] } } });
    expect(bad.json).toEqual({ error: "invalid_options", issue: "unknown_target_list" });
    const m = await call(fieldsRoute.POST, `/api/boards/${ids.A}/fields`, { method: "POST", params: { id: ids.A }, body: { label: "Their status", type: "MIRROR", options: { linkFieldKey: ids.connectKey, lookupFieldKeys: { [ids.B]: "__builtin_status" } } } });
    expect(m.status).toBe(201);
    ids.mirrorKey = m.json.field.key;
    const inUse = await call(fieldKeyRoute.DELETE, `/api/boards/${ids.A}/fields/${ids.connectKey}`, { method: "DELETE", params: { id: ids.A, key: ids.connectKey } });
    expect(inUse.status).toBe(409);
    expect(inUse.json).toEqual({ error: "field_in_use", usedBy: [ids.mirrorKey] });
    const mode = await call(fieldKeyRoute.PATCH, `/api/boards/${ids.A}/fields/${ids.connectKey}`, { method: "PATCH", params: { id: ids.A, key: ids.connectKey }, body: { options: { kind: "DOC" } } });
    expect(mode.json).toEqual({ error: "connect_mode_immutable" });
  });

  it("validates a connect value on create and reads connections and mirrors back", async () => {
    as("member");
    const refused = await call(boardItemsRoute.POST, `/api/boards/${ids.A}/items`, { method: "POST", params: { id: ids.A }, body: { title: "c", metadata: { [ids.connectKey]: [ids.tOther] } } });
    expect(refused.json).toEqual({ error: "invalid_connection", key: ids.connectKey });
    const mirrorWrite = await call(boardItemsRoute.POST, `/api/boards/${ids.A}/items`, { method: "POST", params: { id: ids.A }, body: { title: "c", metadata: { [ids.mirrorKey]: "x" } } });
    expect(mirrorWrite.json).toEqual({ error: "read_only_field", key: ids.mirrorKey });
    const ok = await call(boardItemsRoute.POST, `/api/boards/${ids.A}/items`, { method: "POST", params: { id: ids.A }, body: { title: "connected", metadata: { [ids.connectKey]: [ids.tB1] } } });
    expect(ok.status).toBe(201);
    ids.connected = ok.json.item.id;
    expect(ok.json.item.connections[ids.connectKey].map((x: any) => x.id)).toEqual([ids.tB1]);
    expect(ok.json.item.mirrors[ids.mirrorKey]).toEqual({ values: ["To Do"] });
    const stored = (await prisma.item.findUnique({ where: { id: ids.connected }, select: { metadata: true } }))!.metadata as any;
    expect(stored.$connectKeys).toEqual([ids.connectKey]);
    const cands = await call(candidatesRoute.GET, `/api/boards/${ids.A}/fields/${ids.connectKey}/candidates?q=one`, { params: { id: ids.A, key: ids.connectKey } });
    expect(cands.json.items.map((x: any) => x.id)).toContain(ids.tB1);
    expect(cands.json.items.every((x: any) => x.list.id === ids.B)).toBe(true);
  });

  it("keeps connections the writer cannot see when they save", async () => {
    // A connection to a task in List C, which the outsider cannot read.
    as("member");
    const cTask = await createBoardItem({ organizationId: ids.org, boardId: ids.C, title: "in C", actorId: users.member.id });
    await prisma.item.update({ where: { id: ids.connected }, data: { metadata: { [ids.connectKey]: [ids.tB1, cTask.id], $connectKeys: [ids.connectKey] } } });
    const got = await call(itemRoute.GET, `/api/items/${ids.connected}`, { params: { id: ids.connected } });
    expect(got.json.item.metadata[ids.connectKey]).toEqual([ids.tB1, cTask.id]);
    // Hand the task to the outsider so they may edit it, then save a smaller value.
    await prisma.item.update({ where: { id: ids.connected }, data: { assigneeIds: [users.outsider.id], ownerId: users.outsider.id } });
    as("outsider");
    const seen = await call(itemRoute.GET, `/api/items/${ids.connected}`, { params: { id: ids.connected } });
    expect(seen.json.item.metadata[ids.connectKey]).toEqual([ids.tB1]);
    await call(itemRoute.PATCH, `/api/items/${ids.connected}`, { method: "PATCH", params: { id: ids.connected }, body: { metadataPatch: { [ids.connectKey]: [] } } });
    const after = (await prisma.item.findUnique({ where: { id: ids.connected }, select: { metadata: true } }))!.metadata as any;
    expect(after[ids.connectKey]).toEqual([cTask.id]);
  });
});

describe("List comfort", () => {
  it("stores defaults and colour rules in settings, merged, and applies defaults only to absent keys", async () => {
    as("member");
    const bad = await call(boardRoute.PATCH, `/api/boards/${ids.A}`, { method: "PATCH", params: { id: ids.A }, body: { defaults: { status: "GONE" } } });
    expect(bad.json).toEqual({ error: "invalid_defaults", issues: ["status_not_in_list"] });
    const ok = await call(boardRoute.PATCH, `/api/boards/${ids.A}`, { method: "PATCH", params: { id: ids.A }, body: { defaults: { priority: "HIGH", fields: { budget: 5 } } } });
    expect(ok.status).toBe(200);
    const rules = [{ id: "r1", field: "status", operator: "is", value: "SHIPPED", color: "green" }];
    expect((await call(boardRoute.PATCH, `/api/boards/${ids.A}`, { method: "PATCH", params: { id: ids.A }, body: { rowColorRules: rules } })).status).toBe(200);
    const settings = await call(settingsRoute.GET, `/api/boards/${ids.A}/settings`, { params: { id: ids.A } });
    expect(settings.json).toEqual({ defaults: { priority: "HIGH", fields: { budget: 5 }, itemTypeId: null }, rowColorRules: rules });
    const withDefaults = await call(boardItemsRoute.POST, `/api/boards/${ids.A}/items`, { method: "POST", params: { id: ids.A }, body: { title: "defaulted" } });
    expect(withDefaults.json.item.priority).toBe("HIGH");
    expect(withDefaults.json.item.metadata.budget).toBe(5);
    const sentNull = await call(boardItemsRoute.POST, `/api/boards/${ids.A}/items`, { method: "POST", params: { id: ids.A }, body: { title: "explicit", priority: null, metadata: { budget: 9 } } });
    expect(sentNull.json.item.priority).toBeNull();
    expect(sentNull.json.item.metadata.budget).toBe(9);
    const rowsCount = await prisma.item.count({ where: { boardId: ids.A, priority: "HIGH" } });
    expect(rowsCount).toBe(1);
  });

  it("merges view config patches on the locked row and refuses a bad comfort value", async () => {
    as("member");
    const a = await call(viewRoute.PATCH, `/api/boards/${ids.A}/views/${ids.viewA}`, { method: "PATCH", params: { id: ids.A, viewId: ids.viewA }, body: { configPatch: { rowHeight: "compact" } } });
    expect(a.status).toBe(200);
    await call(viewRoute.PATCH, `/api/boards/${ids.A}/views/${ids.viewA}`, { method: "PATCH", params: { id: ids.A, viewId: ids.viewA }, body: { configPatch: { pinnedColumns: ["__name"] } } });
    const v = await prisma.view.findUnique({ where: { id: ids.viewA }, select: { config: true } });
    expect(v!.config).toEqual({ groupBy: "status", rowHeight: "compact", pinnedColumns: ["__name"] });
    await call(viewRoute.PATCH, `/api/boards/${ids.A}/views/${ids.viewA}`, { method: "PATCH", params: { id: ids.A, viewId: ids.viewA }, body: { configPatch: { rowHeight: null } } });
    expect((await prisma.view.findUnique({ where: { id: ids.viewA }, select: { config: true } }))!.config).toEqual({ groupBy: "status", pinnedColumns: ["__name"] });
    const bad = await call(viewRoute.PATCH, `/api/boards/${ids.A}/views/${ids.viewA}`, { method: "PATCH", params: { id: ids.A, viewId: ids.viewA }, body: { configPatch: { rowHeight: "huge" } } });
    expect(bad.json).toEqual({ error: "invalid_view_config", key: "rowHeight" });
  });
});

describe("dashboards", () => {
  it("creates, lists, reads, versions and computes under each viewer", async () => {
    as("member");
    const layout = { x: 0, y: 0, w: 4, h: 4 };
    const created = await call(dashboardsRoute.POST, `/api/dashboards`, {
      method: "POST",
      body: {
        name: "Ops",
        widgets: [
          { id: "count-a", kind: "stat", title: "A tasks", source: { kind: "lists", listIds: [ids.A] }, layout },
          { id: "by-status-b", kind: "chart", title: "B by status", source: { kind: "lists", listIds: [ids.B] }, groupBy: "status", layout },
          { id: "notes", kind: "notes", title: "Read me", text: "hello", layout },
        ],
      },
    });
    expect(created.status).toBe(201);
    const id = created.json.dashboard.id as string;
    ids.dashboard = id;
    const listed = await call(dashboardsRoute.GET, `/api/dashboards`);
    expect(listed.json.dashboards.find((d: any) => d.id === id)).toMatchObject({ widgetCount: 3, canEdit: true });

    as("outsider");
    const read = await call(dashboardRoute.GET, `/api/dashboards/${id}`, { params: { id } });
    expect(read.json.canEdit).toBe(false);
    expect(read.json.dashboard.widgets[0]).toEqual({ id: "count-a", kind: "hidden", layout });
    expect(JSON.stringify(read.json)).not.toContain("A tasks");
    const data = await call(dashboardDataRoute.GET, `/api/dashboards/${id}/data`, { params: { id } });
    expect(data.json.widgets["count-a"]).toEqual({ kind: "hidden" });
    expect(data.json.widgets["by-status-b"].kind).toBe("chart");
    expect(data.json.widgets.notes).toEqual({ kind: "notes" });
    expect((await call(dashboardRoute.PATCH, `/api/dashboards/${id}`, { method: "PATCH", params: { id }, body: { name: "x" } })).status).toBe(403);

    as("member");
    const mine = await call(dashboardDataRoute.GET, `/api/dashboards/${id}/data`, { params: { id } });
    expect(mine.json.widgets["count-a"].kind).toBe("stat");
    expect(mine.json.widgets["count-a"].value).toBeGreaterThan(0);
    expect((await call(dashboardRoute.PATCH, `/api/dashboards/${id}`, { method: "PATCH", params: { id }, body: { name: "x" } })).json).toEqual({ error: "version_required" });
    expect((await call(dashboardRoute.PATCH, `/api/dashboards/${id}`, { method: "PATCH", params: { id }, body: { name: "x", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" } })).status).toBe(409);
    const v = read.json.dashboard.updatedAt as string;
    const dropped = await call(dashboardRoute.PATCH, `/api/dashboards/${id}`, { method: "PATCH", params: { id }, body: { expectedUpdatedAt: v, widgets: [] } });
    expect(dropped.json).toEqual({ error: "widget_missing", ids: ["count-a", "by-status-b", "notes"] });
    const renamed = await call(dashboardRoute.PATCH, `/api/dashboards/${id}`, { method: "PATCH", params: { id }, body: { expectedUpdatedAt: v, name: "Ops two" } });
    expect(renamed.json.dashboard.name).toBe("Ops two");
  });
});

describe("scheduled email reports", () => {
  it("refuses an address, sends each member their own copy once per due instant, and lets a recipient leave", async () => {
    as("member");
    const bad = await call(schedulesRoute.POST, `/api/report-schedules`, { method: "POST", body: { targetKind: "dashboard", targetId: ids.dashboard, cadence: "daily", timeOfDay: "09:00", timezone: "UTC", recipientUserIds: ["someone@example.com"] } });
    expect(bad.status).toBe(400);
    const unknown = await call(schedulesRoute.POST, `/api/report-schedules`, { method: "POST", body: { targetKind: "dashboard", targetId: ids.dashboard, cadence: "daily", timeOfDay: "09:00", timezone: "UTC", recipientUserIds: [users.stranger.id] } });
    expect(unknown.json).toEqual({ error: "invalid_recipients" });
    const created = await call(schedulesRoute.POST, `/api/report-schedules`, { method: "POST", body: { targetKind: "dashboard", targetId: ids.dashboard, cadence: "daily", timeOfDay: "09:00", timezone: "Asia/Kolkata", recipientUserIds: [users.member.id, users.outsider.id] } });
    expect(created.status).toBe(201);
    const sid = created.json.schedule.id as string;
    ids.schedule = sid;
    expect(created.json.schedule.cadenceText).toBe("Every day at 09:00 (Asia/Kolkata)");

    const due = new Date(Date.now() - 60_000);
    await prisma.reportSchedule.update({ where: { id: sid }, data: { nextRunAt: due } });
    const first = await runDueReports(new Date(), { limit: 25, budgetMs: 60_000 });
    const second = await runDueReports(new Date(), { limit: 25, budgetMs: 60_000 });
    expect(first).toMatchObject({ ran: true });
    expect("queued" in second ? second.queued : -1).toBe(0);
    const emails = await prisma.emailLog.findMany({ where: { organizationId: ids.org, template: "report_schedule" } });
    expect(emails.map((e) => e.to).sort()).toEqual([users.member.email, users.outsider.email].sort());
    const outsiderCopy = emails.find((e) => e.to === users.outsider.email)!;
    expect(outsiderCopy.html).not.toContain("A tasks");
    const memberCopy = emails.find((e) => e.to === users.member.email)!;
    expect(memberCopy.html).toContain("A tasks");
    const row = await prisma.reportSchedule.findUnique({ where: { id: sid } });
    expect(row!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect((row!.runLog as any[])[0]).toMatchObject({ outcome: "sent", sent: 2, skippedNoAccess: 0, skippedInactive: 0 });

    as("outsider");
    expect((await call(unsubscribeRoute.DELETE, `/api/report-schedules/${sid}/recipients/me`, { method: "DELETE", params: { id: sid } })).json).toEqual({ ok: true });
    expect((await call(unsubscribeRoute.DELETE, `/api/report-schedules/${sid}/recipients/me`, { method: "DELETE", params: { id: sid } })).status).toBe(404);
    expect((await call(scheduleRoute.GET, `/api/report-schedules/${sid}`, { params: { id: sid } })).status).toBe(404);

    as("member");
    const stale = await call(scheduleRoute.PATCH, `/api/report-schedules/${sid}`, { method: "PATCH", params: { id: sid }, body: { expectedUpdatedAt: "2000-01-01T00:00:00.000Z", recipientUserIds: [users.member.id, users.outsider.id] } });
    expect(stale.status).toBe(409);
    expect((await call(scheduleRoute.PATCH, `/api/report-schedules/${sid}`, { method: "PATCH", params: { id: sid }, body: { expectedUpdatedAt: row!.updatedAt.toISOString(), targetId: "x" } })).json).toEqual({ error: "target_immutable" });

    const noSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect((await call(cronRoute.POST, `/api/cron/report-schedules`, { method: "POST" })).status).toBe(503);
    process.env.CRON_SECRET = "s3cret";
    expect((await call(cronRoute.POST, `/api/cron/report-schedules`, { method: "POST", headers: { "x-cron-secret": "wrong" } })).status).toBe(403);
    expect((await call(cronRoute.POST, `/api/cron/report-schedules`, { method: "POST", headers: { "x-cron-secret": "s3cret" } })).json).toMatchObject({ ran: true, queued: 0 });
    if (noSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = noSecret;
  });
});

describe("the union at the multi-List read sites", () => {
  it("shows a shared task in Everything under the readable List, never its home", async () => {
    as("outsider");
    const r = await call(everythingRoute.GET, `/api/me/everything?done=1`);
    expect(r.status).toBe(200);
    const copy = r.json.rows.find((x: any) => x.id === ids.copy);
    expect(copy).toBeTruthy();
    expect(copy.board.id).toBe(ids.B);
    expect(copy.canEdit).toBe(false);
    expect(r.json.facets.lists.map((l: any) => l.id)).toEqual([ids.B]);
    expect(Object.keys(r.json.listStatuses)).not.toContain(ids.A);
    expect(JSON.stringify(r.json)).not.toContain(ids.A);
  });

  it("counts what a List shares in and out, and only through readable Lists", async () => {
    as("outsider");
    expect((await call(linksRoute.GET, `/api/boards/${ids.B}/links`, { params: { id: ids.B } })).json).toEqual({ sharedIn: 1, sharedOut: 0 });
    as("member");
    expect((await call(linksRoute.GET, `/api/boards/${ids.A}/links`, { params: { id: ids.A } })).json).toEqual({ sharedIn: 0, sharedOut: 1 });
  });

  it("lets only FULL pull a task out of every List, and never touches the task", async () => {
    as("outsider");
    expect((await call(itemListsRoute.DELETE, `/api/items/${ids.copy}/lists`, { method: "DELETE", params: { id: ids.copy } })).json).toEqual({ error: "no_access", reason: "role_too_low" });
    as("member");
    expect((await call(itemListsRoute.DELETE, `/api/items/${ids.copy}/lists`, { method: "DELETE", params: { id: ids.copy } })).json).toEqual({ ok: true });
    expect(await prisma.itemListLink.count({ where: { itemId: ids.copy } })).toBe(0);
    expect(await prisma.item.count({ where: { id: ids.copy } })).toBe(1);
  });

  it("parks a link with its other side in Trash and brings it back when that side returns", async () => {
    const E = await prisma.board.create({ data: { organizationId: ids.org, spaceId: ids.spaceB, slug: `list-e-${suffix}`, name: "list-e", itemType: "studio-item", ownerId: users.member.id } });
    await prisma.itemListLink.create({ data: { itemId: ids.tA2, boardId: E.id, position: 1 } });
    const ctx = { organizationId: ids.org, userId: users.member.id };
    await moveToTrash("board", E.id, ctx);
    await moveToTrash("item", ids.tA2, ctx);
    const boardTrash = await prisma.trashItem.findFirst({ where: { organizationId: ids.org, entityType: "board", entityId: E.id } });
    expect(((boardTrash!.snapshot as any).children.listLinks ?? []).map((l: any) => l.itemId)).toEqual([ids.tA2]);
    await restoreFromTrash({ id: boardTrash!.id, entityType: "board", snapshot: boardTrash!.snapshot });
    const itemTrash = await prisma.trashItem.findFirst({ where: { organizationId: ids.org, entityType: "item", entityId: ids.tA2 } });
    expect(((itemTrash!.snapshot as any).children.listLinks ?? []).map((l: any) => l.boardId)).toEqual([E.id]);
    await restoreFromTrash({ id: itemTrash!.id, entityType: "item", snapshot: itemTrash!.snapshot });
    expect(await prisma.itemListLink.count({ where: { itemId: ids.tA2, boardId: E.id } })).toBe(1);
  });

  it("previews a card under the caller exactly as the saved card would compute", async () => {
    as("outsider");
    const layout = { x: 0, y: 0, w: 4, h: 4 };
    const hidden = await call(previewWidgetRoute.POST, `/api/dashboards/widget-preview`, { method: "POST", body: { widget: { id: "p", kind: "stat", title: "A", source: { kind: "lists", listIds: [ids.A] }, layout } } });
    expect(hidden.json).toEqual({ result: { kind: "hidden" } });
    const shown = await call(previewWidgetRoute.POST, `/api/dashboards/widget-preview`, { method: "POST", body: { widget: { id: "p", kind: "stat", title: "B", source: { kind: "lists", listIds: [ids.B] }, layout } } });
    expect(shown.json.result.kind).toBe("stat");
    const pass = await call(previewWidgetRoute.POST, `/api/dashboards/widget-preview`, { method: "POST", body: { widget: { id: "p", kind: "passthrough" } } });
    expect(pass.json).toEqual({ error: "unknown_widget", id: "p" });
  });

  it("lists the reports a member receives and previews only their own copy", async () => {
    as("member");
    const got = await call(schedulesRoute.GET, `/api/report-schedules?received=1`);
    const mine = got.json.schedules.find((x: any) => x.id === ids.schedule);
    expect(mine).toMatchObject({ targetKind: "dashboard", targetName: "Ops two" });
    expect(mine.recipients).toBeUndefined();
    const preview = await call(schedulePreviewRoute.GET, `/api/report-schedules/${ids.schedule}/preview`, { params: { id: ids.schedule } });
    expect(preview.json.subject).toBe("Dashboard report: Ops two");
    as("outsider");
    expect((await call(schedulePreviewRoute.GET, `/api/report-schedules/${ids.schedule}/preview`, { params: { id: ids.schedule } })).status).toBe(404);
  });
});

// ── Phase 5b review fixes ────────────────────────────────────────────
// Each test builds its own Lists and tasks, so none depends on the order of
// the blocks above.
describe("review fixes", () => {
  let n = 0;
  const list = async (spaceId: string, fields: unknown[] = [], name = "fx") => {
    n += 1;
    return prisma.board.create({
      data: { organizationId: ids.org, spaceId, slug: `${name}-${n}-${suffix}`, name: `${name}-${n}`, itemType: "studio-item", ownerId: users.member.id, schema: { fields } as object },
    });
  };
  const task = (boardId: string, title: string, extra: Record<string, unknown> = {}) =>
    createBoardItem({ organizationId: ids.org, boardId, title, status: "TO_DO", actorId: users.member.id, ...extra } as never);
  const link = (itemId: string, boardId: string) => prisma.itemListLink.create({ data: { itemId, boardId, position: 1, addedById: users.member.id } });
  const md = async (id: string) => (await prisma.item.findUnique({ where: { id }, select: { metadata: true } }))!.metadata as any;
  const budget = { key: "budget", label: "Budget", type: "NUMBER", position: 0 };
  const stage = { key: "stage", label: "Stage", type: "TEXT", position: 1 };

  it("(1) adds a burst of tasks to Lists at once without exhausting the pool", async () => {
    as("member");
    const lists = await Promise.all(Array.from({ length: 12 }, () => list(ids.spaceA)));
    const tasks = await Promise.all(lists.map((_, i) => task(ids.A, `burst ${i}`)));
    const started = Date.now();
    const res = await Promise.all(lists.map((l, i) => call(linksRoute.POST, `/api/boards/${l.id}/links`, { method: "POST", params: { id: l.id }, body: { itemIds: [tasks[i].id] } })));
    expect(res.map((r) => r.status)).toEqual(lists.map(() => 200));
    expect(res.every((r) => r.json.results[0].ok && r.json.results[0].created)).toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await prisma.itemListLink.count({ where: { boardId: { in: lists.map((l) => l.id) } } })).toBe(12);
    // One task into twelve Lists at once: serialised on the task row, all land.
    const one = await task(ids.A, "one into many");
    const many = await Promise.all(lists.map((l) => call(linksRoute.POST, `/api/boards/${l.id}/links`, { method: "POST", params: { id: l.id }, body: { itemIds: [one.id] } })));
    expect(many.every((r) => r.status === 200 && r.json.results[0].ok)).toBe(true);
    expect(await prisma.itemListLink.count({ where: { itemId: one.id } })).toBe(12);
  }, 60_000);

  it("(2) creates a burst of tasks into one List on a cold process, every one saved", async () => {
    const l = await list(ids.spaceA);
    resetListLinksAvailability();
    const started = Date.now();
    const made = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => task(l.id, `cold ${i}`)));
    expect(made.filter((m) => m.status === "rejected")).toEqual([]);
    expect(Date.now() - started).toBeLessThan(10_000);
    const positions = (await prisma.item.findMany({ where: { boardId: l.id }, select: { position: true } })).map((r) => r.position);
    expect(new Set(positions).size).toBe(12);
  }, 60_000);

  it("(2b) saves a burst of connect writes, and two writers of one task keep both keys", async () => {
    as("member");
    const q = await list(ids.spaceA, [budget]);
    const target = await task(q.id, "target");
    const p = await list(ids.spaceA, [{ key: "rel", label: "Rel", type: "RELATIONSHIP", position: 0, options: { targetBoardIds: [q.id] } }, budget, stage]);
    const tasks = await Promise.all(Array.from({ length: 12 }, (_, i) => task(p.id, `w ${i}`)));
    const res = await Promise.all(tasks.map((t) => call(itemRoute.PATCH, `/api/items/${t.id}`, { method: "PATCH", params: { id: t.id }, body: { metadataPatch: { rel: [target.id] } } })));
    expect(res.map((r) => r.status)).toEqual(tasks.map(() => 200));
    for (const t of tasks) expect((await md(t.id)).rel).toEqual([target.id]);
    const both = await Promise.all([
      call(itemRoute.PATCH, `/api/items/${tasks[0].id}`, { method: "PATCH", params: { id: tasks[0].id }, body: { metadataPatch: { budget: 5 } } }),
      call(itemRoute.PATCH, `/api/items/${tasks[0].id}`, { method: "PATCH", params: { id: tasks[0].id }, body: { metadataPatch: { stage: "s" } } }),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(await md(tasks[0].id)).toMatchObject({ rel: [target.id], budget: 5, stage: "s" });
  }, 60_000);

  it("(3) a move after a link was removed keeps the value the user just wrote", async () => {
    as("member");
    const X = await list(ids.spaceA, [budget]);
    const Y = await list(ids.spaceA, [budget]);
    const t = await task(X.id, "moves", { metadata: { budget: 5 } });
    expect((await call(linksRoute.POST, `/api/boards/${Y.id}/links`, { method: "POST", params: { id: Y.id }, body: { itemIds: [t.id] } })).json.results[0].ok).toBe(true);
    await call(itemRoute.PATCH, `/api/items/${t.id}`, { method: "PATCH", params: { id: t.id }, body: { contextBoardId: Y.id, metadataPatch: { budget: 50 } } });
    expect((await call(linkItemRoute.DELETE, `/api/boards/${Y.id}/links/${t.id}`, { method: "DELETE", params: { id: Y.id, itemId: t.id } })).json).toEqual({ ok: true });
    await call(itemRoute.PATCH, `/api/items/${t.id}`, { method: "PATCH", params: { id: t.id }, body: { metadataPatch: { budget: 7 } } });
    const moved = await call(itemRoute.PATCH, `/api/items/${t.id}`, { method: "PATCH", params: { id: t.id }, body: { boardId: Y.id } });
    expect(moved.status).toBe(200);
    const stored = await md(t.id);
    expect(stored.budget).toBe(7);
    // The old share's values are kept where they were, not swapped in.
    expect(stored.$lists[Y.id]).toEqual({ budget: 50 });
    expect(stored.$lists[X.id]).toBeUndefined();
    expect(moved.json.item.metadata.budget).toBe(7);
  });

  it("(4) Restore to a List the task was linked into shows that List's own values", async () => {
    as("member");
    const H = await list(ids.spaceA, [budget]);
    const B2 = await list(ids.spaceA, [budget, stage]);
    const t = await task(H.id, "restore to", { metadata: { budget: 1 } });
    await call(linksRoute.POST, `/api/boards/${B2.id}/links`, { method: "POST", params: { id: B2.id }, body: { itemIds: [t.id] } });
    await call(itemRoute.PATCH, `/api/items/${t.id}`, { method: "PATCH", params: { id: t.id }, body: { contextBoardId: B2.id, metadataPatch: { budget: 42, stage: "b-only" } } });
    await moveToTrash("item", t.id, { organizationId: ids.org, userId: users.member.id });
    await prisma.board.delete({ where: { id: H.id } });
    const trash = await prisma.trashItem.findFirst({ where: { organizationId: ids.org, entityType: "item", entityId: t.id } });
    await restoreFromTrash({ id: trash!.id, entityType: "item", snapshot: trash!.snapshot }, { targetBoardId: B2.id });
    const row = await prisma.item.findUnique({ where: { id: t.id }, select: { boardId: true, metadata: true } });
    expect(row!.boardId).toBe(B2.id);
    expect((row!.metadata as any)).toMatchObject({ budget: 42, stage: "b-only", $lists: { [H.id]: { budget: 1 } } });
    const got = await call(itemRoute.GET, `/api/items/${t.id}`, { params: { id: t.id } });
    expect(got.json.item.metadata).toMatchObject({ budget: 42, stage: "b-only" });
    expect(await prisma.itemListLink.count({ where: { itemId: t.id } })).toBe(0);
    expect(await prisma.trashItem.count({ where: { id: trash!.id } })).toBe(0);
  });

  it("(5) two Lists restored at once both park their link with the task, and it comes back with both", async () => {
    const E = await list(ids.spaceA);
    const F = await list(ids.spaceA);
    const t = await task(ids.C, "parked twice");
    await link(t.id, E.id);
    await link(t.id, F.id);
    const ctx = { organizationId: ids.org, userId: users.member.id };
    await moveToTrash("board", E.id, ctx);
    await moveToTrash("board", F.id, ctx);
    await moveToTrash("item", t.id, ctx);
    const [te, tf] = await Promise.all([E.id, F.id].map((id) => prisma.trashItem.findFirst({ where: { organizationId: ids.org, entityType: "board", entityId: id } })));
    await Promise.all([te!, tf!].map((x) => restoreFromTrash({ id: x.id, entityType: "board", snapshot: x.snapshot })));
    const held = await prisma.trashItem.findFirst({ where: { organizationId: ids.org, entityType: "item", entityId: t.id } });
    expect(((held!.snapshot as any).children.listLinks ?? []).map((l: any) => l.boardId).sort()).toEqual([E.id, F.id].sort());
    await restoreFromTrash({ id: held!.id, entityType: "item", snapshot: held!.snapshot });
    expect((await prisma.itemListLink.findMany({ where: { itemId: t.id } })).map((l) => l.boardId).sort()).toEqual([E.id, F.id].sort());
  });

  it("(5b) a second restore of the same Trash row is refused and changes nothing", async () => {
    const t = await task(ids.C, "twice restored");
    const E = await list(ids.spaceA);
    await link(t.id, E.id);
    await moveToTrash("item", t.id, { organizationId: ids.org, userId: users.member.id });
    const held = await prisma.trashItem.findFirst({ where: { organizationId: ids.org, entityType: "item", entityId: t.id } });
    // A stale tab restoring the same row again finds it gone, under the lock,
    // and writes nothing.
    await restoreFromTrash({ id: held!.id, entityType: "item", snapshot: held!.snapshot });
    await expect(restoreFromTrash({ id: held!.id, entityType: "item", snapshot: held!.snapshot })).rejects.toThrow();
    expect(await prisma.itemListLink.count({ where: { itemId: t.id, boardId: E.id } })).toBe(1);
  });

  it("(6) a mirror never shows a home value of a task its viewer reads only through a shared List", async () => {
    as("member");
    const T6 = await list(ids.spaceA, [budget], "t6");
    const C6 = await list(ids.spaceB, [], "c6");
    const A6 = await list(ids.spaceB, [], "a6");
    const x = await task(T6.id, "private budget", { metadata: { budget: 987654 } });
    await link(x.id, C6.id);
    const rel = await call(fieldsRoute.POST, `/api/boards/${A6.id}/fields`, { method: "POST", params: { id: A6.id }, body: { label: "Rel", type: "RELATIONSHIP", options: { targetBoardIds: [T6.id, C6.id] } } });
    expect(rel.status).toBe(201);
    const mirror = await call(fieldsRoute.POST, `/api/boards/${A6.id}/fields`, { method: "POST", params: { id: A6.id }, body: { label: "Budget there", type: "MIRROR", options: { linkFieldKey: rel.json.field.key, lookupFieldKeys: { [T6.id]: "budget" } } } });
    expect(mirror.status).toBe(201);
    const y = await call(boardItemsRoute.POST, `/api/boards/${A6.id}/items`, { method: "POST", params: { id: A6.id }, body: { title: "y", metadata: { [rel.json.field.key]: [x.id] } } });
    expect(y.status).toBe(201);
    expect(y.json.item.mirrors[mirror.json.field.key]).toEqual({ values: [987654] });
    as("outsider");
    const rows = await call(boardItemsRoute.GET, `/api/boards/${A6.id}/items`, { params: { id: A6.id } });
    const row = rows.json.items.find((r: any) => r.id === y.json.item.id);
    expect(JSON.stringify(row.mirrors ?? {})).not.toContain("987654");
    const page = await call(itemRoute.GET, `/api/items/${y.json.item.id}`, { params: { id: y.json.item.id } });
    expect(JSON.stringify(page.json)).not.toContain("987654");
  });

  it("(7) a read-only guest of a secondary List cannot write that List's values", async () => {
    as("member");
    const S7 = await prisma.space.create({ data: { organizationId: ids.org, slug: `s7-${suffix}`, name: "s7", visibility: "WORKSPACE", ownerId: users.member.id, members: { create: [{ userId: users.member.id, role: "OWNER" }, { userId: users.outsider.id, role: "MEMBER" }] } } });
    ids.spaceS7 = S7.id;
    const H7 = await list(S7.id, [], "h7");
    const B7 = await list(ids.spaceA, [stage], "b7");
    await prisma.boardMember.create({ data: { boardId: B7.id, userId: users.outsider.id, role: "GUEST" } });
    const z = await task(H7.id, "guest target");
    expect((await call(linksRoute.POST, `/api/boards/${B7.id}/links`, { method: "POST", params: { id: B7.id }, body: { itemIds: [z.id] } })).json.results[0].ok).toBe(true);
    as("outsider");
    const denied = await call(itemRoute.PATCH, `/api/items/${z.id}`, { method: "PATCH", params: { id: z.id }, body: { contextBoardId: B7.id, metadataPatch: { stage: "written-by-guest" } } });
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ error: "no_access", reason: "list_read_only" });
    expect((await md(z.id)).$lists).toBeUndefined();
    // The shared body is the task's, and theirs to edit from any context.
    const body = await call(itemRoute.PATCH, `/api/items/${z.id}`, { method: "PATCH", params: { id: z.id }, body: { contextBoardId: B7.id, metadataPatch: { description: "ok" } } });
    expect(body.status).toBe(200);
    ids.z7 = z.id;
    ids.H7 = H7.id;
  });

  it("(8) a home reader's activity never names a secondary List they cannot read", async () => {
    as("member");
    const B8 = await list(ids.spaceA, [stage], "b8");
    const z = await task(ids.H7, "activity target");
    await call(linksRoute.POST, `/api/boards/${B8.id}/links`, { method: "POST", params: { id: B8.id }, body: { itemIds: [z.id] } });
    await call(itemRoute.PATCH, `/api/items/${z.id}`, { method: "PATCH", params: { id: z.id }, body: { contextBoardId: B8.id, metadataPatch: { stage: "hidden" } } });
    const mine = await call(activityRoute.GET, `/api/items/${z.id}/activity`, { params: { id: z.id } });
    expect(JSON.stringify(mine.json)).toContain(B8.id);
    as("outsider");
    const theirs = await call(activityRoute.GET, `/api/items/${z.id}/activity`, { params: { id: z.id } });
    expect(theirs.status).toBe(200);
    expect(JSON.stringify(theirs.json)).not.toContain(B8.id);
    expect(JSON.stringify(theirs.json)).not.toContain('"stage"');
  });

  it("(10) a schedule's run log tells a non-admin creator nothing about a recipient's access", async () => {
    as("member");
    const created = await call(schedulesRoute.POST, `/api/report-schedules`, { method: "POST", body: { targetKind: "view", targetId: ids.viewA, cadence: "daily", timeOfDay: "09:00", timezone: "UTC", recipientUserIds: [users.outsider.id] } });
    expect(created.status).toBe(201);
    const sid = created.json.schedule.id as string;
    await prisma.reportSchedule.update({ where: { id: sid }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    await runDueReports(new Date(), { limit: 25, budgetMs: 60_000 });
    const raw = (await prisma.reportSchedule.findUnique({ where: { id: sid } }))!.runLog as any[];
    expect(raw[0]).toMatchObject({ outcome: "nothing_sent", skippedNoAccess: 1 });
    const seen = await call(scheduleRoute.GET, `/api/report-schedules/${sid}`, { params: { id: sid } });
    expect(seen.json.runLog[0]).toEqual({ dueAt: raw[0].dueAt, ranAt: raw[0].ranAt, outcome: "ran" });
    expect(seen.json.schedule.lastRun).toEqual(seen.json.runLog[0]);
    expect(seen.json.schedule.lastSentAt).toBeNull();
    expect(JSON.stringify(seen.json)).not.toMatch(/skipped|"sent"/);
    const listed = await call(schedulesRoute.GET, `/api/report-schedules`);
    expect(JSON.stringify(listed.json.schedules.find((x: any) => x.id === sid))).not.toMatch(/skipped|"sent"/);
    as("admin");
    const admin = await call(scheduleRoute.GET, `/api/report-schedules/${sid}`, { params: { id: sid } });
    expect(admin.json.runLog[0]).toMatchObject({ outcome: "nothing_sent", skippedNoAccess: 1 });
  });

  it("(11) a subtask's reader still gets its parent, as before Phase 5b", async () => {
    as("member");
    const P = await task(ids.C, "Launch plan");
    const S = await task(ids.C, "my part", { parentItemId: P.id });
    await prisma.item.update({ where: { id: S.id }, data: { ownerId: users.outsider.id, assigneeIds: [users.outsider.id] } });
    as("outsider");
    const r = await call(itemRoute.GET, `/api/items/${S.id}`, { params: { id: S.id } });
    expect(r.status).toBe(200);
    expect(r.json.parent).toEqual({ id: P.id, title: "Launch plan" });
  });

  it("(12) counts linked tasks exactly by group, the same as the row list", async () => {
    const { linkedTreeCountGroups, linkedTreeRows } = await import("@/lib/list-links-server");
    const G = await list(ids.spaceA);
    const root = await task(ids.C, "g root");
    await task(ids.C, "g child", { parentItemId: root.id });
    const other = await task(ids.C, "g other", { status: "SHIPPED" });
    await link(root.id, G.id);
    await link(other.id, G.id);
    const rows = await linkedTreeRows([G.id], { organizationId: ids.org });
    const groups = await linkedTreeCountGroups([G.id], { organizationId: ids.org });
    expect(rows).toHaveLength(3);
    expect(groups.reduce((s, g) => s + g.count, 0)).toBe(3);
    expect(groups.find((g) => g.status === "SHIPPED")?.count).toBe(1);
  });

  it("(13) a recurring occurrence keeps its connect marker, its shared Lists' values and its links", async () => {
    const { cloneItemTree } = await import("@/lib/recurring-tasks");
    const R = await list(ids.spaceA, [{ key: "deps", label: "Deps", type: "RELATIONSHIP", position: 0, options: { targetBoardIds: [ids.C] } }]);
    const L = await list(ids.spaceA, [stage]);
    const dep = await task(ids.C, "dep");
    const src = await task(R.id, "series", { metadata: { deps: [dep.id] } });
    await prisma.item.update({ where: { id: src.id }, data: { metadata: { deps: [dep.id], $connectKeys: ["deps"], $lists: { [L.id]: { stage: "shared value" } } } } });
    await link(src.id, L.id);
    const copyId = await cloneItemTree(src.id, new Date(Date.now() + 86_400_000));
    const copy = await md(copyId!);
    expect(copy.$connectKeys).toEqual(["deps"]);
    expect(copy.$lists).toEqual({ [L.id]: { stage: "shared value" } });
    expect((await prisma.itemListLink.findMany({ where: { itemId: copyId! } })).map((l) => l.boardId)).toEqual([L.id]);
  });
});
