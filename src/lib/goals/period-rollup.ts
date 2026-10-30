// Period-aware goal progress (docs/plans/recurring-goals.md D2, B6, B8).
//
// A repeating goal's number is the number of ONE of its periods, never the
// running mirror on KeyResult: the current period for "now", and any period
// for its history, its close and its parent. A parent's period is computed
// from its children's periods by their cadence, so a Company goal closing
// October reads its Department goals' October, not the November that has
// already started under them.
//
// For a period P of a repeating goal, the progress is the mean of its own
// targets' rows for P plus each measured child's contribution:
//   - a repeating child's periods that are P's cadence or finer and whose
//     nominal last day (nominalLastDayKey) falls in P: the mean of them (one
//     for the same cadence, about four weeks for a month);
//   - else a coarser child's period that holds P's nominal last day, as it
//     stands (a quarterly Department goal under a monthly Company goal);
//   - a one-time child: its progress as of P's end (`oneTimeAsOf`).
// A CLOSED period reads its frozen numbers. A one-time PARENT takes a
// repeating child as the mean of the child's ENDED periods inside the
// parent's dates, or its current period while none has ended, so it does not
// drop to near 0 every 1st when its monthly children restart.
//
// Pure: no prisma. The server module (goal-periods.server.ts) and the org
// rollup (alignment.ts computeGoalRollups) build the graph and ask here.

import {
  firstDayKey,
  lastDayKey,
  nominalLastDayKey,
  periodAt,
  type GoalCadence,
  type PeriodSettings,
} from "@/lib/goals/goal-period";

/** One target's row in one period, with the value it reads now (or froze at). */
export interface RollupTarget {
  /** Clamped, 0 to 100. */
  progress: number;
  /** The same without the clamp ("112%"). */
  attainment: number;
  /** B6: out of the period's progress (opened after its window, or paused too long). */
  leftOut: boolean;
}

export interface RollupPeriod {
  id: string;
  key: string;
  cadence: GoalCadence;
  startsAt: Date;
  endsAt: Date;
  status: string;
  /** Frozen at the close (null for Not measured). */
  progress: number | null;
  attainment: number | null;
  targets: RollupTarget[];
}

export interface RollupGoal {
  id: string;
  parentId: string | null;
  repeat: GoalCadence | null;
  startDate: Date | null;
  endDate: Date | null;
  /** Repeating goals: every stored period, oldest first. Empty for one-time goals. */
  periods: RollupPeriod[];
}

export interface PeriodScore {
  /** Clamped mean, 0 to 100, or null when nothing measured counted. */
  progress: number | null;
  attainment: number | null;
}

const NONE: PeriodScore = { progress: null, attainment: null };

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * A target's progress along start to target WITHOUT the 0 to 100 clamp, for
 * the history's "Hit, 112%" (B1 attainment). The same direction rules as
 * keyResultProgress (alignment.ts), which is this clamped.
 */
export function unclampedProgress(
  startValue: number,
  targetValue: number,
  currentValue: number,
  direction: "HIGHER" | "LOWER" | "MAINTAIN" = "HIGHER",
): number {
  const start = Number(startValue) || 0;
  const target = Number(targetValue) || 0;
  const current = Number(currentValue) || 0;
  if (direction === "MAINTAIN") {
    if (Math.abs(current - target) <= Math.abs(target) * 0.005) return 100;
    const span = Math.abs(start - target);
    if (span === 0) return 0;
    return Math.round(Math.max(0, (1 - Math.abs(current - target) / span) * 100));
  }
  if (direction === "LOWER") {
    const span = start - target;
    if (span <= 0) return current <= target ? 100 : 0;
    return Math.round(((start - current) / span) * 100);
  }
  const span = target - start;
  if (span <= 0) return current >= target ? 100 : 0;
  return Math.round(((current - start) / span) * 100);
}

