import "server-only";

// The Lists a viewer may read, resolved ONCE per request through the one
// node-access resolver (never a gate call per List), with each List's own
// status set so "done" is decided by the List that owns the item. Shared by
// My team and Workload so the two pages never disagree about whose work is
// visible or what counts as open.

import { prisma } from "@/lib/prisma";
import { nodeCtxFromViewer, nodeRoleMap } from "@/lib/access/node-access";
import type { Viewer } from "@/lib/access/types";
import { roleAtLeast } from "@/lib/access/node-rules";
import { getBoardStatuses, isDoneStatus, type StatusOption } from "@/lib/board-items-shared";
import type { Prisma } from "@/generated/prisma";

export interface ReadableBoard {
  id: string;
  slug: string;
  name: string;
  statuses: StatusOption[];
  /** Can edit: may assign and reschedule the List's items. */
  canEdit: boolean;
}

export interface ReadableBoards {
  ids: string[];
  byId: Map<string, ReadableBoard>;
  isDone: (boardId: string, status: string | null) => boolean;
}

export async function readableBoardsFor(viewer: Viewer): Promise<ReadableBoards> {
  const boards = await prisma.board.findMany({
    where: { organizationId: viewer.organizationId, archivedAt: null },
    select: { id: true, slug: true, name: true, statuses: true },
  });
  const roles = await nodeRoleMap(nodeCtxFromViewer(viewer), "list", boards.map((b) => b.id));
  const byId = new Map<string, ReadableBoard>();
  for (const b of boards) {
    const role = roles.get(b.id) ?? "none";
    if (!roleAtLeast(role, "VIEW")) continue;
    byId.set(b.id, { id: b.id, slug: b.slug, name: b.name, statuses: getBoardStatuses(b), canEdit: roleAtLeast(role, "EDIT") });
  }
  return {
    ids: [...byId.keys()],
    byId,
    isDone: (boardId, status) => isDoneStatus(byId.get(boardId)?.statuses ?? [], status),
  };
}

/**
 * A where clause that drops the items each List's OWN status set calls done,
 * so a query can order and page over open work in SQL. Lists sharing a done
 * set share one clause (most use the default trio), so the clause stays
 * small. A status a List does not define is not excluded here: callers still
 * run isDone over the rows, which applies the shared name fallback.
 */
export function openItemsWhere(boards: ReadableBoards, boardIds: readonly string[] = boards.ids): Prisma.ItemWhereInput {
  const bySet = new Map<string, { statuses: string[]; boardIds: string[] }>();
  for (const id of boardIds) {
    const b = boards.byId.get(id);
    if (!b) continue;
    const done = b.statuses.filter((o) => o.group !== "ACTIVE").map((o) => o.value).sort();
    if (!done.length) continue;
    const key = done.join("\u0000");
    const entry = bySet.get(key);
    if (entry) entry.boardIds.push(id);
    else bySet.set(key, { statuses: done, boardIds: [id] });
  }
  if (!bySet.size) return {};
  return {
    NOT: {
      OR: [...bySet.values()].map((e) => ({ boardId: { in: e.boardIds }, status: { in: e.statuses } })),
    },
  };
}
