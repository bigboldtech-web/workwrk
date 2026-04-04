import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";
import { getCurrentPeriod, getLastPeriod } from "@/lib/kpi-utils";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const orgId = getOrgId(session);
  const currentPeriod = getCurrentPeriod();
  const lastPeriod = getLastPeriod();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [kraAssignments, kpiRecords, sopAssignments, reviews, performanceScore, myOkrs, todayTasks, pendingSurveys, pendingPolicies] = await Promise.all([
    // My KRA assignments with KPIs
    prisma.kRAAssignment.findMany({
      where: { userId, status: "ACTIVE" },
      include: {
        kra: {
          select: {
            id: true, name: true, category: true,
            kpis: { select: { id: true, name: true, unit: true, targetValue: true, lowerIsBetter: true } },
          },
        },
      },
    }),
    // My KPI records for current + last month
    prisma.kPIRecord.findMany({
      where: { userId, period: { in: [currentPeriod, lastPeriod] } },
      include: { kpi: { select: { id: true, name: true, unit: true, lowerIsBetter: true } } },
      orderBy: { period: "desc" },
    }),
    // My pending SOP assignments
    prisma.sOPAssignment.findMany({
      where: { userId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
      include: { sop: { select: { id: true, title: true, category: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    // My upcoming reviews
    prisma.review.findMany({
      where: { subjectId: userId, status: { in: ["PENDING", "SELF_ASSESSMENT"] } },
      include: { cycle: { select: { name: true, type: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    // Latest performance score
    prisma.performanceScore.findFirst({
      where: { userId },
      orderBy: { period: "desc" },
    }),
    // My OKRs
    prisma.oKR.findMany({
      where: { ownerId: userId },
      select: { id: true, title: true, progress: true, status: true, quarter: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    // Today's tasks
    prisma.task.findMany({
      where: { assigneeId: userId, date: { gte: today, lt: tomorrow } },
      select: { id: true, title: true, status: true, hoursSpent: true, category: true },
      orderBy: { createdAt: "asc" },
    }),
    // Pending surveys
    prisma.pulseSurvey.count({
      where: {
        organizationId: orgId,
        status: "ACTIVE",
        responses: { none: { userId } },
      },
    }),
    // Pending policies
    prisma.policy.count({
      where: {
        organizationId: orgId,
        status: "PUBLISHED",
        requiresAck: true,
        acknowledgments: { none: { userId } },
      },
    }),
  ]);

  // Calculate KPI completion for current period
  const allKpiIds = kraAssignments.flatMap((a) => a.kra.kpis.map((k) => k.id));
  const currentRecords = kpiRecords.filter((r) => r.period === currentPeriod && r.actualValue != null);
  const completionRate = allKpiIds.length > 0 ? Math.round((currentRecords.length / allKpiIds.length) * 100) : 0;

  const todayCompleted = todayTasks.filter((t) => t.status === "COMPLETED").length;

  return jsonSuccess({
    kraAssignments,
    kpiRecords,
    sopAssignments,
    reviews,
    myOkrs,
    todayTasks,
    stats: {
      compositeScore: performanceScore?.score ?? null,
      totalKpis: allKpiIds.length,
      completedKpis: currentRecords.length,
      completionRate,
      pendingSops: sopAssignments.length,
      pendingReviews: reviews.length,
      pendingSurveys,
      pendingPolicies,
      todayTasksTotal: todayTasks.length,
      todayTasksDone: todayCompleted,
    },
    currentPeriod,
    lastPeriod,
  });
}
