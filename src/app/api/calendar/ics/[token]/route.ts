import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { renderICalendar, type ICalEvent } from "@/services/icalExport";

/**
 * Public iCal feed. Auth is the per-user token in the URL — no session
 * cookie, so external calendar apps can subscribe unauthenticated.
 *
 * Content is the user's own tasks + meetings they're attending, within
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
    prisma.task.findMany({
      where: {
        assigneeId: sub.userId,
        // Skip Google events — they're already on the user's Google
        // calendar; re-exporting them would create duplicates.
        externalSource: null,
        OR: [
          { date: { gte: from, lte: to } },
          {
            AND: [
              { startAt: { lte: to } },
              { OR: [{ endAt: null }, { endAt: { gte: from } }] },
            ],
          },
        ],
      },
      select: {
        id: true, title: true, description: true,
        date: true, startAt: true, endAt: true, allDay: true,
        status: true, updatedAt: true,
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
    const start = t.startAt ?? t.date;
    const end = t.endAt ?? (t.startAt ? new Date(t.startAt.getTime() + 30 * 60 * 1000) : t.date);
    events.push({
      kind: "task",
      id: t.id,
      title: t.title,
      description: t.description,
      startAt: start,
      endAt: end,
      allDay: t.allDay !== false && !t.startAt,
      updatedAt: t.updatedAt,
      url: `${baseUrl}/tasks`,
      status: t.status === "COMPLETED" ? "CONFIRMED" : "CONFIRMED",
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
