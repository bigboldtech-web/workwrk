// work-schedule.ts: the organization's working calendar, and the pure math
// every surface that spends it needs.
//
// Decided addition (b), docs/plans/competitor-gap-2026-09.md section 7:
// "an org-wide working calendar (workweek days, hours, holidays) as a
// settings record ... consumed by workload-grid.tsx (replace the hoursPerDay
// constant) and the timesheets surface".
//
// WHAT IT REPLACES. Two surfaces each carried their own idea of a work day:
// the Workload grid defaulted to 8 hours a day and a "count weekends"
// switch with no knowledge of which days an organization actually works,
// and the Timesheets week card had no expected-hours figure at all, so a
// 32-hour week and a 48-hour week looked the same. Both now ask this file.
//
// THE TABLE IS OPTIONAL, FOREVER. `readOrgWorkSchedule`
// (src/lib/work-schedule-server.ts) returns
// WORK_SCHEDULE_DEFAULTS when there is no row, and also when the table
// itself is not there, which is what a release deployed ahead of
// prisma/sql/2026-09-22-work-schedule.sql sees. Those defaults are exactly
// what the two surfaces hard-coded before this file existed, so "absent"
// and "never configured" and "old database" all render identically.
//
// THIS FILE IS PURE: no prisma, no React, no imports, so the client hook
// (src/lib/use-work-schedule.ts) and the server reader
// (src/lib/work-schedule-server.ts) can both use it without either pulling
// the other into its bundle. Every rule below is unit-tested.

/** ISO-ish weekday numbers matching JavaScript's Date.getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Holiday {
  /** "YYYY-MM-DD", the calendar date in the schedule's own zone. */
  date: string;
  name: string;
}

export interface WorkSchedule {
  /** Working days, 0 = Sunday. Sorted, de-duplicated, may be empty. */
  workdays: Weekday[];
  /** Hours in a full work day. Always > 0. */
  hoursPerDay: number;
  /** IANA zone, or null for "each person's own zone". */
  timezone: string | null;
  holidays: Holiday[];
}

/**
 * Monday to Friday, eight hours, no holidays.
 *
 * These are not a guess: they are the values workload-grid.tsx and the
 * Workload settings dialog already used (DEFAULT_WORKLOAD_SETTINGS.dailyHours
 * = 8, countWeekends = false), written down once so both surfaces and the
 * absent-table path agree.
 */
export const WORK_SCHEDULE_DEFAULTS: WorkSchedule = {
  workdays: [1, 2, 3, 4, 5],
  hoursPerDay: 8,
  timezone: null,
  holidays: [],
};

const DAY_MS = 86_400_000;

// ── Parsing ───────────────────────────────────────────────────────
// Everything below takes `unknown`, because the row's `holidays` is Json
// and because this also parses a request body. A field that does not make
// sense falls back to its default rather than throwing: a malformed
// holiday list must not take the Workload grid down.

function toWeekdays(v: unknown): Weekday[] {
  if (!Array.isArray(v)) return WORK_SCHEDULE_DEFAULTS.workdays;
  const seen = new Set<number>();
  for (const raw of v) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 6) seen.add(n);
  }
  // An empty list is kept rather than defaulted: "we work no fixed days" is
  // a real answer for a shift business, and silently rewriting it to
  // Monday-to-Friday would be the product arguing with the admin.
  return [...seen].sort((a, b) => a - b) as Weekday[];
}

function toHours(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 24) return WORK_SCHEDULE_DEFAULTS.hoursPerDay;
  // Two decimals, matching the Decimal(4,2) column, so a value that made a
  // round trip through the database reads back identically.
  return Math.round(n * 100) / 100;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toHolidays(v: unknown): Holiday[] {
  if (!Array.isArray(v)) return [];
  const out: Holiday[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { date?: unknown; name?: unknown };
    const date = typeof r.date === "string" ? r.date.slice(0, 10) : "";
    if (!DATE_RE.test(date) || seen.has(date)) continue;
    seen.add(date);
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Holiday";
    out.push({ date, name });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Normalise anything row-shaped or body-shaped into a WorkSchedule. */
export function parseWorkSchedule(row: unknown): WorkSchedule {
  if (!row || typeof row !== "object") return WORK_SCHEDULE_DEFAULTS;
  const r = row as { workdays?: unknown; hoursPerDay?: unknown; timezone?: unknown; holidays?: unknown };
  return {
    workdays: r.workdays === undefined ? WORK_SCHEDULE_DEFAULTS.workdays : toWeekdays(r.workdays),
    hoursPerDay: r.hoursPerDay === undefined ? WORK_SCHEDULE_DEFAULTS.hoursPerDay : toHours(r.hoursPerDay),
    timezone: typeof r.timezone === "string" && r.timezone.trim() ? r.timezone.trim() : null,
    holidays: r.holidays === undefined ? [] : toHolidays(r.holidays),
  };
}

// ── The pure math the surfaces spend ──────────────────────────────

/** "YYYY-MM-DD" for a local date, with no zone hop. */
export function dayKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Is this date a working day: a workday weekday that is not a holiday. */
export function isWorkingDay(schedule: WorkSchedule, d: Date): boolean {
  if (!schedule.workdays.includes(d.getDay() as Weekday)) return false;
  const key = dayKeyLocal(d);
  return !schedule.holidays.some((h) => h.date === key);
}

/** The holiday on this date, or null. Used for the cell tooltip. */
export function holidayOn(schedule: WorkSchedule, d: Date): Holiday | null {
  const key = dayKeyLocal(d);
  return schedule.holidays.find((h) => h.date === key) ?? null;
}

/**
 * Capacity for one date: hoursPerDay on a working day, 0 otherwise.
 *
 * This is the number the Workload grid colours its cells against, and the
 * reason a holiday is not just "shaded like a weekend": a task scheduled
 * across Christmas used to look comfortably under capacity because the day
 * still counted eight hours.
 */
export function capacityForDay(schedule: WorkSchedule, d: Date, hoursOverride?: number): number {
  if (!isWorkingDay(schedule, d)) return 0;
  const h = hoursOverride === undefined ? schedule.hoursPerDay : hoursOverride;
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/** Working days in [from, to], both ends inclusive. */
export function workingDaysBetween(schedule: WorkSchedule, from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  if (b.getTime() < a.getTime()) return 0;
  let n = 0;
  for (let t = a.getTime(); t <= b.getTime(); t += DAY_MS) {
    if (isWorkingDay(schedule, new Date(t))) n += 1;
  }
  return n;
}

/**
 * Hours the organization expects in the week beginning `weekStart`.
 *
 * The Timesheets week card reads this so a submitted total has something to
 * be short of. Holidays inside the week reduce it, which is the whole point
 * of holidays being in the record rather than in somebody's head.
 */
export function expectedWeekHours(schedule: WorkSchedule, weekStart: Date): number {
  const end = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  return Math.round(workingDaysBetween(schedule, weekStart, end) * schedule.hoursPerDay * 100) / 100;
}
