// Edit / delete a time entry. Owner can change hours / description /
// task on a DRAFT timesheet. Submitted/approved timesheets are locked
// The owner has to retract first.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { normaliseEntryTags } from "@/lib/timesheet-grid";

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
    select: {
      id: true, organizationId: true, timesheetId: true, userId: true, day: true,
      hours: true, description: true, taskId: true, itemId: true, source: true,
      clockedInAt: true, clockedOutAt: true, createdAt: true, updatedAt: true,
      timesheet: { select: { status: true, userId: true } },
    },
  });
  if (!entry) return jsonError("Entry not found", 404);
  if (entry.timesheet.userId !== userId) return jsonError("Forbidden", 403);
  if (entry.timesheet.status !== "DRAFT") {
    return jsonError(`Cannot edit entries on a ${entry.timesheet.status} timesheet`, 409);
  }
  // Active punch: refuse a direct edit, the person must clock out first.
  if (entry.clockedInAt && !entry.clockedOutAt) {
    return jsonError("Stop the active punch before editing", 409);
  }

  // A missing or malformed body is the contract, not a bare 500 with an
  // empty response: `req.json()` throws on both, and an unhandled throw in a
  // route handler tells the caller nothing (the punch route was fixed for
  // exactly this as audit C-1; this sibling was not).
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return jsonError("Send at least one of hours, description, itemId, taskId, billable or tags");
  }
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

  // The Item the add row and the Clock's task picker both set. Only `taskId`
  // was accepted here, so an inline edit could never re-link the thing the
  // entry was actually created against: it could only unlink it.
  if (body.itemId !== undefined) {
    if (body.itemId === null || body.itemId === "") {
      data.itemId = null;
    } else if (typeof body.itemId === "string") {
      const item = await prisma.item.findFirst({
        where: { id: body.itemId, organizationId: orgId },
        select: { id: true },
      });
      if (!item) return jsonError("That task is not in this organization", 404);
      data.itemId = item.id;
    }
  }

  // Phase 4, time-tracking depth. Both are additive, both are owner-only
  // like every other field here, and both are only reachable while the week
  // is still a DRAFT, which the guard above has already settled.
  if (body.billable !== undefined) data.billable = body.billable === true;
  if (body.tags !== undefined) data.tags = normaliseEntryTags(body.tags);

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.timeEntry.update({
    where: { id },
    data,
    select: {
      id: true, organizationId: true, timesheetId: true, userId: true, day: true,
      hours: true, description: true, taskId: true, itemId: true, source: true,
      clockedInAt: true, clockedOutAt: true, createdAt: true, updatedAt: true,
      billable: true, tags: true,
    },
  });
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
    select: {
      id: true, organizationId: true, timesheetId: true, userId: true, day: true,
      hours: true, description: true, taskId: true, itemId: true, source: true,
      clockedInAt: true, clockedOutAt: true, createdAt: true, updatedAt: true,
      timesheet: { select: { status: true, userId: true } },
    },
  });
  if (!entry) return jsonError("Entry not found", 404);
  if (entry.timesheet.userId !== userId) return jsonError("Forbidden", 403);
  if (entry.timesheet.status !== "DRAFT") {
    return jsonError(`Cannot delete entries on a ${entry.timesheet.status} timesheet`, 409);
  }

  // `select` even on a delete: without one Prisma returns every scalar of
  // the model, which is the shape that breaks against a database missing a
  // column this release knows about.
  await prisma.timeEntry.delete({ where: { id }, select: { id: true } });
  return jsonSuccess({ deleted: true });
}