/** The mean of what counted, clamped and not, or nothing when nothing counted. */
export function meanScore(parts: ReadonlyArray<{ progress: number; attainment: number }>): PeriodScore {
  if (parts.length === 0) return NONE;
  const p = parts.reduce((s, x) => s + x.progress, 0) / parts.length;
  const a = parts.reduce((s, x) => s + x.attainment, 0) / parts.length;
  return { progress: clamp(p), attainment: Math.round(a) };
}

export interface PeriodGraph {
  goals: ReadonlyMap<string, RollupGoal>;
  childrenOf: ReadonlyMap<string, readonly string[]>;
  settings: PeriodSettings;
  now: Date;
  /** A one-time goal's progress as of an instant (its live number when the instant is not past). */
  oneTimeAsOf: (goalId: string, at: Date) => PeriodScore;
  /** Scores already computed, by goal and period, so a deep tree is walked once. */
  memo?: Map<string, PeriodScore>;
}

/** The goal's children, as the graph holds them. */
export function buildChildrenOf(goals: Iterable<Pick<RollupGoal, "id" | "parentId">>): Map<string, string[]> {
  const all = [...goals];
  const ids = new Set(all.map((g) => g.id));
  const out = new Map<string, string[]>();
  for (const g of all) {
    if (!g.parentId || !ids.has(g.parentId)) continue;
    const list = out.get(g.parentId);
    if (list) list.push(g.id);
    else out.set(g.parentId, [g.id]);
  }
  return out;
}

const RANK: Record<GoalCadence, number> = { WEEKLY: 0, MONTHLY: 1, QUARTERLY: 2, YEARLY: 3 };

/** The day range a period covers in the workspace zone: its first and last day keys. */
function dayRange(p: Pick<RollupPeriod, "startsAt" | "endsAt">, s: PeriodSettings): [string, string] {
  return [firstDayKey(p, s), lastDayKey(p, s)];
}

/**
 * A repeating child's periods that count toward the parent period P (D2):
 * same cadence or finer, whose nominal last day falls inside P; else the
 * coarser one holding P's nominal last day.
 */
export function childPeriodsFor(child: RollupGoal, p: RollupPeriod, s: PeriodSettings): RollupPeriod[] {
  const [first, last] = dayRange(p, s);
  const finer = child.periods.filter((c) => {
    if (RANK[c.cadence] > RANK[p.cadence]) return false;
    const nld = nominalLastDayKey(c, s);
    return nld >= first && nld <= last;
  });
  if (finer.length > 0) return finer;
  const pNominal = nominalLastDayKey(p, s);
  const holding = child.periods.find((c) => {
    if (RANK[c.cadence] <= RANK[p.cadence]) return false;
    const [cf, cl] = dayRange(c, s);
    return pNominal >= cf && pNominal <= cl;
  });
  return holding ? [holding] : [];
}

/**
 * The child periods a parent period P waits for before it closes (B7, D2):
 * the ones childPeriodsFor reads for P that are P's cadence or finer, so a
 * quarterly Company goal never freezes while its monthly Department goal's
 * December still takes KPI numbers. A coarser child's period is read as it
 * stands when P closes (D2), so it holds nothing: its final number counts
 * work after P's end, which P must not wait for.
 */
export function childPeriodsHoldingClose<T extends Pick<RollupPeriod, "key" | "cadence" | "startsAt" | "endsAt">>(
  childPeriods: readonly T[],
  p: Pick<RollupPeriod, "key" | "cadence" | "startsAt" | "endsAt">,
  s: PeriodSettings,
): T[] {
  const read = childPeriodsFor(
    { id: "", parentId: null, repeat: null, startDate: null, endDate: null, periods: childPeriods as unknown as RollupPeriod[] },
    p as RollupPeriod,
    s,
  ) as unknown as T[];
  return read.filter((c) => RANK[c.cadence] <= RANK[p.cadence]);
}

