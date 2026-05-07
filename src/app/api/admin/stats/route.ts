import { prisma } from "@/lib/prisma";
import { getSessionOrFail, hasRole, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { AccessLevel } from "@/generated/prisma";

// Founder dashboard stats. Single endpoint so the admin page only
// makes one fetch. Adds funnel + MRR-over-time + cohort churn on top
// of the existing aggregate metrics; queries are bounded to keep this
// cheap until we outgrow it.

const PLAN_PRICES: Record<string, number> = {
  STARTER: 4999,
  GROWTH: 14999,
  SCALE: 29999,
  ENTERPRISE: 75000,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const FUNNEL_WINDOW_DAYS = 30;
const COHORT_MONTHS = 6;
const MRR_HISTORY_MONTHS = 12;
const CHURN_LIMIT = 10;

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function fmtMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN" as AccessLevel])) {
    return jsonError("Forbidden", 403);
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
  const funnelWindowStart = new Date(Date.now() - FUNNEL_WINDOW_DAYS * DAY_MS);
  const cohortStart = addMonths(startOfMonthUTC(now), -(COHORT_MONTHS - 1));

  const [
    totalOrgs,
    totalUsers,
    activeOrgs,
    trialOrgs,
    orgsByPlan,
    recentOrgs,
    recentUsers,
    funnelSignedUp,
    funnelCompletedSetup,
    funnelEngagedOrgIds,
    funnelPaying,
    cohortOrgs,
    activeSubsByOrg,
    subsHistory,
    recentChurnRows,
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
      where: { createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    }),

    // Funnel — last FUNNEL_WINDOW_DAYS only.
    prisma.organization.count({
      where: { createdAt: { gte: funnelWindowStart } },
    }),
    prisma.organization.count({
      where: {
        createdAt: { gte: funnelWindowStart },
        // Settings is a JSON column. Prisma's path-equality filter
        // works against the strict equality of `setupCompleted`.
        settings: { path: ["setupCompleted"], equals: true },
      },
    }),
    // "Engaged" = created at least 1 SOP/KRA/Task in window. We
    // collect the set of org ids touched by any of those activities.
    Promise.all([
      prisma.sOP.findMany({
        where: { createdAt: { gte: funnelWindowStart } },
        select: { organizationId: true },
        distinct: ["organizationId"],
      }),
      prisma.kRA.findMany({
        where: { createdAt: { gte: funnelWindowStart } },
        select: { organizationId: true },
        distinct: ["organizationId"],
      }),
      prisma.task.findMany({
        where: { createdAt: { gte: funnelWindowStart } },
        select: { organizationId: true },
        distinct: ["organizationId"],
      }),
    ]).then(([s, k, t]) => {
      const ids = new Set<string>();
      for (const row of [...s, ...k, ...t]) ids.add(row.organizationId);
      return ids;
    }),
    prisma.subscription.count({
      where: {
        status: "ACTIVE",
        createdAt: { gte: funnelWindowStart },
      },
    }),

    // Cohorts — orgs grouped by signup month, last COHORT_MONTHS months.
    prisma.organization.findMany({
      where: { createdAt: { gte: cohortStart } },
      select: { id: true, createdAt: true, status: true },
    }),
    // Subscription state per org so we can flag "still paying".
    prisma.subscription.findMany({
      where: { status: "ACTIVE" },
      select: { organizationId: true, plan: true },
    }),

    // MRR history — every subscription with its lifetime window. We
    // bucket by month in JS to avoid a per-month roundtrip.
    prisma.subscription.findMany({
      where: { createdAt: { gte: addMonths(startOfMonthUTC(now), -MRR_HISTORY_MONTHS) } },
      select: { plan: true, createdAt: true, canceledAt: true, status: true },
    }),

    // Recent churn — last CHURN_LIMIT cancellations.
    prisma.subscription.findMany({
      where: { canceledAt: { not: null } },
      orderBy: { canceledAt: "desc" },
      take: CHURN_LIMIT,
      select: {
        canceledAt: true,
        plan: true,
        organization: { select: { id: true, name: true } },
      },
    }),
  ]);

  // ──────────────────────────────────────────────────────────────
  // Aggregate values

  let mrr = 0;
  for (const group of orgsByPlan) mrr += (PLAN_PRICES[group.plan] || 0) * group._count.id;
  const activeRate = totalOrgs > 0 ? Math.round((activeOrgs / totalOrgs) * 100) : 0;

  // ──────────────────────────────────────────────────────────────
  // Funnel — counts and conversion %s

  const funnel = {
    signedUp: funnelSignedUp,
    completedSetup: funnelCompletedSetup,
    engaged: funnelEngagedOrgIds.size,
    paying: funnelPaying,
    windowDays: FUNNEL_WINDOW_DAYS,
  };

  // ──────────────────────────────────────────────────────────────
  // Cohorts — for each month in the window, count org status

  const payingByOrg = new Set(activeSubsByOrg.map((s) => s.organizationId));
  type CohortRow = { month: string; size: number; active: number; paying: number; churned: number };
  const cohortByMonth = new Map<string, CohortRow>();
  for (let i = 0; i < COHORT_MONTHS; i++) {
    const m = addMonths(cohortStart, i);
    cohortByMonth.set(fmtMonth(m), { month: fmtMonth(m), size: 0, active: 0, paying: 0, churned: 0 });
  }
  for (const org of cohortOrgs) {
    const key = fmtMonth(startOfMonthUTC(org.createdAt));
    const row = cohortByMonth.get(key);
    if (!row) continue;
    row.size++;
    if (org.status === "ACTIVE") row.active++;
    if (payingByOrg.has(org.id)) row.paying++;
    if (org.status === "CANCELLED" || org.status === "SUSPENDED") row.churned++;
  }
  const cohorts = Array.from(cohortByMonth.values());

  // ──────────────────────────────────────────────────────────────
  // MRR over time — at the end of each month, sum prices for subs
  // that were ACTIVE at that point (created on/before, not yet canceled).

  type MrrPoint = { month: string; mrr: number };
  const mrrPoints: MrrPoint[] = [];
  const horizonStart = addMonths(startOfMonthUTC(now), -(MRR_HISTORY_MONTHS - 1));
  for (let i = 0; i < MRR_HISTORY_MONTHS; i++) {
    const monthStart = addMonths(horizonStart, i);
    const monthEnd = addMonths(monthStart, 1);
    let monthMrr = 0;
    for (const sub of subsHistory) {
      if (sub.createdAt >= monthEnd) continue; // not yet started
      if (sub.canceledAt && sub.canceledAt < monthStart) continue; // canceled before
      // Counts past-due toward MRR — they're billed, just unhealthy.
      monthMrr += PLAN_PRICES[sub.plan] || 0;
    }
    mrrPoints.push({ month: fmtMonth(monthStart), mrr: monthMrr });
  }

  // ──────────────────────────────────────────────────────────────
  // Recent churn — flatten relation

  const recentChurn = recentChurnRows.map((r) => ({
    orgId: r.organization.id,
    orgName: r.organization.name,
    plan: r.plan,
    canceledAt: r.canceledAt?.toISOString() ?? null,
  }));

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
    funnel,
    cohorts,
    mrrOverTime: mrrPoints,
    recentChurn,
  });
}
