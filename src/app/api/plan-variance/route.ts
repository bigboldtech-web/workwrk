// Plan variance — actual vs budget for a given plan + scenario.
// Compares PlanLine.amount (the budgeted figure) against
// JournalLine sums in POSTED entries that fall in the same period
// + account.
//
// Result is a row per (account, period) showing budget, actual,
// and the signed variance. Aggregating in app code keeps the SQL
// boring; throughput is limited by the line count which for a
// monthly plan over a year is at most ~thousands.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

const DEBIT_NATURAL = new Set(["ASSET", "EXPENSE"]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const planId = sp.get("planId");
  const scenarioId = sp.get("scenarioId");
  if (!planId) return jsonError("planId required");

  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    include: {
      fiscalYear: { include: { periods: { select: { id: true, label: true, startDate: true, endDate: true } } } },
      scenarios: true,
    },
  });
  if (!plan) return jsonError("plan not found", 404);

  const scenario = scenarioId
    ? plan.scenarios.find((s) => s.id === scenarioId)
    : (plan.scenarios.find((s) => s.isDefault) ?? plan.scenarios[0]);
  if (!scenario) return jsonError("plan has no scenarios — recreate the plan", 500);

  // Pull plan lines for the scenario.
  const planLines = await prisma.planLine.findMany({
    where: { organizationId: orgId, planId, scenarioId: scenario.id },
    include: {
      account: { select: { id: true, code: true, name: true, type: true } },
      period: { select: { id: true, label: true } },
    },
  });

  // For each (account, period) in the plan, sum POSTED journal
  // lines with a postedAt inside the period and the account on
  // either the debit or credit side.
  const periodById = new Map(plan.fiscalYear.periods.map((p) => [p.id, p]));

  const journalLines = await prisma.journalLine.findMany({
    where: {
      entry: {
        organizationId: orgId,
        status: "POSTED",
        postedAt: {
          gte: plan.fiscalYear.startDate,
          lte: plan.fiscalYear.endDate,
        },
      },
    },
    select: {
      amount: true,
      debitAccountId: true,
      creditAccountId: true,
      entry: { select: { postedAt: true } },
    },
  });

  // Build a map: accountId+periodId → actual signed balance (using
  // natural-side convention).
  const actualMap = new Map<string, { debit: number; credit: number; type?: string }>();
  function key(accountId: string, periodId: string) { return `${accountId}::${periodId}`; }
  const periods = plan.fiscalYear.periods;
  function findPeriodId(at: Date): string | null {
    for (const p of periods) {
      if (at >= p.startDate && at <= p.endDate) return p.id;
    }
    return null;
  }
  for (const line of journalLines) {
    const pid = findPeriodId(line.entry.postedAt);
    if (!pid) continue;
    const amount = Number(line.amount);
    if (line.debitAccountId) {
      const k = key(line.debitAccountId, pid);
      const r = actualMap.get(k) ?? { debit: 0, credit: 0 };
      r.debit += amount;
      actualMap.set(k, r);
    }
    if (line.creditAccountId) {
      const k = key(line.creditAccountId, pid);
      const r = actualMap.get(k) ?? { debit: 0, credit: 0 };
      r.credit += amount;
      actualMap.set(k, r);
    }
  }

  // Group plan lines by (account, period) — sum cost-center splits.
  const planMap = new Map<string, { plan: number; account: typeof planLines[number]["account"]; period: typeof planLines[number]["period"] }>();
  for (const l of planLines) {
    const k = key(l.accountId, l.periodId);
    const r = planMap.get(k) ?? { plan: 0, account: l.account, period: l.period };
    r.plan += Number(l.amount);
    planMap.set(k, r);
  }

  // Emit rows. Variance is `actual - plan` for revenue / regret
  // semantics: positive = beat budget on revenue; negative = went
  // over on expense. UI flips the sign for expense rows so "good
  // = green, bad = red" reads consistently.
  const rows = Array.from(planMap.entries()).map(([k, v]) => {
    const [, periodId] = k.split("::");
    const actualSums = actualMap.get(k) ?? { debit: 0, credit: 0 };
    const isDebitNatural = DEBIT_NATURAL.has(v.account.type);
    const actual = isDebitNatural
      ? actualSums.debit - actualSums.credit
      : actualSums.credit - actualSums.debit;
    const variance = actual - v.plan;
    return {
      accountId: v.account.id,
      accountCode: v.account.code,
      accountName: v.account.name,
      accountType: v.account.type,
      periodId,
      periodLabel: periodById.get(periodId)?.label ?? periodId,
      plan: v.plan,
      actual,
      variance,
    };
  });

  return jsonSuccess({
    plan: { id: plan.id, name: plan.name, status: plan.status, type: plan.type },
    fiscalYear: { id: plan.fiscalYear.id, label: plan.fiscalYear.label },
    scenario: { id: scenario.id, name: scenario.name },
    rows,
  });
}
