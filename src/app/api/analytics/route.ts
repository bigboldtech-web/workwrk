import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess } from "@/lib/api-helpers";
import { getTopPerformers } from "@/services/performanceScoreService";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const now = new Date();

  const [users, departments, tasks, sops, sopCompliance, kpiRecords, checkIns] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: orgId },
      include: {
        department: { select: { name: true } },
        role: { select: { title: true } },
        kpiRecords: { select: { score: true, period: true, createdAt: true } },
        assignedTasks: { select: { status: true, completedAt: true } },
      },
    }),
    prisma.department.findMany({
      where: { organizationId: orgId },
      include: { _count: { select: { members: true } } },
    }),
    prisma.task.findMany({
      where: { organizationId: orgId },
      select: { status: true, priority: true, completedAt: true, createdAt: true, deadline: true },
    }),
    prisma.sOP.findMany({ where: { organizationId: orgId }, select: { status: true, category: true } }),
    prisma.sOPCompliance.findMany({
      where: { sop: { organizationId: orgId } },
      select: { stepsTotal: true, stepsCompleted: true },
    }),
    prisma.kPIRecord.findMany({
      where: { kpi: { organizationId: orgId } },
      select: { score: true, period: true, createdAt: true, userId: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.checkIn.findMany({
      where: { user: { organizationId: orgId } },
      select: { mood: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Company health score
  const allScores = kpiRecords.filter((r) => r.score != null).map((r) => r.score!);
  const avgKPI = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "COMPLETED").length;
  const taskCompletionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  const totalSteps = sopCompliance.reduce((s, r) => s + r.stepsTotal, 0);
  const completedSteps = sopCompliance.reduce((s, r) => s + r.stepsCompleted, 0);
  const sopComplianceRate = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  const avgMood = checkIns.length > 0
    ? checkIns.reduce((s, c) => s + (c.mood || 3), 0) / checkIns.length
    : 3;

  const healthScore = Math.round(avgKPI * 0.4 + taskCompletionRate * 0.3 + sopComplianceRate * 0.2 + (avgMood / 5) * 100 * 0.1);

  // Key metrics
  const overdueTasks = tasks.filter(
    (t) => t.deadline && t.deadline < now && !["COMPLETED", "CANCELLED"].includes(t.status)
  ).length;

  // Monthly trend (last 6 months)
  const monthlyTrend = [];
  for (let i = 5; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthName = monthStart.toLocaleString("default", { month: "short" });

    const monthTasks = tasks.filter((t) => t.createdAt >= monthStart && t.createdAt <= monthEnd);
    const monthCompleted = monthTasks.filter((t) => t.status === "COMPLETED").length;
    const monthScores = kpiRecords
      .filter((r) => r.createdAt >= monthStart && r.createdAt <= monthEnd && r.score != null)
      .map((r) => r.score!);
    const monthAvgKPI = monthScores.length > 0 ? Math.round(monthScores.reduce((a, b) => a + b, 0) / monthScores.length) : 0;

    monthlyTrend.push({
      month: monthName,
      tasksCreated: monthTasks.length,
      tasksCompleted: monthCompleted,
      avgKPI: monthAvgKPI,
    });
  }

  // Department comparison
  const deptComparison = departments.map((d) => {
    const deptUsers = users.filter((u) => u.department?.name === d.name);
    const deptKPIs = deptUsers.flatMap((u) => u.kpiRecords.filter((r) => r.score != null).map((r) => r.score!));
    const deptAvgKPI = deptKPIs.length > 0 ? Math.round(deptKPIs.reduce((a, b) => a + b, 0) / deptKPIs.length) : 0;
    const deptTasks = deptUsers.flatMap((u) => u.assignedTasks);
    const deptCompleted = deptTasks.filter((t) => t.status === "COMPLETED").length;
    const deptCompletionRate = deptTasks.length > 0 ? Math.round((deptCompleted / deptTasks.length) * 100) : 0;

    return {
      name: d.name,
      members: d._count.members,
      avgKPI: deptAvgKPI,
      taskCompletion: deptCompletionRate,
      totalTasks: deptTasks.length,
    };
  });

  // Performance score trend (last 6 months)
  const scoreTrendMonths: { period: string; avgScore: number; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const scores = await prisma.performanceScore.findMany({
      where: { organizationId: orgId, period },
      select: { score: true },
    });
    const avg = scores.length > 0 ? Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length) : 0;
    scoreTrendMonths.push({
      period,
      avgScore: avg,
      count: scores.length,
    });
  }

  // Top performers by composite score
  const topComposite = await getTopPerformers(orgId, 5);
  const topPerformerUsers = topComposite.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: topComposite.map((t) => t.userId) } },
        select: {
          id: true, firstName: true, lastName: true,
          role: { select: { title: true } },
          department: { select: { name: true } },
        },
      })
    : [];

  const topPerformers = topComposite.map((t) => {
    const u = topPerformerUsers.find((u) => u.id === t.userId);
    return {
      id: t.userId,
      name: u ? `${u.firstName} ${u.lastName}` : "Unknown",
      role: u?.role?.title || "No role",
      department: u?.department?.name || "",
      score: Math.round(t.score),
    };
  });

  // Monthly "Most Recognized" leaderboard
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const monthlyKudos = await prisma.kudos.findMany({
    where: { organizationId: orgId, createdAt: { gte: monthStart, lte: monthEnd } },
    select: { receiverId: true, companyValue: true },
  });

  const kudosCounts: Record<string, number> = {};
  for (const k of monthlyKudos) {
    kudosCounts[k.receiverId] = (kudosCounts[k.receiverId] || 0) + 1;
  }
  const sortedKudos = Object.entries(kudosCounts).sort(([, a], [, b]) => b - a).slice(0, 5);
  const kudosUserIds = sortedKudos.map(([id]) => id);
  const kudosUsers = kudosUserIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: kudosUserIds } },
        select: { id: true, firstName: true, lastName: true, role: { select: { title: true } }, department: { select: { name: true } } },
      })
    : [];

  const mostRecognized = sortedKudos.map(([userId, count]) => {
    const u = kudosUsers.find((u) => u.id === userId);
    return {
      id: userId,
      name: u ? `${u.firstName} ${u.lastName}` : "Unknown",
      role: u?.role?.title || "No role",
      department: u?.department?.name || "",
      kudosCount: count,
    };
  });

  return jsonSuccess({
    healthScore,
    keyMetrics: {
      totalPeople: users.length,
      avgKPI: Math.round(avgKPI),
      taskCompletionRate: Math.round(taskCompletionRate),
      sopComplianceRate: Math.round(sopComplianceRate),
      overdueTasks,
      avgMood: Number(avgMood.toFixed(1)),
      publishedSOPs: sops.filter((s) => s.status === "PUBLISHED").length,
      totalCheckIns: checkIns.length,
    },
    monthlyTrend,
    deptComparison,
    scoreTrend: scoreTrendMonths,
    topPerformers,
    mostRecognized,
    totalKudosThisMonth: monthlyKudos.length,
  });
}
