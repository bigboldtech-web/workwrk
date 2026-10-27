// Repeating goals in the performance score and the review cycles
// (docs/plans/recurring-goals.md G1, G2, G3).
//
// WHICH PERIOD COUNTS (G1). The score's month M keeps its key (the
// service's getCurrentPeriod). Its breakdown carries `okrParts`, one
// { okrId, periodKey, progress } per goal, and okrScore is their mean. A
// one-time goal's part is its live progress, as before (periodKey null). A
// repeating goal's part is its scored periods that BELONG to M, a period
// belonging to the workspace-zone month of its nominal last day
// (nominalLastDayKey, so a stretched October counts in October): a monthly
// goal, its month; a weekly goal, the mean of its weeks ending in M; a
// quarterly or yearly goal only in the month it ends. Mapping by the
// period's own days, never "the current period", keeps the October row on
// October when the server's clock and the workspace's disagree for a few
// hours at the month change (01:00 IST on 1 November is still October on a
// UTC server, and October is the period that row reads). A period not yet
// closed counts at its live number unless B6 would leave it unscored (a
// goal made on 27 October, a period opened after its window); a closed one
// counts only when it was scored, at its frozen number.
//
// THE CLOSE PATCH (G2). patchPeriodScore runs once per closed period
// (patchScoreOnce in goal-periods.server.ts holds the row FOR UPDATE and
// stamps scorePatchedAt in the same transaction). It patches the owner's
// row for the month the period belongs to:
//   - a row with okrParts: that goal's part is replaced (or removed, when
//     the month no longer holds a scored period of it), okrScore is the new
//     mean, and the total is re-composed from the row's STORED breakdown, so
//     no other component is recomputed (October's row never picks up
//     November's KPI numbers or reviews);
//   - a row from before okrParts: left alone;
//   - no row for the month: one is made with the goal part alone.
//
// REVIEW CYCLES (G3). A repeating goal reads as the mean of its scored
// periods whose nominal last day falls inside the cycle; the period running
// now only when the cycle ends inside it. A Q3 review opened on 2 November
// reads July, August and September, never November.
//
// THE SOURCES OF STEPS 4 AND 5. A period's live number is the org rollup's
// (periodScore over the period graph), which is where a List or table
// source's stored number arrives when those steps land; nothing here reads
// a source itself.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { computeGoalRollups, goalRollupFor, type GoalRollupContext } from "@/lib/alignment";
import {
  firstDayKey,
  isGoalCadence,
  isScored,
  lastDayKey,
  nominalLastDayKey,
  openedAfterWindow,
  periodLabel,
  periodSettingsOf,
  resultFor,
  RESULT_LABEL,
  startOfZonedDay,
  type GoalCadence,
  type GoalPeriodRange,
  type GoalResult,
  type PeriodSettings,
} from "@/lib/goals/goal-period";
import { periodScore } from "@/lib/goals/period-rollup";
import { composeScore, scoreWeightsOf, type ScoreWeights } from "@/lib/performance/score-compose";

/** One goal's share of a month's performance score (G1). */
export interface OkrPart {
  okrId: string;
  /** The period counted (for a weekly goal, the last of its weeks counted); null for a one-time goal. */
  periodKey: string | null;
  progress: number;
}

/** A stored period, with what the score and review reads need. */
export interface CountedPeriodRow {
  id: string;
  okrId: string;
  key: string;
  cadence: string;
  startsAt: Date;
  endsAt: Date;
  trackedFrom: Date;
  graceEndsAt: Date;
  closesAt: Date;
  createdAt: Date;
  status: string;
  progress: number | null;
  attainment: number | null;
  result: string | null;
  scored: boolean | null;
}

const PERIOD_SELECT = {
  id: true, okrId: true, key: true, cadence: true, startsAt: true, endsAt: true, trackedFrom: true, graceEndsAt: true,
  closesAt: true, createdAt: true, status: true, progress: true, attainment: true, result: true, scored: true,
} as const;

/** A run of whole days in the workspace zone, both ends included ("2026-10-01" to "2026-10-31"). */
export interface DayWindow {
  firstKey: string;
  lastKey: string;
}

