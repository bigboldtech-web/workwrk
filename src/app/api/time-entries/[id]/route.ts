// Edit / delete a time entry. Owner can change hours / description /
// task on a DRAFT timesheet. Submitted/approved timesheets are locked
// — owner has to retract first.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";

const MAX_HOURS_PER_ENTRY = 24;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const entry = await prisma.timeEntry.findFirst({
    where: { id, organizationId: orgId },
    include: { timesheet: { select: { status: true, userId: true } } },
  });
  if (!entry) return jsonError("Entry not found", 404);
  if (entry.timesheet.userId !== userId) return jsonError("Forbidden", 403);
  if (entry.timesheet.status !== "DRAFT") {
    return jsonError(`Cannot edit entries on a ${entry.timesheet.status} timesheet`, 409);
  }
  // Active punch — refuse direct edit, must clock out first.
  if (entry.clockedInAt && !entry.clockedOutAt) {
    return jsonError("Stop the active punch before editing", 409);
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.hours !== undefined) {
    const num = Number(body.hours);
    if (!Number.isFinite(num) || num <= 0 || num > MAX_HOURS_PER_ENTRY) {
      return jsonError(`hours must be > 0 and ≤ ${MAX_HOURS_PER_ENTRY}`);
    }
    data.hours = num;
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if (body.taskId !== undefined) {
    if (body.taskId === null || body.taskId === "") {
      data.taskId = null;
    } else if (typeof body.taskId === "string") {
      const task = await prisma.task.findFirst({
        where: { id: body.taskId, organizationId: orgId },
        select: { id: true },
      });
      data.taskId = task?.id ?? null;
    }
  }

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.timeEntry.update({ where: { id }, data });
  return jsonSuccess({
    ...updated,
    hours: updated.hours === null ? null : Number(updated.hours),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const entry = await prisma.timeEntry.findFirst({
    where: { id, organizationId: orgId },
    include: { timesheet: { select: { status: true, userId: true } } },
  });
  if (!entry) return jsonError("Entry not found", 404);
  if (entry.timesheet.userId !== userId) return jsonError("Forbidden", 403);
  if (entry.timesheet.status !== "DRAFT") {
    return jsonError(`Cannot delete entries on a ${entry.timesheet.status} timesheet`, 409);
  }

  await prisma.timeEntry.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
