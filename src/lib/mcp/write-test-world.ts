// Stand-ins for the gates and write paths the MCP write tools run, over the
// in-memory store (src/lib/oauth/oauth-test-db.ts), for the vitest suites
// (never imported by the app). Each suite mocks the modules it needs with
// the objects below:
//
//   vi.mock("@/lib/item-gate", async () => (await import("./write-test-world")).itemGateMock);
//
// The gates answer by a role table (world.roles, "list:<id>" and the like
// per person); an absent pair is none. The task, comment and activity rows
// are real rows of the store, and every activity row goes through the REAL
// item-thread.ts writers, so a suite can read what "via" put on each.
// createItemAs (POST /api/boards/[id]/items), createDocAs (POST /api/docs)
// and createReminderFor (POST /api/reminders) run for real over these.

import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { DEFAULT_STATUS_OPTIONS, PRIORITY_OPTIONS } from "@/lib/board-items-shared";
import { createUpdate, logActivity } from "@/lib/item-thread";
import { seed, testDb as db } from "@/lib/oauth/oauth-test-db";

type Row = Record<string, unknown>;

export const RANK: Record<string, number> = { none: 0, VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };

export const world = {
  /** userId -> "list:<id>" | "doc:<id>" | "space:<id>" | "folder:<id>" -> role. */
  roles: new Map<string, Map<string, string>>(),
  /** What each write path was asked, in order. */
  calls: {
    /** Each task createItemAs wrote (the board-items writer's input). */
    create: [] as Array<{ boardId: string; body: Row }>,
    patch: [] as Array<{ id: string; body: Row }>,
    comment: [] as Array<{ id: string; body: Row }>,
    docSave: [] as Array<{ id: string; body: Row }>,
    kudos: [] as Row[],
  },
  /** Titles createBoardItem refuses (a subtask that fails). */
  failCreate: new Set<string>(),
  /** Runs before each patch is applied (somebody else saving at that moment). */
  beforePatch: null as null | ((id: string, body: Row) => void),
  /** A comment waits for this before it is written (a slow first call while its retry arrives). */
  hold: null as null | Promise<void>,
  /** PATCH answers 400 with this free text (an exception's own message), writing nothing. */
  patchFails: null as null | string,
  /** The assignee check throws (an exception out of the create route, before its own try). */
  assignThrows: false,
  /** The options each PATCH was given (patchItemAs's 4th argument). */
  patchOptions: [] as Array<Record<string, unknown>>,
  seq: 0,
};

export function resetWorld(): void {
  world.roles = new Map();
  for (const k of Object.keys(world.calls) as Array<keyof typeof world.calls>) world.calls[k].length = 0;
  world.failCreate.clear();
  world.beforePatch = null;
  world.hold = null;
  world.patchFails = null;
  world.assignThrows = false;
  world.patchOptions = [];
  world.seq = 0;
}

export function grant(userId: string, key: string, role: string): void {
  if (!world.roles.has(userId)) world.roles.set(userId, new Map());
  world.roles.get(userId)!.set(key, role);
}

export function roleOf(userId: string, key: string): string {
  return world.roles.get(userId)?.get(key) ?? "none";
}

const rows = (name: string): Row[] => (db.rows[name] ??= []);
const find = (name: string, id: unknown) => rows(name).find((r) => r.id === id);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ── @/lib/item-gate ──

export const itemGateMock = {
  gateItem: async (id: string, c: { userId: string; organizationId: string }, action: string) => {
    const item = find("item", id);
    if (!item || item.organizationId !== c.organizationId) return { error: json({ error: "Not found" }, 404) };
    const board = find("board", item.boardId);
    const listRole = roleOf(c.userId, `list:${item.boardId}`);
    const assigned = item.ownerId === c.userId || ((item.assigneeIds as string[]) ?? []).includes(c.userId);
    const role = assigned && RANK[listRole] < RANK.EDIT ? "EDIT" : listRole;
    if (RANK[role] === 0) return { error: json({ error: "Not found" }, 404) };
    const need = action === "view" ? 1 : action === "comment" ? 2 : 3;
    if (RANK[role] < need) return { error: json({ error: "no_access" }, 403) };
    return {
      item: { ...item, board },
      decision: { role, roleBeforeArchive: role },
      creatorId: null,
      isCreator: false,
      watcherIds: [],
      unwatcherIds: [],
      viaLinkedList: null,
      canAddToList: RANK[listRole] >= RANK.EDIT,
      canManageList: RANK[listRole] >= RANK.FULL,
    };
  },
};

// ── @/lib/agents/acting ──

type P = { userId: string; organizationId: string; name?: string };

