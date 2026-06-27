// Timesheet helpers — bridge card timers into the weekly timesheet.
//
// A person's hours come from the time they track on Kanban cards. When a
// card timer stops, logTimerToTimesheet drops a TimeEntry into that user's
// open (DRAFT) weekly Timesheet, linked back to the card. The timesheet then
// reads as "what they worked on + how long", aligned with the calendar.

import { prisma } from "@/lib/prisma";

/** Monday 00:00 UTC of the week containing `d` (matches Timesheet.weekStartDate). */
export function weekStartUTC(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const diff = (x.getUTCDay() + 6) % 7; // days since Monday
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}

/** 00:00 UTC of the given day (matches TimeEntry.day). */
export function dayStartUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Find or create the user's DRAFT timesheet for the week containing `date`. */
export async function getOrCreateOpenTimesheet(orgId: string, userId: string, date: Date) {
  const weekStartDate = weekStartUTC(date);
  const existing = await prisma.timesheet.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate } },
  });
  if (existing) return existing;
  return prisma.timesheet.create({
    data: { organizationId: orgId, userId, weekStartDate, status: "DRAFT" },
  });
}

/**
 * Append a tracked-time entry (from a stopped card timer) to the user's open
 * weekly timesheet. No-op if the week is already submitted/approved, so we
 * never mutate a locked sheet. Returns the created TimeEntry or null.
 */
export async function logTimerToTimesheet(input: {
  orgId: string;
  userId: string;
  itemId: string;
  title: string;
  durationMs: number;
  when: Date;
}) {
  const { orgId, userId, itemId, title, durationMs, when } = input;
  if (durationMs <= 0) return null;

  const sheet = await getOrCreateOpenTimesheet(orgId, userId, when);
  if (sheet.status !== "DRAFT") return null;

  const hours = Number((durationMs / 3_600_000).toFixed(2));
  return prisma.timeEntry.create({
    data: {
      organizationId: orgId,
      timesheetId: sheet.id,
      userId,
      day: dayStartUTC(when),
      hours,
      itemId,
      description: title,
      source: "TIMER",
      clockedInAt: new Date(when.getTime() - durationMs),
      clockedOutAt: when,
    },
  });
}
