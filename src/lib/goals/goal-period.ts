// The period engine of repeating goals (docs/plans/recurring-goals.md B2, A2,
// A3, B6, B7). A repeating goal starts fresh every week, month, quarter or
// year; this module says where each period begins and ends, what it is
// called, how long late numbers are taken, when it freezes, and what its
// result reads. The server module that stores periods
// (goal-periods.server.ts, step 2) asks it every question and decides
// nothing about time on its own.
//
// IN THE WORKSPACE ZONE. A period begins and ends at 00:00 in
// Organization.settings.timezone, so everyone in any zone sees the same
// October. Weeks start on the workspace's week start day; quarters and years
// are FISCAL, from the workspace's fiscal year start (Settings > Locale), the
// same quarter the goal page already labels.
//
// A DAY WHOSE MIDNIGHT DOES NOT EXIST. Where a daylight saving change falls
// at 00:00 (America/Santiago, early September), the day starts at the jump,
// 01:00. zonedWallClockToUtc lands such a midnight on the hour BEFORE in a
// zone west of UTC (23:00 the day before, so the key read back is the wrong
// day), so startOfZonedDay below checks what the helper gave and, only when
// it is not the day's first instant, searches the few hours around it.
//
// IDENTITY (B2). The current period is the STORED row whose range holds now
// (periodAt), never a key recomputed from today's settings. A new period of a
// running goal starts at the previous period's end (nextPeriod: no gap, no
// overlap); its end is the first boundary under the settings in force at
// opening that leaves it at least half a nominal period long, so a change of
// zone, week start, fiscal start or cadence never makes a stub. Its key is
// the day it starts, in the zone at opening.
//
// WHAT A STORED PERIOD IS CALLED, AND WHICH MONTHS IT IS, comes from its OWN
// range, never from today's settings, so a running period keeps its name
// and its KPI months when the zone, week start or fiscal start changes
// (heldMonths, nominalLastDayKey, periodLabel, kpiMonths). A month, quarter
// or year is the workspace-zone months it holds at least half of: a
// stretched October (A3: "October runs to 1 November") is October, and its
// nominal last day is 31 October, not 1 November. A week is named by its
// first day (its key). This is the period's middle, not its last instant.
//
// Pure: no prisma, no React, no network. Only Intl, through the zone helpers.
// Never `hour12: false` here (Node 20 prints midnight as "24").

import { zonedDateKey, zonedWallClockToUtc } from "@/lib/zoned-time";
import { fiscalQuarterOf, normalizeFiscalStart } from "@/lib/fiscal-quarter";
import { shiftKpiPeriod } from "@/lib/kpi-period";
import { localeSettingsOf, MONTH_NAMES, type WeekStart } from "@/lib/settings/org-policy";

/* ───────────────────────── Types ───────────────────────── */

/** How often a repeating goal starts fresh. OKR.repeat and GoalPeriod.cadence. */
export const GOAL_CADENCES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type GoalCadence = (typeof GOAL_CADENCES)[number];

export function isGoalCadence(v: unknown): v is GoalCadence {
  return typeof v === "string" && (GOAL_CADENCES as readonly string[]).includes(v);
}

/** Coarser cadences rank higher. */
const RANK: Record<GoalCadence, number> = { WEEKLY: 0, MONTHLY: 1, QUARTERLY: 2, YEARLY: 3 };

/** The three workspace settings a period depends on. */
export interface PeriodSettings {
  timezone: string;
  weekStart: WeekStart;
  /** 1 to 12, the month the fiscal year starts in. */
  fiscalYearStart: number;
}

/** The period settings of an organization, from Organization.settings (Settings > Locale). */
export function periodSettingsOf(orgSettings: unknown): PeriodSettings {
  const l = localeSettingsOf(orgSettings);
  return { timezone: l.timezone, weekStart: l.weekStart, fiscalYearStart: normalizeFiscalStart(l.fiscalYearStart) };
}

/** One period as GoalPeriod stores it. `endsAt` is exclusive. */
export interface GoalPeriodRange {
  /** The yyyy-mm-dd day it starts, in the zone at opening. Unique per goal. */
  key: string;
  /** The cadence it was cut with (a cadence change leaves old periods on theirs). */
  cadence: GoalCadence;
  startsAt: Date;
  endsAt: Date;
}

