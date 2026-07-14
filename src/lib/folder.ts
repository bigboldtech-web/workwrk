// Folders — second tier of the Space > Folder > Board nesting. Folders
// can nest inside other Folders; nesting depth is capped at 6 by app
// code (the DB allows deeper, but the sidebar UI doesn't render past 6
// levels). Folders inherit their Space's visibility for Phase 1; the
// Phase 6 resolver may add per-Folder ACLs later.

import { prisma } from "@/lib/prisma";

const MAX_FOLDER_DEPTH = 6;

export type FolderVisibility = "PRIVATE" | "WORKSPACE" | "ORG";

const ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

/** Can this viewer see a folder? A PRIVATE folder is visible only to its owner
 *  and org admins; WORKSPACE/ORG folders are gated by the Space, not here. */
export function folderVisibleTo(
  folder: { visibility: string | null; ownerId: string | null },
  userId: string | null | undefined,
  accessLevel: string | null | undefined,
): boolean {
  if (folder.visibility !== "PRIVATE") return true;
  if (accessLevel && ADMIN_LEVELS.has(accessLevel)) return true;
  return !!userId && folder.ownerId === userId;
}

export interface FolderSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  spaceId: string;
  parentFolderId: string | null;
  ownerId: string | null;
  visibility: FolderVisibility;
  position: number;
  archivedAt: Date | null;
  childCount: number;
  boardCount: number;
}

/**
 * List folders inside a Space. Returns a flat list; the consumer
 * (sidebar tree builder) reassembles the hierarchy via parentFolderId.
 */
export async function listFoldersInSpace(spaceId: string, opts: { includeArchived?: boolean } = {}): Promise<FolderSummary[]> {
  const rows = await prisma.folder.findMany({
    where: {
      spaceId,
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      icon: true,
      color: true,
      spaceId: true,
      parentFolderId: true,
      ownerId: true,
      visibility: true,
      position: true,
      archivedAt: true,
      _count: { select: { childFolders: true, boards: true } },
    },
  });
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    icon: f.icon,
    color: f.color,
    spaceId: f.spaceId,
    parentFolderId: f.parentFolderId,
    ownerId: f.ownerId,
    visibility: f.visibility as FolderVisibility,
    position: f.position,
    archivedAt: f.archivedAt,
    childCount: f._count.childFolders,
    boardCount: f._count.boards,
  }));
}

/**
 * Compute the depth of a folder by walking up to root. Used to enforce
 * the 6-level cap at create/move time. Returns 0 for a root-level folder.
 */
export async function getFolderDepth(folderId: string): Promise<number> {
  let depth = 0;
  let currentId: string | null = folderId;
  while (currentId && depth < MAX_FOLDER_DEPTH + 2) {
    const row: { parentFolderId: string | null } | null = await prisma.folder.findUnique({
      where: { id: currentId },
      select: { parentFolderId: true },
    });
    if (!row?.parentFolderId) break;
    currentId = row.parentFolderId;
    depth += 1;
  }
  return depth;
}

export interface CreateFolderInput {
  organizationId: string;
  spaceId: string;
  parentFolderId?: string | null;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  visibility?: FolderVisibility;
  userId: string;
}

export async function createFolder(input: CreateFolderInput): Promise<FolderSummary> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("Folder name is required");

  if (input.parentFolderId) {
    const parentDepth = await getFolderDepth(input.parentFolderId);
    if (parentDepth + 1 >= MAX_FOLDER_DEPTH) {
      throw new Error(`Folders can only nest ${MAX_FOLDER_DEPTH} levels deep`);
    }
  }

  // Drop new folder at the end of its parent group (max position + 1024).
  // Fractional ordering — Linear pattern — so insertions between two
  // folders pick the midpoint without renumbering.
  const last = await prisma.folder.findFirst({
    where: { spaceId: input.spaceId, parentFolderId: input.parentFolderId ?? null },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = (last?.position ?? 0) + 1024;

  const created = await prisma.folder.create({
    data: {
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      parentFolderId: input.parentFolderId ?? null,
      name: trimmed,
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      ownerId: input.userId,
      visibility: input.visibility ?? "WORKSPACE",
      position,
    },
    select: {
      id: true, name: true, description: true, icon: true, color: true,
      spaceId: true, parentFolderId: true, ownerId: true, visibility: true, position: true,
      archivedAt: true,
    },
  });

  return { ...created, visibility: created.visibility as FolderVisibility, childCount: 0, boardCount: 0 };
}

export interface UpdateFolderInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  spaceId?: string;
  parentFolderId?: string | null;
  position?: number;
}

export async function updateFolder(folderId: string, patch: UpdateFolderInput) {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error("Folder name cannot be empty");
    data.name = trimmed;
  }
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.icon !== undefined) data.icon = patch.icon;
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.spaceId !== undefined) data.spaceId = patch.spaceId;
  if (patch.parentFolderId !== undefined) {
    if (patch.parentFolderId === folderId) {
      throw new Error("Folder cannot be its own parent");
    }
    if (patch.parentFolderId) {
      const targetDepth = await getFolderDepth(patch.parentFolderId);
      if (targetDepth + 1 >= MAX_FOLDER_DEPTH) {
        throw new Error(`Folders can only nest ${MAX_FOLDER_DEPTH} levels deep`);
      }
    }
    data.parentFolderId = patch.parentFolderId;
  }
  if (patch.position !== undefined) data.position = patch.position;

  return prisma.folder.update({ where: { id: folderId }, data });
}

export async function archiveFolder(folderId: string) {
  return prisma.folder.update({
    where: { id: folderId },
    data: { archivedAt: new Date() },
  });
}

export async function unarchiveFolder(folderId: string) {
  return prisma.folder.update({
    where: { id: folderId },
    data: { archivedAt: null },
  });
}

/**
 * Drag-reorder helper: pick a fractional position between two siblings.
 * Called from the Phase 2 sidebar drag handlers.
 *
 *   moveBetween(prev?.position, next?.position) → number
 *
 * If both bounds are present, returns midpoint. If only one is present,
 * extends by 1024 in the open direction. If neither, returns 0.
 */
export function positionBetween(before?: number | null, after?: number | null): number {
  if (before != null && after != null) return (before + after) / 2;
  if (before != null) return before + 1024;
  if (after != null) return after - 1024;
  return 0;
}