const DAY = 86_400_000;

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The days of a "YYYY-MM" month. */
export function monthWindow(month: string): DayWindow {
  const [y, m] = month.split("-").map(Number);
  return { firstKey: `${month}-01`, lastKey: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

const typed = <T extends CountedPeriodRow>(p: T): (T & { cadence: GoalCadence }) | null =>
  isGoalCadence(p.cadence) ? (p as T & { cadence: GoalCadence }) : null;

/** G1: the score month ("YYYY-MM") a period belongs to, the workspace-zone month of its nominal last day. */
export function scoreMonthOf(p: GoalPeriodRange, s: PeriodSettings): string {
  return nominalLastDayKey(p, s).slice(0, 7);
}

/** B6, read before the close: would this open period's live number count? */
function openCounts(p: CountedPeriodRow, live: number | null): boolean {
  if (live == null) return false;
  return isScored({
    result: resultFor(live),
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    trackedFrom: p.trackedFrom,
    openedAfterWindow: openedAfterWindow({ graceEndsAt: p.graceEndsAt }, p.createdAt),
  });
}

export interface CountedPeriod<T> {
  period: T;
  progress: number;
}

const isRunning = (p: Pick<CountedPeriodRow, "startsAt" | "endsAt">, now: Date) =>
  p.startsAt.getTime() <= now.getTime() && now.getTime() < p.endsAt.getTime();

/** Does a review cycle (or a score month) read this period? See countedPeriods. */
function windowReads(r: GoalPeriodRange & CountedPeriodRow, window: DayWindow, mode: "month" | "cycle", s: PeriodSettings, now: Date): boolean {
  if (mode === "cycle" && r.status !== "CLOSED" && isRunning(r, now)) {
    return firstDayKey(r, s) <= window.lastKey && window.lastKey <= lastDayKey(r, s);
  }
  const nld = nominalLastDayKey(r, s);
  return nld >= window.firstKey && nld <= window.lastKey;
}

/**
 * Of one goal's stored periods, the ones a window of days reads, each at the
 * number it counts (G1, G3), oldest first:
 *   - a CLOSED period whose nominal last day falls in the window, when it was
 *     scored, at its frozen progress;
 *   - a period that has ended but not closed (its grace, a KPI hold, or
 *     waiting for the cron) whose nominal last day falls in the window, at
 *     its live number, unless B6 would leave it unscored;
 *   - the period running now: for a score month, when its nominal last day
 *     falls in the month (so a quarter counts only in the month it ends);
 *     for a review cycle, only when the cycle's last day falls inside it.
 */
export function countedPeriods<T extends CountedPeriodRow>(
  periods: readonly T[],
  window: DayWindow,
  mode: "month" | "cycle",
  s: PeriodSettings,
  now: Date,
  live: (p: T) => number | null,
): CountedPeriod<T>[] {
  const out: CountedPeriod<T>[] = [];
  const sorted = [...periods].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const p of sorted) {
    const r = typed(p);
    if (!r || p.startsAt.getTime() > now.getTime() || !windowReads(r, window, mode, s, now)) continue;
    if (p.status === "CLOSED") {
      if (p.scored === true && p.progress != null) out.push({ period: p, progress: p.progress });
      continue;
    }
    const value = live(p);
    if (value != null && openCounts(p, value)) out.push({ period: p, progress: value });
  }
  return out;
}

/** A goal's part from what countedPeriods kept, or null when nothing counted. */
function partOf(okrId: string, counted: ReadonlyArray<CountedPeriod<CountedPeriodRow>>): OkrPart | null {
  if (counted.length === 0) return null;
  const mean = counted.reduce((sum, c) => sum + c.progress, 0) / counted.length;
  return { okrId, periodKey: counted[counted.length - 1].period.key, progress: Math.max(0, Math.min(100, Math.round(mean))) };
}

/** The live number of an open period, from the org rollup's period graph (its rows, its KPI months, its children: D2). */
function liveFrom(ctx: Pick<GoalRollupContext, "periods" | "periodGraph">): (p: CountedPeriodRow) => number | null {
  return (p) => {
    if (!ctx.periodGraph) return null;
    const stored = (ctx.periods.get(p.okrId) ?? []).find((x) => x.id === p.id);
    if (!stored) return null;
    return periodScore(p.okrId, stored, ctx.periodGraph).progress;
  };
}

/** The stored periods of these goals that can belong to the window (a wide margin; the exact rule runs in memory). */
async function periodsAround(
  db: Pick<Prisma.TransactionClient, "goalPeriod">,
  okrIds: readonly string[],
  window: DayWindow,
  s: PeriodSettings,
  extra: Prisma.GoalPeriodWhereInput = {},
): Promise<Map<string, CountedPeriodRow[]>> {
  const out = new Map<string, CountedPeriodRow[]>();
  if (okrIds.length === 0) return out;
  // A period's nominal last day can sit up to half a month past its own
  // last day (it holds more than half of that month), and a stretched one
  // ends a few days past it, so the read takes three weeks either side.
  const from = new Date(startOfZonedDay(window.firstKey, s.timezone).getTime() - 21 * DAY);
  const to = new Date(startOfZonedDay(addDays(window.lastKey, 1), s.timezone).getTime() + 21 * DAY);
  const rows = (await db.goalPeriod.findMany({
    where: { okrId: { in: [...okrIds] }, startsAt: { lt: to }, endsAt: { gt: from }, ...extra },
    select: PERIOD_SELECT,
    orderBy: { startsAt: "asc" },
  })) as CountedPeriodRow[];
  for (const r of rows) {
    const list = out.get(r.okrId);
    if (list) list.push(r);
    else out.set(r.okrId, [r]);
  }
  return out;
}

const clampMean = (xs: readonly number[]) => Math.min(Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), 100);

