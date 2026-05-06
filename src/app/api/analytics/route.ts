import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { getTopPerformers } from "@/services/performanceScoreService";

// Analytics is gated at the API level — managers and above only.
// Sidebar already has managerOnly=true on the entry, but defence in
// depth so a direct fetch from a logged-in employee can't pull the
// org-wide rollups.
export async function GET(req: Request) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) {
    return jsonError("Analytics requires manager-level access", 403);
  }

  try {
  const orgId = getOrgId(session);
  const now = new Date();

  // Parse date range
  const url = new URL(req.url);
  const range = url.searchParams.get("range") || "6m";
  const rangeMonths: Record<string, number> = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 };
  const months = rangeMonths[range] || 6;
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - months, 1);

  const [users, departments, sops, sopCompliance, kpiRecords, checkIns, kraAssignments] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: orgId },
      include: {
        department: { select: { name: true } },
        role: { select: { title: true } },
        kpiRecords: { where: { createdAt: { gte: rangeStart } }, select: { score: true, period: true, createdAt: true } },
      },
    }),
    prisma.department.findMany({
      where: { organizationId: orgId },
      include: { _count: { select: { members: true } } },
    }),
    prisma.sOP.findMany({ where: { organizationId: orgId }, select: { status: true, category: true } }),
    prisma.sOPCompliance.findMany({
      where: { sop: { organizationId: orgId } },
      select: { stepsTotal: true, stepsCompleted: true },
    }),
    prisma.kPIRecord.findMany({
      where: { kpi: { organizationId: orgId }, createdAt: { gte: rangeStart } },
      select: { score: true, period: true, createdAt: true, userId: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.checkIn.findMany({
      where: { user: { organizationId: orgId }, createdAt: { gte: rangeStart } },
      select: { mood: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.kRAAssignment.count({ where: { kra: { organizationId: orgId }, status: "ACTIVE" } }),
  ]);

  // Company health score
  const allScores = kpiRecords.filter((r) => r.score != null).map((r) => r.score!);
  const avgKPI = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  const totalSteps = sopCompliance.reduce((s, r) => s + r.stepsTotal, 0);
  const completedSteps = sopCompliance.reduce((s, r) => s + r.stepsCompleted, 0);
  const sopComplianceRate = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  const avgMood = checkIns.length > 0
    ? checkIns.reduce((s, c) => s + (c.mood || 3), 0) / checkIns.length
    : 3;

  const healthScore = Math.round(avgKPI * 0.5 + sopComplianceRate * 0.3 + (avgMood / 5) * 100 * 0.2);

  // Monthly trend (last 6 months)
  const monthlyTrend = [];
  for (let i = 5; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthName = monthStart.toLocaleString("default", { month: "short" });

    const monthScores = kpiRecords
      .filter((r) => r.createdAt >= monthStart && r.createdAt <= monthEnd && r.score != null)
      .map((r) => r.score!);
    const monthAvgKPI = monthScores.length > 0 ? Math.round(monthScores.reduce((a, b) => a + b, 0) / monthScores.length) : 0;

    monthlyTrend.push({
      month: monthName,
      kpiRecords: monthScores.length,
      avgKPI: monthAvgKPI,
    });
  }

  // Department comparison
  const deptComparison = departments.map((d) => {
    const deptUsers = users.filter((u) => u.department?.name === d.name);
    const deptKPIs = deptUsers.flatMap((u) => u.kpiRecords.filter((r) => r.score != null).map((r) => r.score!));
    const deptAvgKPI = deptKPIs.length > 0 ? Math.round(deptKPIs.reduce((a, b) => a + b, 0) / deptKPIs.length) : 0;

    return {
      name: d.name,
      members: d._count.members,
      avgKPI: deptAvgKPI,
    };
  });

  // Performance score trend — single query instead of 6 sequential ones
  const periods = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const allTrendScores = await prisma.performanceScore.findMany({
    where: { organizationId: orgId, period: { in: periods } },
    select: { score: true, period: true },
  });
  const scoreTrendMonths = periods.map((period) => {
    const scores = allTrendScores.filter((s) => s.period === period);
    const avg = scores.length > 0 ? Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length) : 0;
    return { period, avgScore: avg, count: scores.length };
  });

  // Top performers
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

  // Most Recognized
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const monthlyKudos = await prisma.kudos.findMany({
    where: { organizationId: orgId, createdAt: { gte: monthStart, lte: monthEnd } },
    select: { receiverId: true },
  });

  const kudosCounts: Record<string, number> = {};
  for (const k of monthlyKudos) kudosCounts[k.receiverId] = (kudosCounts[k.receiverId] || 0) + 1;
  const sortedKudos = Object.entries(kudosCounts).sort(([, a], [, b]) => b - a).slice(0, 5);
  const kudosUsers = sortedKudos.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: sortedKudos.map(([id]) => id) } },
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
    dateRange: { range, months, from: rangeStart.toISOString(), to: now.toISOString() },
    healthScore,
    keyMetrics: {
      totalPeople: users.length,
      avgKPI: Math.round(avgKPI),
      activeKRAs: kraAssignments,
      sopComplianceRate: Math.round(sopComplianceRate),
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
  } catch (err) {
    console.error("[analytics] failed:", err);
    const msg = err instanceof Error ? err.message : "Analytics query failed";
    const isSchema = /does not exist|relation .* does not exist|column .* does not exist|P2021|P2022/.test(msg);
    return Response.json(
      {
        error: isSchema
          ? "Database is out of date. Run `npx prisma migrate deploy` on the server to apply pending migrations."
          : msg,
        detail: msg,
      },
      { status: 500 },
    );
  }
}
