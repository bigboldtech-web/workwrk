// Clock-in / clock-out toggle. GET returns the active punch (if
// any). POST starts or stops a punch:
//   - if the caller already has an active punch and source != "punchIn"
//     → close it (stop the clock)
//   - if no active punch → open a new one on today's day
//
// Body shape:
//   { action: "start" | "stop", taskId?: string, description?: string }
// "start" while already running is a no-op (returns the existing).

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

const MIN_PUNCH_SECONDS = 5; // refuse "stop" within 5s of "start" — likely an accidental double-click
const MAX_PUNCH_HOURS = 16; // a single clock running >16h is almost always a forgotten stop

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const active = await prisma.timeEntry.findFirst({
    where: { userId, clockedInAt: { not: null }, clockedOutAt: null },
    select: {
      id: true,
      timesheetId: true,
      day: true,
      clockedInAt: true,
      description: true,
      taskId: true,
    },
  });

  if (!active) return jsonSuccess({ active: null });
  return jsonSuccess({ active });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const body = await req.json();
  const action = typeof body.action === "string" ? body.action : "";
  const taskId = typeof body.taskId === "string" ? body.taskId : null;
  const description = typeof body.description === "string" ? body.description.trim() || null : null;

  if (!["start", "stop"].includes(action)) {
    return jsonError("action must be 'start' or 'stop'");
  }

  const active = await prisma.timeEntry.findFirst({
    where: { userId, clockedInAt: { not: null }, clockedOutAt: null },
  });

  if (action === "start") {
    if (active) {
      // Already clocked in. Don't silently double-punch.
      return jsonSuccess({ active, alreadyRunning: true });
    }

    // Validate task ownership if supplied.
    let validatedTaskId: string | null = null;
    if (taskId) {
      const task = await prisma.task.findFirst({
        where: { id: taskId, organizationId: orgId },
        select: { id: true },
      });
      validatedTaskId = task?.id ?? null;
    }

    const now = new Date();
    const day = dayStartUTC(now);
    const weekStart = weekStartUTC(day);

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
    if (timesheet.status !== "DRAFT") {
      return jsonError("Retract the timesheet before clocking new time", 409);
    }

    const entry = await prisma.timeEntry.create({
      data: {
        organizationId: orgId,
        timesheetId: timesheet.id,
        userId,
        day,
        clockedInAt: now,
        description,
        taskId: validatedTaskId,
        source: "PUNCH",
      },
    });
    return jsonSuccess({ active: entry }, 201);
  }

  // action === "stop"
  if (!active) {
    return jsonError("No active punch to stop", 409);
  }
  const now = new Date();
  const startedAt = active.clockedInAt!;
  const elapsedMs = now.getTime() - startedAt.getTime();
  if (elapsedMs < MIN_PUNCH_SECONDS * 1000) {
    return jsonError("Punch is too short — wait a moment before stopping", 409);
  }
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  if (elapsedHours > MAX_PUNCH_HOURS) {
    return jsonError(
      `This punch has been running for over ${MAX_PUNCH_HOURS}h. Please retry — likely a forgotten stop.`,
      409,
    );
  }
  const hours = Math.round(elapsedHours * 100) / 100;

  const closed = await prisma.timeEntry.update({
    where: { id: active.id },
    data: { clockedOutAt: now, hours },
  });
  return jsonSuccess({
    active: null,
    closed: { ...closed, hours: closed.hours === null ? null : Number(closed.hours) },
  });
}
