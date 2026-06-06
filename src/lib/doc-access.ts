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

interface DocAnchor {
  entityType: string | null;
  entityId: string | null;
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
    return Boolean(await getBoardForReader(anchor.entityId, userId, level));
  }

  if (anchor.entityType === "BOARD_ITEM") {
    // Resolve the parent board, then defer to the board resolver.
    const item = await prisma.item.findUnique({
      where: { id: anchor.entityId },
      select: { boardId: true },
    });
    if (!item) return false; // pinned to a deleted item — drop
    return Boolean(await getBoardForReader(item.boardId, userId, level));
  }

  if (anchor.entityType === "FOLDER") {
    // Resolve the parent Space via the folder, then defer.
    const folder = await prisma.folder.findUnique({
      where: { id: anchor.entityId },
      select: { spaceId: true },
    });
    if (!folder) return false;
    return Boolean(await getSpaceForReader(folder.spaceId, userId, level));
  }

  // Unknown anchor type (LEAD, future suite-specific types, etc.) —
  // fall through. Suite-owned types should gate inside their own GETs;
  // this helper covers only the core PPMS primitives.
  return true;
}
