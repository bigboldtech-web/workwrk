// Calendar grid maths, in the VIEWER'S time zone.
//
// WHY THIS IS NOT `new Date().getHours()`. A week grid answers two questions
// about every instant: which day column does it belong to, and how far down
// that column does it sit. Both are calendar questions, and a calendar only
// exists in a time zone. `Date.prototype.getHours()` answers them in the
// zone of the machine the browser is running on, which is why the Planner
// opened on a Sunday column for a Monday-start preference and printed
// "5:30 PM" for a person whose preference says 24h in Asia/Kolkata
// (audit P-11, T-7, TC-4).
//
// Every function here takes the zone (and the week start) explicitly, so the
// rules are provable in a node test with no DOM and no ambient TZ.
//
// Pure: no React, no prisma, no Intl caching beyond one formatter per call
// path. `daysBackToWeekStart` and `weekdayOrder` live in
// src/lib/planner-prefs.ts, which is THE reader for the week-start
// preference; this file consumes them rather than re-deciding.

import { daysBackToWeekStart, resolvePlannerWeekStart } from "./planner-prefs";

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday .. 6 = Saturday, in the zone. */
  weekday: number;
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Calendar parts of `date` as read in `zone`. `hourCycle: "h23"` so midnight
 * is hour 0 and not hour 24 (the same reason src/lib/format/date.ts fixes it).
 * An unusable zone name falls back to the runtime's own, which is what every
 * other reader in the product does rather than throwing at a person.
 */
export function zonedParts(date: Date, zone?: string | null): ZonedParts {
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
    hourCycle: "h23",
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", zone ? { ...opts, timeZone: zone } : opts);
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", opts);
  }
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  const hour = out.hour === "24" ? 0 : Number(out.hour);
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour,
    minute: Number(out.minute),
    weekday: WEEKDAY_INDEX[out.weekday] ?? 0,
  };
}

/** "YYYY-MM-DD" for `date` in `zone`: the key a day column is grouped by. */
export function zonedDayKey(date: Date, zone?: string | null): string {
  const p = zonedParts(date, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes since midnight of `date`'s own day, in `zone`: the block's offset. */
export function zonedMinutesOfDay(date: Date, zone?: string | null): number {
  const p = zonedParts(date, zone);
  return p.hour * 60 + p.minute;
}

/**
 * The seven day keys of the week containing `anchor`, starting on
 * `weekStart` (0 = Sunday .. 6 = Saturday), all read in `zone`.
 *
 * Day keys and not Dates, because a Date carries an instant and a column
 * carries a calendar day: adding 24 hours across a DST boundary lands on the
 * same day twice, and adding a day to a key never can.
 */
export function zonedWeekKeys(anchor: Date, weekStart: unknown, zone?: string | null): string[] {
  const p = zonedParts(anchor, zone);
  const back = daysBackToWeekStart(p.weekday, weekStart);
  const first = addDaysToKey(`${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, -back);
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(first, i));
}

/** Add whole days to a "YYYY-MM-DD" key. Calendar arithmetic, no instants. */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** The day number a key names, for the column header. */
export function dayOfKey(key: string): number {
  return Number(key.slice(8, 10));
}

/** 0 = Sunday .. 6 = Saturday for a day key. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The instant at `minutes` past midnight on day `key`, in `zone`.
 *
 * Used when a drag on the grid becomes a time to save. Done by probing: the
 * naive UTC instant is read back in the zone and the difference corrected,
 * twice, which settles every offset including the 30 and 45 minute ones and
 * both sides of a DST change.
 */
export function instantAt(key: string, minutes: number, zone?: string | null): Date {
  const [y, m, d] = key.split("-").map(Number);
  let guess = new Date(Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60));
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, zone);
    const wantedMinutes = minutes;
    const gotMinutes = p.hour * 60 + p.minute;
    const dayDrift =
      (Date.UTC(y, m - 1, d) - Date.UTC(p.year, p.month - 1, p.day)) / 60_000;
    const drift = dayDrift + (wantedMinutes - gotMinutes);
    if (drift === 0) break;
    guess = new Date(guess.getTime() + drift * 60_000);
  }
  return guess;
}

/** "07:00" or "7 am", from `home.locale.timeFormat`. */
export function hourLabel(hour: number, timeFormat: "12h" | "24h" | null | undefined): string {
  if (timeFormat === "24h") return `${String(hour).padStart(2, "0")}:00`;
  const am = hour < 12;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${am ? "am" : "pm"}`;
}

/** "09:30" or "9:30 AM", for a block's second line. */
export function clockLabel(date: Date, zone: string | null | undefined, timeFormat: "12h" | "24h" | null | undefined): string {
  const p = zonedParts(date, zone);
  if (timeFormat === "24h") return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const am = p.hour < 12;
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h}:${String(p.minute).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

/** The weekday header words in the order a week starting on `weekStart` runs. */
export function weekdayLabels(weekStart: unknown): string[] {
  const start = resolvePlannerWeekStart(weekStart);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return Array.from({ length: 7 }, (_, i) => names[(start + i) % 7]);
}

/** The month a key belongs to, 1 = January. For the Month view's tinting. */
export function monthOfKey(key: string): number {
  return Number(key.slice(5, 7));
}

/**
 * The day keys of a Month view's grid: whole weeks, starting on `weekStart`,
 * covering every day of the month containing `anchor` plus the lead and
 * trail days that complete the first and last week.
 *
 * Five rows when the month fits in five (a 28-day February that starts on
 * the week start fits in four, and four is what it returns: the grid is as
 * tall as the month needs and never padded to a fixed six, which is what
 * put an entirely greyed-out row under some months).
 */
export function zonedMonthKeys(anchor: Date, weekStart: unknown, zone?: string | null): string[] {
  const p = zonedParts(anchor, zone);
  const firstOfMonth = `${p.year}-${String(p.month).padStart(2, "0")}-01`;
  const back = daysBackToWeekStart(weekdayOfKey(firstOfMonth), weekStart);
  const start = addDaysToKey(firstOfMonth, -back);
  // Days in the month, without asking a Date for them: day 0 of the next
  // month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  const cells = Math.ceil((back + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => addDaysToKey(start, i));
}

/** "September 2026" for the Month view's period label. */
export function monthLabel(anchor: Date, zone?: string | null, language?: string | null): string {
  const p = zonedParts(anchor, zone);
  const d = new Date(Date.UTC(p.year, p.month - 1, 15, 12));
  try {
    return d.toLocaleDateString(language ?? undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  } catch {
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  }
}
