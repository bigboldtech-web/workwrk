import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getCurrentPeriod } from "@/lib/kpi-utils";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const userId = getUserId(session);
  const orgId = getOrgId(session);
  const currentPeriod = getCurrentPeriod();

  // Get direct reports
  const directReports = await prisma.user.findMany({
    where: { managerId: userId, organizationId: orgId, deletedAt: null },
    select: {
      id: true, firstName: true, lastName: true, avatar: true, status: true,
      role: { select: { title: true } },
      department: { select: { name: true } },
      kraAssignments: {
        where: { status: "ACTIVE" },
        select: { kra: { select: { kpis: { select: { id: true } } } } },
      },
    },
  });

  const reportIds = directReports.map((r) => r.id);

  // Get current period KPI records for all reports
  const [teamRecords, pendingApprovals, latestScores] = await Promise.all([
    prisma.kPIRecord.findMany({
      where: { userId: { in: reportIds }, period: currentPeriod },
      select: { userId: true, actualValue: true, score: true, status: true },
    }),
    // Records submitted by employees awaiting approval
    prisma.kPIRecord.findMany({
      where: { userId: { in: reportIds }, status: "SUBMITTED" },
      include: {
        user: { select: { firstName: true, lastName: true } },
        kpi: { select: { name: true, unit: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    // Latest scores for each report
    prisma.performanceScore.findMany({
      where: { userId: { in: reportIds } },
      orderBy: { period: "desc" },
      distinct: ["userId"],
    }),
  ]);

  const scoreMap = new Map(latestScores.map((s) => [s.userId, s.score]));
  const recordsByUser = new Map<string, { total: number; completed: number; avgScore: number }>();

  for (const report of directReports) {
    const totalKpis = report.kraAssignments.reduce((sum, a) => sum + a.kra.kpis.length, 0);
    const userRecords = teamRecords.filter((r) => r.userId === report.id);
    const completed = userRecords.filter((r) => r.actualValue != null).length;
    const scores = userRecords.filter((r) => r.score != null).map((r) => r.score!);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    recordsByUser.set(report.id, { total: totalKpis, completed, avgScore });
  }

  const teamMembers = directReports.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    avatar: r.avatar,
    status: r.status,
    role: r.role?.title || "",
    department: r.department?.name || "",
    compositeScore: scoreMap.get(r.id) ?? null,
    kpiTotal: recordsByUser.get(r.id)?.total ?? 0,
    kpiCompleted: recordsByUser.get(r.id)?.completed ?? 0,
    avgKpiScore: recordsByUser.get(r.id)?.avgScore ?? 0,
  }));

  const totalTeamKpis = teamMembers.reduce((sum, m) => sum + m.kpiTotal, 0);
  const completedTeamKpis = teamMembers.reduce((sum, m) => sum + m.kpiCompleted, 0);
  const teamCompletionRate = totalTeamKpis > 0 ? Math.round((completedTeamKpis / totalTeamKpis) * 100) : 0;
  const avgTeamScore = teamMembers.length > 0
    ? Math.round(teamMembers.reduce((sum, m) => sum + (m.compositeScore ?? m.avgKpiScore), 0) / teamMembers.length)
    : 0;

  return jsonSuccess({
    teamMembers,
    pendingApprovals,
    stats: {
      teamSize: teamMembers.length,
      avgTeamScore,
      teamCompletionRate,
      pendingApprovalCount: pendingApprovals.length,
    },
    currentPeriod,
  });
}