/** One period's score: frozen when CLOSED, else its targets plus its children's contributions. */
export function periodScore(goalId: string, p: RollupPeriod, g: PeriodGraph, visiting: Set<string> = new Set()): PeriodScore {
  if (p.status === "CLOSED") return { progress: p.progress, attainment: p.attainment ?? p.progress };
  const memoKey = `${goalId}|${p.id}`;
  const known = g.memo?.get(memoKey);
  if (known) return known;
  if (visiting.has(goalId)) return NONE;
  visiting.add(goalId);
  const parts: Array<{ progress: number; attainment: number }> = p.targets
    .filter((t) => !t.leftOut)
    .map((t) => ({ progress: t.progress, attainment: t.attainment }));
  for (const childId of g.childrenOf.get(goalId) ?? []) {
    const c = childContribution(childId, p, g, visiting);
    if (c.progress != null) parts.push({ progress: c.progress, attainment: c.attainment ?? c.progress });
  }
  visiting.delete(goalId);
  const score = meanScore(parts);
  g.memo?.set(memoKey, score);
  return score;
}

/** What one child adds to its repeating parent's period P (D2). */
export function childContribution(childId: string, p: RollupPeriod, g: PeriodGraph, visiting: Set<string> = new Set()): PeriodScore {
  const child = g.goals.get(childId);
  if (!child) return NONE;
  if (!child.repeat) return g.oneTimeAsOf(childId, p.endsAt);
  const scores = childPeriodsFor(child, p, g.settings)
    .map((c) => periodScore(childId, c, g, visiting))
    .filter((x): x is { progress: number; attainment: number } => x.progress != null)
    .map((x) => ({ progress: x.progress, attainment: x.attainment ?? x.progress }));
  return meanScore(scores);
}

/**
 * The period a repeating goal shows for "now": the stored one whose range
 * holds now, else the latest that has started (an ended goal's last period,
 * or the one in its grace while the next is not open yet). Null before its
 * first period starts.
 */
export function currentPeriodOf<T extends Pick<RollupPeriod, "startsAt" | "endsAt">>(periods: readonly T[], now: Date): T | null {
  const holding = periodAt(periods, now);
  if (holding) return holding;
  let best: T | null = null;
  for (const p of periods) if (p.startsAt.getTime() <= now.getTime() && (!best || p.startsAt > best.startsAt)) best = p;
  return best;
}

/** A repeating goal's live number: its current period's score. */
export function repeatingLiveScore(goalId: string, g: PeriodGraph): PeriodScore {
  const goal = g.goals.get(goalId);
  if (!goal || !goal.repeat) return NONE;
  const p = currentPeriodOf(goal.periods, g.now);
  return p ? periodScore(goalId, p, g) : NONE;
}

const dateKeyOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * What a repeating child adds to a ONE-TIME parent (D2): the mean of its
 * periods that have ended (closed, or past their end and waiting for the
 * close) whose nominal last day falls inside the parent's dates, or, while
 * none has ended, its current period. A goal's start and due are calendar
 * days stored as UTC midnight, so they compare as their first ten
 * characters.
 */
export function repeatingChildForOneTimeParent(
  childId: string,
  parent: Pick<RollupGoal, "startDate" | "endDate">,
  g: PeriodGraph,
): PeriodScore {
  const child = g.goals.get(childId);
  if (!child || !child.repeat) return NONE;
  const from = dateKeyOf(parent.startDate);
  const to = dateKeyOf(parent.endDate);
  const ended = child.periods.filter((c) => {
    if (c.endsAt.getTime() > g.now.getTime()) return false;
    const nld = nominalLastDayKey(c, g.settings);
    return (!from || nld >= from) && (!to || nld <= to);
  });
  if (ended.length === 0) return repeatingLiveScore(childId, g);
  return meanScore(
    ended
      .map((c) => periodScore(childId, c, g))
      .filter((x): x is { progress: number; attainment: number } => x.progress != null)
      .map((x) => ({ progress: x.progress, attainment: x.attainment ?? x.progress })),
  );
}
