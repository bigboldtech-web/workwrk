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
  if (!trimmed) throw new Error("Board name is required");

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

  const slug = await uniqueBoardSlug(input.organizationId, toSlug(trimmed));
  const itemType = input.itemType ?? "studio-item";
  const viewType = input.defaultViewType ?? "TABLE";

  const created = await prisma.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: {
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        folderId: input.folderId ?? null,
        slug,
        name: trimmed,
        description: input.description ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        itemType,
        ownerId: input.userId,
        visibility: input.visibility ?? "WORKSPACE",
        schema: itemType === "studio-item" ? { fields: [] } : {},
        settings: {},
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
    case "WHITEBOARD":return "Whiteboard";
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

export async function listBoardsInFolder(folderId: string, opts: { includeArchived?: boolean } = {}): Promise<BoardSummary[]> {
  const rows = await prisma.board.findMany({
    where: { folderId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
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
  return prisma.board.update({ where: { id: boardId }, data });
}

export async function archiveBoard(boardId: string) {
  return prisma.board.update({
    where: { id: boardId },
    data: { archivedAt: new Date() },
  });
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
    select: { id: true, spaceId: true, visibility: true, ownerId: true, organizationId: true },
  });
  if (!board) return null;

  // Org admins always read.
  if (accessLevel && ADMIN_LEVELS.has(accessLevel)) return board;

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
