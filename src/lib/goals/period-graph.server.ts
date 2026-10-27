// Loading the periods of repeating goals for the rollup, the close and the
// periods route (docs/plans/recurring-goals.md D2, C6, B6).
//
// WHAT IS READ, and why no more (every list load runs this):
//   - every OPEN period of the repeating goals, with its target rows;
//   - each goal's LATEST period (one DISTINCT ON read), so an ended goal
//     still shows its last result;
//   - CLOSED periods only where D2 reads them: a repeating child's periods
//     inside a one-time parent's dates, and a repeating parent's children's
//     periods that overlap the parent's open ones. A goal's own closed
//     history is the periods route's, never the rollup's.
// A KPI-linked row of an open period reads the KPIRecord for the period's
// own months (kpiMonths) of the KPI and person STORED ON THE ROW at opening
// (KeyResultPeriod.kpiId, kpiUserId), never today's link or owner, so a
// reassignment or an unlink during October's KPI hold leaves October alone.
//
// Every lookup is a Map: the work grows with the rows read, not with their
// square.
//
// No import of alignment.ts: alignment's org rollup imports this file.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { kpiMonths, openedAfterWindow, type GoalCadence, type PeriodSettings, isGoalCadence } from "@/lib/goals/goal-period";
import { combineKpiMonths, hasConnectedSource, isMeasuredAutomatically, kpiCombineOf, targetDirection } from "@/lib/goals/goal-measure";
import { buildChildrenOf, meanScore, repeatingChildForOneTimeParent, unclampedProgress, type PeriodGraph, type PeriodScore, type RollupPeriod } from "@/lib/goals/period-rollup";

type Db = Pick<Prisma.TransactionClient, "$queryRaw" | "goalPeriod" | "keyResultPeriod" | "kPIRecord" | "oKR" | "kRCheckIn">;

