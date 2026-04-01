import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const [
    totalUsers,
    newUsers,
    activeKras,
    recentKpiRecords,
    sopCount,
    recentCheckIns,
    lowMoodCheckIns,
  ] = await Promise.all([
    prisma.user.count({ where: { organizationId: orgId } }),
    prisma.user.count({ where: { organizationId: orgId, createdAt: { gte: oneWeekAgo } } }),
    prisma.kRAAssignment.count({ where: { kra: { organizationId: orgId }, status: "ACTIVE" } }),
    prisma.kPIRecord.findMany({
      where: { kpi: { organizationId: orgId }, createdAt: { gte: oneWeekAgo } },
      select: { score: true },
    }),
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

  const avgKpiScore = recentKpiRecords.length > 0
    ? Math.round(recentKpiRecords.filter(r => r.score != null).reduce((sum, r) => sum + r.score!, 0) / recentKpiRecords.filter(r => r.score != null).length)
    : null;

  const digest = {
    period: `${oneWeekAgo.toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}`,
    highlights: [
      { label: "Team Size", value: totalUsers, detail: newUsers > 0 ? `+${newUsers} new this week` : "No new joins" },
      { label: "Active KRAs", value: activeKras, detail: "Assigned across team" },
      { label: "KPI Updates", value: recentKpiRecords.length, detail: avgKpiScore != null ? `Avg score: ${avgKpiScore}` : "This week" },
      { label: "Published SOPs", value: sopCount, detail: "Active processes" },
      { label: "Team Mood", value: avgMood || "N/A", detail: `${lowMoodCheckIns} low-mood check-ins` },
      { label: "Check-ins", value: recentCheckIns.length, detail: "This week" },
    ],
    alerts: [] as string[],
  };

  if (lowMoodCheckIns > 3) digest.alerts.push(`${lowMoodCheckIns} team members reported low mood this week.`);
  if (recentKpiRecords.length === 0) digest.alerts.push("No KPI records this week — check if teams are tracking.");

  return jsonSuccess(digest);
}
