import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { isBillingLive } from "@/services/billing";

// Staff console stats for Overview and Analytics: counts, funnel, cohorts
// and cancellations. Queries are bounded to keep this cheap.
//
// NO REVENUE NUMBER is computed here. The old `mrr`, `activeRate` and
// `mrrOverTime` multiplied a hard-coded price list by companies per plan,
// counting trials, suspended companies and lifetime deals as monthly
// revenue in one hard-coded currency, and "active rate" measured a status
// flag a staff member sets. The console reports what Stripe charged, one
// line per currency, never converted (spec-admin-backoffice 2.5, step 6);
// until that reader ships, `revenue.source` says only whether billing is
// connected, and the page shows no number rather than a made-up one.

const DAY_MS = 24 * 60 * 60 * 1000;
const FUNNEL_WINDOW_DAYS = 30;
const COHORT_MONTHS = 6;
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
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

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

    // Funnel: last FUNNEL_WINDOW_DAYS only.
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

    // Cohorts: orgs grouped by signup month, last COHORT_MONTHS months.
    prisma.organization.findMany({
      where: { createdAt: { gte: cohortStart } },
      select: { id: true, createdAt: true, status: true },
    }),
    // Subscription state per org so we can flag "still paying".
    prisma.subscription.findMany({
      where: { status: "ACTIVE" },
      select: { organizationId: true, plan: true },
    }),

    // Recent churn: last CHURN_LIMIT cancellations.
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


  // ──────────────────────────────────────────────────────────────
  // Funnel: counts and conversion %s

  const funnel = {
    signedUp: funnelSignedUp,
    completedSetup: funnelCompletedSetup,
    engaged: funnelEngagedOrgIds.size,
    paying: funnelPaying,
    windowDays: FUNNEL_WINDOW_DAYS,
  };

  // ──────────────────────────────────────────────────────────────
  // Cohorts: for each month in the window, count org status

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
  // Recent churn: flatten relation

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
    revenue: { source: isBillingLive ? ("stripe" as const) : ("unavailable" as const) },
    // Companies with an ACTIVE subscription row right now: a real count.
    payingOrgs: payingByOrg.size,
    newOrgsThisMonth: recentOrgs,
    newUsersThisMonth: recentUsers,
    planBreakdown: orgsByPlan.map((g) => ({ plan: g.plan, count: g._count.id })),
    funnel,
    cohorts,
    recentChurn,
  });
}
