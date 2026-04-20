import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId } from "@/lib/api-helpers";
import { getTopPerformers } from "@/services/performanceScoreService";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const currentUserId = getUserId(session);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Viewer profile for survey audience checks
  const viewer = await prisma.user.findUnique({
    where: { id: currentUserId },
    select: { id: true, officeId: true, departmentId: true },
  });

  // All queries run in parallel — no sequential bottlenecks
  const [
    totalPeople,
    newPeopleThisMonth,
    departments,
    sopCount,
    sopComplianceAgg,
    pipCount,
    recentActivity,
    recentKudos,
    recentKpiRecords,
    compositeTopPerformers,
    activeSurveys,
  ] = await Promise.all([
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null } }),
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.department.findMany({
      where: { organizationId: orgId },
      select: { name: true, color: true, _count: { select: { members: true } } },
    }),
    prisma.sOP.count({ where: { organizationId: orgId, status: "PUBLISHED" } }),
    // Aggregate SOP compliance instead of fetching all records
    prisma.sOPCompliance.aggregate({
      where: { sop: { organizationId: orgId } },
      _sum: { stepsTotal: true, stepsCompleted: true },
    }),
    prisma.user.count({ where: { organizationId: orgId, status: "PIP", deletedAt: null } }),
    prisma.activityLog.findMany({
      where: { organizationId: orgId },
      include: { actor: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.kudos.findMany({
      where: { organizationId: orgId },
      include: {
        giver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        receiver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        reactions: { select: { emoji: true, userId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.kPIRecord.findMany({
      where: { kpi: { organizationId: orgId } },
      include: {
        user: { select: { firstName: true, lastName: true } },
        kpi: { select: { name: true, unit: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    getTopPerformers(orgId, 5),
    prisma.pulseSurvey.findMany({
      where: { organizationId: orgId, status: "ACTIVE" },
      include: {
        responses: { where: { userId: currentUserId }, select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  // Surface only surveys the viewer is in the audience of AND hasn't responded to
  const pendingSurveys = activeSurveys
    .filter((s) => s.responses.length === 0)
    .filter((s) => {
      if (s.audienceType === "ALL") return true;
      if (s.audienceType === "OFFICES") return !!viewer?.officeId && s.officeIds.includes(viewer.officeId);
      if (s.audienceType === "DEPARTMENTS") return !!viewer?.departmentId && s.departmentIds.includes(viewer.departmentId);
      if (s.audienceType === "USERS") return s.userIds.includes(currentUserId);
      return false;
    })
    .slice(0, 5)
    .map((s) => ({
      id: s.id,
      title: s.title,
      questions: s.questions,
      audienceType: s.audienceType,
      createdAt: s.createdAt.toISOString(),
    }));

  // SOP compliance from aggregate
  const totalSteps = sopComplianceAgg._sum.stepsTotal || 0;
  const completedSteps = sopComplianceAgg._sum.stepsCompleted || 0;
  const sopCompliance = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // Top performers — use composite scores, no need to fetch all users
  let topPerformers: { id: string; name: string; role: string; score: number; department: string }[] = [];
  if (compositeTopPerformers.length > 0) {
    const topUserIds = compositeTopPerformers.map((t) => t.userId);
    const topUsers = await prisma.user.findMany({
      where: { id: { in: topUserIds } },
      select: { id: true, firstName: true, lastName: true, role: { select: { title: true } }, department: { select: { name: true } } },
    });
    const userMap = new Map(topUsers.map((u) => [u.id, u]));
    topPerformers = compositeTopPerformers.map((t) => {
      const u = userMap.get(t.userId);
      return {
        id: t.userId,
        name: u ? `${u.firstName} ${u.lastName}` : "Unknown",
        role: u?.role?.title || "",
        score: Math.round(t.score),
        department: u?.department?.name || "",
      };
    });
  }

  // Department performance — use DB aggregation instead of in-memory
  const deptScores = await prisma.performanceScore.groupBy({
    by: ["userId"],
    where: { organizationId: orgId },
    _avg: { score: true },
  });
  const userDepts = deptScores.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: deptScores.map((s) => s.userId) } },
        select: { id: true, department: { select: { name: true } } },
      })
    : [];
  const userDeptMap = new Map(userDepts.map((u) => [u.id, u.department?.name || ""]));

  const deptAvgs = new Map<string, number[]>();
  deptScores.forEach((s) => {
    const dept = userDeptMap.get(s.userId) || "Unassigned";
    if (!deptAvgs.has(dept)) deptAvgs.set(dept, []);
    if (s._avg.score) deptAvgs.get(dept)!.push(s._avg.score);
  });

  const deptPerformance = departments.map((d) => {
    const scores = deptAvgs.get(d.name) || [];
    const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return { name: d.name, score: avg, members: d._count.members, color: d.color || "#d4ff2e" };
  });

  // Alerts
  const alerts: { type: string; message: string; time: string }[] = [];
  if (pipCount > 0) alerts.push({ type: "danger", message: `${pipCount} employee(s) on PIP`, time: "active" });
  if (sopCompliance > 80) alerts.push({ type: "success", message: `SOP compliance is at ${sopCompliance}%`, time: "this period" });

  return NextResponse.json({
    stats: { totalPeople, newPeopleThisMonth, sopCompliance, sopCount },
    topPerformers,
    recentKpiRecords: recentKpiRecords.map((r) => ({
      id: r.id, kpiName: r.kpi.name, unit: r.kpi.unit, score: r.score,
      actualValue: r.actualValue, targetValue: r.targetValue,
      userName: `${r.user.firstName} ${r.user.lastName}`,
      createdAt: r.createdAt.toISOString(),
    })),
    departmentPerformance: deptPerformance,
    alerts,
    recentActivity: recentActivity.map((a) => ({
      id: a.id, type: a.type, description: a.description, actor: a.actor,
      createdAt: a.createdAt.toISOString(),
    })),
    recentKudos: recentKudos.map((k) => {
      const byEmoji = new Map<string, number>();
      const mine: string[] = [];
      for (const r of k.reactions) {
        byEmoji.set(r.emoji, (byEmoji.get(r.emoji) || 0) + 1);
        if (r.userId === currentUserId) mine.push(r.emoji);
      }
      return {
        id: k.id, message: k.message, companyValue: k.companyValue,
        giver: k.giver, receiver: k.receiver,
        createdAt: k.createdAt.toISOString(),
        reactionCounts: Array.from(byEmoji.entries())
          .map(([emoji, count]) => ({ emoji, count }))
          .sort((a, b) => b.count - a.count),
        totalReactions: k.reactions.length,
        myReactions: mine,
      };
    }),
    pendingSurveys,
  }, {
    headers: {
      // Cache dashboard for 30 seconds in browser to avoid hammering DB on
      // navigation / refresh
      "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
    },
  });
}