export const actingMock = {
  /** The person a connection acts for (auth.ts, enforceStanding): the user row, as a Member, in UTC. */
  resolveActingPerson: async (organizationId: string, userId: string) => {
    const u = rows("user").find((r) => r.id === userId);
    if (!u) return { ok: false, reason: "gone" };
    const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || String(u.email);
    return { ok: true, person: { userId, organizationId, ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", name, firstName: String(u.firstName ?? name), email: u.email, timezone: "UTC" } };
  },
  itemCtxFor: (p: P) => ({ userId: p.userId, ...legacyLevelRow("EMPLOYEE"), organizationId: p.organizationId, userName: p.name ?? null }),
  nodeCtxOf: (p: P) => ({ userId: p.userId, organizationId: p.organizationId, orgAdmin: false, denied: false }),
  docSaveCtxOf: (p: P) => ({ userId: p.userId, orgId: p.organizationId, ...legacyLevelRow("EMPLOYEE") }),
  canReadListAs: async (p: P, boardId: string) => RANK[roleOf(p.userId, `list:${boardId}`)] >= RANK.VIEW,
  canContributeAs: async (p: P, boardId: string) => RANK[roleOf(p.userId, `list:${boardId}`)] >= RANK.EDIT,
};

// ── @/lib/board ──

export const boardMock = {
  getBoardForReader: async (id: string, userId: string) => {
    const b = find("board", id);
    return b && RANK[roleOf(userId, `list:${id}`)] >= RANK.VIEW ? b : null;
  },
  canContributeBoard: async (id: string, userId: string) => RANK[roleOf(userId, `list:${id}`)] >= RANK.EDIT,
  canReadBoard: async (id: string, userId: string) => RANK[roleOf(userId, `list:${id}`)] >= RANK.VIEW,
  getOrCreatePersonalBoard: async (organizationId: string, userId: string) => {
    const existing = rows("board").find((b) => b.organizationId === organizationId && b.ownerId === userId && b.productSlug === "personal-list");
    if (existing) return existing;
    grant(userId, `list:pl-${userId}`, "FULL");
    return seed(db, "board", {
      id: `pl-${userId}`, organizationId, name: "Personal list", slug: `personal-${userId}`, productSlug: "personal-list", ownerId: userId,
      spaceId: null, folderId: null, statuses: null, schema: { fields: [] }, settings: {}, itemType: "studio-item", archivedAt: null,
    });
  },
};

// ── @/lib/board-items ──

export const boardItemsMock = {
  PRIORITY_OPTIONS,
  /** What createItemAs hands the board-items writer, recorded in world.calls.create. */
  createBoardItem: async (input: Row) => {
    world.calls.create.push({ boardId: String(input.boardId), body: { ...input } });
    if (world.failCreate.has(String(input.title))) throw new Error("That task could not be saved.");
    const board = find("board", input.boardId);
    const statuses = (board?.statuses as Array<{ value: string }> | null) ?? DEFAULT_STATUS_OPTIONS;
    const assigneeIds = (input.assigneeIds as string[] | undefined) ?? [];
    world.seq += 1;
    const item = seed(db, "item", {
      id: `it-${world.seq}`,
      organizationId: input.organizationId,
      boardId: input.boardId,
      title: input.title,
      status: (input.status as string | undefined) ?? statuses[0]?.value ?? null,
      priority: input.priority ?? null,
      dueAt: input.dueAt ? new Date(String(input.dueAt)) : null,
      startAt: input.startAt ? new Date(String(input.startAt)) : null,
      ownerId: assigneeIds[0] ?? null,
      assigneeIds,
      parentItemId: input.parentItemId ?? null,
      metadata: input.metadata ?? {},
      itemType: "studio-item",
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const tagId of (input.tagIds as string[] | undefined) ?? []) {
      seed(db, "tagAssignment", { tagId, entityType: "BOARD_ITEM", entityId: item.id, organizationId: input.organizationId, tag: { archived: false }, createdAt: new Date() });
    }
    await logActivity({ organizationId: String(input.organizationId), itemId: String(item.id), actorId: String(input.actorId), action: "CREATED" });
    if (input.parentItemId) {
      await logActivity({ organizationId: String(input.organizationId), itemId: String(input.parentItemId), actorId: String(input.actorId), action: "SUBTASK_ADDED", meta: { title: input.title } });
    }
    return { ...item };
  },
  getBoardItemRow: async (id: string) => {
    const item = find("item", id);
    return item ? { ...item } : null;
  },
  listBoardItems: async () => [],
};

// ── @/lib/items/item-patch ──

export const itemPatchMock = {
  /** PATCH /api/items/[id], as far as the write tools use it: one task's fields, a move, the description check. */
  patchItemAs: async (c: { userId: string; organizationId: string }, id: string, body: Row, options: Row = {}) => {
    world.calls.patch.push({ id, body: structuredClone(body) });
    world.patchOptions.push({ ...options });
    world.beforePatch?.(id, body);
    if (world.patchFails) return json({ error: world.patchFails }, 400);
    const gate = await itemGateMock.gateItem(id, c, body.boardId ? "move" : "edit");
    if ("error" in gate) return gate.error;
    const item = find("item", id)!;
    const md = (item.metadata ?? {}) as Row;
    if (body.expectDescription !== undefined && (typeof md.description === "string" ? md.description : "") !== body.expectDescription) {
      return json({ error: "description_changed" }, 409);
    }
    const log = (action: string, meta: Row = {}) => logActivity({ organizationId: c.organizationId, itemId: id, actorId: c.userId, action, meta });
    if (typeof body.boardId === "string") {
      const to = find("board", body.boardId);
      if (!to) return json({ error: "Not found" }, 404);
      item.boardId = to.id;
      await log("MOVED", {});
      return json({ item, moved: { toBoardId: to.id, toListName: to.name, status: item.status, reason: "kept" } }, 200);
    }
    if (typeof body.title === "string" && body.title !== item.title) {
      await log("TITLE_CHANGED", { from: item.title, to: body.title });
      item.title = body.title;
    }
    if (body.status !== undefined && body.status !== item.status) {
      await log("STATUS_CHANGED", { from: item.status, to: body.status });
      item.status = body.status;
    }
    if (body.priority !== undefined) item.priority = body.priority;
    if (body.dueAt !== undefined) item.dueAt = body.dueAt === null ? null : new Date(String(body.dueAt));
    if (body.startAt !== undefined) item.startAt = body.startAt === null ? null : new Date(String(body.startAt));
    if (Array.isArray(body.assigneeIds)) {
      item.assigneeIds = [...(body.assigneeIds as string[])];
      item.ownerId = (body.assigneeIds as string[])[0] ?? null;
      await log("ASSIGNEES_CHANGED", {});
    }
    if (Array.isArray(body.tagIds)) {
      // As board-items syncItemTags: the task's assignments become exactly tagIds, but with
      // keepArchivedTags an assignment of an archived tag stays as it is.
      const want = new Set(body.tagIds as string[]);
      const archived = (tagId: unknown) => rows("tag").some((t) => t.id === tagId && t.archived === true);
      db.rows.tagAssignment = rows("tagAssignment").filter((t) => t.entityId !== id || want.has(String(t.tagId)) || (options.keepArchivedTags === true && archived(t.tagId)));
      for (const tagId of want) {
        if (!rows("tagAssignment").some((t) => t.entityId === id && t.tagId === tagId)) {
          seed(db, "tagAssignment", { tagId, entityType: "BOARD_ITEM", entityId: id, organizationId: c.organizationId, tag: { archived: false }, createdAt: new Date() });
        }
      }
      await log("TAGS_CHANGED", {});
    }
    if (body.metadataPatch && typeof body.metadataPatch === "object") {
      item.metadata = { ...md, ...(body.metadataPatch as Row) };
      await log("FIELDS_UPDATED", { fields: Object.keys(body.metadataPatch as Row) });
    }
    item.updatedAt = new Date();
    return json({ item }, 200);
  },
};

// ── @/lib/items/item-comment ──

export const itemCommentMock = {
  postItemCommentAs: async (c: { userId: string; organizationId: string }, id: string, body: Row) => {
    world.calls.comment.push({ id, body: { ...body } });
    if (world.hold) await world.hold;
    const gate = await itemGateMock.gateItem(id, c, "comment");
    if ("error" in gate) return gate.error;
    const update = await createUpdate({ organizationId: c.organizationId, itemId: id, authorId: c.userId, body: String(body.body ?? "") });
    return json({ update }, 201);
  },
};

// ── Docs: @/lib/doc-access, @/lib/access/node-access, @/lib/access/node-placement, @/lib/docs/doc-save ──

function placeKey(anchor: { entityType: string | null; entityId: string | null }): string | null {
  const kind = anchor.entityType === "SPACE" ? "space" : anchor.entityType === "FOLDER" ? "folder" : anchor.entityType === "BOARD" ? "list" : null;
  return kind && anchor.entityId ? `${kind}:${anchor.entityId}` : null;
}

function docRole(userId: string, docId: string): string {
  const d = find("doc", docId);
  if (!d) return "none";
  if (d.entityType === "NOTEPAD") return d.entityId === userId ? "FULL" : "none";
  return roleOf(userId, `doc:${docId}`);
}

export const docAccessMock = {
  docAccess: async (ctx: { userId: string }, docId: string) => {
    const r = docRole(ctx.userId, docId);
    return RANK[r] >= RANK.VIEW ? { role: r, unlockedRole: r, legacy: null, canComment: true, canShare: false, canManage: r === "FULL", locked: false } : null;
  },
  canCreateDocAt: async (ctx: { userId: string }, anchor: { entityType: string | null; entityId: string | null }, parentId: string | null) => {
    if (parentId) return RANK[docRole(ctx.userId, parentId)] >= RANK.EDIT;
    if (anchor.entityType === "NOTEPAD") return anchor.entityId === ctx.userId;
    const key = placeKey(anchor);
    return key ? RANK[roleOf(ctx.userId, key)] >= RANK.EDIT : true;
  },
};

export const nodeAccessMock = {
  nodeCtxFromLevel: (userId: string, organizationId: string) => ({ userId, organizationId, orgAdmin: false, denied: false }),
  canReadDocPlace: async (ctx: { userId: string }, anchor: { entityType: string | null; entityId: string | null }, parentId: string | null) => {
    if (parentId) return RANK[docRole(ctx.userId, parentId)] >= RANK.VIEW;
    if (anchor.entityType === "NOTEPAD") return anchor.entityId === ctx.userId;
    const key = placeKey(anchor);
    return key ? RANK[roleOf(ctx.userId, key)] >= RANK.VIEW : true;
  },
  nodeRoleMap: async (ctx: { userId: string }, kind: string, ids: Iterable<string>) => new Map([...ids].map((id) => [id, roleOf(ctx.userId, `${kind}:${id}`)])),
  listVisibleSpaces: async () => [],
};

export const nodePlacementMock = {
  docHomeOf: async () => null,
  docPlaceLive: async () => true,
  docAnchorPlaceOf: async () => null,
};

export const docSaveMock = {
  /** PUT /api/docs/[id], as far as append_to_doc uses it: the content, only over the version it was read at. */
  saveDocAs: async (_c: unknown, id: string, body: Row) => {
    world.calls.docSave.push({ id, body: { ...body } });
    const d = find("doc", id);
    if (!d) return json({ error: "not found" }, 404);
    if (body.knownUpdatedAt !== (d.updatedAt as Date).toISOString()) return json({ error: "conflict" }, 409);
    d.content = body.content;
    d.updatedAt = new Date((d.updatedAt as Date).getTime() + 1000);
    d.version = Number(d.version ?? 1) + 1;
    return json({ ok: true, version: d.version }, 200);
  },
};

// ── @/lib/kudos-give ──

export const kudosMock = {
  /** The wall's rules as far as the tool meets them: never to yourself, then the row. */
  giveKudos: async (input: { organizationId: string; giverId: string; receiverId: string; message: string; companyValue?: string | null }) => {
    world.calls.kudos.push({ ...input });
    if (input.receiverId === input.giverId) return { ok: false as const, status: 400 as const, error: "You cannot give kudos to yourself" };
    world.seq += 1;
    const kudos = seed(db, "kudos", { id: `k-${world.seq}`, ...input, companyValue: input.companyValue ?? null, createdAt: new Date() });
    return { ok: true as const, duplicate: false, kudos: kudos as unknown as { id: string; message: string; companyValue: string | null } };
  },
};

// ── The rest createItemAs reaches ──

export const quietMocks = {
  notifyItem: { notifyItemAssigned: async () => undefined, notifyItemStatusChanged: async () => undefined, notifyItemCommented: async () => undefined },
  dispatcher: { dispatchEvent: async () => undefined },
  assignable: {
    unknownUserIds: async (ids: string[], organizationId: string) => {
      if (world.assignThrows) throw new Error("connection reset while reading users");
      return ids.filter((id) => !rows("user").some((u) => u.id === id && u.organizationId === organizationId));
    },
  },
  connect: { validateConnectWrites: async () => ({ ok: true, values: {}, keys: [] }) },
  links: {
    linkedListsOf: async () => ({ links: [] }),
    readableItemsVia: async (v: { userId: string; organizationId: string }, items: Array<{ id: string; boardId: string; organizationId: string }>) =>
      new Map(items.map((it) => [it.id, { readable: it.organizationId === v.organizationId && RANK[roleOf(v.userId, `list:${it.boardId}`)] >= 1, via: null }])),
    listReader: (v: { userId: string }) => ({ canRead: async (boardId: string) => RANK[roleOf(v.userId, `list:${boardId}`)] >= 1 }),
  },
};
