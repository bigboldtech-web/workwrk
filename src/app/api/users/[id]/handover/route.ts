// /api/users/[id]/handover, the offboarding ledger. Before removing a
// person, the manager sees what they still hold (open tasks, live OKRs,
// KRA assignments, company assets, direct reports) so nothing falls on
// the floor. Same gate as DELETE /api/users/[id]: manager tier AND
// (org-admin OR the target sits inside the caller's report tree).
//
//   GET  → counts + capped lists (advisory summary for the confirm dialog)
//   POST → { reassignToId } moves their OPEN items' ownerId and their
//          reports' managerId to the picked person. Done work keeps its
//          original owner: history is never rewritten.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { managerMapFor, peopleCtx, relationTo } from "@/lib/people/person-access.server";
import { wouldCreateCycle } from "@/lib/people/reporting-lines";
import { groupHandoverAssignees } from "@/lib/board-items-shared";

// Same completion heuristic as /api/me/work, Item.status is a per-board
// free string, so "open" = anything that doesn't read as finished.
function isOpenStatus(s?: string | null): boolean {
  return !/(done|complete|closed|resolved|shipped)/i.test(s ?? "");
}

const LIST_CAP = 5;

async function gateHandover(_session: unknown, id: string) {
  // The same people DELETE /api/users/[id] admits (person-access.server.ts):
  // Admins, and the manager tier over their chain (solid or dotted), so the
  // Remove dialog never shows a summary its own Remove would then refuse.
  const ctx = await peopleCtx();
  if (!ctx) return jsonError("Unauthorized", 401);
  const relation = relationTo(ctx, id);
  if (ctx.isAdmin) return null;
  if (!ctx.managerTier || relation === "none" || relation === "self") {
    return jsonError("You can only run handover for people in your reporting line.", 403);
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { id } = await params;
  const gateError = await gateHandover(session, id);
  if (gateError) return gateError;

  const target = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!target) return jsonError("User not found", 404);

  const [items, okrs, kraAssignments, assets, directReports] = await Promise.all([
    prisma.item.findMany({
      where: { organizationId: orgId, ownerId: id, archivedAt: null },
      select: { id: true, title: true, status: true, board: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    }),
    prisma.oKR.findMany({
      where: { organizationId: orgId, ownerId: id, status: { not: "COMPLETED" } },
      select: { id: true, title: true, quarter: true, status: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.kRAAssignment.findMany({
      where: { userId: id, status: "ACTIVE" },
      select: { id: true, kra: { select: { name: true } } },
    }),
    prisma.asset.findMany({
      where: { organizationId: orgId, assignedToId: id },
      select: { id: true, name: true, type: true },
      orderBy: { assignedAt: "desc" },
    }),
    prisma.user.findMany({
      where: { organizationId: orgId, managerId: id, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
  ]);

  const openTasks = items.filter((it) => isOpenStatus(it.status));

  return jsonSuccess({
    openTasks: {
      count: openTasks.length,
      items: openTasks.slice(0, LIST_CAP).map((t) => ({
        id: t.id,
        title: t.title,
        board: t.board?.name ?? null,
      })),
    },
    okrs: { count: okrs.length, items: okrs.slice(0, LIST_CAP) },
    kras: {
      count: kraAssignments.length,
      items: kraAssignments.slice(0, LIST_CAP).map((a) => ({ id: a.id, name: a.kra.name })),
    },
    assets: { count: assets.length, items: assets.slice(0, LIST_CAP) },
    directReports: { count: directReports.length, items: directReports.slice(0, LIST_CAP) },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { id } = await params;
  const gateError = await gateHandover(session, id);
  if (gateError) return gateError;

  const target = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!target) return jsonError("User not found", 404);

  const body = await req.json().catch(() => ({}));
  const reassignToId = typeof body?.reassignToId === "string" ? body.reassignToId : "";
  if (!reassignToId) return jsonError("reassignToId is required");
  if (reassignToId === id) return jsonError("Cannot reassign work to the person being removed");

  const recipient = await prisma.user.findFirst({
    where: { id: reassignToId, organizationId: orgId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!recipient) return jsonError("Reassignment target not found or inactive", 404);

  // Open items only, completed/closed work stays attributed to the
  // person who did it (data integrity: history is never rewritten).
  const items = await prisma.item.findMany({
    where: { organizationId: orgId, ownerId: id, archivedAt: null },
    select: { id: true, status: true, assigneeIds: true },
  });
  const open = items.filter((it) => isOpenStatus(it.status));
  const openIds = open.map((it) => it.id);

  // ownerId IS assigneeIds[0]. Every writer holds that invariant, and the
  // owner-only patch rule (applyOwnerOnlyPatch) now DEPENDS on it: a row whose
  // ownerId is missing from its own assignee set reads as a legacy row, and
  // the repair puts the missing owner back at the front. So a handover that
  // rewrote ownerId alone left rows where the offboarded person was still
  // assigneeIds[0]; the very next unassign on such a task dropped the
  // RECIPIENT and promoted the leaver back to owner, silently reverting the
  // handover. The set is rewritten with the ownerId, so the two never disagree.
  //
  // Grouped by resulting set so this stays a handful of updateMany calls
  // rather than one per task, and it all lands in the same transaction as the
  // reports move.
  const bySet = groupHandoverAssignees(open, id, reassignToId);

  // The reports that move: never the recipient themselves, and never a
  // report whose move would close a loop (the recipient sits somewhere under
  // that report). A report that cannot go to the recipient must not keep a
  // removed person as manager (the chart would silently draw them as a top
  // of the company), so it goes up a level to the leaver's own manager, or
  // to no manager when that too would loop; the response names every one so
  // the Remove dialog can say where they went.
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
    prisma.item.updateMany({
      where: { id: { in: openIds } },
      data: { ownerId: reassignToId },
    }),
    ...bySet.map(({ assigneeIds, ids }) =>
      prisma.item.updateMany({
        where: { id: { in: ids } },
        data: { assigneeIds },
      }),
    ),
    // Exclude the recipient themselves so we never create a self-managing
    // cycle when the new owner used to report to the leaver.
    ...[...skipTo.entries()].map(([up, ids]) =>
      prisma.user.updateMany({
        where: { organizationId: orgId, managerId: id, deletedAt: null, id: { in: ids } },
        data: { managerId: up },
      }),
    ),
    prisma.user.updateMany({
      where: { organizationId: orgId, managerId: id, deletedAt: null, id: { in: movable } },
      data: { managerId: reassignToId },
    }),
  ]);
  // Positional, because the assignee rewrites above are a variable-length run.
  const tasksMoved = results[0] as { count: number };
  const reportsMoved = results[results.length - 1] as { count: number };

  logActivity({
    type: "user_handover",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Handed over ${tasksMoved.count} open tasks and ${reportsMoved.count} direct reports from ${target.firstName} ${target.lastName} to ${recipient.firstName} ${recipient.lastName}`,
    targetId: id,
    targetType: "user",
  });

  const namesOf = skipped.length || leaverManager
    ? await prisma.user.findMany({ where: { id: { in: [...skipped, ...(leaverManager ? [leaverManager] : [])] } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameOf = (uid: string | null) => {
    const u = uid ? namesOf.find((n) => n.id === uid) : null;
    return u ? `${u.firstName} ${u.lastName}`.trim() : null;
  };
  const reportsRehomed = [...skipTo.entries()].flatMap(([up, ids]) =>
    ids.map((rid) => ({ id: rid, name: nameOf(rid), managerId: up, managerName: nameOf(up) })),
  );

  return jsonSuccess({ tasksReassigned: tasksMoved.count, reportsReassigned: reportsMoved.count, reportsRehomed });
}
