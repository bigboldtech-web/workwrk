// The handover: what happens to a person's work when they leave (access
// invariant 13, settings-architecture 5.5 "Transfer dialog", 5.9 SCIM).
//
// ONE implementation, three callers:
//   POST /api/users/[id]/handover   the Members transfer dialog and the
//                                   Directory's Remove, with the transferee
//                                   the admin picked
//   SCIM deprovisioning             unattended: the person's manager, else
//                                   the first Owner (no acting admin exists)
//
// What moves, in ONE transaction:
//   - their OPEN tasks (ownerId and assigneeIds[0], kept in step; done work
//     keeps its owner, history is never rewritten)
//   - their direct reports (never into a reporting loop: a report that
//     cannot go to the recipient goes up to the leaver's own manager, else to
//     no manager)
//   - the Spaces, Folders and Lists they own (ownerId), so no container is
//     ever left with an owner who cannot sign in
// Nothing is deleted. Server-only (prisma).

import { prisma } from "@/lib/prisma";
import { groupHandoverAssignees } from "@/lib/board-items-shared";
import { managerMapFor } from "@/lib/people/person-access.server";
import { wouldCreateCycle } from "@/lib/people/reporting-lines";
import { followReportingLine } from "@/lib/performance/review-cycle.server";

/** Same completion heuristic as /api/me/work: Item.status is a per-List free string. */
export function isOpenStatus(s?: string | null): boolean {
  return !/(done|complete|closed|resolved|shipped)/i.test(s ?? "");
}

export interface HandoverResult {
  tasksReassigned: number;
  reportsReassigned: number;
  containersReassigned: number;
  reportsRehomed: { id: string; name: string | null; managerId: string | null; managerName: string | null }[];
}

export async function runHandover(input: { organizationId: string; fromId: string; toId: string; actorId: string | null }): Promise<HandoverResult> {
  const { organizationId: orgId, fromId: id, toId: reassignToId } = input;
  const items = await prisma.item.findMany({
    where: { organizationId: orgId, ownerId: id, archivedAt: null },
    select: { id: true, status: true, assigneeIds: true },
  });
  const open = items.filter((it) => isOpenStatus(it.status));
  const openIds = open.map((it) => it.id);
  // ownerId IS assigneeIds[0]: the set is rewritten with the owner, or the
  // next unassign would promote the leaver back (handover route history).
  const bySet = groupHandoverAssignees(open, id, reassignToId);

  const managers = await managerMapFor(orgId);
  const reportIds = [...managers.entries()].filter(([, m]) => m === id).map(([uid]) => uid);
  const movable = reportIds.filter((r) => r !== reassignToId && !wouldCreateCycle(r, reassignToId, managers));
  const leaverManager = managers.get(id) ?? null;
  const skipped = reportIds.filter((r) => !movable.includes(r));
  const skipTo = new Map<string | null, string[]>();
  for (const r of skipped) {
    const up = leaverManager && leaverManager !== r && !wouldCreateCycle(r, leaverManager, managers) ? leaverManager : null;
    skipTo.set(up, [...(skipTo.get(up) ?? []), r]);
  }

  const results = await prisma.$transaction([
    prisma.item.updateMany({ where: { id: { in: openIds } }, data: { ownerId: reassignToId } }),
    ...bySet.map(({ assigneeIds, ids }) => prisma.item.updateMany({ where: { id: { in: ids } }, data: { assigneeIds } })),
    ...[...skipTo.entries()].map(([up, ids]) =>
      prisma.user.updateMany({ where: { organizationId: orgId, managerId: id, deletedAt: null, id: { in: ids } }, data: { managerId: up } }),
    ),
    prisma.space.updateMany({ where: { organizationId: orgId, ownerId: id }, data: { ownerId: reassignToId } }),
    prisma.folder.updateMany({ where: { organizationId: orgId, ownerId: id }, data: { ownerId: reassignToId } }),
    prisma.board.updateMany({ where: { organizationId: orgId, ownerId: id }, data: { ownerId: reassignToId } }),
    prisma.user.updateMany({ where: { organizationId: orgId, managerId: id, deletedAt: null, id: { in: movable } }, data: { managerId: reassignToId } }),
  ]);
  const tasksMoved = results[0] as { count: number };
  const reportsMoved = results[results.length - 1] as { count: number };
  const n = results.length;
  const containers = (results[n - 4] as { count: number }).count + (results[n - 3] as { count: number }).count + (results[n - 2] as { count: number }).count;

  await followReportingLine(orgId, reportIds, input.actorId ?? reassignToId).catch((e: unknown) => console.error("followReportingLine failed", e));

  const namesOf = skipped.length || leaverManager
    ? await prisma.user.findMany({ where: { id: { in: [...skipped, ...(leaverManager ? [leaverManager] : [])] } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameOf = (uid: string | null) => {
    const u = uid ? namesOf.find((x) => x.id === uid) : null;
    return u ? `${u.firstName} ${u.lastName}`.trim() : null;
  };
  return {
    tasksReassigned: tasksMoved.count,
    reportsReassigned: reportsMoved.count,
    containersReassigned: containers,
    reportsRehomed: [...skipTo.entries()].flatMap(([up, ids]) => ids.map((rid) => ({ id: rid, name: nameOf(rid), managerId: up, managerName: nameOf(up) }))),
  };
}

export { unattendedRecipient, wouldRemoveLastOwner } from "@/lib/access/membership";

/**
 * What a deactivation would leave behind without a handover: open tasks the
 * person owns, people who report to them, and Spaces, Folders and Lists they
 * own (the same three runHandover moves and the Members transfer dialog
 * counts). PATCH /api/users/[id] refuses { status: "INACTIVE" } while any is
 * non-zero, so no route can orphan a leaver's work (invariant 13): every UI
 * path runs POST /api/users/[id]/handover first, which empties all three.
 */
export async function pendingHandover(organizationId: string, id: string): Promise<{ openTasks: number; directReports: number; containers: number }> {
  const [items, reports, spaces, folders, boards] = await Promise.all([
    prisma.item.findMany({ where: { organizationId, ownerId: id, archivedAt: null }, select: { status: true } }),
    prisma.user.count({ where: { organizationId, managerId: id, deletedAt: null } }),
    prisma.space.count({ where: { organizationId, ownerId: id } }),
    prisma.folder.count({ where: { organizationId, ownerId: id } }),
    prisma.board.count({ where: { organizationId, ownerId: id } }),
  ]);
  return { openTasks: items.filter((it) => isOpenStatus(it.status)).length, directReports: reports, containers: spaces + folders + boards };
}
