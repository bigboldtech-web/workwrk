import { prisma } from "@/lib/prisma";
import { getSessionOrFail, hasRole, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { AccessLevel } from "@/generated/prisma";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN" as AccessLevel])) {
    return jsonError("Forbidden", 403);
  }

  const [
    totalOrgs,
    totalUsers,
    activeOrgs,
    trialOrgs,
    orgsByPlan,
    recentOrgs,
    recentUsers,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.organization.count({ where: { status: "ACTIVE" } }),
    prisma.organization.count({ where: { status: "TRIAL" } }),
    prisma.organization.groupBy({
      by: ["plan"],
      _count: { id: true },
    }),
    prisma.organization.count({
      where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    }),
  ]);

  // Calculate MRR based on plans
  const planPrices: Record<string, number> = {
    STARTER: 4999,
    GROWTH: 14999,
    SCALE: 29999,
    ENTERPRISE: 75000,
  };

  let mrr = 0;
  for (const group of orgsByPlan) {
    mrr += (planPrices[group.plan] || 0) * group._count.id;
  }

  // Active rate (orgs with users who logged in last 7 days / total active orgs)
  const activeRate = totalOrgs > 0 ? Math.round((activeOrgs / totalOrgs) * 100) : 0;

  return jsonSuccess({
    totalOrgs,
    totalUsers,
    activeOrgs,
    trialOrgs,
    mrr,
    activeRate,
    newOrgsThisMonth: recentOrgs,
    newUsersThisMonth: recentUsers,
    planBreakdown: orgsByPlan.map((g) => ({ plan: g.plan, count: g._count.id })),
  });
}
