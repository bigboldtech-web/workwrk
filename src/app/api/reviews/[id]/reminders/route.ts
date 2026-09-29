// POST /api/reviews/[id]/reminders { subjectIds? } -> { notified }
//
// Send a reminder (the /reviews row menu, the cycle page "...", and the
// Team table's bulk bar with `subjectIds`). Who is reminded, inside the
// sender's reach (the People team and Admin: the cycle; anyone else: their
// chain and the people they review):
//   a subject whose own review is not submitted     "Your review for {cycle} is due {date}"
//   a reviewer who still owes manager reviews       "You owe N manager reviews for {cycle}"
// Never the sender themself, and one reminder per person per cycle in 12
// hours, so a worried manager never floods anyone's Inbox.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { cycleViewerCtx } from "@/lib/performance/review-cycle.server";
import { formatDate } from "@/lib/format/date";

const QUIET_MS = 12 * 60 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const ctx = await cycleViewerCtx();
  if (!ctx || ctx.isGuest) return jsonError("Not found", 404);
  const { id } = await params;
  const orgId = getOrgId(session);
  const cycle = await prisma.reviewCycle.findFirst({ where: { id, organizationId: orgId } });
  if (!cycle) return jsonError("Review cycle not found", 404);
  if (cycle.status !== "ACTIVE" && cycle.status !== "IN_CALIBRATION") return jsonError("Only an open cycle sends reminders", 409);

  const body = ((await req.json().catch(() => null)) ?? {}) as { subjectIds?: unknown };
  const only = Array.isArray(body.subjectIds) ? new Set(body.subjectIds.filter((x): x is string => typeof x === "string")) : null;

  const rows = await prisma.review.findMany({
    where: { cycleId: id, subject: { deletedAt: null } },
    select: { subjectId: true, reviewerId: true, status: true },
  });
  const inReach = (r: { subjectId: string; reviewerId: string }) =>
    ctx.peopleTeamOrAdmin || ctx.chain.has(r.subjectId) || r.reviewerId === ctx.userId || (cycle.createdById === ctx.userId && ctx.chain.has(r.subjectId));
  const reach = rows.filter((r) => inReach(r) && (!only || only.has(r.subjectId)));
  if (!reach.length && !ctx.peopleTeamOrAdmin && cycle.createdById !== ctx.userId) return jsonError("Not found", 404);

  const since = new Date(Date.now() - QUIET_MS);
  const link = `/reviews/${id}`;
  const due = formatDate(cycle.endDate, { timezone: "UTC" }, "date");
  const recent = await prisma.notification.findMany({
    where: { link: { startsWith: link }, createdAt: { gte: since }, type: { in: ["review_open", "manager_reviews_due"] } },
    select: { userId: true, type: true },
  });
  const quiet = new Set(recent.map((n) => `${n.type}:${n.userId}`));

  const data: Array<{ userId: string; type: string; title: string; message: string; link: string }> = [];
  if (cycle.status === "ACTIVE") {
    for (const r of reach) {
      if (r.status !== "PENDING" || r.subjectId === ctx.userId || quiet.has(`review_open:${r.subjectId}`)) continue;
      data.push({ userId: r.subjectId, type: "review_open", title: `Your review for ${cycle.name} is open`, message: `Due ${due}`, link });
    }
  }
  const owed = new Map<string, number>();
  for (const r of reach) {
    if (r.status !== "PENDING" && r.status !== "SELF_ASSESSMENT") continue;
    if (r.reviewerId === ctx.userId || r.reviewerId === r.subjectId) continue;
    owed.set(r.reviewerId, (owed.get(r.reviewerId) ?? 0) + 1);
  }
  for (const [reviewerId, n] of owed) {
    if (quiet.has(`manager_reviews_due:${reviewerId}`)) continue;
    data.push({
      userId: reviewerId,
      type: "manager_reviews_due",
      title: `You owe ${n} manager ${n === 1 ? "review" : "reviews"} for ${cycle.name}`,
      message: `Due ${due}`,
      link: `${link}?tab=team`,
    });
  }
  if (data.length) await prisma.notification.createMany({ data });
  return jsonSuccess({ notified: data.length });
}
