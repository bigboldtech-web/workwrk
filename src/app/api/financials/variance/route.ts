import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  isOrgAdmin,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";

/**
 * Variance report — Phase 5 v1.
 *
 * GET /api/financials/variance?plan=<id>&scenario=<id>&period=<id>
 *
 * Joins:
 *   • PlanLine.amount  (the planned number for account × period × scenario)
 *   • JournalLine sum  (the actual posted total for the same account × period)
 *
 * Returns rows of `{ account, planned, actual, variance, variancePct }`
 * with $ delta and % delta. The UI renders them in a table with
 * unfavorable variances highlighted (red for expense overruns,
 * red for revenue shortfalls).
 *
 * Org-admin only. Multi-scenario comparison + cost-center breakouts
 * are explicit v2 follow-ups.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const planId = sp.get("plan");
  const scenarioId = sp.get("scenario");
  const periodId = sp.get("period");
  if (!planId || !scenarioId || !periodId) {
    return jsonError("plan, scenario, and period are all required");
  }

  // Ownership check — every input must belong to this org.
  const [plan, scenario, period] = await Promise.all([
    prisma.budgetPlan.findFirst({
      where: { id: planId, organizationId: orgId },
      select: { id: true, name: true },
    }),
    prisma.planScenario.findFirst({
      where: { id: scenarioId, organizationId: orgId },
      select: { id: true, name: true },
    }),
    prisma.accountingPeriod.findFirst({
      where: { id: periodId, organizationId: orgId },
      select: { id: true, label: true },
    }),
  ]);
  if (!plan) return jsonError("plan not found", 404);
  if (!scenario) return jsonError("scenario not found", 404);
  if (!period) return jsonError("period not found", 404);

  // Planned numbers — one row per account × cost-center for the
  // requested scenario+period. Sum so a multi-cost-center plan
  // collapses to a single account total for the report.
  const plannedRows = await prisma.planLine.groupBy({
    by: ["accountId"],
    where: { organizationId: orgId, planId, scenarioId, periodId },
    _sum: { amount: true },
  });

  // Actuals — sum POSTED journal lines per account, picking the
  // natural-balance side based on account type so revenue + expense
  // surface as positive numbers (matching the planned convention).
  const lines = await prisma.journalLine.findMany({
    where: { entry: { organizationId: orgId, periodId, status: "POSTED" } },
    select: {
      amount: true,
      debitAccountId: true,
      creditAccountId: true,
      debitAccount: { select: { id: true, type: true } },
      creditAccount: { select: { id: true, type: true } },
    },
  });
  const actualByAccount = new Map<string, number>();
  for (const ln of lines) {
    const amt = Number(ln.amount);
    if (ln.debitAccountId && ln.debitAccount) {
      const t = ln.debitAccount.type;
      const signed = t === "ASSET" || t === "EXPENSE" ? amt : -amt;
      actualByAccount.set(ln.debitAccountId, (actualByAccount.get(ln.debitAccountId) ?? 0) + signed);
    }
    if (ln.creditAccountId && ln.creditAccount) {
      const t = ln.creditAccount.type;
      const signed = t === "ASSET" || t === "EXPENSE" ? -amt : amt;
      actualByAccount.set(ln.creditAccountId, (actualByAccount.get(ln.creditAccountId) ?? 0) + signed);
    }
  }

  // Hydrate account metadata for the rows.
  const accountIds = Array.from(new Set([
    ...plannedRows.map((p) => p.accountId),
    ...actualByAccount.keys(),
  ]));
  const accounts = await prisma.glAccount.findMany({
    where: { id: { in: accountIds }, organizationId: orgId },
    select: { id: true, code: true, name: true, type: true },
  });
  const accountMap = new Map(accounts.map((a) => [a.id, a] as const));
  const plannedMap = new Map(plannedRows.map((p) => [p.accountId, Number(p._sum.amount ?? 0)] as const));

  const rows = accountIds
    .map((id) => {
      const account = accountMap.get(id);
      if (!account) return null;
      const planned = plannedMap.get(id) ?? 0;
      const actual = actualByAccount.get(id) ?? 0;
      const variance = actual - planned;
      // Direction: for revenue, positive variance is favorable; for
      // expense, negative variance (under-spending) is favorable.
      const favorable =
        account.type === "REVENUE" ? variance >= 0 :
        account.type === "EXPENSE" ? variance <= 0 :
        null;
      const variancePct = planned === 0 ? null : (variance / Math.abs(planned)) * 100;
      return { account, planned, actual, variance, variancePct, favorable };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.account.code.localeCompare(b.account.code));

  const summary = rows.reduce(
    (s, r) => {
      s.totalPlanned += r.planned;
      s.totalActual += r.actual;
      s.totalVariance += r.variance;
      return s;
    },
    { totalPlanned: 0, totalActual: 0, totalVariance: 0 },
  );

  return jsonSuccess({
    plan,
    scenario,
    period,
    rows,
    summary,
  });
}