/**
 * G1: the person's goal parts for the score month `month` ("YYYY-MM"), and
 * okrScore, their mean (null with no part). Every goal they own, as the
 * score always read; a one-time goal at its live rollup, a repeating goal
 * at its periods belonging to the month, left out when none counts.
 */
export async function okrPartsFor(userId: string, month: string, now: Date = new Date()): Promise<{ okrScore: number | null; okrParts: OkrPart[] }> {
  const okrs = await prisma.oKR.findMany({
    where: { ownerId: userId },
    select: { id: true, organizationId: true, progress: true, status: true, repeat: true },
  });
  if (okrs.length === 0) return { okrScore: null, okrParts: [] };
  // Score off the live rollup (KPI-linked KRs + measured children), the
  // same number every goal surface shows, not the stored OKR.progress
  // column which drifts stale between KPI readings.
  const orgId = okrs[0].organizationId;
  const ctx = await computeGoalRollups(orgId, now);
  const s = ctx.periodSettings;
  const repeatingIds = okrs.filter((o) => isGoalCadence(o.repeat) && o.organizationId === orgId).map((o) => o.id);
  const window = monthWindow(month);
  const byGoal = s && repeatingIds.length ? await periodsAround(prisma, repeatingIds, window, s) : new Map<string, CountedPeriodRow[]>();
  const live = liveFrom(ctx);
  const okrParts: OkrPart[] = [];
  for (const o of okrs) {
    if (isGoalCadence(o.repeat)) {
      if (!s || o.organizationId !== orgId) continue;
      const part = partOf(o.id, countedPeriods(byGoal.get(o.id) ?? [], window, "month", s, now, live));
      if (part) okrParts.push(part);
      continue;
    }
    okrParts.push({ okrId: o.id, periodKey: null, progress: goalRollupFor(ctx, o).progress });
  }
  return { okrScore: okrParts.length ? clampMean(okrParts.map((p) => p.progress)) : null, okrParts };
}

/* ───────────────────────── The close patch (G2) ───────────────────────── */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Patch the owner's score row for the month the period belongs to (G2). Inside patchScoreOnce's transaction. */
export async function patchPeriodScore(tx: Prisma.TransactionClient, periodId: string): Promise<void> {
  const p = await tx.goalPeriod.findUnique({
    where: { id: periodId },
    select: { ...PERIOD_SELECT, okr: { select: { id: true, ownerId: true, organizationId: true } } },
  });
  if (!p || p.status !== "CLOSED" || !p.okr?.ownerId) return;
  const range = typed(p as CountedPeriodRow);
  if (!range) return;
  const ownerId = p.okr.ownerId;
  const orgId = p.okr.organizationId;
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const s = periodSettingsOf(org?.settings);
  const month = scoreMonthOf(range, s);
  // The goal's part in that month, from its CLOSED periods there (at the
  // final close every one of them has frozen; a weekly goal's earlier weeks
  // closed before this one). An unscored period gives no part.
  const around = (await periodsAround(tx, [p.okrId], monthWindow(month), s, { status: "CLOSED" })).get(p.okrId) ?? [];
  const counted = around
    .filter((x) => {
      const r = typed(x);
      return !!r && scoreMonthOf(r, s) === month && x.scored === true && x.progress != null;
    })
    .map((x) => ({ period: x, progress: x.progress as number }));
  const part = partOf(p.okrId, counted);

  const row = await tx.performanceScore.findUnique({ where: { userId_period: { userId: ownerId, period: month } } });
  if (!row) {
    // No row for the month: one with the goal part alone.
    if (!part) return;
    const weights = scoreWeightsOf(org?.settings);
    const okrScore = part.progress;
    const score = composeScore({ kpiScore: null, managerRating: null, peerRating: null, selfRating: null, sopCompliance: null, okrScore, taskScore: null, kudosBonus: 0 }, weights);
    if (score == null) return;
    const breakdown = { kpiScore: null, managerRating: null, peerRating: null, selfRating: null, sopCompliance: null, kudosBonus: 0, okrScore, okrParts: [part], weights };
    await tx.performanceScore.create({
      data: { userId: ownerId, period: month, score, breakdown: breakdown as unknown as Prisma.InputJsonValue, organizationId: orgId, calculatedAt: new Date() },
    });
    return;
  }
  const b = (row.breakdown ?? null) as Record<string, unknown> | null;
  // A row from before okrParts: its goal share cannot be picked out, so it is left alone.
  if (!b || !Array.isArray(b.okrParts)) return;
  const had = (b.okrParts as OkrPart[]).filter((x) => x && typeof x.okrId === "string");
  const parts: OkrPart[] = [];
  let placed = false;
  for (const x of had) {
    if (x.okrId !== p.okrId) parts.push(x);
    else if (part && !placed) {
      parts.push(part);
      placed = true;
    }
  }
  if (part && !placed) parts.push(part);
  const okrScore = parts.length ? clampMean(parts.map((x) => num(x.progress) ?? 0)) : null;
  const weights = b.weights && typeof b.weights === "object" ? (b.weights as ScoreWeights) : scoreWeightsOf(org?.settings);
  // The total from the row's STORED inputs: nothing else is recomputed.
  const score = composeScore({
    kpiScore: num(b.kpiScore),
    managerRating: num(b.managerRating),
    peerRating: num(b.peerRating),
    selfRating: num(b.selfRating),
    sopCompliance: num(b.sopCompliance),
    okrScore,
    taskScore: num(b.taskScore),
    kudosBonus: num(b.kudosBonus) ?? 0,
  }, weights);
  const next: Record<string, unknown> = { ...b, okrParts: parts };
  if (okrScore == null) delete next.okrScore;
  else next.okrScore = okrScore;
  if (score == null) {
    // Nothing is left to score in that month: no row, as the service writes none.
    await tx.performanceScore.delete({ where: { id: row.id } });
    return;
  }
  await tx.performanceScore.update({ where: { id: row.id }, data: { score, breakdown: next as unknown as Prisma.InputJsonValue } });
}

