// delegated-items.ts: "tasks I handed out".
//
// The retired Today / Overdue page had a Delegated tab (GET /api/tasks
// ?view=delegated) listing the tasks the viewer had given to other people. The
// legacy `Task` table carried a creator column; `Item` does not. What Items DO
// carry is the activity log: `ItemActivity` writes a CREATED row with the
// actor on every create and an ASSIGNED row on every assignment, and the item
// gate already reads the creator back from exactly that row (rule 5). So the
// delegated set is "items I created or assigned, minus the ones assigned to
// me", read the same way the gate reads it.
//
// Server-only: it touches Prisma. Both `GET /api/me/work?scope=delegated` and
// `GET /api/me/everything?assignedBy=me` call it, so the two pages agree on
// what "assigned by me" means.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

const CAP = 5000;

/** Ids of every item the viewer created or assigned, most recent first, capped. */
export async function actedItemIds(organizationId: string, userId: string): Promise<string[]> {
  const rows = await prisma.itemActivity.findMany({
    where: { organizationId, entityType: "BOARD_ITEM", actorId: userId, action: { in: ["CREATED", "ASSIGNED"] } },
    select: { entityId: true },
    orderBy: { createdAt: "desc" },
    take: CAP,
    distinct: ["entityId"],
  });
  return rows.map((r) => r.entityId);
}

/**
 * The Item predicate for the delegated set: acted on by the viewer, currently
 * assigned to somebody, and not to the viewer.
 */
export async function delegatedWhere(organizationId: string, userId: string): Promise<Prisma.ItemWhereInput> {
  const ids = await actedItemIds(organizationId, userId);
  return {
    organizationId,
    id: { in: ids },
    archivedAt: null,
    NOT: [{ ownerId: userId }, { assigneeIds: { has: userId } }],
    OR: [{ ownerId: { not: null } }, { assigneeIds: { isEmpty: false } }],
  };
}
