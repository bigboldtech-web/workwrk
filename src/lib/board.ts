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
import type { Visibility, ViewType } from "@/generated/prisma";

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

/**
 * Create a Board with a default View of the given type. For studio-item
 * boards we also seed an empty `schema.fields` array so the field-shelf
 * UI has somewhere to write to.
 */
export async function createBoard(input: CreateBoardInput): Promise<BoardSummary & { defaultViewType: ViewType }> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("Board name is required");

  // Ensure the Space exists in the org; reject otherwise.
  const space = await prisma.space.findFirst({
    where: { id: input.spaceId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!space) throw new Error("Space not found");

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
      },
    });
    const defaultView = await tx.view.create({
      data: {
        boardId: board.id,
        name: viewTypeDefaultLabel(viewType),
        type: viewType,
        isDefault: true,
        isShared: true,
        ownerId: input.userId,
        config: {},
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
    case "TABLE":    return "Table";
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
  return prisma.board.update({ where: { id: boardId }, data });
}

export async function archiveBoard(boardId: string) {
  return prisma.board.update({
    where: { id: boardId },
    data: { archivedAt: new Date() },
  });
}

/**
 * Access check — the Phase 6 resolver will replace this. For now:
 * org admin always reads; otherwise the user must read the parent Space.
 */
export async function canReadBoard(boardId: string, userId: string, accessLevel?: string): Promise<boolean> {
  if (accessLevel && ADMIN_LEVELS.has(accessLevel)) return true;
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { spaceId: true, visibility: true },
  });
  if (!board?.spaceId) return false;
  if (board.visibility === "ORG") return true;
  const member = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: board.spaceId, userId } },
    select: { id: true },
  });
  return !!member;
}
