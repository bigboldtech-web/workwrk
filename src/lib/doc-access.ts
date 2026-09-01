// Phase 37 — shared Doc visibility gate.
//
// Docs anchor polymorphically to SPACE / BOARD / BOARD_ITEM / null
// (standalone). Pre-Phase 37, only SPACE-anchored Docs were gated; a
// BOARD_ITEM-anchored Doc on a PRIVATE board was readable + writable
// by anyone in the org who could guess its ID. This helper closes
// that hole by resolving the doc's anchor up to its real owner
// (Space or Board) and asking the existing resolver.
//
// Returns true when the viewer can see the doc OR the anchor doesn't
// have a known gate (standalone docs, future entity types). 404-not-403:
// callers should return "not found" on false, never "forbidden".

import { prisma } from "@/lib/prisma";
import { getSpaceForReader } from "@/lib/space";
import { getBoardForReader } from "@/lib/board";
import { folderReadable } from "@/lib/folder";

interface DocAnchor {
  entityType: string | null;
  entityId: string | null;
}

/** A board doc is readable if the viewer can read the board via the Space OR,
 *  for a folder-only grantee, via the board's parent folder — mirroring the
 *  folder fallback the central resolveBoard added. */
async function boardReadableWithFolder(
  boardId: string,
  userId: string,
  level: string,
): Promise<boolean> {
  if (await getBoardForReader(boardId, userId, level)) return true;
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { folderId: true },
  });
  if (board?.folderId) return folderReadable(board.folderId, userId, level);
  return false;
}

export async function docAccessible(
  anchor: DocAnchor,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<boolean> {
  if (!anchor.entityType || !anchor.entityId) return true;

  const level = accessLevel ?? "EMPLOYEE";

  if (anchor.entityType === "SPACE") {
    return Boolean(await getSpaceForReader(anchor.entityId, userId, level));
  }

  if (anchor.entityType === "BOARD") {
    return boardReadableWithFolder(anchor.entityId, userId, level);
  }

  if (anchor.entityType === "BOARD_ITEM") {
    // Resolve the parent board, then defer to the board resolver.
    const item = await prisma.item.findUnique({
      where: { id: anchor.entityId },
      select: { boardId: true },
    });
    if (!item) return false; // pinned to a deleted item — drop
    return boardReadableWithFolder(item.boardId, userId, level);
  }

  if (anchor.entityType === "FOLDER") {
    // Granular: a folder-only grantee reads their folder's docs; a PRIVATE
    // folder's docs are hidden from space readers without a folder grant.
    return folderReadable(anchor.entityId, userId, level);
  }

  if (anchor.entityType === "NOTEPAD") {
    // Personal sticky note (topbar Notepad / voice capture). Owner-only,
    // regardless of access level — these are private jottings, not org
    // documents, so even OWNER/ADMIN gets no read-around. This one gate
    // covers the list GET (per-row), /api/docs/[id] GET/PUT/DELETE, the
    // POST create gate (can't mint a note anchored to someone else), and
    // search (which also filters per-row through docAccessible).
    return anchor.entityId === userId;
  }

  // Unknown anchor type (LEAD, future suite-specific types, etc.) —
  // fall through. Suite-owned types should gate inside their own GETs;
  // this helper covers only the core PPMS primitives.
  return true;
}
