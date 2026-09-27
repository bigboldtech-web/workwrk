import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format/date";

/**
 * Cron: the "review closes in 3 days" nudge (spec-teams-performance
 * section 4 cron rows). For every Active cycle that closes within the next
 * three days, everyone in it who has not done their part is told, once:
 *   a subject whose own review is not submitted    review_open
 *   a reviewer who still owes manager reviews      manager_reviews_due
 * Both link the cycle itself (/reviews/{cycleId}, the Team section for a
 * reviewer). Nobody is told twice about the same cycle in 20 hours, so the
 * daily run never piles up rows, and a removed person is never written to.
 *
 * Schedule: daily at 8:30 (scripts/CRON-SETUP.md). NOT installed by this
 * change: the founder adds the row. Guarded by CRON_SECRET, and closed in
 * production when the secret is missing.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret && process.env.NODE_ENV === "production") {
    return Response.json({ error: "CRON_SECRET is not set, so the cron endpoints are closed" }, { status: 503 });
  }
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
    const provided = header?.replace(/^Bearer\s+/i, "");
    if (provided !== cronSecret) return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + 3 * 86_400_000);
  const since = new Date(now.getTime() - 20 * 60 * 60 * 1000);
  const cycles = await prisma.reviewCycle.findMany({
    where: { status: "ACTIVE", endDate: { gte: now, lte: horizon } },
    select: { id: true, name: true, endDate: true },
  });

  let notified = 0;
  for (const c of cycles) {
    const link = `/reviews/${c.id}`;
    const due = formatDate(c.endDate, { timezone: "UTC" }, "date");
    const rows = await prisma.review.findMany({
      where: { cycleId: c.id, status: { in: ["PENDING", "SELF_ASSESSMENT"] }, subject: { deletedAt: null } },
      select: { subjectId: true, reviewerId: true, status: true },
    });
    const recent = await prisma.notification.findMany({
      where: { link: { startsWith: link }, createdAt: { gte: since }, type: { in: ["review_open", "manager_reviews_due"] } },
      select: { userId: true, type: true },
    });
    const quiet = new Set(recent.map((n) => `${n.type}:${n.userId}`));
    const data: Array<{ userId: string; type: string; title: string; message: string; link: string }> = [];
    for (const r of rows) {
      if (r.status !== "PENDING" || quiet.has(`review_open:${r.subjectId}`)) continue;
      quiet.add(`review_open:${r.subjectId}`);
      data.push({ userId: r.subjectId, type: "review_open", title: `Your review for ${c.name} closes in 3 days`, message: `Due ${due}`, link });
    }
    const owed = new Map<string, number>();
    for (const r of rows) if (r.reviewerId !== r.subjectId) owed.set(r.reviewerId, (owed.get(r.reviewerId) ?? 0) + 1);
    const activeReviewers = owed.size
      ? new Set((await prisma.user.findMany({ where: { id: { in: [...owed.keys()] }, deletedAt: null }, select: { id: true } })).map((u) => u.id))
      : new Set<string>();
    for (const [reviewerId, n] of owed) {
      if (!activeReviewers.has(reviewerId) || quiet.has(`manager_reviews_due:${reviewerId}`)) continue;
      data.push({ userId: reviewerId, type: "manager_reviews_due", title: `You owe ${n} manager ${n === 1 ? "review" : "reviews"} for ${c.name}`, message: `Closes in 3 days, ${due}`, link: `${link}?tab=team` });
    }
    if (data.length) {
      const res = await prisma.notification.createMany({ data });
      notified += res.count;
    }
  }
  return Response.json({ ran: true, at: now.toISOString(), cycles: cycles.length, notified });
}
