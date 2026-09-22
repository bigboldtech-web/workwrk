import { prisma } from "@/lib/prisma";
import type { CalendarSubscription } from "@/generated/prisma";
import {
  ensureFreshToken,
  listEvents,
  GOOGLE_CAL_SOURCE,
  type GoogleEvent,
} from "./googleCalendar";

/**
 * Incremental sync of Google Calendar events into WorkwrK.
 *
 * Design decisions:
 *  · Google events land as `CalendarEvent` rows with
 *    `externalSource = "GCAL"`, which is the table the Calendar reads
 *    (`GET /api/calendar/events`). They are reported to the client under
 *    `kind: "external"` and are not editable there; edit them in Google
 *    and the next pass brings the change across.
 *  · A legacy `Task` row is written alongside for one release. See the
 *    long note above `applyEvent` for exactly why and what removes it.
 *  · `externalId` is stored as `${calendarId}::${eventId}` — lets us
 *    scope cleanup by calendar when the user unsubscribes.
 *  · `syncToken` lives on each per-calendar subscription row. First run
 *    uses a `timeMin` of 30 days ago and no syncToken; Google returns a
 *    syncToken in the last page. Subsequent runs pass that token and
 *    receive deltas only. On 410 (token expired), we clear it and the
 *    next pass does a full resync.
 *  · Privacy: when the subscription has `shareTitles=false`, we write
 *    the task title as "Busy" — external event detail stays on the
 *    user's Google calendar, only the time block is visible to peers
 *    and managers inside Workwrk.
 */

const INITIAL_WINDOW_DAYS = 30;

export async function syncAllSubscriptions(): Promise<{
  subscriptions: number;
  inserted: number;
  updated: number;
  deleted: number;
  failed: number;
}> {
  const subs = await prisma.calendarSubscription.findMany({
    where: {
      provider: "GOOGLE",
      enabled: true,
      externalCalendarId: { not: null },
      direction: { in: ["IN", "BOTH"] },
    },
  });

  let inserted = 0, updated = 0, deleted = 0, failed = 0;

  for (const sub of subs) {
    try {
      const stats = await syncOne(sub);
      inserted += stats.inserted;
      updated += stats.updated;
      deleted += stats.deleted;
    } catch (err: any) {
      failed++;
      console.error(`[GCal sync] subscription ${sub.id} failed:`, err?.message ?? err);
    }
  }

  return { subscriptions: subs.length, inserted, updated, deleted, failed };
}

