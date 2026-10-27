// Loading the periods of repeating goals for the rollup, the close and the
// periods route (docs/plans/recurring-goals.md D2, C6, B6).
//
// Two bounded queries for any number of goals: every stored period (oldest
// first), then the target rows of the OPEN ones only (a closed period reads
// its frozen numbers). A KPI-linked target of an open period reads the
// owner's KPIRecord for the period's own months (kpiMonths, from its own
// range), combined by the target's choice for a quarterly or yearly goal; a
// third query fetches those records, only when such a target exists.
//
// No import of alignment.ts: alignment's org rollup imports this file.

import { prisma } from "@/lib/prisma";
import { kpiMonths, openedAfterWindow, type GoalCadence, type PeriodSettings, isGoalCadence } from "@/lib/goals/goal-period";
import { combineKpiMonths, isMeasuredAutomatically, kpiCombineOf, targetDirection } from "@/lib/goals/goal-measure";
import { unclampedProgress, type RollupPeriod } from "@/lib/goals/period-rollup";

/** The goal fields the loader needs. */
export interface GraphGoalInput {
  id: string;
  ownerId: string | null;
  keyResults: ReadonlyArray<{
    id: string;
    kpiId: string | null;
    source?: unknown;
    kpi?: { direction?: string | null; lowerIsBetter?: boolean | null } | null;
  }>;
}

/** A target row of an open period, with what it reads now. */
export interface LiveTargetRow {
  id: string;
  keyResultId: string | null;
  periodId: string;
  startValue: number;
  targetValue: number;
  /** What the row reads now: the KPI's period number for a KPI target, else the stored value. */
  currentValue: number;
  progress: number;
  attainment: number;
  kpiDerived: boolean;
  leftOut: boolean;
}

