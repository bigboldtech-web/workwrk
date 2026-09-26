// A small five-field cron reader for agent schedules (spec-ai-automation
// section 2, /agents: "Runs on", a schedule picker with four presets, Every
// weekday morning / Every Monday / Every month start / Custom cron).
//
//   minute hour day-of-month month day-of-week
//
// Each field takes "*", a number, a list ("1,15"), a range ("1-5") and a step
// ("*/15", "0-30/10"). Day of week is 0 to 7 with both 0 and 7 meaning
// Sunday. When both day fields are restricted, a day matches either one
// (the classic cron rule). Pure, so the scheduler, the drawer's words and
// the tests read the same thing.
//
// THE ZONE. A schedule may lead with "CRON_TZ=<IANA zone> " (the prefix
// cronie and most cron readers use), and then its times are that zone's wall
// clock: "CRON_TZ=Asia/Kolkata 0 9 * * 1-5" is 9:00 in Kolkata on weekdays,
// whatever clock the server runs on. The drawer writes the prefix with the
// zone of the person who picks the schedule. A schedule with no prefix (every
// one saved before the prefix existed, and the keywords "daily" and
// "weekly") keeps the server's local clock, as it always has; the page names
// that zone next to the words so nobody reads it as their own.

import { isValidTimeZone, zonedParts, zonedTimeToUtc } from "@/lib/reports/schedule";

const ZONE_PREFIX = /^\s*CRON_TZ=(\S+)\s+/i;

/** The zone a schedule names with a CRON_TZ= prefix (null when none or invalid), and the rest. */
export function splitScheduleZone(schedule: string | null | undefined): { zone: string | null; body: string } {
  const raw = schedule ?? "";
  const m = ZONE_PREFIX.exec(raw);
  if (!m) return { zone: null, body: raw.trim() };
  return { zone: isValidTimeZone(m[1]) ? m[1] : null, body: raw.slice(m[0].length).trim() };
}

/** Whether the text carries a CRON_TZ= prefix at all (valid or not). */
export function hasZonePrefix(schedule: string | null | undefined): boolean {
  return ZONE_PREFIX.test(schedule ?? "");
}

/**
 * The text to save for a schedule a person picked: a bare five-field cron
 * gets the picker's zone; a schedule that already names a zone, or is not a
 * cron at all ("every 15 minutes"), is saved as typed.
 */
export function scheduleForSave(schedule: string, zone: string | null | undefined): string {
  const t = schedule.trim();
  if (hasZonePrefix(t)) return t;
  return parseCron(t) ? withScheduleZone(t, zone) : t;
}

/** "0 9 * * 1-5" in `zone`, as the text the scheduler stores. */
export function withScheduleZone(cron: string, zone: string | null | undefined): string {
  const body = splitScheduleZone(cron).body;
  return zone && isValidTimeZone(zone) ? `CRON_TZ=${zone} ${body}` : body;
}

export interface CronSpec {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  days: ReadonlySet<number>;
  months: ReadonlySet<number>;
  weekdays: ReadonlySet<number>;
  /** Whether the day-of-month / day-of-week field was restricted (not "*"). */
  daysRestricted: boolean;
  weekdaysRestricted: boolean;
}

const RANGES: ReadonlyArray<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (7 = Sunday)
];

function parseField(raw: string, [lo, hi]: [number, number]): Set<number> | null {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    if (!part) return null;
    const [rangePart, stepPart] = part.split("/");
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return null;
      step = Number(stepPart);
      if (step < 1) return null;
    }
    let from: number;
    let to: number;
    if (rangePart === "*") {
      from = lo;
      to = hi;
    } else if (/^\d+$/.test(rangePart)) {
      from = Number(rangePart);
      to = stepPart !== undefined ? hi : from;
    } else {
      const m = rangePart.match(/^(\d+)-(\d+)$/);
      if (!m) return null;
      from = Number(m[1]);
      to = Number(m[2]);
    }
    if (from < lo || to > hi || from > to) return null;
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

/** The parsed schedule, or null when the text is not a five-field cron. */
export function parseCron(expr: string | null | undefined): CronSpec | null {
  if (!expr) return null;
  if (hasZonePrefix(expr)) {
    const { zone, body } = splitScheduleZone(expr);
    return zone ? parseCron(body) : null;
  }
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const parsed = fields.map((f, i) => parseField(f, RANGES[i]));
  if (parsed.some((p) => p === null)) return null;
  const [minutes, hours, days, months, weekdaysRaw] = parsed as Set<number>[];
  const weekdays = new Set<number>([...weekdaysRaw].map((d) => (d === 7 ? 0 : d)));
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    daysRestricted: fields[2] !== "*",
    weekdaysRestricted: fields[4] !== "*",
  };
}

export function isCron(expr: string | null | undefined): boolean {
  return parseCron(expr) !== null;
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  const dom = spec.days.has(d.getDate());
  const dow = spec.weekdays.has(d.getDay());
  if (spec.daysRestricted && spec.weekdaysRestricted) return dom || dow;
  if (spec.daysRestricted) return dom;
  if (spec.weekdaysRestricted) return dow;
  return true;
}

/**
 * The first minute strictly after `from` that the schedule names, or null
 * when the text is not a cron or names no minute in the next 366 days (a
 * 31st of February).
 */
export function nextCronRun(expr: string, from: Date = new Date()): Date | null {
  const spec = parseCron(expr);
  if (!spec) return null;
  const { zone } = splitScheduleZone(expr);
  if (zone) return nextZonedRun(spec, from, zone);
  const t = new Date(from);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (t.getTime() <= limit) {
    if (!spec.months.has(t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(spec, t)) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!spec.hours.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!spec.minutes.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(t);
  }
  return null;
}

/**
 * The same walk on the wall clock of `zone`: `w` is a Date whose UTC fields
 * ARE that wall clock, and each match converts back to the real instant. A
 * wall time that a DST change skips lands just after the gap; one that it
 * repeats runs once, at its first instant.
 */
function nextZonedRun(spec: CronSpec, from: Date, zone: string): Date | null {
  const p = zonedParts(from, zone);
  const w = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute + 1, 0, 0));
  const limit = Date.UTC(p.year, p.month - 1, p.day) + 367 * 24 * 60 * 60 * 1000;
  while (w.getTime() <= limit) {
    if (!spec.months.has(w.getUTCMonth() + 1)) {
      w.setUTCMonth(w.getUTCMonth() + 1, 1);
      w.setUTCHours(0, 0, 0, 0);
      continue;
    }
    const dom = spec.days.has(w.getUTCDate());
    const dow = spec.weekdays.has(w.getUTCDay());
    const dayOk = spec.daysRestricted && spec.weekdaysRestricted ? dom || dow : spec.daysRestricted ? dom : spec.weekdaysRestricted ? dow : true;
    if (!dayOk) {
      w.setUTCDate(w.getUTCDate() + 1);
      w.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!spec.hours.has(w.getUTCHours())) {
      w.setUTCHours(w.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!spec.minutes.has(w.getUTCMinutes())) {
      w.setUTCMinutes(w.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    const instant = zonedTimeToUtc(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), zone);
    if (instant.getTime() > from.getTime()) return instant;
    w.setUTCMinutes(w.getUTCMinutes() + 1, 0, 0);
  }
  return null;
}
