import { prisma } from "@/lib/prisma";
import type { CalendarSubscription } from "@/generated/prisma";
import {
  ensureFreshToken,
  listEvents,
  GOOGLE_CAL_SOURCE,
  type GoogleEvent,
} from "./googleCalendar";

/**
 * Incremental sync of Google Calendar events → Workwrk Task rows.
 *
 * Design decisions:
 *  · Google events arrive as Tasks with `externalSource = "GCAL"` so the
 *    existing view code renders them for free. The edit/delete guard in
 *    the Task API blocks the user from mutating them.
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

async function applyEvent(
  event: GoogleEvent,
  ctx: { userId: string; organizationId: string; calendarId: string; shareTitles: boolean },
): Promise<"inserted" | "updated" | "deleted" | "skipped"> {
  if (!event.id) return "skipped";
  const externalId = `${ctx.calendarId}::${event.id}`;

  // Deleted / cancelled events — tombstone handling.
  if (event.status === "cancelled") {
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

  const title = ctx.shareTitles ? (event.summary?.trim() || "(No title)") : "Busy";
  const description = ctx.shareTitles ? (event.description?.trim() || null) : null;

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
