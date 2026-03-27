import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const [
    totalUsers,
    newUsers,
    completedTasks,
    overdueTasks,
    totalTasks,
    sopCount,
    recentCheckIns,
    lowMoodCheckIns,
  ] = await Promise.all([
    prisma.user.count({ where: { organizationId: orgId } }),
    prisma.user.count({ where: { organizationId: orgId, createdAt: { gte: oneWeekAgo } } }),
    prisma.task.count({ where: { organizationId: orgId, completedAt: { gte: oneWeekAgo } } }),
    prisma.task.count({
      where: { organizationId: orgId, status: { in: ["NOT_STARTED", "IN_PROGRESS"] }, deadline: { lt: new Date() } },
    }),
    prisma.task.count({ where: { organizationId: orgId, createdAt: { gte: oneWeekAgo } } }),
    prisma.sOP.count({ where: { organizationId: orgId, status: "PUBLISHED" } }),
    prisma.checkIn.findMany({
      where: { user: { organizationId: orgId }, createdAt: { gte: oneWeekAgo } },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.checkIn.count({
      where: { user: { organizationId: orgId }, createdAt: { gte: oneWeekAgo }, mood: { lte: 2 } },
    }),
  ]);

  const avgMood = recentCheckIns.length > 0
    ? (recentCheckIns.reduce((sum, c) => sum + (c.mood || 3), 0) / recentCheckIns.length).toFixed(1)
    : null;

  const digest = {
    period: `${oneWeekAgo.toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}`,
    highlights: [
      { label: "Team Size", value: totalUsers, detail: newUsers > 0 ? `+${newUsers} new this week` : "No new joins" },
      { label: "Tasks Completed", value: completedTasks, detail: `of ${totalTasks} created this week` },
      { label: "Overdue Tasks", value: overdueTasks, detail: overdueTasks > 5 ? "Needs attention" : "Under control" },
      { label: "Published SOPs", value: sopCount, detail: "Active processes" },
      { label: "Team Mood", value: avgMood || "N/A", detail: `${lowMoodCheckIns} low-mood check-ins` },
      { label: "Check-ins", value: recentCheckIns.length, detail: "This week" },
    ],
    alerts: [] as string[],
  };

  if (overdueTasks > 5) digest.alerts.push(`${overdueTasks} tasks are overdue — consider reviewing priorities.`);
  if (lowMoodCheckIns > 3) digest.alerts.push(`${lowMoodCheckIns} team members reported low mood this week.`);
  if (completedTasks === 0) digest.alerts.push("No tasks completed this week — check team workload.");

  return jsonSuccess(digest);
}
