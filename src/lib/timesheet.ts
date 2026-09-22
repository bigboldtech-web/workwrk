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
 * What the bridge did, so the caller can SAY so.
 *
 * It used to return `null` for two completely different outcomes: "the
 * duration was zero" and "your week is submitted, so the 45 minutes you
 * just logged went nowhere". The second one is a person losing time they
 * worked, silently, on the surface that feeds payroll (time.md #21). The
 * shape below lets /api/timers and /api/timers/stop hand the reason back and
 * the task Time tracker print it.
 */
export type TimerBridgeResult =
  | { logged: true; entryId: string }
  | { logged: false; reason: "empty" }
  | { logged: false; reason: "week_locked"; weekStatus: string };

/**
 * Append a tracked-time entry (from a card timer, running or manual) to the
 * user's open weekly timesheet. It never mutates a locked sheet, and it now
 * says when it did not.
 */
export async function logTimerToTimesheet(input: {
  orgId: string;
  userId: string;
  itemId: string;
  title: string;
  durationMs: number;
  when: Date;
}): Promise<TimerBridgeResult> {
  const { orgId, userId, itemId, title, durationMs, when } = input;
  if (durationMs <= 0) return { logged: false, reason: "empty" };

  const sheet = await getOrCreateOpenTimesheet(orgId, userId, when);
  if (sheet.status !== "DRAFT") {
    return { logged: false, reason: "week_locked", weekStatus: sheet.status };
  }

  const hours = Number((durationMs / 3_600_000).toFixed(2));
  const entry = await prisma.timeEntry.create({
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
    // Named columns, not the whole model: see the note in the punch route.
    // The two Phase 4 columns are deliberately absent, because this write
    // neither sets nor reads them, so the bridge keeps working on a database
    // that has not had prisma/sql/2026-09-22-work-schedule.sql applied.
    select: { id: true, timesheetId: true, day: true, hours: true },
  });
  return { logged: true, entryId: entry.id };
}

/** The sentence a surface shows for a bridge that did not write. */
export function timerBridgeMessage(result: TimerBridgeResult): string | null {
  if (result.logged || result.reason === "empty") return null;
  if (result.weekStatus === "SUBMITTED") {
    return "This time was tracked but not added to your week: the week is submitted. Retract it in Timesheets and log the hours there.";
  }
  if (result.weekStatus === "REJECTED") {
    return "This time was tracked but not added to your week: the week was sent back. Reopen it in Timesheets and log the hours there.";
  }
  return "This time was tracked but not added to your week: the week is approved. Ask your approver to reopen it.";
}
