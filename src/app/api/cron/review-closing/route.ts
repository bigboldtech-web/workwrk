import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format/date";
import { cronRefusal } from "@/lib/cron-auth";

/**
 * Cron: the "review closes in 3 days" nudge (spec-teams-performance
 * section 4 cron rows). For every Active cycle that closes within the next
 * three days, everyone in it who has not done their part is told, once:
 *   a subject whose own review is not submitted    review_open
 *   a reviewer who still owes manager reviews      manager_reviews_due
 * Both link the cycle itself (/reviews/{cycleId}, the Team section for a
 * reviewer). Once means once: anyone already told about the cycle inside
 * its closing window (from three days before it closes) is not told again,
 * so the daily run sends one nudge per person per cycle, and a removed
 * person is never written to. The title says how long is really left
 * (today, tomorrow, or in N days).
 *
 * Schedule: daily at 8:30 (scripts/CRON-SETUP.md). NOT installed by this
 * change: the founder adds the row. Guarded by CRON_SECRET, and closed
 * when the secret is missing (src/lib/cron-auth.ts).
 */
export async function POST(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const now = new Date();
  const horizon = new Date(now.getTime() + 3 * 86_400_000);
  const cycles = await prisma.reviewCycle.findMany({
    where: { status: "ACTIVE", endDate: { gte: now, lte: horizon } },
    select: { id: true, name: true, endDate: true },
  });

  let notified = 0;
  for (const c of cycles) {
    const link = `/reviews/${c.id}`;
    const due = formatDate(c.endDate, { timezone: "UTC" }, "date");
    // The closing window opens three days before the close date: a nudge (or
    // the launch notice, for a cycle launched inside it) sent since then is
    // the one this person gets.
    const since = new Date(c.endDate.getTime() - 3 * 86_400_000);
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const endUtc = Date.UTC(c.endDate.getUTCFullYear(), c.endDate.getUTCMonth(), c.endDate.getUTCDate());
    const daysLeft = Math.max(0, Math.round((endUtc - todayUtc) / 86_400_000));
    const when = daysLeft === 0 ? "closes today" : daysLeft === 1 ? "closes tomorrow" : `closes in ${daysLeft} days`;
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
      data.push({ userId: r.subjectId, type: "review_open", title: `Your review for ${c.name} ${when}`, message: `Due ${due}`, link });
    }
    const owed = new Map<string, number>();
    for (const r of rows) if (r.reviewerId !== r.subjectId) owed.set(r.reviewerId, (owed.get(r.reviewerId) ?? 0) + 1);
    const activeReviewers = owed.size
      ? new Set((await prisma.user.findMany({ where: { id: { in: [...owed.keys()] }, deletedAt: null }, select: { id: true } })).map((u) => u.id))
      : new Set<string>();
    for (const [reviewerId, n] of owed) {
      if (!activeReviewers.has(reviewerId) || quiet.has(`manager_reviews_due:${reviewerId}`)) continue;
      data.push({ userId: reviewerId, type: "manager_reviews_due", title: `You owe ${n} manager ${n === 1 ? "review" : "reviews"} for ${c.name}`, message: `${when.charAt(0).toUpperCase()}${when.slice(1)}, ${due}`, link: `${link}?tab=team` });
    }
    if (data.length) {
      const res = await prisma.notification.createMany({ data });
      notified += res.count;
    }
  }
  return Response.json({ ran: true, at: now.toISOString(), cycles: cycles.length, notified });
}
