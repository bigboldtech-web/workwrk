import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { computeGoalRollups, goalRollupFor } from "@/lib/alignment";
import { repeatingCycleReads, type CycleGoalRead } from "@/lib/goals/goal-period-score.server";
import { subjectRowView } from "@/lib/people/review-visibility";
import { reviewWritersIn } from "@/lib/performance/review-cycle.server";
import { cleanSelfRatings, isReviewDraft, wouldBlankDraft, selfReviewGap, subjectMayWrite } from "@/lib/performance/review-cycle";

// GET: Get current user's review for self-assessment (with auto-populated metrics)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: cycleId } = await params;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const review = await prisma.review.findFirst({
    where: { cycleId, subjectId: userId },
    include: {
      cycle: true,
      subject: {
        select: { id: true, firstName: true, lastName: true },
      },
      reviewer: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  if (!review) return jsonError("No review found for you in this cycle", 404);

  // Auto-populate KPI scores for the review period: records made inside
  // the cycle's window, the same set the save averages into kpiScore, so
  // the number shown and the number stored can never disagree.
  const kpiRecords = await prisma.kPIRecord.findMany({
    where: { userId, kpi: { organizationId: orgId }, createdAt: { gte: review.cycle.startDate, lte: review.cycle.endDate } },
    include: {
      kpi: { select: { name: true, unit: true, kra: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // The average KPI score over EVERY record in the window (the list above
  // shows the latest 200; the mean never stops at them), so the shown and
  // the stored score agree however many records there are.
  const agg = await prisma.kPIRecord.aggregate({
    where: { userId, kpi: { organizationId: orgId }, createdAt: { gte: review.cycle.startDate, lte: review.cycle.endDate }, score: { not: null } },
    _avg: { score: true },
  });
  const avgKpiScore = agg._avg.score != null ? Math.round(agg._avg.score) : null;

  // SOP compliance
  const sopRecords = await prisma.sOPCompliance.findMany({
    where: { userId, createdAt: { gte: review.cycle.startDate, lte: review.cycle.endDate } },
    select: { score: true },
    orderBy: { createdAt: "desc" },
  });
  const sopScores = sopRecords.filter((r) => r.score != null).map((r) => r.score!);
  const avgSopScore = sopScores.length > 0 ? Math.round(sopScores.reduce((a, b) => a + b, 0) / sopScores.length) : null;

  // Get KRA assignments for the user
  const kraAssignments = await prisma.kRAAssignment.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      kra: { select: { id: true, name: true, category: true, weight: true } },
    },
  });

  // OKRs owned by the user during this cycle's window. We pull every
  // owned OKR plus the check-ins inside the cycle dates so the
  // self-assessment auto-populates with what they actually shipped,
  // they barely have to type anything to fill in the "what went well"
  // section.
  const cycleStart = review.cycle?.startDate;
  const cycleEnd = review.cycle?.endDate;
  const myOkrs = await prisma.oKR.findMany({
    where: { organizationId: orgId, ownerId: userId },
    include: {
      keyResults: {
        select: {
          id: true, title: true, unit: true,
          startValue: true, currentValue: true, targetValue: true, progress: true,
          checkIns: {
            where: cycleStart && cycleEnd
              ? { createdAt: { gte: cycleStart, lte: cycleEnd } }
              : undefined,
            orderBy: { createdAt: "asc" },
            select: { id: true, value: true, note: true, createdAt: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  // Derive each goal's progress from the same org-wide rollup every other
  // surface uses (live KRs + measured children), instead of reading the
  // stored OKR.progress column, that column goes stale whenever a linked
  // KPI's reading changes, so a raw read here would disagree with the
  // dashboard and the goals page for the same goal.
  const now = new Date();
  const rollupCtx = await computeGoalRollups(orgId, now);
  // A repeating goal reads its periods inside the cycle (docs/plans/
  // recurring-goals.md G3): the mean of its scored ones, each listed with its
  // result, never the period running now unless the cycle ends inside it. A
  // Q3 review opened on 2 November reads July, August and September.
  const cycleReads = cycleStart && cycleEnd
    ? await repeatingCycleReads(rollupCtx, myOkrs.filter((o) => o.repeat).map((o) => o.id), { start: cycleStart, end: cycleEnd }, now)
    : new Map<string, CycleGoalRead>();
  const derivedOkrs = myOkrs.map((o) => {
    const roll = goalRollupFor(rollupCtx, o);
    const read = o.repeat ? cycleReads.get(o.id) : undefined;
    if (o.repeat) {
      return { ...o, progress: read?.progress ?? null, status: roll.status, progressSource: read?.progress != null ? roll.source : "NONE", periods: read?.periods ?? [] };
    }
    return { ...o, progress: roll.progress, status: roll.status, progressSource: roll.source };
  });
  // A repeating goal with no period counted in the cycle is left out of the mean.
  const averaged = derivedOkrs.filter((o) => o.progress != null);
  const okrAvgProgress = averaged.length === 0
    ? null
    : Math.round(averaged.reduce((s, o) => s + (o.progress || 0), 0) / averaged.length);

  return jsonSuccess({
    // The subject's own row never carries the manager's draft, calibration
    // or the 9-box potential (lib/people/review-visibility.ts).
    review: subjectRowView(review, userId),
    metrics: {
      kpiRecords,
      avgKpiScore,
      avgSopScore,
      okrs: derivedOkrs,
      okrAvgProgress,
    },
    kraAssignments,
  });
}

// PATCH: Submit or save draft self-assessment
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: cycleId } = await params;
  const userId = getUserId(session);

  const review = await prisma.review.findFirst({
    where: { cycleId, subjectId: userId },
    include: { cycle: { select: { startDate: true, endDate: true, status: true, name: true } } },
  });

  if (!review) return jsonError("No review found for you in this cycle", 404);
  // A submitted review is read only, and only an Active cycle takes writes
  // (lib/performance/review-cycle.ts). The old route let a draft save on a
  // SUBMITTED review put it back to "not started", which the manager and
  // the cycle's counts then read as never written.
  if (review.status !== "PENDING") return jsonError("Your review is already submitted", 409);
  if (!subjectMayWrite(review.cycle.status, review.status)) {
    return jsonError(review.cycle.status === "DRAFT" ? "This cycle has not opened yet" : "This cycle no longer takes self reviews", 409);
  }

  const body = (await req.json().catch(() => null)) ?? {};
  const submit = body.submit === true;
  // Never overwrite a stored draft with nothing (src/lib/performance/review-cycle.ts).
  if (!isReviewDraft(body.selfRatings)) return jsonError("Nothing to save: the review did not arrive. Your draft is unchanged.", 400);
  const selfRatings = cleanSelfRatings(body.selfRatings);
  if (wouldBlankDraft(review.selfRatings, selfRatings, body.allowEmpty === true)) {
    return jsonError("Nothing to save: this would empty your written draft. Your draft is unchanged.", 400);
  }
  if (submit) {
    const kras = await prisma.kRAAssignment.findMany({ where: { userId, status: "ACTIVE" }, select: { kraId: true } });
    const gap = selfReviewGap(selfRatings, kras.map((k) => k.kraId));
    if (gap) return jsonError(gap, 400);
  }
  // selfRatings: { kraRatings: [{kraId, kraName, rating, achievements}], reflection: {wentWell, couldImprove, goals} }

  // NOTE: the old "task completion rate" metric is gone, honestly. It
  // read the legacy (always-empty) prisma.task table, then wrote a
  // `taskCompletionRate` column that does not exist on Review, so
  // EVERY self-assessment save crashed with a Prisma validation error.
  // Review has no column to store it and nothing consumes it; bringing
  // it back (from the live Item model) needs a schema migration first.

  // KPI score, only records made inside this cycle's window. Averaging
  // the user's entire KPI history would score this period with last
  // year's numbers.
  const orgId = getOrgId(session);
  const kpiRecords = await prisma.kPIRecord.findMany({
    where: {
      userId,
      kpi: { organizationId: orgId },
      createdAt: { gte: review.cycle.startDate, lte: review.cycle.endDate },
    },
    select: { score: true },
  });
  const kpiScores = kpiRecords.filter((r) => r.score != null).map((r) => r.score!);
  const avgKpiScore = kpiScores.length > 0 ? Math.round(kpiScores.reduce((a, b) => a + b, 0) / kpiScores.length) : null;

  // Guarded on PENDING, so a submit racing an autosave cannot be undone by it.
  const res = await prisma.review.updateMany({
    where: { id: review.id, status: "PENDING" },
    data: {
      selfRatings,
      kpiScore: avgKpiScore,
      ...(submit ? { status: "SELF_ASSESSMENT" as const, submittedAt: new Date() } : {}),
    },
  });
  if (res.count === 0) return jsonError("Your review is already submitted", 409);
  const updated = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });

  // Tell the reviewer: whoever writes the manager half now
  // (reviewWritersIn), never an Agent's launch stamp, and never the subject
  // themself, when they have no manager.
  const writer = submit
    ? (await reviewWritersIn(getOrgId(session), [{ id: review.id, subjectId: review.subjectId, reviewerId: review.reviewerId, status: updated.status, cycleStatus: review.cycle.status }])).get(review.id) ?? null
    : null;
  if (submit && writer && writer !== userId) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    const who = me ? `${me.firstName} ${me.lastName}`.trim() : "Someone you review";
    await prisma.notification.create({
      data: {
        title: `${who} submitted their review`,
        message: `${review.cycle.name}: their manager review is yours to write.`,
        type: "review",
        link: `/reviews/${cycleId}?tab=team&person=${userId}`,
        userId: writer,
      },
    }).catch((e: unknown) => console.error("self review notification", e));
  }

  return jsonSuccess(subjectRowView(updated as unknown as Record<string, unknown>, userId));
}
