// What the goal page, GET /api/okrs/[id]?period= and assess?period= read of a
// repeating goal's periods (docs/plans/recurring-goals.md E2, E4, I).
//
//   goalPeriodsSummary   the period control's choices (every period that has
//                        started, oldest first), the current one, the first
//                        one's name and the Repeats row's words
//   periodView           ONE period as the page shows it: its dates and
//                        state, its progress and result, and its targets'
//                        numbers. An OPEN period reads its live numbers from
//                        the org rollup every surface reads (the KPI months,
//                        the children, D2); a CLOSED one reads what froze, and
//                        a target deleted since still shows (B5)
//   closedPeriodsPage    Past periods: the closed periods, newest first,
//                        12 a page, each with its result and, for a goal
//                        with one target, "112 of 100"
//   repeatEditFacts      what the Edit modal needs beyond the goal row: the
//                        current period, whether Starts may still move and
//                        how many check-ins moving it leaves behind, whether
//                        a KPI is linked, and for a one-time goal the
//                        conversion's "What was added since 1 Oct" numbers
//
// Reads only. Settling is the caller's (settleOnRead), as on every read path.

import { prisma } from "@/lib/prisma";
import type { GoalRollupContext } from "@/lib/alignment";
import {
  daysLeft,
  GOAL_CADENCES,
  isGoalCadence,
  kpiMonths,
  lastDayKey,
  nominalLastDayKey,
  periodDatesLabel,
  periodFor,
  periodLabel,
  RESULT_LABEL,
  startOfZonedDay,
  type GoalCadence,
  type GoalPeriodRange,
  type GoalResult,
  type PeriodSettings,
} from "@/lib/goals/goal-period";
import { currentStoredPeriod, periodState, type PeriodState } from "@/lib/goals/goal-periods.server";
import { isMeasuredAutomatically, periodStartOf, targetDirection } from "@/lib/goals/goal-measure";
import { periodScore, unclampedProgress } from "@/lib/goals/period-rollup";
import { shiftKpiPeriod } from "@/lib/kpi-period";
import { zonedDateKey } from "@/lib/zoned-time";
import { goalVerdictFor } from "@/lib/goal-verdict";

type StoredRange = GoalPeriodRange & { id: string; status: string; graceEndsAt: Date; closesAt: Date; trackedFrom: Date };

const dayBefore = (d: Date, zone: string) => zonedDateKey(new Date(d.getTime() - 1), zone);

