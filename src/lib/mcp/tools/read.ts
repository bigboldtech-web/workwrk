// The ten read tools (docs/plans/mcp-server.md 4.1, 4.3).
//
// EACH RUNS THE PERSON'S OWN GATES, NEVER WIDER. The person is the one the
// connection acts as, resolved fresh for this request (auth.ts,
// resolveActingPerson), and every read goes through the gate the app's own
// page or route stands behind:
//   list_spaces    node-access listVisibleSpaces (the Spaces sidebar)
//   list_lists     nodeRoleMap(..., "list"), Can view; canAddTasks is Can edit
//   search_tasks,  searchTaskRows (src/lib/agents/tools.ts): the task page's
//   list_my_tasks  ladder (readableItemsVia), read in pages
//   get_task       gateItem view, listIsReadable, itemBreadcrumb
//   search_people  searchEmployeeRows, the directory's rules, never a level
//   search_docs    nodeRoleMap(..., "doc"), Can view
//   get_doc        docAccess
//   list_my_goals  searchOkrRows (goalVisibilityOr)
// Every query is scoped to the connection's workspace: an id from another
// workspace the person belongs to answers not found.
//
// The legacy level never appears here: acting.ts hands it to the gates
// (itemCtxFor, nodeCtxOf, canReadListAs), on the item-gate precedent.
//
// WHAT COMES BACK IS DATA (4.4): the registry wraps every payload in the
// data block; the summaries are counts in our words. Dates are the person's
// own days, URLs absolute. No access level is ever in a result.
//
// Server-only.

import { olderThan, collectReadable } from "@/lib/agents/collect-readable";
import { searchEmployeeRows, searchOkrRows, searchTaskRows } from "@/lib/agents/tools";
import { getBoardStatuses, isDoneStatus } from "@/lib/board-items-shared";
import { dayKeyInZone, zonedIso } from "@/lib/item-date";
import { prisma } from "@/lib/prisma";
import { isSystemBoard, isSystemItemType } from "@/lib/system-items";
import type { NodeRole } from "@/lib/access/node-access";
import type { ActingPerson } from "@/lib/agents/acting";
import { MCP_ORIGIN } from "../config";
import { decodeCursor, encodeCursor, type CursorAt } from "../cursor";
import { DATA_BUDGET, TASK_LADDER, docWindow, fitRows, taskAtRung } from "../data";
import { docText } from "../doc-text";
import { MCP_FIELD_COPY as F, MCP_SUMMARY_COPY as S, MCP_TOOL_COPY, MCP_WHO_COPY as W } from "../mcp-copy";
import { fixed, refused, type McpCall, type McpTool, type ToolAnswer } from "../tool-types";
import {
  BOOL,
  CURSOR,
  ID,
  INT,
  LIMIT,
  NAMED_OR_NULL,
  PERSON,
  PERSON_OR_NULL,
  STR,
  STR_OR_NULL,
  TASK,
  TEXT,
  input,
  output,
} from "./schemas";

const R = MCP_TOOL_COPY.refusals;

// The gates, loaded on first use, as the teammate tools load them.
const acting = () => import("@/lib/agents/acting");
const nodeAccess = () => import("@/lib/access/node-access");
const nodeRules = () => import("@/lib/access/node-rules");
const itemGate = () => import("@/lib/item-gate");
const itemRole = () => import("@/lib/item-role");
const linksServer = () => import("@/lib/list-links-server");
const docAccessMod = () => import("@/lib/doc-access");

const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

// ── Shared ──

/** An absolute URL on the app (4.2). */
export function appUrl(path: string): string {
  return `${MCP_ORIGIN()}${path}`;
}

/** The person's own day for a moment (4.2), or null. */
function dayOf(d: Date | string | null | undefined, person: ActingPerson): string | null {
  if (!d) return null;
  const key = dayKeyInZone(d, { timezone: person.timezone });
  return key || null;
}

/** Display names by user id: the name, else the email, never a level. */
async function namesOf(ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const list = [...new Set([...ids].filter((x): x is string => !!x))];
  if (list.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, firstName: true, lastName: true, email: true } });
  return new Map(rows.map((u) => [u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email]));
}

function person(id: string | null | undefined, names: Map<string, string>): { id: string; name: string } | null {
  return id ? { id, name: names.get(id) ?? "" } : null;
}