/* ───────────────────────── Review cycles (G3) ───────────────────────── */

export type CyclePeriodState = "open" | "grace" | "closing" | "closed";

/** One period a review cycle shows for a repeating goal (the self assessment lists them). */
export interface CyclePeriodRead {
  key: string;
  label: string;
  state: CyclePeriodState;
  /** The frozen result of a closed period, else null. */
  result: GoalResult | null;
  resultLabel: string | null;
  /** Frozen, or live while it has not closed. Null when nothing was measured. */
  progress: number | null;
  attainment: number | null;
  /** Whether it counts in the cycle's number. */
  counted: boolean;
}

export interface CycleGoalRead {
  /** The mean of the counted periods, or null when none counts. */
  progress: number | null;
  periods: CyclePeriodRead[];
}

function stateOf(p: CountedPeriodRow, now: Date): CyclePeriodState {
  if (p.status === "CLOSED") return "closed";
  if (now.getTime() < p.endsAt.getTime()) return "open";
  if (now.getTime() < p.closesAt.getTime()) return "grace";
  return "closing";
}

const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * G3: each repeating goal's number for a review cycle, and the periods the
 * cycle shows (every period in it, counted or not, oldest first). A cycle's
 * dates are calendar days (stored as UTC midnight, read as their first ten
 * characters). `ctx` is the org rollup the caller read.
 */
export async function repeatingCycleReads(
  ctx: GoalRollupContext,
  okrIds: readonly string[],
  cycle: { start: Date; end: Date },
  now: Date = new Date(),
): Promise<Map<string, CycleGoalRead>> {
  const out = new Map<string, CycleGoalRead>();
  const s = ctx.periodSettings;
  if (!s || okrIds.length === 0) return out;
  const window: DayWindow = { firstKey: dayKeyOf(cycle.start), lastKey: dayKeyOf(cycle.end) };
  const byGoal = await periodsAround(prisma, okrIds, window, s);
  const live = liveFrom(ctx);
  for (const okrId of okrIds) {
    const periods = byGoal.get(okrId) ?? [];
    const counted = countedPeriods(periods, window, "cycle", s, now, live);
    const countedIds = new Set(counted.map((c) => c.period.id));
    const shown: CyclePeriodRead[] = [];
    for (const p of periods) {
      const r = typed(p);
      if (!r || p.startsAt.getTime() > now.getTime() || !windowReads(r, window, "cycle", s, now)) continue;
      const closed = p.status === "CLOSED";
      const value = closed ? p.progress : live(p);
      const result = closed && p.result && p.result in RESULT_LABEL ? (p.result as GoalResult) : null;
      shown.push({
        key: p.key,
        label: periodLabel(r, s, now),
        state: stateOf(p, now),
        result,
        resultLabel: result ? RESULT_LABEL[result] : null,
        progress: value,
        attainment: closed ? p.attainment : value,
        counted: countedIds.has(p.id),
      });
    }
    out.set(okrId, { progress: counted.length ? Math.round(counted.reduce((a, c) => a + c.progress, 0) / counted.length) : null, periods: shown });
  }
  return out;
}