/** The last day KPI numbers are taken for a period: the last day of the month after its last KPI month (October: 30 Nov). */
function kpiLastDay(p: Pick<GoalPeriodRange, "cadence" | "startsAt" | "endsAt">, s: PeriodSettings): string | null {
  const months = kpiMonths(p, s);
  if (months.length === 0) return null;
  const next = shiftKpiPeriod(months[months.length - 1], 1);
  const [y, m] = next.split("-").map(Number);
  return `${next}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/* ───────────────────────── The period control ───────────────────────── */

export interface PeriodChoiceView {
  key: string;
  label: string;
}

export interface GoalPeriodsSummary {
  cadence: GoalCadence;
  /** Every period that has started, oldest first (the period control walks these). */
  choices: PeriodChoiceView[];
  /** The period shown for now: the one holding now, else the latest that has started. */
  currentKey: string | null;
  closedCount: number;
  /** The Repeats row: the first period's name, and the last one's when Ends is set. */
  startLabel: string | null;
  untilLabel: string | null;
  started: boolean;
}

export async function goalPeriodsSummary(
  okr: { id: string; repeat: string | null; repeatUntil: string | null; startDate: Date | null },
  s: PeriodSettings,
  now: Date,
): Promise<GoalPeriodsSummary | null> {
  if (!isGoalCadence(okr.repeat)) return null;
  const cadence = okr.repeat;
  const rows = await prisma.goalPeriod.findMany({
    where: { okrId: okr.id },
    orderBy: { startsAt: "asc" },
    select: { id: true, key: true, cadence: true, startsAt: true, endsAt: true, status: true, graceEndsAt: true, closesAt: true, trackedFrom: true },
  });
  const typed: StoredRange[] = rows.filter((r) => isGoalCadence(r.cadence)).map((r) => ({ ...r, cadence: r.cadence as GoalCadence }));
  const startedRows = typed.filter((p) => p.startsAt.getTime() <= now.getTime());
  const current = currentStoredPeriod(typed, now);
  const first = typed[0] ?? null;
  const startRange = first ?? (okr.startDate ? periodFor(cadence, startOfZonedDay(okr.startDate.toISOString().slice(0, 10), s.timezone), s) : null);
  const untilRange = okr.repeatUntil ? periodFor(cadence, startOfZonedDay(okr.repeatUntil, s.timezone), s) : null;
  return {
    cadence,
    choices: startedRows.map((p) => ({ key: p.key, label: periodLabel(p, s, now) })),
    currentKey: current?.key ?? null,
    closedCount: typed.filter((p) => p.status === "CLOSED").length,
    startLabel: startRange ? periodLabel(startRange, s, now) : null,
    untilLabel: untilRange ? periodLabel(untilRange, s, now) : null,
    started: startedRows.length > 0,
  };
}

/* ───────────────────────── One period ───────────────────────── */

export interface PeriodTargetView {
  /** KeyResultPeriod.id */
  rowId: string;
  /** Null once the target was deleted (its closed rows stay, B5). */
  keyResultId: string | null;
  title: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
  currentValue: number;
  progress: number;
  attainment: number;
  /** "Carried from October" until someone checks in (B4). */
  carried: boolean;
  /** The row's number comes from its KPI in this period. */
  kpiLinked: boolean;
}

export interface PeriodView {
  /** GoalPeriod.id */
  id: string;
  key: string;
  label: string;
  cadence: GoalCadence;
  state: PeriodState;
  /** The period shown for now. */
  current: boolean;
  startsAt: string;
  endsAt: string;
  trackedFrom: string;
  graceEndsAt: string;
  closesAt: string;
  daysLeft: number;
  /** "1 Oct 2026 to 31 Oct 2026" */
  datesLabel: string;
  lastDay: string;
  nominalLastDay: string;
  resetsOn: string;
  /** Hand check-ins are taken into it now (started, OPEN, before graceEndsAt). */
  takesCheckIns: boolean;
  /** It has ended and still takes late hand numbers. */
  takesLateNumbers: boolean;
  /** Its close waits for a KPI month past its grace (B7). */
  kpiHeld: boolean;
  graceLastDay: string;
  kpiLastDay: string | null;
  closedDay: string | null;
  /** The period before it, for "Carried from October". */
  previousLabel: string | null;
  /** Clamped, or null when nothing measured counts. */
  progress: number | null;
  attainment: number | null;
  result: GoalResult | null;
  resultLabel: string | null;
  scored: boolean | null;
  targets: PeriodTargetView[];
}

/**
 * ONE period of a repeating goal as the page shows it: `key`, or the period
 * shown for now when null. Null when the goal has no such period (a stale
 * link, or none started yet). `ctx` is the org rollup an OPEN period reads
 * its live numbers from; a CLOSED period needs none (null).
 */
export async function periodView(ctx: Pick<GoalRollupContext, "periods" | "periodGraph"> | null, okrId: string, key: string | null, s: PeriodSettings, now: Date): Promise<PeriodView | null> {
  const all = await prisma.goalPeriod.findMany({
    where: { okrId },
    orderBy: { startsAt: "asc" },
    select: {
      id: true, key: true, cadence: true, startsAt: true, endsAt: true, trackedFrom: true, graceEndsAt: true, closesAt: true,
      status: true, progress: true, attainment: true, result: true, scored: true, closedAt: true,
    },
  });
  const typed = all.filter((r) => isGoalCadence(r.cadence)).map((r) => ({ ...r, cadence: r.cadence as GoalCadence }));
  const shownNow = currentStoredPeriod(typed, now);
  const p = key ? typed.find((r) => r.key === key) ?? null : shownNow;
  if (!p || p.startsAt.getTime() > now.getTime()) return null;
  const idx = typed.findIndex((r) => r.id === p.id);
  const before = idx > 0 ? typed[idx - 1] : null;

  const [rows, krs] = await Promise.all([
    prisma.keyResultPeriod.findMany({
      where: { periodId: p.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, keyResultId: true, title: true, unit: true, startValue: true, targetValue: true, currentValue: true, progress: true, carried: true, kpiId: true },
    }),
    prisma.keyResult.findMany({ where: { okrId }, select: { id: true, kpi: { select: { direction: true, lowerIsBetter: true } } } }),
  ]);
  const kpiOf = new Map(krs.map((k) => [k.id, k.kpi]));

  // An OPEN period's live numbers: the rollup's rows (KPI months read by the
  // identity stored on each row) and its score with the children (D2).
  const stored = p.status === "OPEN" && ctx ? (ctx.periods.get(okrId) ?? []).find((x) => x.id === p.id) : undefined;
  const live = new Map((stored?.rows ?? []).map((r) => [r.id, r]));
  const score = p.status === "CLOSED"
    ? { progress: p.progress, attainment: p.attainment ?? p.progress }
    : stored && ctx?.periodGraph
      ? periodScore(okrId, stored, ctx.periodGraph)
      : { progress: p.progress, attainment: p.attainment };

  const targets: PeriodTargetView[] = rows.map((r) => {
    const l = live.get(r.id);
    const value = l ? l.currentValue : r.currentValue ?? r.startValue;
    const direction = targetDirection({ startValue: r.startValue, targetValue: r.targetValue, kpi: r.keyResultId ? kpiOf.get(r.keyResultId) ?? null : null });
    const attainment = l ? l.attainment : unclampedProgress(r.startValue, r.targetValue, value, direction);
    return {
      rowId: r.id,
      keyResultId: r.keyResultId,
      title: r.title,
      unit: r.unit,
      startValue: r.startValue,
      targetValue: r.targetValue,
      currentValue: value,
      progress: l ? l.progress : r.progress ?? Math.max(0, Math.min(100, Math.round(attainment))),
      attainment,
      carried: r.carried,
      kpiLinked: r.kpiId != null,
    };
  });

  const state = periodState(p, now);
  const result = (p.result as GoalResult | null) ?? null;
  return {
    id: p.id,
    key: p.key,
    label: periodLabel(p, s, now),
    cadence: p.cadence,
    state,
    current: shownNow?.id === p.id,
    startsAt: p.startsAt.toISOString(),
    endsAt: p.endsAt.toISOString(),
    trackedFrom: p.trackedFrom.toISOString(),
    graceEndsAt: p.graceEndsAt.toISOString(),
    closesAt: p.closesAt.toISOString(),
    daysLeft: daysLeft(p, now, s),
    datesLabel: periodDatesLabel(p, s),
    lastDay: lastDayKey(p, s),
    nominalLastDay: nominalLastDayKey(p, s),
    resetsOn: zonedDateKey(p.endsAt, s.timezone),
    takesCheckIns: p.status === "OPEN" && p.startsAt.getTime() <= now.getTime() && now.getTime() < p.graceEndsAt.getTime(),
    takesLateNumbers: p.status === "OPEN" && now.getTime() >= p.endsAt.getTime() && now.getTime() < p.graceEndsAt.getTime(),
    kpiHeld: p.closesAt.getTime() > p.graceEndsAt.getTime(),
    graceLastDay: dayBefore(p.graceEndsAt, s.timezone),
    kpiLastDay: p.closesAt.getTime() > p.graceEndsAt.getTime() ? kpiLastDay(p, s) : null,
    closedDay: p.closedAt ? zonedDateKey(p.closedAt, s.timezone) : null,
    previousLabel: before ? periodLabel(before, s, now) : null,
    progress: score.progress,
    attainment: score.attainment,
    result,
    resultLabel: result ? RESULT_LABEL[result] : null,
    scored: p.scored,
    targets,
  };
}

/* ───────────────────────── Past periods ───────────────────────── */

export interface PastPeriodRow {
  key: string;
  label: string;
  /** For the trend's axis: "Oct", "26 Oct", "Q3 FY27", "FY27". */
  shortLabel: string;
  result: GoalResult | null;
  resultLabel: string | null;
  progress: number | null;
  attainment: number | null;
  /** A goal with one target in that period: its numbers, "112 of 100". */
  single: { currentValue: number; targetValue: number; unit: string | null } | null;
}

export const PAST_PAGE_SIZE = 12;

function shortLabelOf(p: GoalPeriodRange, s: PeriodSettings, now: Date): string {
  if (p.cadence === "WEEKLY") return periodLabel(p, s, now).replace(/^Week of /, "");
  if (p.cadence === "MONTHLY") return periodLabel(p, s, now).slice(0, 3);
  return periodLabel(p, s, now);
}

/** The closed periods of a goal, newest first, `PAST_PAGE_SIZE` a page. */
export async function closedPeriodsPage(okrId: string, s: PeriodSettings, page: number, now: Date): Promise<{ rows: PastPeriodRow[]; total: number; page: number; pageSize: number }> {
  const where = { okrId, status: "CLOSED" };
  const [total, rows] = await Promise.all([
    prisma.goalPeriod.count({ where }),
    prisma.goalPeriod.findMany({
      where,
      orderBy: { startsAt: "desc" },
      skip: (page - 1) * PAST_PAGE_SIZE,
      take: PAST_PAGE_SIZE,
      select: {
        key: true, cadence: true, startsAt: true, endsAt: true, progress: true, attainment: true, result: true,
        targets: { select: { currentValue: true, startValue: true, targetValue: true, unit: true } },
      },
    }),
  ]);
  const out: PastPeriodRow[] = [];
  for (const r of rows) {
    if (!isGoalCadence(r.cadence)) continue;
    const range = { key: r.key, cadence: r.cadence, startsAt: r.startsAt, endsAt: r.endsAt };
    const result = (r.result as GoalResult | null) ?? null;
    const one = r.targets.length === 1 ? r.targets[0] : null;
    out.push({
      key: r.key,
      label: periodLabel(range, s, now),
      shortLabel: shortLabelOf(range, s, now),
      result,
      resultLabel: result ? RESULT_LABEL[result] : null,
      progress: r.progress,
      attainment: r.attainment ?? r.progress,
      single: one ? { currentValue: one.currentValue ?? one.startValue, targetValue: one.targetValue, unit: one.unit } : null,
    });
  }
  return { rows: out, total, page, pageSize: PAST_PAGE_SIZE };
}

/* ───────────────────────── The Edit modal ───────────────────────── */

export interface ConversionTarget {
  title: string;
  unit: string | null;
  /** Its number now. */
  now: number;
  /** Its number at the period start: the last check-in before it, or its start value when it was added after the period began. */
  atStart: number;
  /** The day of that check-in, or null when the target was added after the period began. */
  atStartDay: string | null;
  /** The day the target was added, for one added after the period began. */
  addedDay: string | null;
  startValue: number;
}

/** A hand-checked target whose number restarts at the first period's start (B4: Start value), with what it holds now. */
export interface RestartingTarget {
  title: string;
  unit: string | null;
  now: number;
  startValue: number;
}

export interface RepeatEditFacts {
  settings: PeriodSettings;
  /** The period shown for now (repeating goals). */
  current: (GoalPeriodRange & { label: string; nominalLastDay: string; status: string }) | null;
  /** Starts may still move: no period has closed and only the first has opened. */
  startsEditable: boolean;
  /** The first period's key, or the Starts of a goal that has not started. */
  firstKey: string | null;
  firstLabel: string | null;
  /** Check-ins in the first period, which moving Starts later leaves in Activity uncounted (A3). */
  firstCheckIns: number;
  closedCount: number;
  kpiLinked: boolean;
  /** Every target is measured automatically (the reminder field hides, A2). */
  allAutomatic: boolean;
  /**
   * Repeating back to One time while no period has closed (step 2 review
   * M5): the dates the goal had before it became repeating, so the modal can
   * put them back. Null when there is no record or a period has closed.
   */
  previousDates: { startDate: string | null; endDate: string | null } | null;
  /**
   * One time to Repeating (A3), per cadence: the current period's start,
   * the up-counting hand targets the "What was added since 1 Oct" choice can
   * count (the number at the start is known), and the hand targets that
   * restart with nothing to count them by (the modal says what happens to
   * their numbers).
   */
  conversion: Partial<Record<GoalCadence, { periodKey: string; periodName: string; startDay: string; targets: ConversionTarget[]; restarting: RestartingTarget[] }>>;
  /** One time: every hand target that restarts at the first period, whichever period that is. */
  restarting: RestartingTarget[];
}

type ConversionRecord = { repeatChange?: string; previousStartDate?: string | null; previousEndDate?: string | null };

export async function repeatEditFacts(
  okr: { id: string; organizationId: string; repeat: string | null; startDate: Date | null },
  s: PeriodSettings,
  now: Date,
): Promise<RepeatEditFacts> {
  const krs = await prisma.keyResult.findMany({
    where: { okrId: okr.id },
    select: {
      id: true, title: true, unit: true, startValue: true, targetValue: true, currentValue: true, kpiId: true, source: true,
      periodStart: true, createdAt: true, kpi: { select: { direction: true, lowerIsBetter: true } },
    },
  });
  const facts: RepeatEditFacts = {
    settings: s,
    current: null,
    startsEditable: true,
    firstKey: null,
    firstLabel: null,
    firstCheckIns: 0,
    closedCount: 0,
    kpiLinked: krs.some((k) => k.kpiId),
    allAutomatic: krs.length > 0 && krs.every((k) => isMeasuredAutomatically(k)),
    previousDates: null,
    conversion: {},
    restarting: [],
  };

  if (isGoalCadence(okr.repeat)) {
    const rows = await prisma.goalPeriod.findMany({
      where: { okrId: okr.id },
      orderBy: { startsAt: "asc" },
      select: { id: true, key: true, cadence: true, startsAt: true, endsAt: true, status: true, graceEndsAt: true, closesAt: true, trackedFrom: true },
    });
    const typed = rows.filter((r) => isGoalCadence(r.cadence)).map((r) => ({ ...r, cadence: r.cadence as GoalCadence }));
    const cur = currentStoredPeriod(typed, now);
    if (cur) facts.current = { key: cur.key, cadence: cur.cadence, startsAt: cur.startsAt, endsAt: cur.endsAt, label: periodLabel(cur, s, now), nominalLastDay: nominalLastDayKey(cur, s), status: cur.status };
    facts.closedCount = typed.filter((p) => p.status === "CLOSED").length;
    facts.startsEditable = facts.closedCount === 0 && typed.length <= 1;
    const first = typed[0] ?? null;
    const firstRange = first ?? (okr.startDate ? periodFor(okr.repeat, startOfZonedDay(okr.startDate.toISOString().slice(0, 10), s.timezone), s) : null);
    facts.firstKey = firstRange?.key ?? null;
    facts.firstLabel = firstRange ? periodLabel(firstRange, s, now) : null;
    if (first) facts.firstCheckIns = await prisma.kRCheckIn.count({ where: { periodId: first.id } });
    if (facts.closedCount === 0) {
      // The record the conversion wrote (planRepeatPatch), newest first.
      const record = await prisma.activityLog.findFirst({
        where: { organizationId: okr.organizationId, targetId: okr.id, targetType: "okr", metadata: { path: ["repeatChange"], equals: "became_repeating" } },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      });
      const r = record?.metadata as ConversionRecord | null | undefined;
      if (r) facts.previousDates = { startDate: r.previousStartDate ?? null, endDate: r.previousEndDate ?? null };
    }
    return facts;
  }

  // One time: what the first period does to each hand target's number.
  const hand = krs.filter((k) => !isMeasuredAutomatically(k));
  const restartsAll = hand.filter((k) => periodStartOf({ periodStart: k.periodStart, direction: targetDirection(k) }) === "START" && k.currentValue !== k.startValue);
  facts.restarting = restartsAll.map((k) => ({ title: k.title, unit: k.unit, now: k.currentValue, startValue: k.startValue }));
  if (restartsAll.length === 0) return facts;
  const periods = GOAL_CADENCES.map((c) => periodFor(c, now, s));
  // Every check-in before the latest period start, newest first, once.
  const latestStart = Math.max(...periods.map((p) => p.startsAt.getTime()));
  const before = await prisma.kRCheckIn.findMany({
    where: { keyResultId: { in: restartsAll.map((k) => k.id) }, createdAt: { lt: new Date(latestStart) } },
    orderBy: { createdAt: "desc" },
    select: { keyResultId: true, value: true, createdAt: true },
  });
  const beforeBy = new Map<string, typeof before>();
  for (const c of before) beforeBy.set(c.keyResultId, [...(beforeBy.get(c.keyResultId) ?? []), c]);
  for (const p of periods) {
    const targets: ConversionTarget[] = [];
    const restarting: RestartingTarget[] = [];
    for (const k of restartsAll) {
      // The choice counts up-counting targets whose number at the start is
      // known: the last check-in before it, or the start value of a target
      // added after it began (it held that then). The server applies the
      // same rule (planRepeatPatch).
      const last = targetDirection(k) === "HIGHER" ? (beforeBy.get(k.id) ?? []).find((c) => c.createdAt.getTime() < p.startsAt.getTime()) : undefined;
      const addedAfter = targetDirection(k) === "HIGHER" && k.createdAt.getTime() >= p.startsAt.getTime();
      if (last && last.value !== k.currentValue) {
        targets.push({ title: k.title, unit: k.unit, now: k.currentValue, atStart: last.value, atStartDay: zonedDateKey(last.createdAt, s.timezone), addedDay: null, startValue: k.startValue });
      } else if (!last && addedAfter) {
        targets.push({ title: k.title, unit: k.unit, now: k.currentValue, atStart: k.startValue, atStartDay: null, addedDay: zonedDateKey(k.createdAt, s.timezone), startValue: k.startValue });
      } else if (!last) {
        restarting.push({ title: k.title, unit: k.unit, now: k.currentValue, startValue: k.startValue });
      }
    }
    if (targets.length || restarting.length) {
      const name = p.cadence === "MONTHLY" ? periodLabel(p, s, now).replace(/ \d{4}$/, "") : periodLabel(p, s, now);
      facts.conversion[p.cadence] = { periodKey: p.key, periodName: name, startDay: zonedDateKey(p.startsAt, s.timezone), targets, restarting };
    }
  }
  return facts;
}

/* ───────────────────────── The verdict of a period in its grace ───────────────────────── */

/**
 * The ONE verdict (goal-verdict.ts goalVerdictFor) for a period that has
 * ended but is still open (in its grace, or waiting for its close): paced
 * over its own window, all of which is used, with its own last check-in.
 * The period running now reads goalVerdicts as every surface does; a closed
 * period has a result instead.
 */
export async function periodVerdict(
  okr: { id: string; startDate: Date | null; endDate: Date | null; createdAt: Date; checkInCadence: string | null; keyResults: ReadonlyArray<{ kpiId: string | null; source?: unknown }> },
  v: PeriodView,
  hasLinkedWork: boolean,
  now: Date,
) {
  const last = await prisma.kRCheckIn.findFirst({ where: { periodId: v.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return goalVerdictFor({
    progress: v.progress ?? 0,
    progressSource: v.progress == null ? "NONE" : "ROLLUP",
    startDate: okr.startDate,
    endDate: okr.endDate,
    createdAt: okr.createdAt,
    completedAt: null,
    checkInCadence: okr.checkInCadence,
    lastCheckInAt: null,
    allDerived: okr.keyResults.every((k) => isMeasuredAutomatically(k)),
    hasLinkedWork,
    period: { trackedFrom: v.trackedFrom, endsAt: v.endsAt, lastCheckInAt: last?.createdAt ?? null },
  }, now);
}