function cursorOf(raw: unknown): { ok: true; at: CursorAt | null } | { ok: false } {
  if (raw === undefined) return { ok: true, at: null };
  const at = decodeCursor(raw);
  return at ? { ok: true, at } : { ok: false };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** A list's rows cut to the budget at a row, with nextCursor from the last row kept (4.5 step 1). */
function listAnswer<R extends { id: string; updatedAt: Date }, T>(
  rows: R[],
  shape: (r: R) => T,
  key: string,
  nextCursor: string | null,
  extra: (cut: boolean) => Record<string, unknown>,
  summary: (payload: Record<string, unknown>) => string,
): ToolAnswer {
  return {
    kind: "data",
    build: (step) =>
      step === 0
        ? fitRows(rows, (kept, cut) => ({ [key]: kept.map(shape), nextCursor: cut ? encodeCursor(kept[kept.length - 1]) : nextCursor, ...extra(cut) }), DATA_BUDGET)
        : null,
    summary,
  };
}

function withMore(base: string, payload: Record<string, unknown>): string {
  return payload.nextCursor ? `${base} ${S.more}` : base;
}

// ── The task row (4.2 TASK) ──

interface TaskLike {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueAt: Date | null;
  startAt: Date | null;
  ownerId: string | null;
  assigneeIds: string[];
  boardId: string;
  parentItemId: string | null;
}

export interface TaskShape {
  id: string;
  title: string;
  status: string | null;
  done: boolean;
  priority: string | null;
  dueDate: string | null;
  startDate: string | null;
  list: { id: string; name: string; personal: boolean };
  owner: { id: string; name: string } | null;
  assignees: { id: string; name: string }[];
  parentTaskId: string | null;
  url: string;
}

/** Tasks as TASK rows: their Lists and people read once for all. */
export async function taskShapes(rows: readonly TaskLike[], p: ActingPerson): Promise<TaskShape[]> {
  if (rows.length === 0) return [];
  const boardIds = [...new Set(rows.map((r) => r.boardId))];
  const [boards, names] = await Promise.all([
    prisma.board.findMany({ where: { id: { in: boardIds }, organizationId: p.organizationId }, select: { id: true, name: true, productSlug: true, statuses: true } }),
    namesOf(rows.flatMap((r) => [r.ownerId, ...(r.assigneeIds ?? [])])),
  ]);
  const byId = new Map(boards.map((b) => [b.id, b]));
  return rows.map((r) => {
    const b = byId.get(r.boardId);
    return {
      id: r.id,
      title: r.title,
      status: r.status ?? null,
      done: isDoneStatus(getBoardStatuses(b ?? null), r.status),
      priority: r.priority ?? null,
      dueDate: dayOf(r.dueAt, p),
      startDate: dayOf(r.startAt, p),
      list: { id: r.boardId, name: b?.name ?? "", personal: b?.productSlug === "personal-list" },
      owner: person(r.ownerId, names),
      assignees: [...new Set(r.assigneeIds ?? [])].map((id) => ({ id, name: names.get(id) ?? "" })),
      parentTaskId: r.parentItemId ?? null,
      url: appUrl(`/item/${encodeURIComponent(r.id)}`),
    };
  });
}

/** search_tasks and list_my_tasks: the shared core, then TASK rows and the cursor. */
async function taskSearch(call: McpCall, f: Parameters<typeof searchTaskRows>[1]): Promise<ToolAnswer> {
  const p = call.person;
  const res = await searchTaskRows({ orgId: p.organizationId, userId: p.userId }, { ...f, doneBy: "list" });
  if (!res) return fixed({ tasks: [], nextCursor: null, partial: false }, S.tasks(0));
  const shapes = new Map((await taskShapes(res.rows, p)).map((t) => [t.id, t]));
  const next = res.rows.length >= f.limit ? res.rows[res.rows.length - 1] : res.capped ? res.last : null;
  return listAnswer(
    res.rows,
    (r) => shapes.get(r.id)!,
    "tasks",
    next ? encodeCursor(next) : null,
    () => ({ partial: res.capped }),
    (payload) => {
      const n = (payload.tasks as unknown[]).length;
      return payload.partial ? `${S.tasks(n)} ${S.partial}` : withMore(S.tasks(n), payload);
    },
  );
}

// ── who_am_i ──

const whoAmI: McpTool = {
  name: "who_am_i",
  scope: "read",
  inputSchema: input({}),
  outputSchema: output({
    person: { type: "object", properties: { id: STR(), name: STR(), email: STR(), timezone: STR() }, required: ["id", "name", "email", "timezone"] },
    workspace: PERSON(),
    role: { type: "string", enum: [W.owner, W.admin, W.member] },
    access: { type: "string", enum: [W.read, W.readAndChange] },
    app: STR(),
    connectedAt: STR(),
  }),
  annotations: READ_ANNOTATIONS,
  run: async (call) => {
    const p = call.person;
    const g = call.ctx.grant;
    const org = await prisma.organization.findUnique({ where: { id: g.organizationId }, select: { name: true } });
    return fixed(
      {
        person: { id: p.userId, name: p.name, email: p.email, timezone: p.timezone },
        workspace: { id: g.organizationId, name: org?.name ?? "" },
        role: p.orgRole === "OWNER" ? W.owner : p.orgRole === "ADMIN" ? W.admin : W.member,
        access: call.ctx.scopes.includes("mcp:write") ? W.readAndChange : W.read,
        app: g.appName,
        connectedAt: g.authorizedAt.toISOString(),
      },
      S.whoAmI,
    );
  },
};

// ── list_spaces ──

const listSpaces: McpTool = {
  name: "list_spaces",
  scope: "read",
  inputSchema: input({ query: TEXT(100, F.query), limit: LIMIT(100, 50) }),
  outputSchema: output({
    spaces: { type: "array", items: output({ id: STR(), name: STR(), lists: INT(), url: STR() }) },
    more: BOOL(),
  }),
  annotations: READ_ANNOTATIONS,
  run: async (call, inp) => {
    const [{ listVisibleSpaces }, { nodeCtxOf }] = await Promise.all([nodeAccess(), acting()]);
    const q = str(inp.query)?.toLowerCase();
    const limit = typeof inp.limit === "number" ? inp.limit : 50;
    const all = (await listVisibleSpaces(nodeCtxOf(call.person), { counts: true })).filter((s) => s.access === "member" && (!q || s.name.toLowerCase().includes(q)));
    const rows = all.slice(0, limit);
    const shape = (s: (typeof all)[number]) => ({ id: s.id, name: s.name, lists: s.boardCount ?? 0, url: appUrl(`/spaces/${encodeURIComponent(s.slug)}`) });
    return {
      kind: "data",
      build: (step) => (step === 0 ? fitRows(rows, (kept, cut) => ({ spaces: kept.map(shape), more: all.length > limit || cut })) : null),
      summary: (payload) => {
        const base = S.spaces((payload.spaces as unknown[]).length);
        return payload.more ? `${base} ${S.morePlain}` : base;
      },
    };
  },
};

// ── list_lists ──

interface BoardRow {
  id: string;
  name: string;
  slug: string;
  spaceId: string | null;
  folderId: string | null;
  productSlug: string | null;
  ownerId: string | null;
  itemType: string;
  settings: unknown;
  statuses: unknown;
  schema: unknown;
  updatedAt: Date;
}

const BOARD_SELECT = {
  id: true, name: true, slug: true, spaceId: true, folderId: true, productSlug: true, ownerId: true, itemType: true, settings: true, statuses: true, schema: true, updatedAt: true,
} as const;

const listLists: McpTool = {
  name: "list_lists",
  scope: "read",
  inputSchema: input({
    spaceId: ID(F.spaceId),
    query: TEXT(100, F.query),
    includePersonal: { type: "boolean", description: F.includePersonal },
    limit: LIMIT(50, 25),
    cursor: CURSOR(),
  }),
  outputSchema: output({
    lists: {
      type: "array",
      items: output({
        id: STR(),
        name: STR(),
        personal: BOOL(),
        space: NAMED_OR_NULL(),
        folder: NAMED_OR_NULL(),
        canAddTasks: BOOL(),
        statuses: { type: "array", items: output({ name: STR(), group: STR() }) },
        fields: { type: "array", items: output({ name: STR(), type: STR() }) },
        url: STR(),
      }),
    },
    nextCursor: STR_OR_NULL(),
  }),
  annotations: READ_ANNOTATIONS,
  run: async (call, inp) => {
    const p = call.person;
    const c = cursorOf(inp.cursor);
    if (!c.ok) return refused(R.badCursor);
    const [{ listVisibleSpaces, nodeRoleMap }, { roleAtLeast }, { nodeCtxOf }, { parseBoardSchema }] = await Promise.all([
      nodeAccess(),
      nodeRules(),
      acting(),
      import("@/lib/field-catalog"),
    ]);
    const ctx = nodeCtxOf(p);
    const spaceId = str(inp.spaceId);
    if (spaceId) {
      // A Space they hold a role on or pass through to something given to them, as their sidebar shows it.
      const visible = await listVisibleSpaces(ctx, { paths: true });
      if (!visible.some((s) => s.id === spaceId)) return refused(R.spaceNotFound);
    }
    const q = str(inp.query);
    const limit = typeof inp.limit === "number" ? inp.limit : 25;
    const roles = new Map<string, NodeRole>();
    // Other people's Personal lists are left out here, before any role is read:
    // an Owner holds Full access on every List, theirs included.
    const page = (after: BoardRow | null, take: number) =>
      prisma.board.findMany({
        where: {
          organizationId: p.organizationId,
          archivedAt: null,
          ...(spaceId ? { spaceId } : {}),
          ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
          AND: [
            olderThan(after),
            { OR: [{ productSlug: null }, { productSlug: { not: "personal-list" } }] },
            { OR: [{ spaceId: null }, { space: { archivedAt: null } }] },
            { OR: [{ folderId: null }, { folder: { archivedAt: null } }] },
          ],
        },
        select: BOARD_SELECT,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take,
      }) as Promise<BoardRow[]>;
    const found = await collectReadable<BoardRow>({
      limit,
      batch: 100,
      maxScan: 1000,
      start: c.at ? ({ id: c.at.id, updatedAt: c.at.updatedAt } as BoardRow) : null,
      page,
      keep: async (batch) => {
        const live = batch.filter((b) => !isSystemBoard(b));
        const map = await nodeRoleMap(ctx, "list", live.map((b) => b.id));
        for (const [id, role] of map) roles.set(id, role);
        return live.filter((b) => roleAtLeast(map.get(b.id) ?? "none", "VIEW"));
      },
    });
    // The person's own Personal list, on the first page of an unscoped search.
    const own =
      inp.includePersonal !== false && !spaceId && !c.at
        ? ((await prisma.board.findFirst({
            where: { organizationId: p.organizationId, ownerId: p.userId, productSlug: "personal-list", archivedAt: null },
            select: BOARD_SELECT,
          })) as BoardRow | null)
        : null;
    const ownShown = own && (!q || own.name.toLowerCase().includes(q.toLowerCase())) ? own : null;

    const all = [...(ownShown ? [ownShown] : []), ...found.rows];
    const [spaces, folders] = await Promise.all([
      prisma.space.findMany({ where: { id: { in: [...new Set(all.map((b) => b.spaceId).filter((x): x is string => !!x))] }, organizationId: p.organizationId }, select: { id: true, name: true } }),
      prisma.folder.findMany({ where: { id: { in: [...new Set(all.map((b) => b.folderId).filter((x): x is string => !!x))] }, organizationId: p.organizationId }, select: { id: true, name: true } }),
    ]);
    const spaceName = new Map(spaces.map((s) => [s.id, s.name]));
    const folderName = new Map(folders.map((f) => [f.id, f.name]));
    const shape = (b: BoardRow) => {
      const personal = b.productSlug === "personal-list";
      return {
        id: b.id,
        name: b.name,
        personal,
        space: b.spaceId && spaceName.has(b.spaceId) ? { id: b.spaceId, name: spaceName.get(b.spaceId)! } : null,
        folder: b.folderId && folderName.has(b.folderId) ? { id: b.folderId, name: folderName.get(b.folderId)! } : null,
        canAddTasks: personal ? b.ownerId === p.userId : roleAtLeast(roles.get(b.id) ?? "none", "EDIT"),
        statuses: getBoardStatuses(b).map((s) => ({ name: s.label, group: s.group })),
        fields: parseBoardSchema(b.schema).fields.map((f) => ({ name: f.label, type: String(f.type) })),
        url: appUrl(personal ? "/my-work/personal" : `/boards/${encodeURIComponent(b.slug)}`),
      };
    };
    const next = found.rows.length >= limit ? found.rows[found.rows.length - 1] : found.capped ? found.last : null;
    const nextCursor = next ? encodeCursor(next) : null;
    return {
      kind: "data",
      build: (step) =>
        step === 0
          ? fitRows(found.rows, (kept, cut) => ({
              lists: [...(ownShown ? [shape(ownShown)] : []), ...kept.map(shape)],
              nextCursor: cut ? encodeCursor(kept[kept.length - 1]) : nextCursor,
            }))
          : null,
      summary: (payload) => withMore(S.lists((payload.lists as unknown[]).length), payload),
    };
  },
};

// ── search_tasks, list_my_tasks ──

const TASK_LIST_OUTPUT = output({ tasks: { type: "array", items: TASK() }, nextCursor: STR_OR_NULL(), partial: BOOL() });

const searchTasks: McpTool = {
  name: "search_tasks",
  scope: "read",
  inputSchema: input({
    query: TEXT(200, F.query),
    status: TEXT(60, F.status),
    listId: ID(F.listId),
    assignedToMe: { type: "boolean", description: F.assignedToMe },
    includeDone: { type: "boolean", description: F.includeDone },
    limit: LIMIT(50, 20),
    cursor: CURSOR(),
  }),
  outputSchema: TASK_LIST_OUTPUT,
  annotations: READ_ANNOTATIONS,
  run: async (call, inp) => {
    const c = cursorOf(inp.cursor);
    if (!c.ok) return refused(R.badCursor);
    const listId = str(inp.listId);
    if (listId) {
      const { canReadListAs } = await acting();
      const board = await prisma.board.findFirst({ where: { id: listId, organizationId: call.person.organizationId, archivedAt: null }, select: { id: true } });
      if (!board || !(await canReadListAs(call.person, board.id))) return refused(R.listNotFound);
    }
    return taskSearch(call, {
      limit: typeof inp.limit === "number" ? inp.limit : 20,
      titleContains: str(inp.query),
      status: str(inp.status),
      listId,
      assignedToMe: inp.assignedToMe === true,
      done: inp.includeDone === true ? undefined : false,
      start: c.at,
    });
  },
};

/** The start of the day `days` after the person's today, in their zone. */
function endOfDayAfter(days: number, p: ActingPerson, now: Date): Date {
  const today = dayKeyInZone(now, { timezone: p.timezone });
  const [y, m, d] = today.split("-").map(Number);
  const key = new Date(Date.UTC(y, m - 1, d + days + 1)).toISOString().slice(0, 10);
  const iso = zonedIso(key, 0, 0, { timezone: p.timezone });
  return iso ? new Date(iso) : new Date(now.getTime() + (days + 1) * 86_400_000);
}

const listMyTasks: McpTool = {
  name: "list_my_tasks",
  scope: "read",
  inputSchema: input({
    includeDone: { type: "boolean", description: F.includeDone },
    dueWithinDays: { type: "integer", minimum: 0, maximum: 365, description: F.dueWithinDays },
    limit: LIMIT(50, 20),
    cursor: CURSOR(),
  }),
  outputSchema: TASK_LIST_OUTPUT,
  annotations: READ_ANNOTATIONS,
  run: async (call, inp) => {
    const c = cursorOf(inp.cursor);
    if (!c.ok) return refused(R.badCursor);
    return taskSearch(call, {
      limit: typeof inp.limit === "number" ? inp.limit : 20,
      assignedToMe: true,
      done: inp.includeDone === true ? undefined : false,
      dueBefore: typeof inp.dueWithinDays === "number" ? endOfDayAfter(inp.dueWithinDays, call.person, call.now) : undefined,
      start: c.at,
    });
  },
};

// ── get_task ──

const getTask: McpTool = {
  name: "get_task",
  scope: "read",
  inputSchema: input({ taskId: ID(F.taskId) }, ["taskId"]),
  outputSchema: {
    ...TASK(),
    properties: {
      ...TASK().properties,
      description: STR(),
      descriptionTruncated: BOOL(),
      tags: { type: "array", items: STR() },
      space: NAMED_OR_NULL(),
      createdBy: PERSON_OR_NULL(),
      createdAt: STR(),
      updatedAt: STR(),
      canEdit: BOOL(),
      canComment: BOOL(),
      subtasks: { type: "array", items: output({ id: STR(), title: STR(), status: STR_OR_NULL(), done: BOOL() }) },
      subtasksTruncated: BOOL(),
      comments: { type: "array", items: output({ id: STR(), author: PERSON_OR_NULL(), at: STR(), text: STR(), truncated: BOOL() }) },
      commentsTruncated: BOOL(),
    },
    required: [
      ...(TASK().required ?? []),
      "description", "descriptionTruncated", "tags", "space", "createdBy", "createdAt", "updatedAt", "canEdit", "canComment",
      "subtasks", "subtasksTruncated", "comments", "commentsTruncated",
    ],
  } as McpTool["outputSchema"],
  annotations: READ_ANNOTATIONS,
  run: async (call, inp) => {
    const p = call.person;
    const [{ gateItem, listIsReadable, itemBreadcrumb }, { allowsItemAction }, { itemCtxFor }, { readableItemsVia }] = await Promise.all([
      itemGate(),
      itemRole(),
      acting(),
      linksServer(),
    ]);
    const c = itemCtxFor(p);
    const gate = await gateItem(String(inp.taskId), c, "view");
    if ("error" in gate) return refused(R.taskNotFound);
    const item = gate.item;
    // Tasks only, never the product's own Items (a meeting's), as every task list leaves them out.
    if (item.organizationId !== p.organizationId || isSystemItemType(item.itemType)) return refused(R.taskNotFound);
    const listReadable = await listIsReadable(item, c);
    const [crumb, kids, updates, tags] = await Promise.all([
      itemBreadcrumb(item, c, { listReadable }),
      prisma.item.findMany({
        where: { parentItemId: item.id, organizationId: p.organizationId, archivedAt: null },
        select: { id: true, title: true, status: true, boardId: true, ownerId: true, assigneeIds: true, organizationId: true, parentItemId: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: 51,
      }),
      prisma.itemUpdate.findMany({
        where: { entityType: "BOARD_ITEM", entityId: item.id, archivedAt: null },
        select: { id: true, body: true, authorId: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 21,
      }),
      prisma.tagAssignment.findMany({ where: { entityType: "BOARD_ITEM", entityId: item.id }, select: { tag: { select: { name: true, archived: true } } } }),
    ]);
    // A subtask the person could not open on its own page is not shown.
    const access = await readableItemsVia(c, kids);
    const subtaskRows = kids.filter((k) => access.get(k.id)?.readable);
    const statuses = getBoardStatuses(item.board);
    const latest = updates.slice(0, 20).reverse();
    const [base] = await taskShapes([item], p);
    const names = await namesOf([gate.creatorId, ...latest.map((u) => u.authorId)]);
    const md = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? (item.metadata as Record<string, unknown>) : {};
    const parts = {
      description: typeof md.description === "string" ? md.description : "",
      subtasks: subtaskRows.map((s) => ({ id: s.id, title: s.title, status: s.status ?? null, done: isDoneStatus(statuses, s.status) })),
      comments: latest.map((u) => ({ id: u.id, author: person(u.authorId, names), at: u.createdAt.toISOString(), text: u.body })),
      moreComments: updates.length > 20,
    };
    const fields = {
      ...base,
      tags: tags.filter((t) => !t.tag.archived).map((t) => t.tag.name),
      space: crumb.space ? { id: crumb.space.id, name: crumb.space.name } : null,
      createdBy: person(gate.creatorId, names),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      canEdit: allowsItemAction(gate.decision, "edit", { creator: gate.isCreator, agent: false }),
      canComment: allowsItemAction(gate.decision, "comment", { creator: gate.isCreator, agent: false }),
    };
    return {
      kind: "data",
      build: (step) => {
        const rung = TASK_LADDER[step];
        return rung ? { ...fields, ...taskAtRung(parts, rung) } : null;
      },
      summary: () => S.task,
    };
  },
};

// ── search_people ──

const searchPeople: McpTool = {
  name: "search_people",
  scope: "read",
  inputSchema: input({ query: TEXT(100, F.query), department: TEXT(100, F.department), limit: LIMIT(30, 10) }),
  outputSchema: output({
    people: { type: "array", items: output({ id: STR(), name: STR(), email: STR(), department: STR_OR_NULL(), jobTitle: STR_OR_NULL() }) },
    more: BOOL(),
  }),
  annotations: READ_ANNOTATIONS,
  run: async (call, inp) => {
    const p = call.person;
    const limit = typeof inp.limit === "number" ? inp.limit : 10;
    // Never a level: the MCP server asks the directory without them.
    const rows = await searchEmployeeRows({ orgId: p.organizationId, userId: p.userId }, { query: str(inp.query), department: str(inp.department), limit: limit + 1, levels: false });
    const people = rows.slice(0, limit).map((r) => ({ id: r.id, name: r.name, email: r.email, department: r.department, jobTitle: r.role }));
    return {
      kind: "data",
      build: (step) => (step === 0 ? fitRows(people, (kept, cut) => ({ people: kept, more: rows.length > limit || cut })) : null),
      summary: (payload) => {
        const base = S.people((payload.people as unknown[]).length);
        return payload.more ? `${base} ${S.morePlain}` : base;
      },
    };
  },
};

// ── Docs ──

interface DocRow {
  id: string;
  title: string;
  entityType: string | null;
  entityId: string | null;
  parentId: string | null;
  createdById: string | null;
  updatedAt: Date;
}

const DOC_SELECT = { id: true, title: true, entityType: true, entityId: true, parentId: true, createdById: true, updatedAt: true } as const;

const PLACE = output({ kind: { type: "string", enum: ["notepad", "docs", "space", "folder", "list", "task", "page"] }, name: STR_OR_NULL() });

const PLACE_KIND: Record<string, "space" | "folder" | "list" | "task"> = { SPACE: "space", FOLDER: "folder", BOARD: "list", BOARD_ITEM: "task" };

/** Where each doc lives, by the names the Docs list shows. */
async function placesOf(docs: readonly DocRow[]): Promise<Map<string, { kind: string; name: string | null }>> {
  const { resolveDocLocations } = await import("@/lib/doc-location");
  const anchored = docs.filter((d) => d.entityType && PLACE_KIND[d.entityType]);
  const [locs, parents] = await Promise.all([
    anchored.length ? resolveDocLocations(anchored) : Promise.resolve(new Map()),
    (() => {
      const ids = [...new Set(docs.filter((d) => !d.entityType && d.parentId).map((d) => d.parentId as string))];
      return ids.length ? prisma.doc.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }) : Promise.resolve([]);
    })(),
  ]);
  const parentTitle = new Map(parents.map((d) => [d.id, d.title]));
  const out = new Map<string, { kind: string; name: string | null }>();
  for (const d of docs) {
    if (d.entityType === "NOTEPAD") out.set(d.id, { kind: "notepad", name: null });
    else if (d.entityType && PLACE_KIND[d.entityType]) out.set(d.id, { kind: PLACE_KIND[d.entityType], name: locs.get(`${d.entityType}:${d.entityId}`)?.name ?? null });
    else if (d.parentId) out.set(d.id, { kind: "page", name: parentTitle.get(d.parentId) ?? null });
    else out.set(d.id, { kind: "docs", name: null });
  }
  return out;
}

const searchDocs: McpTool = {
  name: "search_docs",
  scope: "read",
  inputSchema: input({
    query: TEXT(200, F.query),
    includeMyNotes: { type: "boolean", description: F.includeMyNotes },
    limit: LIMIT(50, 20),
    cursor: CURSOR(),
  }),
  outputSchema: output({
    docs: { type: "array", items: output({ id: STR(), title: STR(), place: PLACE, updatedAt: STR(), owner: PERSON_OR_NULL(), canEdit: BOOL(), url: STR() }) },
    nextCursor: STR_OR_NULL(),
  }),
  annotations: READ_ANNOTATIONS,
  run: async (call, inp) => {
    const p = call.person;
    const c = cursorOf(inp.cursor);
    if (!c.ok) return refused(R.badCursor);
    const [{ nodeRoleMap }, { roleAtLeast, applyDocLock }, { nodeCtxOf }, { readDocLocks }] = await Promise.all([
      nodeAccess(),
      nodeRules(),
      acting(),
      import("@/lib/doc-lock"),
    ]);
    const ctx = nodeCtxOf(p);
    const q = str(inp.query);
    const limit = typeof inp.limit === "number" ? inp.limit : 20;
    // Notes are their owner's alone: only the person's own, and only when asked (by default).
    const anchors =
      inp.includeMyNotes === false
        ? { OR: [{ entityType: null }, { entityType: { not: "NOTEPAD" } }] }
        : { OR: [{ entityType: null }, { entityType: { not: "NOTEPAD" } }, { entityType: "NOTEPAD", entityId: p.userId }] };
    const roles = new Map<string, NodeRole>();
    const found = await collectReadable<DocRow>({
      limit,
      batch: 100,
      maxScan: 1000,
      start: c.at ? ({ id: c.at.id, updatedAt: c.at.updatedAt } as DocRow) : null,
      page: (after, take) =>
        prisma.doc.findMany({
          where: {
            organizationId: p.organizationId,
            archivedAt: null,
            isFolder: false,
            ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
            AND: [olderThan(after), anchors],
          },
          select: DOC_SELECT,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take,
        }),
      keep: async (batch) => {
        const map = await nodeRoleMap(ctx, "doc", batch.map((d) => d.id));
        for (const [id, role] of map) roles.set(id, role);
        return batch.filter((d) => roleAtLeast(map.get(d.id) ?? "none", "VIEW"));
      },
    });
    const [places, locks, names] = await Promise.all([placesOf(found.rows), readDocLocks(found.rows.map((d) => d.id)), namesOf(found.rows.map((d) => d.createdById))]);
    const shape = (d: DocRow) => ({
      id: d.id,
      title: d.title,
      place: places.get(d.id) ?? { kind: "docs", name: null },
      updatedAt: d.updatedAt.toISOString(),
      owner: person(d.createdById, names),
      canEdit: roleAtLeast(applyDocLock(roles.get(d.id) ?? "none", !!locks.get(d.id)?.lockedById), "EDIT"),
      url: appUrl(`/work/docs/${encodeURIComponent(d.id)}`),
    });
    const next = found.rows.length >= limit ? found.rows[found.rows.length - 1] : found.capped ? found.last : null;
    return listAnswer(found.rows, shape, "docs", next ? encodeCursor(next) : null, () => ({}), (payload) => withMore(S.docs((payload.docs as unknown[]).length), payload));
  },
};

const getDoc: McpTool = {
  name: "get_doc",
  scope: "read",
  inputSchema: input({ docId: ID(F.docId), offset: { type: "integer", minimum: 0, maximum: 100_000_000, description: F.offset } }, ["docId"]),
  outputSchema: output({
    doc: output({
      id: STR(),
      title: STR(),
      place: PLACE,
      updatedAt: STR(),
      canEdit: BOOL(),
      url: STR(),
      text: STR(),
      offset: INT(),
      nextOffset: { type: ["integer", "null"] },
      length: INT(),
      truncated: BOOL(),
    }),
  }),
  annotations: READ_ANNOTATIONS,
  run: async (call, inp) => {
    const p = call.person;
    const [{ docAccess }, { roleAtLeast }, { nodeCtxOf }] = await Promise.all([docAccessMod(), nodeRules(), acting()]);
    const row = await prisma.doc.findFirst({
      where: { id: String(inp.docId), organizationId: p.organizationId },
      select: { ...DOC_SELECT, content: true, archivedAt: true },
    });
    if (!row) return refused(R.docNotFound);
    const access = await docAccess(nodeCtxOf(p), row.id);
    if (!access) return refused(R.docNotFound);
    if (row.archivedAt) return refused(R.docArchived);
    const text = docText(row.content);
    if (text === null) return refused(R.docFormat);
    const offset = typeof inp.offset === "number" ? inp.offset : 0;
    if (offset > text.length) return refused(R.offsetPast(text.length));
    const place = (await placesOf([row])).get(row.id) ?? { kind: "docs", name: null };
    const head = {
      id: row.id,
      title: row.title,
      place,
      updatedAt: row.updatedAt.toISOString(),
      canEdit: roleAtLeast(access.role, "EDIT"),
      url: appUrl(`/work/docs/${encodeURIComponent(row.id)}`),
    };
    return {
      kind: "data",
      build: (step) => {
        const w = docWindow(text, offset, step);
        return w ? { doc: { ...head, ...w } } : null;
      },
      summary: (payload) => ((payload.doc as { truncated: boolean }).truncated || offset > 0 ? S.doc : S.docWhole),
    };
  },
};

// ── list_my_goals ──

const GOAL_STATUSES = ["ON_TRACK", "AT_RISK", "BEHIND", "COMPLETED"] as const;

const listMyGoals: McpTool = {
  name: "list_my_goals",
  scope: "read",
  inputSchema: input({
    scope: { type: "string", enum: ["mine", "all_visible"], description: F.goalScope },
    status: { type: "string", enum: [...GOAL_STATUSES] },
    quarter: TEXT(20, F.quarter),
    limit: LIMIT(50, 20),
  }),
  outputSchema: output({
    goals: {
      type: "array",
      items: output({
        id: STR(),
        title: STR(),
        level: STR(),
        status: STR(),
        progress: { type: "number" },
        quarter: STR_OR_NULL(),
        owner: PERSON_OR_NULL(),
        keyResults: {
          type: "array",
          items: output({ id: STR(), title: STR(), progress: { type: "number" }, currentValue: { type: "number" }, targetValue: { type: "number" }, unit: STR_OR_NULL() }),
        },
        url: STR(),
      }),
    },
    more: BOOL(),
  }),
  annotations: READ_ANNOTATIONS,
  run: async (call, inp) => {
    const p = call.person;
    const limit = typeof inp.limit === "number" ? inp.limit : 20;
    const rows =
      (await searchOkrRows(
        { orgId: p.organizationId, userId: p.userId },
        { ownedByMe: inp.scope !== "all_visible", status: str(inp.status), quarter: str(inp.quarter), limit: limit + 1 },
      )) ?? [];
    const names = await namesOf(rows.map((g) => g.ownerId));
    const goals = rows.slice(0, limit).map((g) => ({
      id: g.id,
      title: g.title,
      level: String(g.level),
      status: g.status,
      progress: g.progress,
      quarter: g.quarter ?? null,
      owner: person(g.ownerId, names),
      keyResults: g.keyResults.map((k) => ({ id: k.id, title: k.title, progress: k.progress, currentValue: k.currentValue, targetValue: k.targetValue, unit: k.unit ?? null })),
      url: appUrl(`/okrs/${encodeURIComponent(g.id)}`),
    }));
    return {
      kind: "data",
      build: (step) => (step === 0 ? fitRows(goals, (kept, cut) => ({ goals: kept, more: rows.length > limit || cut })) : null),
      summary: (payload) => {
        const base = S.goals((payload.goals as unknown[]).length);
        return payload.more ? `${base} ${S.morePlain}` : base;
      },
    };
  },
};

/** The ten read tools, in the order tools/list gives them. */
export const READ_TOOLS: readonly McpTool[] = [whoAmI, listSpaces, listLists, searchTasks, getTask, listMyTasks, searchPeople, searchDocs, getDoc, listMyGoals];
