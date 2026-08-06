// Everything — the workspace-wide All Tasks feed (ClickUp's "Everything"
// view). Collects every Item the caller can read across all boards of
// their org, composing per-board visibility via getBoardForReader (the
// same resolver /api/boards/[id]/items gates through), newest first.
//
// Shared by GET /api/me/everything and the /everything page so both
// surfaces return the identical shape.

import { prisma } from "@/lib/prisma";
import { getBoardForReader } from "@/lib/board";
import type { BoardItemRow } from "@/lib/board-items-shared";

export interface EverythingBoardRef {
  id: string;
  slug: string;
  name: string;
}

export interface EverythingSpaceRef {
  id: string;
  name: string;
}

/** BoardItemRow (what board-table-view renders) + where the row lives. */
export interface EverythingItem extends BoardItemRow {
  board: EverythingBoardRef;
  space: EverythingSpaceRef | null;
}

/** Newest-500 cap — no pagination yet; the table's own search/filter
 *  tools work within the window. */
const EVERYTHING_CAP = 500;

export async function listEverythingItems(
  organizationId: string,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<EverythingItem[]> {
  // 1 — every live board in the org, then keep only the readable ones.
  const boards = await prisma.board.findMany({
    where: { organizationId, archivedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      space: { select: { id: true, name: true } },
    },
  });
  if (boards.length === 0) return [];

  const readable = await Promise.all(
    boards.map(async (b) => ((await getBoardForReader(b.id, userId, accessLevel)) ? b : null)),
  );
  const readableBoards = readable.filter((b): b is (typeof boards)[number] => b !== null);
  if (readableBoards.length === 0) return [];
  const boardById = new Map(readableBoards.map((b) => [b.id, b] as const));

  // 2 — the newest items across those boards. Deliberately skips the
  // per-board aggregate batches listBoardItems runs (comments/links/
  // time) — those BoardItemRow fields are optional and the table
  // renders fine without them at this cross-board scale.
  const rows = await prisma.item.findMany({
    where: {
      organizationId,
      boardId: { in: Array.from(boardById.keys()) },
      archivedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: EVERYTHING_CAP,
  });

  // 3 — batch-resolve assignees.
  const ownerIds = Array.from(new Set(rows.map((r) => r.ownerId).filter((x): x is string => !!x)));
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const ownerById = new Map(owners.map((o) => [o.id, o] as const));

  const idsInWindow = new Set(rows.map((r) => r.id));

  return rows.map((r) => {
    const board = boardById.get(r.boardId)!;
    return {
      id: r.id,
      boardId: r.boardId,
      spaceId: board.space?.id ?? null,
      title: r.title,
      status: r.status,
      ownerId: r.ownerId,
      groupKey: r.groupKey,
      position: r.position,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      startAt: r.startAt,
      dueAt: r.dueAt,
      priority: r.priority,
      itemTypeId: r.itemTypeId,
      // Subtasks whose parent fell outside the newest-500 window (or is
      // unreadable) surface as top-level rows instead of silently
      // vanishing under a parent the table never renders.
      parentItemId: r.parentItemId && idsInWindow.has(r.parentItemId) ? r.parentItemId : null,
      archivedAt: r.archivedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      owner: r.ownerId ? ownerById.get(r.ownerId) ?? null : null,
      tags: [],
      board: { id: board.id, slug: board.slug, name: board.name },
      space: board.space ? { id: board.space.id, name: board.space.name } : null,
    };
  });
}