/** The goal fields the loader needs. */
export interface GraphGoalInput {
  id: string;
  ownerId: string | null;
  parentId?: string | null;
  repeat: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
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
  /** What the row reads now: the KPI's period number for a KPI row, else the stored value. */
  currentValue: number;
  progress: number;
  attainment: number;
  /** The KPI and person the row reads (stored at opening), or null for a hand-checked row. */
  kpiId: string | null;
  kpiUserId: string | null;
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
  /** Open periods only: the rows with their live numbers. */
  rows: LiveTargetRow[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const PERIOD_COLUMNS = {
  id: true, okrId: true, key: true, cadence: true, startsAt: true, endsAt: true, trackedFrom: true,
  graceEndsAt: true, closesAt: true, status: true, progress: true, attainment: true, result: true,
  scored: true, closedAt: true, scorePatchedAt: true, createdAt: true,
} as const;

export type PeriodRow = {
  id: string; okrId: string; key: string; cadence: string; startsAt: Date; endsAt: Date; trackedFrom: Date;
  graceEndsAt: Date; closesAt: Date; status: string; progress: number | null; attainment: number | null;
  result: string | null; scored: boolean | null; closedAt: Date | null; scorePatchedAt: Date | null; createdAt: Date;
};

/** Each goal's latest period (by start), in ONE read. */
export async function latestPeriods(db: Pick<Db, "$queryRaw">, okrIds: readonly string[]): Promise<PeriodRow[]> {
  if (okrIds.length === 0) return [];
  const ids = [...okrIds];
  return db.$queryRaw<PeriodRow[]>`
    SELECT DISTINCT ON ("okrId") "id", "okrId", "key", "cadence", "startsAt", "endsAt", "trackedFrom", "graceEndsAt",
      "closesAt", "status", "progress", "attainment", "result", "scored", "closedAt", "scorePatchedAt", "createdAt"
    FROM "GoalPeriod" WHERE "okrId" = ANY(${ids}) ORDER BY "okrId", "startsAt" DESC`;
}

/** A KPI's monthly numbers per (KPI, person): "YYYY-MM" to value, REJECTED and empty records left out. */
export type KpiMonthValues = Map<string, Map<string, number>>;

const kpiKey = (kpiId: string, userId: string | null) => `${kpiId}::${userId ?? "*"}`;

/**
 * The monthly KPI numbers the open periods read: for each (KPI, person) the
 * value of each month asked. A row with no person (an ownerless goal's, a
 * Company goal) reads the most recently updated record of each month, as
 * the one-time read does.
 */
export async function kpiMonthValues(pairs: ReadonlyArray<{ kpiId: string; userId: string | null; months: readonly string[] }>, db: Pick<Db, "kPIRecord"> = prisma): Promise<KpiMonthValues> {
  const out: KpiMonthValues = new Map();
  const wanted = pairs.filter((p) => p.months.length > 0);
  if (wanted.length === 0) return out;
  const kpiIds = [...new Set(wanted.map((p) => p.kpiId))];
  const months = [...new Set(wanted.flatMap((p) => p.months))];
  const userIds = [...new Set(wanted.map((p) => p.userId).filter((u): u is string => !!u))];
  const anyone = wanted.some((p) => !p.userId);
  const records = await db.kPIRecord.findMany({
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
      let m = out.get(key);
      if (!m) {
        m = new Map<string, number>();
        out.set(key, m);
      }
      if (!m.has(r.period)) m.set(r.period, r.actualValue);
    }
  }
  return out;
}

/**
 * The value a KPI row reads for its period (C6), from the identity stored
 * on the row, or null when no month of the period has a number.
 */
export function kpiValueForPeriod(
  values: KpiMonthValues,
  row: { kpiId: string | null; kpiUserId: string | null },
  source: unknown,
  period: { cadence: GoalCadence; startsAt: Date; endsAt: Date },
  settings: PeriodSettings,
): number | null {
  if (!row.kpiId) return null;
  const byMonth = values.get(kpiKey(row.kpiId, row.kpiUserId));
  if (!byMonth) return null;
  const months = kpiMonths(period, settings);
  const combine = period.cadence === "MONTHLY" ? "LATEST" : kpiCombineOf(source);
  return combineKpiMonths(months, byMonth, combine);
}

/** A row is checked in by hand unless its stored KPI or the target's source counts it. */
export function rowIsHand(row: { kpiId: string | null }, kr: { source?: unknown } | undefined): boolean {
  return !row.kpiId && !(kr && hasConnectedSource(kr.source));
}

const DAY = 86_400_000;

/**
 * The CLOSED periods D2 reads (see the head of this file), as OR conditions
 * on one read: a repeating child of a one-time parent within the parent's
 * dates (a day either side; the exact nominal check runs in memory), and a
 * repeating parent's children within the span of the parent's open periods.
 */
function closedWindows(goals: ReadonlyArray<GraphGoalInput>, openByGoal: ReadonlyMap<string, PeriodRow[]>): Prisma.GoalPeriodWhereInput[] {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const out: Prisma.GoalPeriodWhereInput[] = [];
  for (const g of goals) {
    if (!g.parentId || !isGoalCadence(g.repeat)) continue;
    const parent = byId.get(g.parentId);
    if (!parent) continue;
    if (!isGoalCadence(parent.repeat)) {
      out.push({
        okrId: g.id,
        status: "CLOSED",
        ...(parent.endDate ? { startsAt: { lt: new Date(parent.endDate.getTime() + 2 * DAY) } } : {}),
        ...(parent.startDate ? { endsAt: { gt: new Date(parent.startDate.getTime() - DAY) } } : {}),
      });
      continue;
    }
    const open = openByGoal.get(parent.id) ?? [];
    if (open.length === 0) continue;
    let from = open[0].startsAt.getTime();
    let to = open[0].endsAt.getTime();
    for (const p of open) {
      from = Math.min(from, p.startsAt.getTime());
      to = Math.max(to, p.endsAt.getTime());
    }
    out.push({ okrId: g.id, status: "CLOSED", startsAt: { lt: new Date(to) }, endsAt: { gt: new Date(from) } });
  }
  return out;
}

/**
 * The stored periods of the given repeating goals that the rollup reads,
 * oldest first per goal, with the live rows of the open ones. Goals that do
 * not repeat are skipped. `goals` should be every goal of the org (the
 * parent links decide which closed periods D2 needs).
 */
export async function loadStoredPeriods(
  goals: ReadonlyArray<GraphGoalInput>,
  settings: PeriodSettings,
  db: Db = prisma,
): Promise<Map<string, StoredPeriod[]>> {
  const out = new Map<string, StoredPeriod[]>();
  const repeating = goals.filter((g) => isGoalCadence(g.repeat));
  if (repeating.length === 0) return out;
  const goalById = new Map(repeating.map((g) => [g.id, g]));
  const ids = repeating.map((g) => g.id);

  const [open, latest] = await Promise.all([
    db.goalPeriod.findMany({ where: { okrId: { in: ids }, status: "OPEN" }, select: PERIOD_COLUMNS }) as Promise<PeriodRow[]>,
    latestPeriods(db, ids),
  ]);
  const openByGoal = new Map<string, PeriodRow[]>();
  for (const p of open) {
    const list = openByGoal.get(p.okrId);
    if (list) list.push(p);
    else openByGoal.set(p.okrId, [p]);
  }
  const windows = closedWindows(goals, openByGoal);
  const closed = windows.length
    ? ((await db.goalPeriod.findMany({ where: { OR: windows }, select: PERIOD_COLUMNS })) as PeriodRow[])
    : [];

  // One row per period, whichever read found it.
  const periods = new Map<string, PeriodRow>();
  for (const list of [open, latest, closed]) for (const p of list) periods.set(p.id, p);

  const openIds = open.map((p) => p.id);
  const rows = openIds.length
    ? await db.keyResultPeriod.findMany({
        where: { periodId: { in: openIds } },
        select: { id: true, keyResultId: true, periodId: true, startValue: true, targetValue: true, currentValue: true, kpiId: true, kpiUserId: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const rowsByPeriod = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = rowsByPeriod.get(r.periodId);
    if (list) list.push(r);
    else rowsByPeriod.set(r.periodId, [r]);
  }

  // The KPI months each open period's KPI rows read, fetched at once.
  const pairs: Array<{ kpiId: string; userId: string | null; months: string[] }> = [];
  const openById = new Map(open.map((p) => [p.id, p]));
  for (const r of rows) {
    const p = openById.get(r.periodId);
    if (!r.kpiId || !p || !isGoalCadence(p.cadence)) continue;
    pairs.push({ kpiId: r.kpiId, userId: r.kpiUserId, months: kpiMonths({ cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt }, settings) });
  }
  const kpi = await kpiMonthValues(pairs, db);

  const krByGoal = new Map(repeating.map((g) => [g.id, new Map(g.keyResults.map((k) => [k.id, k]))]));
  for (const p of periods.values()) {
    if (!isGoalCadence(p.cadence) || !goalById.has(p.okrId)) continue;
    const krById = krByGoal.get(p.okrId)!;
    const late = openedAfterWindow({ graceEndsAt: p.graceEndsAt }, p.createdAt);
    const live: LiveTargetRow[] = [];
    if (p.status === "OPEN") {
      for (const r of rowsByPeriod.get(p.id) ?? []) {
        const kr = r.keyResultId ? krById.get(r.keyResultId) : undefined;
        const fromKpi = kpiValueForPeriod(kpi, r, kr?.source, { cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt }, settings);
        const value = fromKpi ?? r.currentValue ?? r.startValue;
        const direction = targetDirection({ startValue: r.startValue, targetValue: r.targetValue, kpi: kr?.kpi ?? null });
        const attainment = unclampedProgress(r.startValue, r.targetValue, value, direction);
        live.push({
          id: r.id, keyResultId: r.keyResultId, periodId: r.periodId, startValue: r.startValue, targetValue: r.targetValue,
          currentValue: value, progress: clamp(attainment), attainment, kpiId: r.kpiId, kpiUserId: r.kpiUserId,
          kpiDerived: fromKpi != null,
          // B6: a hand-checked target in a period opened after its window is left out.
          leftOut: rowIsHand(r, kr) && late,
        });
      }
    }
    const stored: StoredPeriod = {
      id: p.id, okrId: p.okrId, key: p.key, cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt,
      trackedFrom: p.trackedFrom, graceEndsAt: p.graceEndsAt, closesAt: p.closesAt, createdAt: p.createdAt,
      status: p.status, progress: p.progress, attainment: p.attainment, result: p.result, scored: p.scored,
      closedAt: p.closedAt, scorePatchedAt: p.scorePatchedAt,
      targets: live.map((t) => ({ progress: t.progress, attainment: t.attainment, leftOut: t.leftOut })),
      rows: live,
    };
    const list = out.get(p.okrId);
    if (list) list.push(stored);
    else out.set(p.okrId, [stored]);
  }
  for (const list of out.values()) list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return out;
}

/**
 * One-time goals' progress as of an instant in the past (D2): each
 * hand-checked target at its last check-in at or before it (its start value
 * if none), a KPI target at the owner's record for that month or earlier, a
 * sourced target at its stored number; its own children by the same rules,
 * a repeating child as the mean of its periods ended by then inside the
 * goal's dates (`graph`, read as of the instant). Only the one-time goals
 * under `rootIds` are read.
 */
export async function oneTimeAsOf(
  orgId: string,
  rootIds: readonly string[],
  at: Date,
  settings: PeriodSettings,
  graph: PeriodGraph | null,
  db: Db = prisma,
): Promise<(goalId: string) => PeriodScore> {
  const none = (): PeriodScore => ({ progress: null, attainment: null });
  if (rootIds.length === 0) return none;
  const all = await db.oKR.findMany({
    where: { organizationId: orgId },
    select: {
      id: true, parentId: true, ownerId: true, repeat: true, startDate: true, endDate: true,
      keyResults: { select: { id: true, startValue: true, targetValue: true, currentValue: true, kpiId: true, source: true, kpi: { select: { direction: true, lowerIsBetter: true } } } },
    },
  });
  const kids = buildChildrenOf(all);
  const byId = new Map(all.map((g) => [g.id, g]));
  // The one-time goals under the roots, through one-time links.
  const wanted = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    const g = byId.get(id);
    if (!g || g.repeat || wanted.has(id)) continue;
    wanted.add(id);
    for (const c of kids.get(id) ?? []) stack.push(c);
  }
  if (wanted.size === 0) return none;
  const goals = [...wanted].map((id) => byId.get(id)!);
  const krIds = goals.flatMap((g) => g.keyResults.filter((k) => !isMeasuredAutomatically(k)).map((k) => k.id));
  const last = krIds.length
    ? await db.kRCheckIn.findMany({ where: { keyResultId: { in: krIds }, createdAt: { lte: at } }, orderBy: { createdAt: "desc" }, distinct: ["keyResultId"], select: { keyResultId: true, value: true } })
    : [];
  const lastBy = new Map(last.map((c) => [c.keyResultId, c.value]));
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone, year: "numeric", month: "2-digit" }).format(new Date(at.getTime() - 1)).slice(0, 7);
  const kpiIds = [...new Set(goals.flatMap((g) => g.keyResults.map((k) => k.kpiId).filter((v): v is string => !!v)))];
  const records = kpiIds.length
    ? await db.kPIRecord.findMany({
        where: { kpiId: { in: kpiIds }, period: { lte: month }, actualValue: { not: null }, status: { not: "REJECTED" } },
        orderBy: [{ period: "desc" }, { updatedAt: "desc" }],
        select: { kpiId: true, userId: true, period: true, actualValue: true },
      })
    : [];
  // The newest canonical record per (KPI, person), and per KPI for an ownerless goal.
  const newest = new Map<string, number>();
  for (const r of records) {
    if (r.actualValue == null || !/^\d{4}-\d{2}$/.test(r.period)) continue;
    for (const key of [kpiKey(r.kpiId, r.userId), kpiKey(r.kpiId, null)]) if (!newest.has(key)) newest.set(key, r.actualValue);
  }
  const asOfGraph: PeriodGraph | null = graph ? { ...graph, now: at, memo: new Map() } : null;
  const memo = new Map<string, PeriodScore>();
  const score = (id: string, seen: Set<string>): PeriodScore => {
    const known = memo.get(id);
    if (known) return known;
    const g = byId.get(id);
    if (!g || seen.has(id)) return none();
    seen.add(id);
    const parts = g.keyResults.map((k) => {
      let value = k.currentValue;
      if (k.kpiId) value = newest.get(kpiKey(k.kpiId, g.ownerId)) ?? k.startValue;
      else if (!isMeasuredAutomatically(k)) value = lastBy.get(k.id) ?? k.startValue;
      const a = unclampedProgress(k.startValue, k.targetValue, value, targetDirection(k));
      return { progress: clamp(a), attainment: a };
    });
    for (const c of kids.get(id) ?? []) {
      const child = byId.get(c);
      // A repeating goal under a one-time child: its periods ended by then (L2).
      const s = child?.repeat ? (asOfGraph ? repeatingChildForOneTimeParent(c, g, asOfGraph) : none()) : score(c, seen);
      if (s.progress != null) parts.push({ progress: s.progress, attainment: s.attainment ?? s.progress });
    }
    const out = meanScore(parts);
    memo.set(id, out);
    return out;
  };
  return (goalId) => score(goalId, new Set());
}
