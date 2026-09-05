// Boards — the unification container that ClickUp calls a "List". A
// Board sits inside a Space (and optionally a Folder), declares an
// itemType + binding, and hosts one or more Views (table/kanban/etc).
//
// Two flavors via `itemType`:
//   - "studio-item" : user-built, columns defined in Board.schema.fields.
//                     Items live in the StudioItem table (or, longer-
//                     term, in a unified Item index). Phase 3 ships
//                     studio-item only; entity-bound boards land in
//                     Phase 3b when the ListBinding resolver does.
//   - "deal" | "task" | "ticket" | …  : entity-bound (Phase 3b)
//
// The Visibility resolver mirrors Space — admins always; otherwise
// the parent Space's membership + visibility decides.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { SpaceRole, Visibility, ViewType } from "@/generated/prisma";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { parseBoardStatuses, type StatusOption } from "@/lib/board-items-shared";
import {
  parseSprintMeta,
  sprintBoardName,
  SPRINT_POINTS_FIELD_KEY,
  SPRINT_POINTS_LABEL,
  type SprintMeta,
} from "@/lib/sprint";

const ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

export interface BoardSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  itemType: string;
  spaceId: string | null;
  folderId: string | null;
  productSlug: string | null;
  visibility: Visibility;
  archivedAt: Date | null;
  defaultViewId: string | null;
  viewCount: number;
}

function toSlug(name: string): string {
  return (
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) ||
    "board"
  );
}