type Range = Pick<GoalPeriodRange, "cadence" | "startsAt" | "endsAt">;

/* ───────────────────────── Day keys ───────────────────────── */

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function partsOf(key: string): [number, number, number] {
  const m = DAY_KEY.exec(key);
  if (!m) throw new RangeError(`goal-period: not a day key: ${key}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function keyAtUtcMidnight(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function addDays(key: string, n: number): string {
  const [y, m, d] = partsOf(key);
  return keyAtUtcMidnight(Date.UTC(y, m - 1, d + n));
}

/** Months since year 0: y * 12 + (month - 1). */
function monthIndexOf(key: string): number {
  const [y, m] = partsOf(key);
  return y * 12 + (m - 1);
}

function firstOfMonth(index: number): string {
  const y = Math.floor(index / 12);
  return `${y}-${String(index - y * 12 + 1).padStart(2, "0")}-01`;
}

/** 0 for Sunday to 6 for Saturday. */
function weekdayOf(key: string): number {
  const [y, m, d] = partsOf(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole calendar days from key `a` to key `b`. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = partsOf(a);
  const [by, bm, bd] = partsOf(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY);
}

/* ───────────────────────── The first instant of a day ───────────────────────── */

const DAY_STARTS = new Map<string, number>();
const DAY_STARTS_CAP = 4096;

/**
 * The first instant of the calendar day `key` in `zone`: its 00:00, or, on a
 * day whose midnight does not exist, the moment the clocks jump (01:00 in
 * Santiago in September). Memoised: a batch opening the same October for two
 * thousand goals asks the same question two thousand times.
 */
export function startOfZonedDay(key: string, zone: string): Date {
  const memo = `${zone}|${key}`;
  const known = DAY_STARTS.get(memo);
  if (known !== undefined) return new Date(known);

  const guess = zonedWallClockToUtc(key, "00:00", zone);
  if (!guess) throw new RangeError(`goal-period: not a day key: ${key}`);
  let t = guess.getTime();
  const isFirst = zonedDateKey(guess, zone) === key && zonedDateKey(new Date(t - MINUTE), zone) < key;
  if (!isFirst) {
    // The day begins somewhere within three hours of the guess (no zone
    // jumps by more). Find the first whole minute that reads as `key`:
    // before it the zone reads an earlier day, from it on this one.
    let lo = t - 3 * HOUR;
    let hi = t + 3 * HOUR;
    while (hi - lo > MINUTE) {
      const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
      if (zonedDateKey(new Date(mid), zone) >= key) hi = mid;
      else lo = mid;
    }
    t = hi;
  }
  if (DAY_STARTS.size >= DAY_STARTS_CAP) DAY_STARTS.clear();
  DAY_STARTS.set(memo, t);
  return new Date(t);
}

/* ───────────────────────── Nominal periods ───────────────────────── */

/** The first day and the day after the last day of the nominal period holding `day`. */
function nominalKeys(cadence: GoalCadence, day: string, s: PeriodSettings): { startKey: string; endKey: string } {
  if (cadence === "WEEKLY") {
    const first = s.weekStart === "SUN" ? 0 : 1;
    const startKey = addDays(day, -((weekdayOf(day) - first + 7) % 7));
    return { startKey, endKey: addDays(startKey, 7) };
  }
  const month = monthIndexOf(day);
  if (cadence === "MONTHLY") return { startKey: firstOfMonth(month), endKey: firstOfMonth(month + 1) };
  const fiscal = normalizeFiscalStart(s.fiscalYearStart);
  const sinceYearStart = (((month % 12) + 1 - fiscal) % 12 + 12) % 12;
  if (cadence === "QUARTERLY") {
    const start = month - (sinceYearStart % 3);
    return { startKey: firstOfMonth(start), endKey: firstOfMonth(start + 3) };
  }
  const start = month - sinceYearStart;
  return { startKey: firstOfMonth(start), endKey: firstOfMonth(start + 12) };
}

function assertInstant(at: Date): number {
  const t = at instanceof Date ? at.getTime() : NaN;
  if (!Number.isFinite(t)) throw new RangeError("goal-period: not an instant");
  return t;
}

/**
 * The nominal period of `cadence` holding the instant `at` under today's
 * settings: the calendar week, month, fiscal quarter or fiscal year.
 */
export function periodFor(cadence: GoalCadence, at: Date, settings: PeriodSettings): GoalPeriodRange {
  assertInstant(at);
  const zone = settings.timezone;
  const { startKey, endKey } = nominalKeys(cadence, zonedDateKey(at, zone), settings);
  return { key: startKey, cadence, startsAt: startOfZonedDay(startKey, zone), endsAt: startOfZonedDay(endKey, zone) };
}

/** `at` when it is a boundary of `cadence`, else the next boundary after it. */
export function firstBoundaryOnOrAfter(cadence: GoalCadence, at: Date, settings: PeriodSettings): Date {
  const t = assertInstant(at);
  const n = periodFor(cadence, at, settings);
  return n.startsAt.getTime() === t ? new Date(t) : n.endsAt;
}

function lengthOf(r: Pick<GoalPeriodRange, "startsAt" | "endsAt">): number {
  return r.endsAt.getTime() - r.startsAt.getTime();
}

/**
 * Where a period of `cadence` that starts at `start` ends: the first boundary
 * after it, unless that leaves less than half the nominal period, in which
 * case the short piece joins the next whole period (B2: no stub).
 */
function stubSafeEnd(cadence: GoalCadence, start: Date, settings: PeriodSettings): Date {
  const n = periodFor(cadence, start, settings);
  if (n.startsAt.getTime() === start.getTime()) return n.endsAt;
  const left = n.endsAt.getTime() - start.getTime();
  if (left * 2 >= lengthOf(n)) return n.endsAt;
  return periodFor(cadence, n.endsAt, settings).endsAt;
}

function rangeOf(cadence: GoalCadence, startsAt: Date, endsAt: Date, zone: string): GoalPeriodRange {
  return { key: zonedDateKey(startsAt, zone), cadence, startsAt: new Date(startsAt.getTime()), endsAt: new Date(endsAt.getTime()) };
}

/* ───────────────────────── Opening the next period ───────────────────────── */

/**
 * The period a running goal opens after `prev` (B2, A3), under the settings
 * in force now. It starts exactly at `prev.endsAt`.
 *
 * - Same cadence: the first boundary after the start that leaves at least
 *   half a nominal period (a zone, week start or fiscal start change since
 *   `prev` opened moves the boundaries; the short piece never stands alone).
 * - A finer cadence: planCadenceChange already stretched the period open at
 *   the change to a boundary of the new cadence, so this is the same rule.
 * - A coarser cadence: the old cadence keeps running whole periods until the
 *   first boundary of the new one on or after the start; the last old period
 *   ends exactly there (stretched or shortened by less than half a period),
 *   and from that boundary on the periods are of the new cadence. Should the
 *   start already sit less than half an old period before that boundary (a
 *   change planCadenceChange did not see), the piece joins the first period
 *   of the new cadence instead of standing alone.
 */
export function nextPeriod(
  prev: Pick<GoalPeriodRange, "cadence" | "endsAt">,
  cadence: GoalCadence,
  settings: PeriodSettings,
): GoalPeriodRange {
  assertInstant(prev.endsAt);
  const start = prev.endsAt;
  const zone = settings.timezone;
  if (RANK[cadence] > RANK[prev.cadence]) {
    const switchAt = firstBoundaryOnOrAfter(cadence, start, settings);
    if (switchAt.getTime() !== start.getTime()) {
      const old = prev.cadence;
      const oldHalf = lengthOf(periodFor(old, start, settings)) / 2;
      if (switchAt.getTime() - start.getTime() < oldHalf) {
        return rangeOf(cadence, start, periodFor(cadence, switchAt, settings).endsAt, zone);
      }
      let end = stubSafeEnd(old, start, settings);
      const after = switchAt.getTime() - end.getTime();
      if (after < lengthOf(periodFor(old, end, settings)) / 2) end = switchAt;
      return rangeOf(old, start, end, zone);
    }
  }
  return rangeOf(cadence, start, stubSafeEnd(cadence, start, settings), zone);
}

/**
 * The period a stopped goal opens when it is restarted at `now` (A4: from the
 * current period; the periods it skipped are not invented). It starts at the
 * nominal start of the period holding `now`, or at `prev.endsAt` when that is
 * later (the zone moved since the goal stopped, so the nominal start would
 * overlap its last period), and ends as nextPeriod's do, never leaving a
 * stub. With no stored period it is the current nominal period. Meant for a
 * goal whose last period has ended; while it still runs, the goal is not
 * stopped and nextPeriod follows it.
 */
export function restartPeriod(
  prev: Pick<GoalPeriodRange, "endsAt"> | null,
  cadence: GoalCadence,
  now: Date,
  settings: PeriodSettings,
): GoalPeriodRange {
  const current = periodFor(cadence, now, settings);
  if (!prev || prev.endsAt.getTime() <= current.startsAt.getTime()) return current;
  const start = new Date(assertInstant(prev.endsAt));
  return rangeOf(cadence, start, stubSafeEnd(cadence, start, settings), settings.timezone);
}

export type CadenceChange = {
  direction: "same" | "coarser" | "finer";
  /** The open period's end after the change: stretched for a finer cadence, else unchanged. */
  currentEndsAt: Date;
  /** The first instant periods of the new cadence run from. */
  effectiveFrom: Date;
};

/**
 * A3: what changing Repeats every does to the period open now. The current
 * period is never cut short.
 *
 * - Coarser ("Repeats quarterly from 1 January. November and December stay
 *   monthly."): the new cadence starts at its first boundary on or after the
 *   current period's end; the old cadence runs whole periods until then.
 *   Should that boundary fall less than half an old period after the current
 *   end (a week ending 30 November before a monthly 1 December), the current
 *   period stretches to it rather than leave a stub.
 * - Finer ("Repeats weekly from Monday 2 November. October runs to 1
 *   November."): the current period stretches to the new cadence's first
 *   boundary on or after its end, by less than one new period.
 *
 * Whenever `currentEndsAt` moves the open period's end, its graceEndsAt and
 * closesAt are recomputed from the new end (GoalPeriod_values_check refuses
 * a grace end before the period's end).
 */
export function planCadenceChange(current: Range, to: GoalCadence, settings: PeriodSettings): CadenceChange {
  const end = current.endsAt;
  if (to === current.cadence) return { direction: "same", currentEndsAt: end, effectiveFrom: end };
  const switchAt = firstBoundaryOnOrAfter(to, end, settings);
  if (RANK[to] < RANK[current.cadence]) return { direction: "finer", currentEndsAt: switchAt, effectiveFrom: switchAt };
  const gap = switchAt.getTime() - end.getTime();
  const stretch = gap > 0 && gap * 2 < lengthOf(periodFor(current.cadence, end, settings));
  return { direction: "coarser", currentEndsAt: stretch ? switchAt : end, effectiveFrom: switchAt };
}

/* ───────────────────────── Identity ───────────────────────── */

/** The stored period whose range holds `at` (the current period is this, for now). */
export function periodAt<T extends Pick<GoalPeriodRange, "startsAt" | "endsAt">>(stored: readonly T[], at: Date): T | null {
  const t = assertInstant(at);
  return stored.find((p) => p.startsAt.getTime() <= t && t < p.endsAt.getTime()) ?? null;
}

/** B2: a period that would overlap a stored one, or reuse its key, is never opened. */
export function mayOpen(
  candidate: Pick<GoalPeriodRange, "key" | "startsAt" | "endsAt">,
  stored: readonly Pick<GoalPeriodRange, "key" | "startsAt" | "endsAt">[],
): boolean {
  if (candidate.endsAt.getTime() <= candidate.startsAt.getTime()) return false;
  return !stored.some(
    (p) =>
      p.key === candidate.key ||
      (candidate.startsAt.getTime() < p.endsAt.getTime() && p.startsAt.getTime() < candidate.endsAt.getTime()),
  );
}

/* ───────────────────────── Starts (A2) ───────────────────────── */

/** The current nominal period and the `count - 1` after it: the Starts choices (never a past one). */
export function startOptions(cadence: GoalCadence, now: Date, settings: PeriodSettings, count = 13): GoalPeriodRange[] {
  const out: GoalPeriodRange[] = [periodFor(cadence, now, settings)];
  while (out.length < count) out.push(periodFor(cadence, out[out.length - 1].endsAt, settings));
  return out;
}

/** True while at least half of `period` is still to come at `now`. */
export function halfRemains(period: Pick<GoalPeriodRange, "startsAt" | "endsAt">, now: Date): boolean {
  return (period.endsAt.getTime() - assertInstant(now)) * 2 >= lengthOf(period);
}

/** A2: the default Starts, the current period while half of it remains, else the next one. */
export function defaultStart(cadence: GoalCadence, now: Date, settings: PeriodSettings): GoalPeriodRange {
  const current = periodFor(cadence, now, settings);
  return halfRemains(current, now) ? current : periodFor(cadence, current.endsAt, settings);
}

/* ───────────────────────── Labels ───────────────────────── */

const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

function dayLabel(key: string, withYear: boolean): string {
  const [y, m, d] = partsOf(key);
  return `${d} ${SHORT_MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** The period's first day, yyyy-mm-dd in the workspace zone. */
export function firstDayKey(period: Pick<GoalPeriodRange, "startsAt">, settings: PeriodSettings): string {
  return zonedDateKey(period.startsAt, settings.timezone);
}

/**
 * The period's last day, yyyy-mm-dd in the workspace zone. Where a period
 * belongs by its last day, use nominalLastDayKey instead (OKR.repeatUntil
 * holds one of those).
 */
export function lastDayKey(period: Pick<GoalPeriodRange, "endsAt">, settings: PeriodSettings): string {
  return zonedDateKey(new Date(period.endsAt.getTime() - 1), settings.timezone);
}

/**
 * The workspace-zone months ("YYYY-MM") the period holds at least half of,
 * read from its own first and last day, so the answer does not move when
 * the fiscal start or the week start changes (and a zone change moves a day
 * at most). A stretched October (to 1 November) holds October; a quarter
 * that a fiscal start change joined to January holds January to April. A
 * period too short to hold half of any month (a week) gets the month of its
 * middle.
 */
export function heldMonths(period: Pick<GoalPeriodRange, "startsAt" | "endsAt">, settings: PeriodSettings): string[] {
  const first = firstDayKey(period, settings);
  const last = lastDayKey(period, settings);
  const out: string[] = [];
  for (let i = monthIndexOf(first); i <= monthIndexOf(last); i++) {
    const monthFirst = firstOfMonth(i);
    const monthLast = addDays(firstOfMonth(i + 1), -1);
    const held = daysBetween(first > monthFirst ? first : monthFirst, last < monthLast ? last : monthLast) + 1;
    if (held * 2 >= daysBetween(monthFirst, monthLast) + 1) out.push(monthFirst.slice(0, 7));
  }
  if (out.length === 0) {
    const mid = new Date(period.startsAt.getTime() + Math.floor(lengthOf(period) / 2));
    out.push(zonedDateKey(mid, settings.timezone).slice(0, 7));
  }
  return out;
}

/**
 * The last day of the nominal period this period stands for, yyyy-mm-dd in
 * the workspace zone. Where a period "belongs" by its last day (a parent's
 * period, the score's month, a review cycle, Ends and repeatUntil: D2, G1,
 * G3, A2, A3), this is the day meant: a stretched October's is 31 October,
 * not 1 November. A month, quarter or year: the last day of the last month
 * it holds at least half of. A week: six days after its first day (its key),
 * or its own last day when it is shorter.
 */
export function nominalLastDayKey(period: GoalPeriodRange, settings: PeriodSettings): string {
  const last = lastDayKey(period, settings);
  if (period.cadence === "WEEKLY") {
    const week = addDays(period.key, 6);
    return week < last ? week : last;
  }
  const months = heldMonths(period, settings);
  return addDays(firstOfMonth(monthIndexOf(`${months[months.length - 1]}-01`) + 1), -1);
}

/**
 * The period's name (B2 table), from its own range: "Week of 26 Oct" (its
 * first day, with the year when it is not this year), "October 2026", "Q3
 * FY27" (the rules of goalQuarterLabel) and "FY27", or "2026" for a year that
 * ends in December. A month, quarter or year is named by the last month it
 * holds at least half of, so a stretched October stays October and FY27
 * stays FY27 after the fiscal start moves to January. A quarter is named
 * under today's fiscal start when its months are a quarter of it; after a
 * fiscal start change that makes them not one, under the start a month either
 * side that does, so the name always means the period's own three months.
 */
export function periodLabel(period: GoalPeriodRange, settings: PeriodSettings, now: Date): string {
  if (period.cadence === "WEEKLY") {
    const thisYear = zonedDateKey(now, settings.timezone).slice(0, 4);
    return `Week of ${dayLabel(period.key, period.key.slice(0, 4) !== thisYear)}`;
  }
  const [y, m] = partsOf(nominalLastDayKey(period, settings));
  if (period.cadence === "MONTHLY") return `${MONTH_NAMES[m - 1]} ${y}`;
  if (period.cadence === "YEARLY") return m === 12 ? String(y) : `FY${String(y % 100).padStart(2, "0")}`;
  const qStart = monthIndexOf(`${y}-${String(m).padStart(2, "0")}-01`) - 2;
  const qMonth = (qStart % 12) + 1;
  const today = normalizeFiscalStart(settings.fiscalYearStart);
  const fits = (f: number) => (((qMonth - f) % 3) + 3) % 3 === 0;
  const fiscal = fits(today) ? today : ([today + 1, today - 1].map((f) => ((f + 11) % 12) + 1).find(fits) ?? today);
  const { quarter, yearLabel } = fiscalQuarterOf(new Date(Date.UTC(Math.floor(qStart / 12), qMonth - 1, 15)), fiscal);
  return `Q${quarter} ${yearLabel}`;
}

/** "1 Apr 2026 to 31 Mar 2027": the period's first and last day, so a Starts choice shows its dates. */
export function periodDatesLabel(period: Pick<GoalPeriodRange, "startsAt" | "endsAt">, settings: PeriodSettings): string {
  return `${dayLabel(firstDayKey(period, settings), true)} to ${dayLabel(lastDayKey(period, settings), true)}`;
}

/** Whole calendar days after today until the period's last day: 4 on 27 October, 0 on its last day. */
export function daysLeft(period: Pick<GoalPeriodRange, "startsAt" | "endsAt">, now: Date, settings: PeriodSettings): number {
  const t = assertInstant(now);
  if (t >= period.endsAt.getTime()) return 0;
  const today = t < period.startsAt.getTime() ? firstDayKey(period, settings) : zonedDateKey(now, settings.timezone);
  return Math.max(0, daysBetween(today, lastDayKey(period, settings)));
}

/* ───────────────────────── Grace and the close (B7) ───────────────────────── */

/** Calendar days after a period's end that hand check-ins are still taken. */
export const GRACE_DAYS: Record<GoalCadence, number> = { WEEKLY: 2, MONTHLY: 5, QUARTERLY: 5, YEARLY: 5 };

/**
 * When hand check-ins for the period stop: 00:00 in the workspace zone, two
 * calendar days after a week ends and five after a month, quarter or year
 * (October's last numbers can be typed until the end of 5 November).
 * Calendar days, not hours: across a daylight saving change it is 00:00
 * local all the same.
 */
export function graceEndsAt(period: Pick<GoalPeriodRange, "cadence" | "endsAt">, settings: PeriodSettings): Date {
  const endDay = zonedDateKey(period.endsAt, settings.timezone);
  return startOfZonedDay(addDays(endDay, GRACE_DAYS[period.cadence]), settings.timezone);
}

/**
 * The KPI months a period covers ("YYYY-MM", KPIRecord.period): the
 * workspace-zone months it holds at least half of (heldMonths), from its own
 * range. None for a week: a KPI is recorded monthly and a weekly goal cannot
 * link one (C6).
 */
export function kpiMonths(period: Range, settings: PeriodSettings): string[] {
  return period.cadence === "WEEKLY" ? [] : heldMonths(period, settings);
}

const KPI_ZONE_SPREAD_MS = 14 * HOUR;

/**
 * When the KPI write gate (kpi-period.ts isKpiPeriodWritableAnyZone) stops
 * taking numbers for the last of the period's KPI months: the start of the
 * second UTC month after it, plus the fourteen hours of zone spread. For
 * October, 1 December 14:00 UTC. Null for a week.
 */
export function kpiCloseAt(period: Range, settings: PeriodSettings): Date | null {
  const months = kpiMonths(period, settings);
  if (months.length === 0) return null;
  const [y, m] = shiftKpiPeriod(months[months.length - 1], 2).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1) + KPI_ZONE_SPREAD_MS);
}

/**
 * The last day KPI numbers are taken for a period, yyyy-mm-dd: the last day
 * of the month after its last KPI month (October: 30 November), the day
 * the goal page names ("Open for KPI numbers until 30 Nov", B7). Null for a
 * week.
 */
export function kpiLastDayKey(period: Range, settings: PeriodSettings): string | null {
  const months = kpiMonths(period, settings);
  if (months.length === 0) return null;
  const next = shiftKpiPeriod(months[months.length - 1], 1);
  const [y, m] = next.split("-").map(Number);
  return `${next}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * The last day a period took numbers, yyyy-mm-dd (final review M4): its
 * KPI day when its close waited for a KPI month (closesAt past graceEndsAt),
 * else the last day of its grace. The goal page's "Took numbers until 5
 * Oct" and the check-in's 409 both read this one day, never the day the
 * cron happened to close it.
 */
export function lastNumbersDayKey(period: Range & { graceEndsAt: Date; closesAt: Date }, settings: PeriodSettings): string {
  const kpi = period.closesAt.getTime() > period.graceEndsAt.getTime() ? kpiLastDayKey(period, settings) : null;
  return kpi ?? zonedDateKey(new Date(period.graceEndsAt.getTime() - 1), settings.timezone);
}

/**
 * When the period freezes (GoalPeriod.closesAt): its grace end, or, for a
 * goal with a KPI-linked target, the later of that and the KPI close, so a
 * manager approving October's KPI on 20 November still lands in October.
 */
export function closesAt(period: Range, settings: PeriodSettings, opts: { kpiLinked: boolean }): Date {
  const grace = graceEndsAt(period, settings);
  const kpi = opts.kpiLinked ? kpiCloseAt(period, settings) : null;
  return kpi && kpi.getTime() > grace.getTime() ? kpi : grace;
}

/** B1: counting starts at the later of the period's start and the moment the goal was created or became repeating. */
export function trackedFrom(period: Pick<GoalPeriodRange, "startsAt">, since: Date): Date {
  return new Date(Math.max(period.startsAt.getTime(), assertInstant(since)));
}

/* ───────────────────────── Results (B6) ───────────────────────── */

export const GOAL_RESULTS = ["HIT", "PARTLY_HIT", "MISSED", "NOT_MEASURED"] as const;
export type GoalResult = (typeof GOAL_RESULTS)[number];

export const RESULT_LABEL: Record<GoalResult, string> = {
  HIT: "Hit",
  PARTLY_HIT: "Partly hit",
  MISSED: "Missed",
  NOT_MEASURED: "Not measured",
};

/**
 * A closed period's result, decided on its CLAMPED progress (0 to 100,
 * rounded as keyResultProgress rounds): Hit at 100, Partly hit from 70 (the
 * line that reads On track everywhere, okrStatusFor), Missed below. Null
 * progress means nothing measured counted.
 */
export function resultFor(progress: number | null | undefined): GoalResult {
  if (progress == null || !Number.isFinite(progress)) return "NOT_MEASURED";
  const p = Math.max(0, Math.min(100, Math.round(progress)));
  if (p >= 100) return "HIT";
  if (p >= 70) return "PARTLY_HIT";
  return "MISSED";
}

/** B3: a period first opened after its hand check-in window had passed. */
export function openedAfterWindow(period: { graceEndsAt: Date }, openedAt: Date): boolean {
  return assertInstant(openedAt) >= period.graceEndsAt.getTime();
}

/**
 * B6: does the period count toward its owner's score? Not when nothing was
 * measured, not when it opened after its window, and not when counting
 * started with less than half of it left (a goal made on 27 October shows
 * October's result but does not drag October's score).
 */
export function isScored(p: {
  result: GoalResult;
  startsAt: Date;
  endsAt: Date;
  trackedFrom: Date;
  openedAfterWindow: boolean;
}): boolean {
  if (p.result === "NOT_MEASURED" || p.openedAfterWindow) return false;
  const tracked = p.endsAt.getTime() - Math.max(p.trackedFrom.getTime(), p.startsAt.getTime());
  return tracked * 2 >= lengthOf(p);
}
