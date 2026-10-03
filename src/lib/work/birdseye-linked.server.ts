// Bird's eye, the tasks linked INTO a List from another (Phase 5b), as cards
// beside the List's own: the read.
//
// THE LIST'S OWN READ DECIDES THEM. Each card is a row of
// listLinkedRootRows (src/lib/board-items.ts), the projection the List's
// Board reads with includeLinked: the link's position, the home status and,
// for a viewer who reads the home, the home set and List, and the task role.
// How a row becomes a card is src/lib/work/birdseye-linked.ts. Nothing here
// decides access: the projection is the one place that does, and
// src/lib/work/birdseye-server.ts, which merges these cards into its counts
// and pages, still reads no access and no link table.
//
// CAPPED, AND SAID SO. A List shows at most LINKED_CAP linked tasks here; a
// List with more says that some linked tasks are not shown (`capped`).

import { prisma } from "@/lib/prisma";
import { listLinkedRootRows } from "@/lib/board-items";
import { withListLinks, type LinkViewer } from "@/lib/list-links-server";
import { linkedCardsOfList, type LinkedCard, type LinkedList } from "@/lib/work/birdseye-linked";

export type { LinkedCard, LinkedList } from "@/lib/work/birdseye-linked";

/**
 * The linked cards of every List given, by List, filtered by the title search
 * and Hide closed, in each List's (rank, position, id) order.
 */
export async function linkedCardsFor(
  lists: readonly LinkedList[],
  viewer: LinkViewer,
  filters: { q: string; hideClosed: boolean },
): Promise<{ byList: Map<string, LinkedCard[]>; capped: Set<string> }> {
  const byList = new Map<string, LinkedCard[]>();
  const capped = new Set<string>();
  if (lists.length === 0) return { byList, capped };
  // One count first, so a List with nothing linked in costs no projection.
  const withLinks = await withListLinks(
    () => prisma.itemListLink.groupBy({ by: ["boardId"], where: { boardId: { in: lists.map((l) => l.id) } }, _count: { _all: true } }),
    [] as Array<{ boardId: string; _count: { _all: number } }>,
  );
  const linkedLists = new Set(withLinks.filter((g) => g._count._all > 0).map((g) => g.boardId));
  for (const list of lists) {
    if (!linkedLists.has(list.id)) continue;
    const rows = await listLinkedRootRows(list.id, viewer);
    const { cards, capped: over } = linkedCardsOfList(rows, list, filters);
    if (over) capped.add(list.id);
    byList.set(list.id, cards);
  }
  return { byList, capped };
}
