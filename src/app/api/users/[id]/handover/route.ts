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
import { peopleCtx, relationTo } from "@/lib/people/person-access.server";
import { isOpenStatus, runHandover } from "@/lib/people/handover.server";

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

  const [items, okrs, kraAssignments, assets, directReports, spaces, folders, lists] = await Promise.all([
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
    prisma.space.findMany({ where: { organizationId: orgId, ownerId: id }, select: { id: true, name: true } }),
    prisma.folder.findMany({ where: { organizationId: orgId, ownerId: id }, select: { id: true, name: true } }),
    prisma.board.findMany({ where: { organizationId: orgId, ownerId: id }, select: { id: true, name: true } }),
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
    containers: {
      count: spaces.length + folders.length + lists.length,
      spaces: spaces.length,
      folders: folders.length,
      lists: lists.length,
      items: [...spaces, ...folders, ...lists].slice(0, LIST_CAP),
    },
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

  // The one handover (src/lib/people/handover.server.ts): open tasks,
  // direct reports (never into a loop) and the Spaces, Folders and Lists
  // they own, in one transaction. History is never rewritten.
  const result = await runHandover({ organizationId: orgId, fromId: id, toId: reassignToId, actorId: getUserId(session) });

  logActivity({
    type: "user_handover",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Handed over ${result.tasksReassigned} open tasks, ${result.reportsReassigned} direct reports and ${result.containersReassigned} Spaces, Folders and Lists from ${target.firstName} ${target.lastName} to ${recipient.firstName} ${recipient.lastName}`,
    targetId: id,
    targetType: "user",
    metadata: { recipientId: reassignToId, ...result, reportsRehomed: result.reportsRehomed.length },
  });

  return jsonSuccess(result);
}