export async function syncOne(sub: CalendarSubscription): Promise<{
  inserted: number; updated: number; deleted: number;
}> {
  if (!sub.externalCalendarId) throw new Error("Per-calendar subscription must have externalCalendarId");

  // Pull tokens off the master row (externalCalendarId null) for this user.
  const master = await prisma.calendarSubscription.findFirst({
    where: { userId: sub.userId, provider: "GOOGLE", externalCalendarId: null },
  });
  if (!master) throw new Error("No master subscription with tokens");

  const token = await ensureFreshToken(master);

  // User's orgId for writing tasks.
  const user = await prisma.user.findUnique({
    where: { id: sub.userId },
    select: { organizationId: true },
  });
  if (!user) throw new Error("User not found");

  const calendarId = sub.externalCalendarId;
  let syncToken = sub.syncToken ?? undefined;
  let pageToken: string | undefined;
  let inserted = 0, updated = 0, deleted = 0;
  let newSyncToken: string | undefined;

  // Outer loop: paginate until no more pages. `syncToken` is only ever
  // returned on the last page.
  const timeMin = new Date(Date.now() - INITIAL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  while (true) {
    let page;
    try {
      page = await listEvents(token, calendarId, { syncToken, pageToken, timeMin });
    } catch (err: any) {
      if (err?.code === 410) {
        // Sync token expired — reset and let the next cron pass do a full resync.
        await prisma.calendarSubscription.update({
          where: { id: sub.id },
          data: { syncToken: null },
        });
        return { inserted, updated, deleted };
      }
      throw err;
    }

    for (const event of page.items) {
      const result = await applyEvent(event, {
        userId: sub.userId,
        organizationId: user.organizationId,
        calendarId,
        shareTitles: sub.shareTitles,
        subscriptionId: sub.id,
      });
      if (result === "inserted") inserted++;
      else if (result === "updated") updated++;
      else if (result === "deleted") deleted++;
    }

    if (page.nextPageToken) {
      pageToken = page.nextPageToken;
      continue;
    }
    newSyncToken = page.nextSyncToken;
    break;
  }

  await prisma.calendarSubscription.update({
    where: { id: sub.id },
    data: {
      syncToken: newSyncToken ?? sub.syncToken,
      lastSyncAt: new Date(),
    },
  });

  return { inserted, updated, deleted };
}

/**
 * Write one Google event into the product.
 *
 * WHERE IT LANDS, AND WHY THAT CHANGED (Phase 4, spec-planner section 2
 * `/planner` Data and section 4 step 5).
 *
 * It used to write a row into the LEGACY `Task` table. The Planner read
 * `Item`. So a connected Google Calendar produced rows that no surface in
 * the product rendered, and the whole connect flow was invisible end to
 * end: a person clicked Connect, granted access, and saw nothing, forever.
 *
 * It writes `CalendarEvent` now, which is the table the calendar read
 * actually reads. The legacy `Task` write is kept BESIDE it, deliberately
 * and temporarily, for two reasons:
 *
 *   1. `/api/calendar/events` still reads the GCAL-marked Item rows the
 *      previous migration left behind, so the two sources agree while
 *      scripts/backfill-calendar-events.mjs has not been run in a given
 *      workspace.
 *   2. Disconnecting deletes the legacy rows by `assigneeId` +
 *      `externalSource` (src/app/api/integrations/google-calendar/route.ts),
 *      and that path has to keep finding what it is meant to remove until
 *      it moves in its own step.
 *
 * The CalendarEvent write is WRAPPED: a deployment that has not applied
 * prisma/sql/2026-09-22-calendar-event.sql yet keeps syncing exactly as it
 * did before rather than failing the whole cron.
 */
async function applyEvent(
  event: GoogleEvent,
  ctx: { userId: string; organizationId: string; calendarId: string; shareTitles: boolean; subscriptionId?: string },
): Promise<"inserted" | "updated" | "deleted" | "skipped"> {
  if (!event.id) return "skipped";
  const externalId = `${ctx.calendarId}::${event.id}`;

  // Deleted / cancelled events: tombstone handling on both tables.
  if (event.status === "cancelled") {
    await deleteCalendarEvent(ctx.userId, externalId);
    const existing = await prisma.task.findFirst({
      where: { externalSource: GOOGLE_CAL_SOURCE, externalId },
      select: { id: true },
    });
    if (!existing) return "skipped";
    await prisma.task.delete({ where: { id: existing.id } });
    return "deleted";
  }

  const start = event.start ?? {};
  const end = event.end ?? {};
  const allDay = !start.dateTime;
  const startAt = start.dateTime ? new Date(start.dateTime) : null;
  const endAt = end.dateTime ? new Date(end.dateTime) : null;
  const date = startAt ?? (start.date ? new Date(start.date) : new Date());

  // The viewer's own reply to the invitation. Google marks their attendee
  // entry with `self`; an event nobody was invited to has no attendees at
  // all and is never declined.
  const declined = (event.attendees ?? []).some((a) => a.self && a.responseStatus === "declined");

  const title = ctx.shareTitles ? (event.summary?.trim() || "(No title)") : "Busy";
  const description = ctx.shareTitles ? (event.description?.trim() || null) : null;

  await upsertCalendarEvent({
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    subscriptionId: ctx.subscriptionId ?? null,
    externalId,
    title,
    description,
    startAt: date,
    // An all-day Google event carries no end time; the day it sits on is
    // the whole answer, so the row ends a minute before the same time
    // tomorrow and never bleeds into the next column.
    endAt: endAt ?? (allDay ? new Date(date.getTime() + 24 * 3_600_000 - 60_000) : new Date(date.getTime() + 3_600_000)),
    allDay,
    declined,
  });

  const existing = await prisma.task.findFirst({
    where: { externalSource: GOOGLE_CAL_SOURCE, externalId },
    select: { id: true },
  });

  const base = {
    title,
    description,
    date,
    startAt,
    endAt,
    allDay,
    externalSource: GOOGLE_CAL_SOURCE,
    externalId,
    syncedAt: new Date(),
  };

  if (existing) {
    await prisma.task.update({ where: { id: existing.id }, data: base });
    return "updated";
  }

  await prisma.task.create({
    data: {
      ...base,
      assigneeId: ctx.userId,
      organizationId: ctx.organizationId,
      status: "PLANNED",
      // Google events live in their own lane — not tied to an org KRA.
      kraId: null,
    },
  });
  return "inserted";
}

/** Upsert on (userId, externalSource, externalId): the sync's idempotency key. */
async function upsertCalendarEvent(row: {
  userId: string;
  organizationId: string;
  subscriptionId: string | null;
  externalId: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  declined: boolean;
}): Promise<void> {
  // TWO ATTEMPTS, AND THE SECOND ONE IS THE TOLERANCE RULE. `declined`
  // arrives with prisma/sql/2026-09-22-calendar-declined.sql; a deployment
  // that has the table but not yet the column must keep syncing rather than
  // losing every event, so the write is retried without the field.
  try {
    await writeCalendarEvent(row, true);
  } catch {
    try {
      await writeCalendarEvent(row, false);
    } catch {
      // The table is not there on this deployment yet. The legacy write in
      // applyEvent still happens, so the sync is exactly as useful as it was.
    }
  }
}

async function writeCalendarEvent(
  row: {
    userId: string;
    organizationId: string;
    subscriptionId: string | null;
    externalId: string;
    title: string;
    description: string | null;
    startAt: Date;
    endAt: Date;
    allDay: boolean;
    declined: boolean;
  },
  withDeclined: boolean,
): Promise<void> {
  await prisma.calendarEvent.upsert({
      where: {
        userId_externalSource_externalId: {
          userId: row.userId,
          externalSource: GOOGLE_CAL_SOURCE,
          externalId: row.externalId,
        },
      },
      create: {
        organizationId: row.organizationId,
        userId: row.userId,
        title: row.title,
        kind: "EVENT",
        startAt: row.startAt,
        endAt: row.endAt,
        allDay: row.allDay,
        description: row.description,
        externalSource: GOOGLE_CAL_SOURCE,
        externalId: row.externalId,
        subscriptionId: row.subscriptionId,
        ...(withDeclined ? { declined: row.declined } : {}),
      },
      update: {
        title: row.title,
        startAt: row.startAt,
        endAt: row.endAt,
        allDay: row.allDay,
        description: row.description,
        subscriptionId: row.subscriptionId,
        ...(withDeclined ? { declined: row.declined } : {}),
      },
  });
}

async function deleteCalendarEvent(userId: string, externalId: string): Promise<void> {
  try {
    await prisma.calendarEvent.deleteMany({
      where: { userId, externalSource: GOOGLE_CAL_SOURCE, externalId },
    });
  } catch {
    // Same tolerance as the upsert above.
  }
}
