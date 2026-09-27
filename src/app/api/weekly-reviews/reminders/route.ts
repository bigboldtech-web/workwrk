// POST /api/weekly-reviews/reminders { ids } -> { notified, skipped }
//
// The /team/reviews bulk bar's Send a reminder. Only reviews inside the
// viewer's own queue population are touched (the same server clause the
// list reads, so an id from outside it is silently skipped, never used to
// reach someone). What a reminder does depends on the row:
//   not submitted   the person is asked to submit their weekly review
//   waiting         the person's manager is told reviews are waiting for
//                   them (never the viewer themself: a People team member
//                   or a skip-level manager nudging the direct manager)
//   decided         nothing: there is nothing left to do
// One reminder per person per review in 12 hours, so a double click or a
// worried manager never floods anyone's Inbox.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listWeeklyQueue, mayOpenQueue, weeklyQueueCtx } from "@/lib/people/weekly-queue.server";
import { parseWeeklyQuery } from "@/lib/people/weekly-queue";

const QUIET_MS = 12 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const ctx = await weeklyQueueCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!mayOpenQueue(ctx)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  if (!ids.length) return NextResponse.json({ error: "Pick at least one review" }, { status: 400 });

  const q = parseWeeklyQuery(new URLSearchParams({ view: "all", scope: "chain", ids: ids.join(",") }));
  const { rows } = await listWeeklyQueue(ctx, q, { all: true });
  const since = new Date(Date.now() - QUIET_MS);
  const actor = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { firstName: true, lastName: true } });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Your manager";

  let notified = 0;
  let skipped = ids.length - rows.length;

  // Not submitted: remind the author.
  for (const r of rows.filter((x) => x.status === "DRAFT")) {
    const link = `/me/weekly-review?review=${r.id}`;
    const recent = await prisma.notification.count({ where: { userId: r.userId, type: "weekly_review_reminder", link, createdAt: { gte: since } } });
    if (recent) { skipped += 1; continue; }
    await prisma.notification.create({
      data: {
        userId: r.userId,
        type: "weekly_review_reminder",
        title: `${actorName} is waiting for your weekly review`,
        message: `Your weekly review for the week of ${r.week} is not submitted yet.`,
        link,
      },
    });
    notified += 1;
  }

  // Waiting: tell each manager (not the viewer) how many wait for them.
  const waiting = rows.filter((x) => x.status === "SUBMITTED");
  const subjects = waiting.length
    ? await prisma.user.findMany({ where: { id: { in: waiting.map((w) => w.userId) } }, select: { id: true, managerId: true } })
    : [];
  const managerOf = new Map(subjects.map((s) => [s.id, s.managerId] as const));
  const perManager = new Map<string, number>();
  for (const w of waiting) {
    const m = managerOf.get(w.userId);
    if (!m || m === ctx.userId) { skipped += 1; continue; }
    perManager.set(m, (perManager.get(m) ?? 0) + 1);
  }
  for (const [managerId, n] of perManager) {
    const recent = await prisma.notification.count({ where: { userId: managerId, type: "weekly_review_reminder", link: "/team/reviews", createdAt: { gte: since } } });
    if (recent) { skipped += n; continue; }
    await prisma.notification.create({
      data: {
        userId: managerId,
        type: "weekly_review_reminder",
        title: n === 1 ? "A weekly review is waiting for you" : `${n} weekly reviews are waiting for you`,
        message: `${actorName} sent a reminder.`,
        link: "/team/reviews",
      },
    });
    notified += 1;
  }
  skipped += rows.filter((x) => x.status === "ACKNOWLEDGED").length;
  return NextResponse.json({ notified, skipped });
}
