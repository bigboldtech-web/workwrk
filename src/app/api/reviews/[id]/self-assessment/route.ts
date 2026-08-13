import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { computeGoalRollups, goalRollupFor } from "@/lib/alignment";

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

  // Auto-populate KPI scores for the review period
  const kpiRecords = await prisma.kPIRecord.findMany({
    where: { userId, kpi: { organizationId: orgId } },
    include: {
      kpi: { select: { name: true, unit: true, kra: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Calculate average KPI score
  const kpiScores = kpiRecords.filter((r) => r.score != null).map((r) => r.score!);
  const avgKpiScore = kpiScores.length > 0 ? Math.round(kpiScores.reduce((a, b) => a + b, 0) / kpiScores.length) : null;

  // SOP compliance
  const sopRecords = await prisma.sOPCompliance.findMany({
    where: { userId },
    select: { score: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const sopScores = sopRecords.filter((r) => r.score != null).map((r) => r.score!);
  const avgSopScore = sopScores.length > 0 ? Math.round(sopScores.reduce((a, b) => a + b, 0) / sopScores.length) : null;

  // Get KRA assignments for the user
  const kraAssignments = await prisma.kRAAssignment.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      kra: { select: { id: true, name: true, category: true } },
    },
  });

  // OKRs owned by the user during this cycle's window. We pull every
  // owned OKR plus the check-ins inside the cycle dates so the
  // self-assessment auto-populates with what they actually shipped —
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
  // stored OKR.progress column — that column goes stale whenever a linked
  // KPI's reading changes, so a raw read here would disagree with the
  // dashboard and the goals page for the same goal.
  const rollupCtx = await computeGoalRollups(orgId);
  const derivedOkrs = myOkrs.map((o) => {
    const roll = goalRollupFor(rollupCtx, o);
    return { ...o, progress: roll.progress, status: roll.status, progressSource: roll.source };
  });
  const okrAvgProgress = derivedOkrs.length === 0
    ? null
    : Math.round(derivedOkrs.reduce((s, o) => s + (o.progress || 0), 0) / derivedOkrs.length);

  return jsonSuccess({
    review,
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
    include: { cycle: { select: { startDate: true, endDate: true } } },
  });

  if (!review) return jsonError("No review found for you in this cycle", 404);
  if (review.status !== "PENDING" && review.status !== "SELF_ASSESSMENT") {
    return jsonError("Self-assessment already submitted");
  }

  const body = await req.json();
  const { selfRatings, submit } = body;
  // selfRatings: { kraRatings: [{kraId, kraName, rating, achievements}], reflection: {wentWell, couldImprove, goals} }

  // NOTE: the old "task completion rate" metric is gone, honestly. It
  // read the legacy (always-empty) prisma.task table, then wrote a
  // `taskCompletionRate` column that does not exist on Review — so
  // EVERY self-assessment save crashed with a Prisma validation error.
  // Review has no column to store it and nothing consumes it; bringing
  // it back (from the live Item model) needs a schema migration first.

  // KPI score — only records made inside this cycle's window. Averaging
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

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: {
      selfRatings: selfRatings ?? undefined,
      kpiScore: avgKpiScore,
      status: submit ? "SELF_ASSESSMENT" : "PENDING",
      ...(submit && { submittedAt: new Date() }),
    },
  });

  // Notify manager if submitted
  if (submit) {
    await prisma.notification.create({
      data: {
        title: "Self-Assessment Submitted",
        message: `${(session.user as { name?: string | null } | undefined)?.name || "An employee"} has submitted their self-assessment. Please complete the manager review.`,
        type: "REVIEW",
        link: `/reviews/${cycleId}`,
        userId: review.reviewerId,
      },
    });
  }

  return jsonSuccess(updated);
}