async function uniqueBoardSlug(organizationId: string, desired: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? desired : `${desired}-${i + 1}`;
    const clash = await prisma.board.findFirst({
      where: { organizationId, slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${desired}-${Date.now()}`;
}

export interface CreateBoardInput {
  organizationId: string;
  userId: string;
  spaceId: string;
  folderId?: string | null;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  itemType?: string;             // default "studio-item"
  defaultViewType?: ViewType;    // default TABLE
  visibility?: Visibility;
  /** Sprints (migration-free): when set, the board is created as a Sprint —
   *  settings.sprint written, Sprint Points NUMBER field seeded, and (when
   *  the name is empty) auto-named "Sprint N (M/D - M/D)". */
  sprint?: { startDate: string; endDate: string };
}

// The ClickUp-style view set every task List ships with: a grouped List, a
// Board (kanban), a Calendar and a Gantt — all reading the SAME items, so a
// task added in one shows in all. This is why "add in List → see in Board /
// Gantt" just works. Non-task boards (Doc / Form / Whiteboard / Dashboard) are
// single-view and are left alone.
const CORE_LIST_VIEWS: { type: ViewType; name: string }[] = [
  { type: "TABLE", name: "List" },
  { type: "KANBAN", name: "Board" },
  { type: "CALENDAR", name: "Calendar" },
  { type: "GANTT", name: "Gantt" },
];
const TASK_LIST_VIEW_TYPES = new Set<ViewType>(["TABLE", "KANBAN", "CALENDAR", "GANTT", "TIMELINE"]);

function isTaskListBoard(itemType: string, viewType: ViewType): boolean {
  return itemType === "studio-item" && TASK_LIST_VIEW_TYPES.has(viewType);
}

// Build the create-data for a fresh task List's core views, default-view first.
function coreViewCreateData(boardId: string, ownerId: string, defaultType: ViewType) {
  const ordered = [
    ...CORE_LIST_VIEWS.filter((v) => v.type === defaultType),
    ...CORE_LIST_VIEWS.filter((v) => v.type !== defaultType),
  ];
  if (!ordered.some((v) => v.type === defaultType)) {
    ordered.unshift({ type: defaultType, name: viewTypeDefaultLabel(defaultType) });
  }
  return ordered.map((v, i) => ({
    boardId,
    name: v.name,
    type: v.type,
    isDefault: v.type === defaultType,
    isShared: true,
    ownerId,
    config: (v.type === "TABLE" ? { groupBy: "status" } : {}) as Prisma.InputJsonValue,
    displayOrder: i,
  }));
}

/**
 * Self-heal: ensure an existing task List has the full core view set. Only
 * touches boards that already have a TABLE view (i.e. real task Lists), and
 * only appends the missing core views (Board / Calendar / Gantt) — it never
 * changes the default or existing views. Idempotent + cheap after the first
 * run (returns 0 with no writes once all core views exist). Returns the number
 * of views created so the caller can decide whether to refetch.
 */
export async function ensureCoreListViews(boardId: string, ownerId: string): Promise<number> {
  const views = await prisma.view.findMany({
    where: { boardId },
    select: { type: true, displayOrder: true },
  });
  if (!views.some((v) => v.type === "TABLE")) return 0; // not a task List — leave alone
  const present = new Set(views.map((v) => v.type));
  const missing = CORE_LIST_VIEWS.filter((v) => !present.has(v.type));
  if (missing.length === 0) return 0;
  let order = views.reduce((max, v) => Math.max(max, v.displayOrder), 0) + 1;
  await prisma.view.createMany({
    data: missing.map((v) => ({
      boardId,
      name: v.name,
      type: v.type,
      isDefault: false,
      isShared: true,
      ownerId,
      config: (v.type === "TABLE" ? { groupBy: "status" } : {}) as Prisma.InputJsonValue,
      displayOrder: order++,
    })),
  });
  return missing.length;
}

/**
 * Create a Board with a default View of the given type. For studio-item
 * boards we also seed an empty `schema.fields` array so the field-shelf
 * UI has somewhere to write to.
 */
// Find-or-create the viewer's personal, space-less List board. This backs
// /tasks/personal-list so it renders through the very same board-table-view as
// every other List — one component, one Item-backed model. Marked by
// productSlug="personal-list" + ownerId; visibility PRIVATE so only the owner
// sees it.
export async function getOrCreatePersonalBoard(organizationId: string, userId: string) {
  const existing = await prisma.board.findFirst({
    where: { organizationId, ownerId: userId, productSlug: "personal-list" },
  });
  if (existing) return existing;
  const slug = `personal-${userId}`;
  try {
    return await prisma.$transaction(async (tx) => {
      const board = await tx.board.create({
        data: {
          organizationId,
          spaceId: null,
          slug,
          name: "Personal List",
          itemType: "studio-item",
          productSlug: "personal-list",
          ownerId: userId,
          visibility: "PRIVATE",
          schema: { fields: [] },
          settings: {},
        },
      });
      // Personal List is "just a List that happens to be personal" — same full
      // view set as any other List so its Board/Calendar/Gantt tabs match.
      await tx.view.createMany({ data: coreViewCreateData(board.id, userId, "TABLE") });
      return board;
    });
  } catch {
    // Lost the slug race on a concurrent first visit — return the existing row.
    const board = await prisma.board.findFirst({ where: { organizationId, slug } });
    if (board) return board;
    throw new Error("Failed to provision personal board");
  }
}

export async function createBoard(input: CreateBoardInput): Promise<BoardSummary & { defaultViewType: ViewType }> {
  const trimmed = input.name.trim();
  // Sprints may omit the name — it's derived from the sprint number + dates.
  if (!trimmed && !input.sprint) throw new Error("Board name is required");

  // Ensure the Space exists in the org; reject otherwise.
  const space = await prisma.space.findFirst({
    where: { id: input.spaceId, organizationId: input.organizationId },
    select: { id: true, settings: true },
  });
  if (!space) throw new Error("Space not found");

  // Cascade (backbone #1): a new board inherits the Space wizard's
  // workflow statuses. parseBoardStatuses accepts the wizard's
  // { key, label, color, group } shape directly; when the Space has no
  // wizard workflow the board's statuses stay NULL → the default trio.
  const spaceSettings = (space.settings ?? {}) as { workflow?: { statuses?: unknown } };
  const seededStatuses = parseBoardStatuses(spaceSettings.workflow?.statuses);

  // Optional Folder must live in the same Space.
  if (input.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: input.folderId, organizationId: input.organizationId, spaceId: input.spaceId },
      select: { id: true },
    });
    if (!folder) throw new Error("Folder not found in this Space");
  }

  // Sprint identity (migration-free): number the sprint 1 + max among this
  // Space's existing sprint boards (parsed client-side from settings — no
  // JSON-path query; fine at SMB scale). Empty name → the dates-in-name
  // convention "Sprint N (M/D - M/D)".
  let sprintMeta: SprintMeta | null = null;
  let boardName = trimmed;
  if (input.sprint) {
    const siblings = await prisma.board.findMany({
      where: { spaceId: input.spaceId, archivedAt: null },
      select: { settings: true },
    });
    let maxNumber = 0;
    for (const row of siblings) {
      const meta = parseSprintMeta(row.settings);
      if (meta && meta.sprintNumber > maxNumber) maxNumber = meta.sprintNumber;
    }
    const sprintNumber = maxNumber + 1;
    sprintMeta = {
      isSprint: true,
      sprintNumber,
      startDate: input.sprint.startDate,
      endDate: input.sprint.endDate,
    };
    if (!boardName) boardName = sprintBoardName(sprintNumber, input.sprint.startDate, input.sprint.endDate);
  }

  const slug = await uniqueBoardSlug(input.organizationId, toSlug(boardName));
  const itemType = input.itemType ?? "studio-item";
  const viewType = input.defaultViewType ?? "TABLE";

  // Sprint task Lists ship with the Sprint Points NUMBER field pre-seeded —
  // exactly the FieldDef addBoardField would produce, so every existing
  // renderer (table column, drawer, FieldShelf) picks it up unchanged.
  const seededSchema: Prisma.InputJsonValue =
    itemType === "studio-item"
      ? sprintMeta
        ? { fields: [{ key: SPRINT_POINTS_FIELD_KEY, label: SPRINT_POINTS_LABEL, type: "NUMBER", position: 0, options: { decimals: 0 } }] }
        : { fields: [] }
      : {};

  const created = await prisma.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: {
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        folderId: input.folderId ?? null,
        slug,
        name: boardName,
        description: input.description ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        itemType,
        ownerId: input.userId,
        visibility: input.visibility ?? "WORKSPACE",
        schema: seededSchema,
        settings: (sprintMeta ? { sprint: sprintMeta } : {}) as Prisma.InputJsonValue,
        ...(seededStatuses ? { statuses: seededStatuses as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    // Task Lists ship with the full ClickUp view set (List/Board/Calendar/
    // Gantt); non-task boards (Doc/Form/Whiteboard/…) get just their one view.
    if (isTaskListBoard(itemType, viewType)) {
      await tx.view.createMany({ data: coreViewCreateData(board.id, input.userId, viewType) });
      const defaultView = await tx.view.findFirstOrThrow({
        where: { boardId: board.id, isDefault: true },
        select: { id: true, type: true },
      });
      return { board, defaultView };
    }
    const defaultView = await tx.view.create({
      data: {
        boardId: board.id,
        name: viewTypeDefaultLabel(viewType),
        type: viewType,
        isDefault: true,
        isShared: true,
        ownerId: input.userId,
        // The default List opens grouped by status (ClickUp parity); other
        // view types start ungrouped.
        config: viewType === "TABLE" ? { groupBy: "status" } : {},
        displayOrder: 0,
      },
    });
    return { board, defaultView };
  });

  return {
    id: created.board.id,
    slug: created.board.slug,
    name: created.board.name,
    description: created.board.description,
    icon: created.board.icon,
    color: created.board.color,
    itemType: created.board.itemType,
    spaceId: created.board.spaceId,
    folderId: created.board.folderId,
    productSlug: created.board.productSlug,
    visibility: created.board.visibility,
    archivedAt: created.board.archivedAt,
    defaultViewId: created.defaultView.id,
    defaultViewType: created.defaultView.type,
    viewCount: 1,
  };
}

function viewTypeDefaultLabel(t: ViewType): string {
  switch (t) {
    // The default TABLE view renders as a clean grouped task List (ClickUp's
    // basic view). A Monday-style "Table" is a separate, explicitly-added view.
    case "TABLE":    return "List";
    case "KANBAN":   return "Board";
    case "CALENDAR": return "Calendar";
    case "GANTT":    return "Gantt";
    case "TIMELINE": return "Timeline";
    case "FORM":     return "Form";
    case "DOC":      return "Doc";
    case "DASHBOARD":return "Dashboard";
    case "MAP":      return "Map";
    case "WORKLOAD": return "Workload";
    case "WHITEBOARD":return "Canvas";
    case "FILE_GALLERY": return "Gallery";
    case "CHART":    return "Chart";
    default:         return "View";
  }
}

export async function listBoardsInSpace(spaceId: string, opts: { includeArchived?: boolean } = {}): Promise<BoardSummary[]> {
  const rows = await prisma.board.findMany({
    where: { spaceId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { name: "asc" },
    include: {
      views: { where: { isDefault: true }, take: 1, select: { id: true } },
      _count: { select: { views: true } },
    },
  });
  return rows.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description,
    icon: b.icon,
    color: b.color,
    itemType: b.itemType,
    spaceId: b.spaceId,
    folderId: b.folderId,
    productSlug: b.productSlug,
    visibility: b.visibility,
    archivedAt: b.archivedAt,
    defaultViewId: b.views[0]?.id ?? null,
    viewCount: b._count.views,
  }));
}

export async function listBoardsInFolder(
  folderId: string,
  opts: { includeArchived?: boolean; organizationId?: string } = {},
): Promise<BoardSummary[]> {
  const rows = await prisma.board.findMany({
    where: {
      folderId,
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { name: "asc" },
    include: {
      views: { where: { isDefault: true }, take: 1, select: { id: true } },
      _count: { select: { views: true } },
    },
  });
  return rows.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description,
    icon: b.icon,
    color: b.color,
    itemType: b.itemType,
    spaceId: b.spaceId,
    folderId: b.folderId,
    productSlug: b.productSlug,
    visibility: b.visibility,
    archivedAt: b.archivedAt,
    defaultViewId: b.views[0]?.id ?? null,
    viewCount: b._count.views,
  }));
}

export interface UpdateBoardInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  visibility?: Visibility;
  folderId?: string | null;
  /** Per-List statuses (backbone #1). null = reset to the default trio. */
  statuses?: StatusOption[] | null;
  /** Sprint date edit — only valid on boards that already carry
   *  settings.sprint (read-merge-write; other settings keys untouched). */
  sprint?: { startDate: string; endDate: string };
}

export async function updateBoard(boardId: string, patch: UpdateBoardInput) {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error("Board name cannot be empty");
    data.name = trimmed;
  }
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.icon !== undefined) data.icon = patch.icon;
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.visibility !== undefined) data.visibility = patch.visibility;
  if (patch.folderId !== undefined) data.folderId = patch.folderId;
  // SQL NULL (DbNull) means "use the default set" — distinct from a
  // stored JSON null, which parseBoardStatuses would also reject.
  if (patch.statuses !== undefined) data.statuses = patch.statuses === null ? Prisma.DbNull : patch.statuses;
  if (patch.sprint !== undefined) {
    const existing = await prisma.board.findUnique({
      where: { id: boardId },
      select: { settings: true, name: true },
    });
    if (!existing) throw new Error("Board not found");
    const meta = parseSprintMeta(existing.settings);
    if (!meta) throw new Error("Not a sprint List");
    // Read-merge-write: never clobber unrelated settings keys.
    const base =
      existing.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
        ? (existing.settings as Record<string, unknown>)
        : {};
    data.settings = {
      ...base,
      sprint: { ...meta, startDate: patch.sprint.startDate, endDate: patch.sprint.endDate },
    } as Prisma.InputJsonValue;
    // Keep the dates-in-name convention true — but only while the name still
    // matches "Sprint N (…"; a user-customized name is left alone.
    if (data.name === undefined && /^Sprint \d+ \(/.test(existing.name)) {
      data.name = sprintBoardName(meta.sprintNumber, patch.sprint.startDate, patch.sprint.endDate);
    }
  }
  return prisma.board.update({ where: { id: boardId }, data });
}

export async function archiveBoard(boardId: string) {
  return prisma.board.update({
    where: { id: boardId },
    data: { archivedAt: new Date() },
  });
}

/**
 * Deep-clone a Board into the SAME space/folder: a new board (fresh slug,
 * "(copy)" name, owned by the actor) with its columns (schema), statuses,
 * settings, views, and all NON-archived items copied verbatim — item cell
 * values (metadata) stay valid because the field keys (schema) are unchanged.
 * Fresh ids everywhere; subtasks are re-parented through an old→new map and
 * inserted parents-first. Recurrence anchors are dropped so we don't spawn a
 * second series. History, comments, tags and time entries are NOT copied —
 * they belong to the original. Caller must have already gated edit access.
 */
export async function duplicateBoard(
  sourceId: string,
  actorId: string,
  organizationId: string,
): Promise<{ id: string; slug: string; name: string }> {
  const src = await prisma.board.findFirst({ where: { id: sourceId, organizationId } });
  if (!src) throw new Error("Board not found");
  // itemId==id holds only for the studio-item flavor; an entity-bound board
  // (Phase 3b) would clone item ids that point at no real entity, so refuse it.
  if (src.itemType !== "studio-item") {
    throw new Error("This kind of List can't be duplicated yet.");
  }

  const [items, views] = await Promise.all([
    prisma.item.findMany({ where: { boardId: sourceId, archivedAt: null } }),
    prisma.view.findMany({ where: { boardId: sourceId } }),
  ]);

  const name = `${src.name} (copy)`;
  const slug = await uniqueBoardSlug(organizationId, toSlug(name));

  // New id per item, used to re-map subtask parents.
  const idMap = new Map<string, string>();
  for (const it of items) idMap.set(it.id, crypto.randomUUID());

  const clonedItems = items.map((it) => {
    const newId = idMap.get(it.id) as string;
    return {
      id: newId,
      itemId: newId, // satisfies @@unique([itemType, itemId])
      organizationId,
      itemType: it.itemType,
      title: it.title,
      status: it.status,
      ownerId: it.ownerId,
      groupKey: it.groupKey,
      position: it.position,
      startAt: it.startAt,
      dueAt: it.dueAt,
      priority: it.priority,
      itemTypeId: it.itemTypeId,
      workType: it.workType,
      metadata: it.metadata as Prisma.InputJsonValue,
      // A subtask whose parent was archived (and thus not cloned) becomes
      // top-level rather than dangling.
      parentItemId: it.parentItemId ? idMap.get(it.parentItemId) ?? null : null,
    };
  });

  const created = await prisma.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: {
        organizationId,
        spaceId: src.spaceId,
        folderId: src.folderId,
        name,
        slug,
        description: src.description,
        icon: src.icon,
        color: src.color,
        itemType: src.itemType,
        productSlug: src.productSlug,
        visibility: src.visibility,
        ownerId: actorId,
        isDefault: false,
        schema: src.schema as Prisma.InputJsonValue,
        // SQL NULL (DbNull), matching updateBoard's "use the default trio"
        // convention — NOT a stored JSON null.
        statuses: src.statuses === null ? Prisma.DbNull : (src.statuses as Prisma.InputJsonValue),
        settings: src.settings as Prisma.InputJsonValue,
      },
    });

    if (views.length > 0) {
      await tx.view.createMany({
        data: views.map((v) => ({
          boardId: board.id,
          name: v.name,
          type: v.type,
          isShared: v.isShared,
          isDefault: v.isDefault,
          // A personal (owned) view becomes the actor's; shared views stay shared.
          ownerId: v.ownerId ? actorId : null,
          displayOrder: v.displayOrder,
          config: v.config as Prisma.InputJsonValue,
        })),
      });
    }

    // Insert items parents-first so subtask FKs resolve.
    const rows = clonedItems.map((r) => ({ ...r, boardId: board.id }));
    const inserted = new Set<string>();
    let remaining = rows;
    while (remaining.length > 0) {
      const ready = remaining.filter((r) => !r.parentItemId || inserted.has(r.parentItemId));
      const batch = ready.length > 0 ? ready : remaining.map((r) => ({ ...r, parentItemId: null }));
      await tx.item.createMany({ data: batch, skipDuplicates: true });
      for (const r of batch) inserted.add(r.id);
      const doneIds = new Set(batch.map((r) => r.id));
      remaining = remaining.filter((r) => !doneIds.has(r.id));
    }

    return board;
  }, { timeout: 30_000, maxWait: 10_000 }); // room for large boards (many items)

  return { id: created.id, slug: created.slug, name };
}

/**
 * Resolve board-level read access, composing Space + Board layers.
 *
 *   visibility = ORG       → any org member can read (overrides Space if Space is stricter)
 *   visibility = WORKSPACE → defer to Space access (the default; "inherit")
 *   visibility = PRIVATE   → BoardMember + Board.ownerId + Space OWNER + org admin only
 *
 * Returns the board row when readable, null otherwise.
 */
export async function getBoardForReader(
  boardId: string,
  userId: string,
  accessLevel: string | null | undefined,
) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true, spaceId: true, visibility: true, ownerId: true, organizationId: true, folderId: true },
  });
  if (!board) return null;

  // Org admins always read.
  if (accessLevel && ADMIN_LEVELS.has(accessLevel)) return board;

  // Private-folder cascade: a board inside a PRIVATE folder is hidden from
  // everyone but the folder owner (admins already returned above), regardless
  // of the board's own visibility.
  if (board.folderId) {
    const folder = await prisma.folder.findUnique({
      where: { id: board.folderId },
      select: { visibility: true, ownerId: true },
    });
    if (folder && folder.visibility === "PRIVATE" && folder.ownerId !== userId) return null;
  }

  if (board.visibility === "ORG") return board;

  if (board.visibility === "PRIVATE") {
    // Board owner always passes.
    if (board.ownerId === userId) return board;
    // Space OWNERs see through PRIVATE board overrides (they manage the parent).
    if (board.spaceId) {
      const spaceMember = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: board.spaceId, userId } },
        select: { role: true },
      });
      if (spaceMember?.role === "OWNER") return board;
    }
    // Otherwise: explicit BoardMember row required.
    const boardMember = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId } },
      select: { id: true },
    });
    return boardMember ? board : null;
  }

  // visibility = WORKSPACE (default) → inherit Space rules.
  if (!board.spaceId) return null;
  const space = await getSpaceForReader(board.spaceId, userId, accessLevel ?? undefined);
  return space ? board : null;
}

/**
 * Edit access check. Org admins always edit. Otherwise:
 *   PRIVATE → BoardMember OWNER/ADMIN, Board.ownerId, or Space OWNER
 *   else    → defer to canEditSpace (Space OWNER/ADMIN)
 */
export async function canEditBoard(
  boardId: string,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<boolean> {
  if (accessLevel && ADMIN_LEVELS.has(accessLevel)) return true;
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { spaceId: true, visibility: true, ownerId: true },
  });
  if (!board) return false;
  if (board.ownerId === userId) return true;

  if (board.visibility === "PRIVATE") {
    const boardMember = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId } },
      select: { role: true },
    });
    if (boardMember?.role === "OWNER" || boardMember?.role === "ADMIN") return true;
    // Fall through to Space OWNER override (admins of the parent Space
    // can manage even a PRIVATE board).
    if (board.spaceId) {
      const spaceMember = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: board.spaceId, userId } },
        select: { role: true },
      });
      return spaceMember?.role === "OWNER";
    }
    return false;
  }

  if (!board.spaceId) return false;
  return canEditSpace(board.spaceId, userId, accessLevel ?? undefined);
}

/**
 * Legacy thin wrapper. Kept so older call sites compile while we
 * migrate them to getBoardForReader. New code should use the resolver.
 */
export async function canReadBoard(boardId: string, userId: string, accessLevel?: string): Promise<boolean> {
  const board = await getBoardForReader(boardId, userId, accessLevel);
  return Boolean(board);
}

export async function listBoardMembers(boardId: string) {
  return prisma.boardMember.findMany({
    where: { boardId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function addBoardMember(boardId: string, userId: string, role: SpaceRole, invitedBy?: string) {
  return prisma.boardMember.upsert({
    where: { boardId_userId: { boardId, userId } },
    create: { boardId, userId, role, invitedBy: invitedBy ?? null },
    update: { role },
  });
}

export async function removeBoardMember(boardId: string, userId: string) {
  return prisma.boardMember.delete({
    where: { boardId_userId: { boardId, userId } },
  });
}