export interface StoredPeriod extends RollupPeriod {
  okrId: string;
  trackedFrom: Date;
  graceEndsAt: Date;
  closesAt: Date;
  createdAt: Date;
  result: string | null;
  scored: boolean | null;
  closedAt: Date | null;
  scorePatchedAt: Date | null;
  /** Open periods only: the rows with their live numbers, by keyResultId (deleted targets keyed by row id). */
  rows: LiveTargetRow[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** A KPI's monthly numbers for one person ("YYYY-MM" to value), REJECTED and empty records left out. */
export type KpiMonthValues = Map<string, Map<string, number>>;

const kpiKey = (kpiId: string, userId: string | null) => `${kpiId}::${userId ?? "*"}`;

/**
 * The monthly KPI numbers the open periods read: for each (KPI, owner) the
 * value of each month asked. An ownerless goal (a Company goal) reads the
 * most recently updated record of each month, as the one-time read does.
 */
export async function kpiMonthValues(pairs: ReadonlyArray<{ kpiId: string; userId: string | null; months: readonly string[] }>): Promise<KpiMonthValues> {
  const out: KpiMonthValues = new Map();
  const wanted = pairs.filter((p) => p.months.length > 0);
  if (wanted.length === 0) return out;
  const kpiIds = [...new Set(wanted.map((p) => p.kpiId))];
  const months = [...new Set(wanted.flatMap((p) => p.months))];
  const userIds = [...new Set(wanted.map((p) => p.userId).filter((u): u is string => !!u))];
  const anyone = wanted.some((p) => !p.userId);
  const records = await prisma.kPIRecord.findMany({
    where: {
      kpiId: { in: kpiIds },
      period: { in: months },
      actualValue: { not: null },
      status: { not: "REJECTED" },
      ...(anyone ? {} : { userId: { in: userIds } }),
    },
    select: { kpiId: true, userId: true, period: true, actualValue: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  for (const r of records) {
    if (r.actualValue == null) continue;
    for (const key of [kpiKey(r.kpiId, r.userId), kpiKey(r.kpiId, null)]) {
      const m = out.get(key) ?? new Map<string, number>();
      if (!m.has(r.period)) m.set(r.period, r.actualValue);
      out.set(key, m);
    }
  }
  return out;
}

/** The value a KPI target reads for a period (C6), or null when no month of it has a number. */
export function kpiValueForPeriod(
  values: KpiMonthValues,
  kr: { kpiId: string | null; source?: unknown },
  ownerId: string | null,
  period: { cadence: GoalCadence; startsAt: Date; endsAt: Date },
  settings: PeriodSettings,
): number | null {
  if (!kr.kpiId) return null;
  const byMonth = values.get(kpiKey(kr.kpiId, ownerId));
  if (!byMonth) return null;
  const months = kpiMonths(period, settings);
  const combine = period.cadence === "MONTHLY" ? "LATEST" : kpiCombineOf(kr.source);
  return combineKpiMonths(months, byMonth, combine);
}

/**
 * Every stored period of the given repeating goals, oldest first, with the
 * live rows of the open ones. Goals that do not repeat are skipped.
 */
export async function loadStoredPeriods(
  goals: ReadonlyArray<GraphGoalInput & { repeat: string | null }>,
  settings: PeriodSettings,
): Promise<Map<string, StoredPeriod[]>> {
  const out = new Map<string, StoredPeriod[]>();
  const repeating = goals.filter((g) => isGoalCadence(g.repeat));
  if (repeating.length === 0) return out;
  const goalById = new Map(repeating.map((g) => [g.id, g]));

  const periods = await prisma.goalPeriod.findMany({
    where: { okrId: { in: repeating.map((g) => g.id) } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true, okrId: true, key: true, cadence: true, startsAt: true, endsAt: true, trackedFrom: true,
      graceEndsAt: true, closesAt: true, status: true, progress: true, attainment: true, result: true,
      scored: true, closedAt: true, scorePatchedAt: true, createdAt: true,
    },
  });
  const openIds = periods.filter((p) => p.status === "OPEN").map((p) => p.id);
  const rows = openIds.length
    ? await prisma.keyResultPeriod.findMany({
        where: { periodId: { in: openIds } },
        select: { id: true, keyResultId: true, periodId: true, startValue: true, targetValue: true, currentValue: true, pausedSince: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const rowsByPeriod = new Map<string, typeof rows>();
  for (const r of rows) rowsByPeriod.set(r.periodId, [...(rowsByPeriod.get(r.periodId) ?? []), r]);

  // The KPI months each open period's KPI targets read, fetched at once.
  const pairs: Array<{ kpiId: string; userId: string | null; months: string[] }> = [];
  for (const p of periods) {
    if (p.status !== "OPEN" || !isGoalCadence(p.cadence)) continue;
    const goal = goalById.get(p.okrId)!;
    for (const kr of goal.keyResults) {
      if (kr.kpiId) pairs.push({ kpiId: kr.kpiId, userId: goal.ownerId, months: kpiMonths({ cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt }, settings) });
    }
  }
  const kpi = await kpiMonthValues(pairs);

  for (const p of periods) {
    if (!isGoalCadence(p.cadence)) continue;
    const goal = goalById.get(p.okrId)!;
    const krById = new Map(goal.keyResults.map((k) => [k.id, k]));
    const late = openedAfterWindow({ graceEndsAt: p.graceEndsAt }, p.createdAt);
    const live: LiveTargetRow[] = p.status !== "OPEN" ? [] : (rowsByPeriod.get(p.id) ?? []).map((r) => {
      const kr = r.keyResultId ? krById.get(r.keyResultId) : undefined;
      const fromKpi = kr ? kpiValueForPeriod(kpi, kr, goal.ownerId, { cadence: p.cadence as GoalCadence, startsAt: p.startsAt, endsAt: p.endsAt }, settings) : null;
      const value = fromKpi ?? r.currentValue ?? r.startValue;
      const direction = targetDirection({ startValue: r.startValue, targetValue: r.targetValue, kpi: kr?.kpi ?? null });
      const attainment = unclampedProgress(r.startValue, r.targetValue, value, direction);
      // B6: a hand-checked target in a period opened after its window is left out.
      const hand = !kr || !isMeasuredAutomatically(kr);
      return {
        id: r.id, keyResultId: r.keyResultId, periodId: r.periodId, startValue: r.startValue, targetValue: r.targetValue,
        currentValue: value, progress: clamp(attainment), attainment, kpiDerived: fromKpi != null, leftOut: hand && late,
      };
    });
    const stored: StoredPeriod = {
      id: p.id, okrId: p.okrId, key: p.key, cadence: p.cadence as GoalCadence, startsAt: p.startsAt, endsAt: p.endsAt,
      trackedFrom: p.trackedFrom, graceEndsAt: p.graceEndsAt, closesAt: p.closesAt, createdAt: p.createdAt,
      status: p.status, progress: p.progress, attainment: p.attainment, result: p.result, scored: p.scored,
      closedAt: p.closedAt, scorePatchedAt: p.scorePatchedAt,
      targets: live.map((t) => ({ progress: t.progress, attainment: t.attainment, leftOut: t.leftOut })),
      rows: live,
    };
    out.set(p.okrId, [...(out.get(p.okrId) ?? []), stored]);
  }
  return out;
}
