import { prisma } from "@/lib/prisma";
import {
  ensureFreshToken,
  insertEvent,
  updateEvent,
  deleteEvent,
  GOOGLE_CAL_SOURCE,
  isGoogleEnabled,
} from "./googleCalendar";

/**
 * Push a Workwrk-native task to Google Calendar.
 *
 * Picks the assignee's first OUT/BOTH per-calendar subscription as the
 * target. Users with multiple write targets can refine later — for the
 * 80% case (one "my work" calendar) this keeps the UX simple.
 *
 * Idempotency: `externalId` on the task is the Google event ID we
 * created on the first push. Subsequent edits PATCH that event; delete
 * removes it.
 *
 * All calls here are fire-and-forget from the task API — errors are
 * logged and the next edit/create will reconcile.
 */
export async function pushTaskToGoogle(taskId: string): Promise<void> {
  if (!isGoogleEnabled()) return;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true, title: true, description: true,
      date: true, startAt: true, endAt: true, allDay: true,
      externalId: true, externalSource: true,
      assigneeId: true,
    },
  });
  if (!task) return;
  // Don't echo GCAL-sourced tasks back to Google.
  if (task.externalSource === GOOGLE_CAL_SOURCE) return;

  const { target, token } = await resolveWriteTarget(task.assigneeId) ?? {};
  if (!target || !token) return;

  const payload = buildEventPayload(task);

  try {
    if (task.externalId) {
      // externalId of a Workwrk-native task = `${calendarId}::${eventId}`
      const [calId, eventId] = task.externalId.split("::");
      // If user changed their write target, stale-calendar tasks still
      // update on the calendar that owns them.
      await updateEvent(token, calId || target.externalCalendarId!, eventId, payload);
    } else {
      const created = await insertEvent(token, target.externalCalendarId!, payload);
      await prisma.task.update({
        where: { id: task.id },
        data: {
          externalId: `${target.externalCalendarId}::${created.id}`,
          externalSource: null, // Workwrk-native with a Google shadow
          syncedAt: new Date(),
        },
      });
    }
  } catch (err: any) {
    console.error(`[GCal push] task ${task.id} failed:`, err?.message ?? err);
  }
}

export async function deleteTaskFromGoogle(taskSnapshot: {
  id: string;
  externalId: string | null;
  externalSource: string | null;
  assigneeId: string;
}): Promise<void> {
  if (!isGoogleEnabled()) return;
  if (!taskSnapshot.externalId) return;
  if (taskSnapshot.externalSource === GOOGLE_CAL_SOURCE) return; // not ours to delete on their side

  const resolved = await resolveWriteTarget(taskSnapshot.assigneeId);
  if (!resolved) return;

  const [calId, eventId] = taskSnapshot.externalId.split("::");
  try {
    await deleteEvent(resolved.token, calId, eventId);
  } catch (err: any) {
    console.error(`[GCal push] delete failed for task ${taskSnapshot.id}:`, err?.message ?? err);
  }
}

async function resolveWriteTarget(userId: string): Promise<{ target: { externalCalendarId: string | null }; token: string } | null> {
  const target = await prisma.calendarSubscription.findFirst({
    where: {
      userId,
      provider: "GOOGLE",
      direction: { in: ["OUT", "BOTH"] },
      enabled: true,
      externalCalendarId: { not: null },
    },
  });
  if (!target) return null;

  const master = await prisma.calendarSubscription.findFirst({
    where: { userId, provider: "GOOGLE", externalCalendarId: null },
  });
  if (!master) return null;

  try {
    const token = await ensureFreshToken(master);
    return { target, token };
  } catch (err: any) {
    console.error(`[GCal push] token refresh for user ${userId} failed:`, err?.message ?? err);
    return null;
  }
}

function buildEventPayload(task: {
  title: string;
  description: string | null;
  date: Date;
  startAt: Date | null;
  endAt: Date | null;
  allDay: boolean;
}): {
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
} {
  const payload: ReturnType<typeof buildEventPayload> = {
    summary: task.title,
    description: task.description ?? undefined,
    start: {},
    end: {},
  };

  if (task.allDay) {
    // All-day Google events use YYYY-MM-DD with exclusive end date.
    const startDay = (task.startAt ?? task.date).toISOString().slice(0, 10);
    const endDayInclusive = task.endAt ?? task.startAt ?? task.date;
    const endDay = new Date(endDayInclusive);
    endDay.setDate(endDay.getDate() + 1); // Google uses exclusive end
    payload.start = { date: startDay };
    payload.end = { date: endDay.toISOString().slice(0, 10) };
  } else {
    const start = task.startAt ?? task.date;
    const end = task.endAt ?? new Date(start.getTime() + 30 * 60 * 1000);
    payload.start = { dateTime: start.toISOString() };
    payload.end = { dateTime: end.toISOString() };
  }

  return payload;
}
