import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Cron — nudges people who owe a KPI score. For every user with at least
 * one KPIRecord still PENDING (never submitted) or REJECTED (a manager
 * sent it back), we drop a single aggregated Notification. The topbar
 * bell polls /api/notifications, so they see it on next load and land on
 * /today where the "KPIs to score" column lives.
 *
 * Idempotency: KPIRecord has no `lastReminderAt`, so we dedupe per USER —
 * skip anyone who already received a `kpi_score_due` notification within
 * DEDUPE_DAYS. That makes the job safe to run daily: at most one nudge per
 * user per window, regardless of how many scores they owe.
 *
 * Guard with CRON_SECRET in production (same pattern as okr-reminders /
 * email-queue). Schedule it alongside the other crons (daily, start of
 * workday).
 */

const DEDUPE_DAYS = 6;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
    const provided = header?.replace(/^Bearer\s+/i, "");
    if (provided !== cronSecret) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Everyone who owes a score: any KPI record still PENDING or REJECTED.
  const owed = await prisma.kPIRecord.groupBy({
    by: ["userId"],
    where: { status: { in: ["PENDING", "REJECTED"] } },
    _count: { _all: true },
  });

  if (owed.length === 0) {
    return Response.json({ ran: true, at: new Date().toISOString(), usersOwed: 0, nudgesCreated: 0 });
  }

  // Dedupe: who already got a KPI nudge inside the window?
  const dedupeSince = new Date(Date.now() - DEDUPE_DAYS * 86_400_000);
  const recent = await prisma.notification.findMany({
    where: {
      userId: { in: owed.map((o) => o.userId) },
      type: "kpi_score_due",
      createdAt: { gte: dedupeSince },
    },
    select: { userId: true },
  });
  const recentlyNudged = new Set(recent.map((r) => r.userId));

  let nudgesCreated = 0;
  for (const row of owed) {
    if (recentlyNudged.has(row.userId)) continue;
    const n = row._count._all;
    await prisma.notification.create({
      data: {
        userId: row.userId,
        type: "kpi_score_due",
        title: n === 1 ? "A KPI score is waiting" : `${n} KPI scores are waiting`,
        message:
          n === 1
            ? "You have a KPI score to submit. Open Today to record it."
            : `You have ${n} KPI scores to submit. Open Today to record them.`,
        link: "/today",
      },
    });
    nudgesCreated++;
  }

  return Response.json({
    ran: true,
    at: new Date().toISOString(),
    usersOwed: owed.length,
    nudgesCreated,
  });
}
