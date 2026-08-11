// /api/users/[id]/handover — the offboarding ledger. Before removing a
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
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { canTouchUserAlignment, isOrgAdminLevel } from "@/lib/alignment-scope";

// Same completion heuristic as /api/me/work — Item.status is a per-board
// free string, so "open" = anything that doesn't read as finished.
function isOpenStatus(s?: string | null): boolean {
  return !/(done|complete|closed|resolved|shipped)/i.test(s ?? "");
}

const LIST_CAP = 5;

async function gateHandover(session: unknown, id: string) {
  if (!isManager(session)) return jsonError("Forbidden", 403);
  if (!isOrgAdminLevel(session) && !(await canTouchUserAlignment(session, id))) {
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

  // Open items only — completed/closed work stays attributed to the
  // person who did it (data integrity: history is never rewritten).
  const items = await prisma.item.findMany({
    where: { organizationId: orgId, ownerId: id, archivedAt: null },
    select: { id: true, status: true },
  });
  const openIds = items.filter((it) => isOpenStatus(it.status)).map((it) => it.id);

  const [tasksMoved, reportsMoved] = await prisma.$transaction([
    prisma.item.updateMany({
      where: { id: { in: openIds } },
      data: { ownerId: reassignToId },
    }),
    // Exclude the recipient themselves so we never create a self-managing
    // cycle when the new owner used to report to the leaver.
    prisma.user.updateMany({
      where: { organizationId: orgId, managerId: id, deletedAt: null, id: { not: reassignToId } },
      data: { managerId: reassignToId },
    }),
  ]);

  logActivity({
    type: "user_handover",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Handed over ${tasksMoved.count} open tasks and ${reportsMoved.count} direct reports from ${target.firstName} ${target.lastName} to ${recipient.firstName} ${recipient.lastName}`,
    targetId: id,
    targetType: "user",
  });

  return jsonSuccess({ tasksReassigned: tasksMoved.count, reportsReassigned: reportsMoved.count });
}
