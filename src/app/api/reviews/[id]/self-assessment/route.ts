import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

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

  return jsonSuccess({
    review,
    metrics: {
      kpiRecords,
      avgKpiScore,
      avgSopScore,
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
  });

  if (!review) return jsonError("No review found for you in this cycle", 404);
  if (review.status !== "PENDING" && review.status !== "SELF_ASSESSMENT") {
    return jsonError("Self-assessment already submitted");
  }

  const body = await req.json();
  const { selfRatings, submit } = body;
  // selfRatings: { kraRatings: [{kraId, kraName, rating, achievements}], reflection: {wentWell, couldImprove, goals} }

  // Calculate task completion rate for storage
  const orgId = getOrgId(session);
  const tasks = await prisma.task.findMany({
    where: { assigneeId: userId, organizationId: orgId },
    select: { status: true },
  });
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "COMPLETED").length;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : null;

  // Calculate KPI score
  const kpiRecords = await prisma.kPIRecord.findMany({
    where: { userId, kpi: { organizationId: orgId } },
    select: { score: true },
  });
  const kpiScores = kpiRecords.filter((r) => r.score != null).map((r) => r.score!);
  const avgKpiScore = kpiScores.length > 0 ? Math.round(kpiScores.reduce((a, b) => a + b, 0) / kpiScores.length) : null;

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: {
      selfRatings: selfRatings ?? undefined,
      kpiScore: avgKpiScore,
      taskCompletionRate,
      status: submit ? "SELF_ASSESSMENT" : "PENDING",
      ...(submit && { submittedAt: new Date() }),
    },
  });

  // Notify manager if submitted
  if (submit) {
    await prisma.notification.create({
      data: {
        title: "Self-Assessment Submitted",
        message: `${(session as any).user.name || "An employee"} has submitted their self-assessment. Please complete the manager review.`,
        type: "REVIEW",
        link: `/reviews/${cycleId}`,
        userId: review.reviewerId,
      },
    });
  }

  return jsonSuccess(updated);
}
