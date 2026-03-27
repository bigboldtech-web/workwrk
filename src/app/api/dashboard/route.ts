import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess } from "@/lib/api-helpers";
import { getTopPerformers } from "@/services/performanceScoreService";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalPeople,
    newPeopleThisMonth,
    taskStats,
    completedTasksThisWeek,
    totalTasksThisWeek,
    overdueTasks,
    departments,
    recentTasks,
    sopCount,
    sopComplianceRecords,
    users,
    notifications,
    recentActivity,
    recentKudos,
  ] = await Promise.all([
    prisma.user.count({ where: { organizationId: orgId } }),
    prisma.user.count({ where: { organizationId: orgId, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.task.groupBy({ by: ["status"], where: { organizationId: orgId }, _count: true }),
    prisma.task.count({ where: { organizationId: orgId, completedAt: { gte: sevenDaysAgo } } }),
    prisma.task.count({ where: { organizationId: orgId, createdAt: { gte: sevenDaysAgo } } }),
    prisma.task.count({
      where: { organizationId: orgId, status: { in: ["NOT_STARTED", "IN_PROGRESS"] }, deadline: { lt: now } },
    }),
    prisma.department.findMany({
      where: { organizationId: orgId },
      include: {
        head: { select: { firstName: true, lastName: true } },
        _count: { select: { members: true } },
      },
    }),
    prisma.task.findMany({
      where: { organizationId: orgId },
      include: { assignee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.sOP.count({ where: { organizationId: orgId, status: "PUBLISHED" } }),
    prisma.sOPCompliance.findMany({
      where: { sop: { organizationId: orgId } },
      select: { stepsTotal: true, stepsCompleted: true },
    }),
    prisma.user.findMany({
      where: { organizationId: orgId },
      include: {
        role: { select: { title: true } },
        department: { select: { name: true } },
        kpiRecords: { orderBy: { createdAt: "desc" }, take: 5, select: { score: true } },
        _count: { select: { assignedTasks: true } },
      },
    }),
    prisma.notification.findMany({
      where: { user: { organizationId: orgId } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.activityLog.findMany({
      where: { organizationId: orgId },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.kudos.findMany({
      where: { organizationId: orgId },
      include: {
        giver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        receiver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  // Calculate SOP compliance %
  const totalSteps = sopComplianceRecords.reduce((s, r) => s + r.stepsTotal, 0);
  const completedSteps = sopComplianceRecords.reduce((s, r) => s + r.stepsCompleted, 0);
  const sopCompliance = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // Calculate top performers — prefer composite performance scores, fallback to KPI avg
  const compositeTopPerformers = await getTopPerformers(orgId, 5);
  let topPerformers: { id: string; name: string; role: string; score: number; department: string }[];

  if (compositeTopPerformers.length > 0) {
    const topUserIds = compositeTopPerformers.map((t) => t.userId);
    const topUsers = users.filter((u) => topUserIds.includes(u.id));
    topPerformers = compositeTopPerformers.map((t) => {
      const u = topUsers.find((u) => u.id === t.userId);
      return {
        id: t.userId,
        name: u ? `${u.firstName} ${u.lastName}` : "Unknown",
        role: u?.role?.title || "No role",
        score: Math.round(t.score),
        department: u?.department?.name || "",
      };
    });
  } else {
    topPerformers = users
      .map((u) => {
        const scores = u.kpiRecords.filter((r) => r.score != null).map((r) => r.score!);
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        return {
          id: u.id,
          name: `${u.firstName} ${u.lastName}`,
          role: u.role?.title || "No role",
          score: Math.round(avg),
          department: u.department?.name || "",
        };
      })
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  // Department performance
  const deptPerformance = departments.map((d) => {
    const deptUsers = users.filter((u) => u.department?.name === d.name);
    const deptScores = deptUsers.flatMap((u) => u.kpiRecords.filter((r) => r.score != null).map((r) => r.score!));
    const avg = deptScores.length > 0 ? Math.round(deptScores.reduce((a, b) => a + b, 0) / deptScores.length) : 0;
    return { name: d.name, score: avg, members: d._count.members, color: d.color || "#6C5CE7" };
  });

  // Alerts
  const alerts: { type: string; message: string; time: string }[] = [];
  if (overdueTasks > 0) alerts.push({ type: "warning", message: `${overdueTasks} tasks are overdue`, time: "now" });
  const pipUsers = users.filter((u) => u.status === "PIP");
  if (pipUsers.length > 0) alerts.push({ type: "danger", message: `${pipUsers.length} employee(s) on PIP`, time: "active" });

  const completedCount = taskStats.find((s) => s.status === "COMPLETED")?._count || 0;
  const totalCount = taskStats.reduce((sum, s) => sum + s._count, 0);
  if (completedCount > 0 && totalCount > 0) {
    const rate = Math.round((completedCount / totalCount) * 100);
    if (rate > 75) alerts.push({ type: "success", message: `Task completion rate is ${rate}%`, time: "this period" });
  }

  return jsonSuccess({
    stats: {
      totalPeople,
      newPeopleThisMonth,
      completedTasksThisWeek,
      totalTasksThisWeek,
      sopCompliance,
      sopCount,
      overdueTasks,
    },
    topPerformers,
    recentTasks: recentTasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      assignee: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName.charAt(0)}.` : "Unassigned",
      deadline: t.deadline?.toISOString() || null,
      completedAt: t.completedAt?.toISOString() || null,
    })),
    departmentPerformance: deptPerformance,
    alerts,
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      type: a.type,
      description: a.description,
      actor: a.actor,
      createdAt: a.createdAt.toISOString(),
    })),
    recentKudos: recentKudos.map((k) => ({
      id: k.id,
      message: k.message,
      companyValue: k.companyValue,
      giver: k.giver,
      receiver: k.receiver,
      createdAt: k.createdAt.toISOString(),
    })),
  });
}
