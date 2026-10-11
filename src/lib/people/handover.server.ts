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
//   - their direct reports (never into a reporting loop, and never to an
//     Agent, who is never anyone's manager: a report that cannot go to the
//     recipient goes up to the leaver's own manager, else to no manager;
//     reporting-lines.ts planReportHandover, which the transfer dialog's
//     preview reads too)
//   - the Spaces, Folders and Lists they own (ownerId), so no container is
//     ever left with an owner who cannot sign in
// Nothing is deleted. Server-only (prisma).

import { prisma } from "@/lib/prisma";
import { groupHandoverAssignees } from "@/lib/board-items-shared";
import { managerMapFor } from "@/lib/people/person-access.server";
import { planReportHandover, type ManagerMap } from "@/lib/people/reporting-lines";
import { agentIdsIn } from "@/lib/access/manager-candidate";
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
  const { reportIds, toRecipient: movable, rehome: skipTo, leaverManager } = await reportPlanFor(orgId, id, reassignToId, managers);
  const skipped = reportIds.filter((r) => !movable.includes(r));

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

/**
 * The report half of the handover, as runHandover will run it: the leaver's
 * reports, who goes to the recipient, and where the rest go. An Agent
 * recipient takes the work but never the reports (access 2.4), and an Agent
 * above the leaver is never handed them either.
 */
async function reportPlanFor(organizationId: string, fromId: string, toId: string, managers: ManagerMap) {
  const leaverManager = managers.get(fromId) ?? null;
  const agentIds = await agentIdsIn(organizationId, [toId, ...(leaverManager ? [leaverManager] : [])]);
  const recipientIsAgent = agentIds.has(toId);
  return { ...planReportHandover({ leaverId: fromId, recipientId: toId, recipientIsAgent, managers, agentIds }), recipientIsAgent };
}

/**
 * What a handover to `toId` would do with the leaver's direct reports, for
 * the transfer dialog to say before it runs (GET /api/users/[id]/handover
 * ?to=): how many there are, whether the recipient is an Agent, and where
 * those who do not go to the recipient land, by name.
 */
export async function previewReportHandover(organizationId: string, fromId: string, toId: string): Promise<{
  reports: number;
  toRecipient: number;
  recipientIsAgent: boolean;
  rehomed: { to: string | null; count: number }[];
}> {
  const managers = await managerMapFor(organizationId);
  const plan = await reportPlanFor(organizationId, fromId, toId, managers);
  const upIds = [...plan.rehome.keys()].filter((k): k is string => !!k);
  const names = upIds.length
    ? await prisma.user.findMany({ where: { id: { in: upIds }, organizationId }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameOf = (uid: string | null) => {
    const u = uid ? names.find((n) => n.id === uid) : null;
    return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null : null;
  };
  return {
    reports: plan.reportIds.length,
    toRecipient: plan.toRecipient.length,
    recipientIsAgent: plan.recipientIsAgent,
    rehomed: [...plan.rehome.entries()].map(([up, rs]) => ({ to: nameOf(up), count: rs.length })),
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
