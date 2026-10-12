import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { peopleCtx } from "@/lib/people/person-access.server";
import { readableCheckInsWhere } from "@/lib/check-in-access.server";

export async function GET() {
  const ctx = await peopleCtx();
  if (!ctx) return jsonError("Unauthorized", 401);

  const orgId = ctx.organizationId;
  // The mood tiles read only the check-ins this viewer may read one by one
  // (src/lib/check-in-access.server.ts, docs-found fixes batch 5): they
  // averaged every check-in in the workspace for anyone signed in, so in a
  // small team the "Team Mood" told a colleague a peer's mood.
  const readable = readableCheckInsWhere(ctx);
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
      where: { AND: [readable, { createdAt: { gte: oneWeekAgo } }] },
      select: { mood: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.checkIn.count({
      where: { AND: [readable, { createdAt: { gte: oneWeekAgo }, mood: { lte: 2 } }] },
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
