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
