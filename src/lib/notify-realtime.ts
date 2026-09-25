// The one door between a task write and the SSE stream.
//
// spec-task-detail.md section 2 (Realtime): "the shell's RealtimeClient gains
// one event { type: "item", itemId, boardId } on the existing /api/realtime
// SSE (emitted by item PATCH and DELETE, updates POST/PATCH/DELETE, reactions,
// entity-link writes, timer start/stop, reminder writes for the task)".
//
// SCOPE, stated plainly rather than implied. The in-process bus indexes
// connections by user id and by conversation id; there is no board or item
// topic and adding one would mean tracking which task each tab has open. So
// this publisher fans out to the people who are DEMONSTRABLY interested in the
// task: its owner, its assignees, its watchers and everyone who has commented
// on it. A viewer who has the task open and is none of those still sees the
// change, one poll later, through the fallback the same spec names (the host
// list's 12s poll, or the task page's own 30s poll while visible). That is a
// latency gap, never a lost write, and it is the honest version of what this
// transport can do today.
//
// The payload is TRIGGER-ONLY, exactly like every other member of the union:
// two ids and nothing else. The client refetches through GET /api/items/[id],
// which gates, so a mis-scoped emit can leak nothing.
//
// BEST EFFORT. Nothing here throws and nothing here blocks the write it
// follows. A realtime failure must never fail a task save.

import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { readWatchers } from "@/lib/item-watchers";
import { withListLinks } from "@/lib/list-links-server";

/**
 * Tell the interested tabs that one task changed.
 *
 * `actorId` is excluded: the tab that made the change already merged the
 * server's response, and echoing the event back to it would fight an
 * in-flight optimistic edit.
 */
export async function publishItemChanged(args: {
  itemId: string;
  /** Saves a query when the caller already loaded the row. */
  boardId?: string | null;
  organizationId: string;
  actorId?: string | null;
  /** Extra recipients the caller already knows (a fresh assignee, say). */
  extraUserIds?: (string | null | undefined)[];
  /** Every List the task appears in; read from its links when absent. */
  listIds?: string[];
  /** Lists the task just left. */
  leftListIds?: string[];
}): Promise<void> {
  try {
    const item = await prisma.item.findUnique({
      where: { id: args.itemId },
      select: { boardId: true, ownerId: true, assigneeIds: true, metadata: true, organizationId: true },
    });
    if (!item || item.organizationId !== args.organizationId) return;

    const commenters = await prisma.itemUpdate
      .findMany({
        where: {
          organizationId: args.organizationId,
          entityType: "BOARD_ITEM",
          entityId: args.itemId,
          archivedAt: null,
        },
        select: { authorId: true },
        distinct: ["authorId"],
        take: 50,
      })
      .catch(() => [] as { authorId: string | null }[]);

    const { watchers } = readWatchers(item.metadata);
    const ids = new Set<string>();
    for (const raw of [
      item.ownerId,
      ...item.assigneeIds,
      ...watchers,
      ...commenters.map((c) => c.authorId),
      ...(args.extraUserIds ?? []),
    ]) {
      if (raw && raw !== args.actorId) ids.add(raw);
    }
    if (ids.size === 0) return;

    // Trigger-only like the rest: List ids, never content. Read here rather
    // than by every caller, and absent (not an error) while the link table is.
    const listIds = args.listIds ?? [
      item.boardId,
      ...(await withListLinks(
        () => prisma.itemListLink.findMany({ where: { itemId: args.itemId }, select: { boardId: true } }).then((r) => r.map((l) => l.boardId)),
        [] as string[],
      )),
    ];
    const event = {
      type: "item" as const,
      itemId: args.itemId,
      boardId: args.boardId ?? item.boardId ?? null,
      listIds: Array.from(new Set(listIds)),
      ...(args.leftListIds?.length ? { leftListIds: Array.from(new Set(args.leftListIds)) } : {}),
    };
    for (const userId of ids) publishToUser(userId, event);
  } catch {
    // Swallow — realtime is a nicety; the write already landed.
  }
}
