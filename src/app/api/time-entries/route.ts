// Time entries — create a manual hours entry. Auto-creates the
// matching weekly Timesheet on demand so an employee's first action
// on a fresh week doesn't 404.
//
// Editing the parent Timesheet's status is enforced — once submitted
// or finalized, no new entries.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { weekStartUTC, dayStartUTC } from "@/lib/timesheet-week";

const MAX_HOURS_PER_ENTRY = 24;

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const body = await req.json();
  const day = body.day ? new Date(body.day) : null;
  if (!day || Number.isNaN(day.getTime())) return jsonError("Invalid day");

  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS_PER_ENTRY) {
    return jsonError(`hours must be > 0 and ≤ ${MAX_HOURS_PER_ENTRY}`);
  }

  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const taskId = typeof body.taskId === "string" ? body.taskId : null;

  // If caller supplied a taskId, verify it belongs to their org. Soft
  // null on mismatch instead of erroring — keeps the UI from breaking
  // on stale picker state.
  let validatedTaskId: string | null = null;
  if (taskId) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
      select: { id: true },
    });
    validatedTaskId = task?.id ?? null;
  }

  const dayStart = dayStartUTC(day);
  const weekStart = weekStartUTC(dayStart);

  // Upsert timesheet first so the FK is satisfied. Concurrent calls
  // for the same week will race — the unique constraint on
  // (userId, weekStartDate) catches it; we retry the find on conflict.
  let timesheet = await prisma.timesheet.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
  });
  if (!timesheet) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { managerId: true },
    });
    try {
      timesheet = await prisma.timesheet.create({
        data: {
          organizationId: orgId,
          userId,
          weekStartDate: weekStart,
          approverId: me?.managerId ?? null,
        },
      });
    } catch {
      timesheet = await prisma.timesheet.findUnique({
        where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
      });
    }
  }
  if (!timesheet) return jsonError("Couldn't reach the week's timesheet");

  if (timesheet.status === "APPROVED" || timesheet.status === "REJECTED") {
    return jsonError(`Cannot add entries to a ${timesheet.status} timesheet`, 409);
  }
  if (timesheet.status === "SUBMITTED") {
    return jsonError("Retract the timesheet before adding entries", 409);
  }

  const entry = await prisma.timeEntry.create({
    data: {
      organizationId: orgId,
      timesheetId: timesheet.id,
      userId,
      day: dayStart,
      hours,
      description,
      taskId: validatedTaskId,
      source: "WEB",
    },
  });

  return jsonSuccess(
    {
      ...entry,
      hours: entry.hours === null ? null : Number(entry.hours),
    },
    201,
  );
}
