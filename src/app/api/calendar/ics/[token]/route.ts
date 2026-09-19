import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { renderICalendar, type ICalEvent } from "@/services/icalExport";

/**
 * Public iCal feed. Auth is the per-user token in the URL — no session
 * cookie, so external calendar apps can subscribe unauthenticated.
 *
 * Content is the tasks assigned to the user (owner or assignee, on the Item
 * model) plus meetings they're attending, within
 * a ±7-day → +90-day window. Keeping the window bounded means the feed
 * stays small and the calendar app doesn't have to render years of
 * history.
 *
 * Returns `text/calendar; charset=utf-8`. Apple, Google, and Outlook all
 * interpret `webcal://` links by treating them as http/https GETs.
 */

const TTL_MINUTES = 15;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  // Trim the optional `.ics` suffix so `/token.ics` and `/token` both work.
  const token = raw.replace(/\.ics$/, "");

  const sub = await prisma.calendarSubscription.findFirst({
    where: { provider: "ICS_EXPORT", accessToken: token, enabled: true },
    select: { userId: true },
  });
  if (!sub) return new Response("Unknown or revoked feed token", { status: 404 });

  const user = await prisma.user.findUnique({
    where: { id: sub.userId },
    select: { firstName: true, lastName: true, organization: { select: { name: true } } },
  });

  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const [tasks, meetings] = await Promise.all([
    // Phase 2 W4. This read the legacy `Task` table. Those rows are Items now
    // (scripts/migrate-legacy-tasks.ts), and leaving the query here would have
    // emptied every subscriber's calendar feed silently on the day the
    // migration ran: an ICS feed that returns zero events looks exactly like a
    // person with nothing scheduled.
    //
    // Two things the Item model changes here, both of them fixes:
    //   - it matched `assigneeId`, one person. A task assigned to you by
    //     somebody else now appears on your feed as well as your own tasks.
    //   - every event gets a real URL (`/item/<id>`). The legacy rows pointed
    //     at the bare `/tasks` index, which is a redirect now, so clicking an
    //     event in Apple Calendar landed on a landing page rather than the task.
    prisma.item.findMany({
      where: {
        archivedAt: null,
        OR: [{ ownerId: sub.userId }, { assigneeIds: { has: sub.userId } }],
        AND: [{ OR: [{ dueAt: { gte: from, lte: to } }, { startAt: { gte: from, lte: to } }] }],
      },
      select: {
        // No `status`: the old query selected it and then set every event to
        // CONFIRMED either way, so it was never read. A finished task is still
        // a real thing that happened on that day.
        id: true, title: true, startAt: true, dueAt: true,
        updatedAt: true, metadata: true,
      },
      take: 1000,
    }),
    prisma.meeting.findMany({
      where: {
        scheduledAt: { gte: from, lte: to },
        attendees: { some: { userId: sub.userId } },
      },
      select: {
        id: true, title: true, agenda: true,
        scheduledAt: true, duration: true, updatedAt: true,
      },
      take: 1000,
    }),
  ]);

  const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
  const events: ICalEvent[] = [];

  for (const t of tasks) {
    const meta = (t.metadata ?? {}) as { description?: unknown; legacyTask?: { externalSource?: string } };
    // A task that came from Google Calendar is already on the subscriber's
    // Google calendar; re-exporting it would show them two of everything. The
    // legacy `externalSource` column is preserved under the migrated
    // remainder, which is where that provenance lives now.
    if (meta.legacyTask?.externalSource) continue;
    const start = t.startAt ?? t.dueAt;
    const end = t.dueAt ?? (t.startAt ? new Date(t.startAt.getTime() + 30 * 60 * 1000) : null);
    if (!start || !end) continue; // unscheduled task, nothing to put on a calendar
    events.push({
      kind: "task",
      id: t.id,
      title: t.title,
      description: typeof meta.description === "string" ? meta.description : null,
      startAt: start,
      // A single-day task (a due date and no start) would otherwise render as
      // a zero-length event that some calendar apps drop entirely.
      endAt: end > start ? end : new Date(start.getTime() + 30 * 60 * 1000),
      allDay: !t.startAt,
      updatedAt: t.updatedAt,
      url: `${baseUrl}/item/${t.id}`,
    });
  }

  for (const m of meetings) {
    const end = new Date(m.scheduledAt.getTime() + (m.duration || 30) * 60 * 1000);
    events.push({
      kind: "meeting",
      id: m.id,
      title: `Meeting: ${m.title}`,
      description: m.agenda,
      startAt: m.scheduledAt,
      endAt: end,
      allDay: false,
      updatedAt: m.updatedAt,
      url: `${baseUrl}/meetings/${m.id}`,
    });
  }

  const calName = user
    ? `${user.firstName} ${user.lastName} · Workwrk`
    : "Workwrk";
  const body = renderICalendar(events, { calendarName: calName, refreshMinutes: TTL_MINUTES });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="workwrk.ics"`,
      "Cache-Control": `public, max-age=${TTL_MINUTES * 60}, stale-while-revalidate=${TTL_MINUTES * 120}`,
    },
  });
}
