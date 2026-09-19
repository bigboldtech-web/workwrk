// work-buckets.ts — "is this task overdue, due today, or due this week?", in
// the VIEWER's time zone and with the viewer's week start.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/home My work widget
// group headers; /my-work "Group by Due date": Overdue / Today / Tomorrow /
// This week / Later / No date), and critic-gaps #13, which is the reason this
// file exists at all:
//
//   `/api/me/work` computed today's edges from `new Date(y, m, d)` — the
//   SERVER's local midnight. `/tasks` greeted you from `getHours()` — the
//   BROWSER's. The Inbox grouped by date a third way. Meanwhile
//   `home.locale.timezone` and `home.locale.weekStart` have been in the
//   preferences schema the whole time with no reader at all. A person in
//   Sydney reading a list bucketed on a New York midnight sees yesterday's
//   work filed under Today for most of their working day.
//
// Everything here is a pure function of (instant, timeZone, weekStart), so the
// server and the browser reach the same answer and the test can pin both.
//
// NO IMPORTS: the API routes and the client both read this, and the test runs
// in vitest's node environment where "@/" does not resolve.

/** The six buckets, in the order the spec prints them. */
export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export const DUE_BUCKET_ORDER: readonly DueBucket[] = [
  "overdue",
  "today",
  "tomorrow",
  "week",
  "later",
  "none",
];

export const DUE_BUCKET_LABEL: Readonly<Record<DueBucket, string>> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "This week",
  later: "Later",
  none: "No date",
};

/** 0 = Sunday .. 6 = Saturday, matching `home.locale.weekStart`. */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface LocaleContext {
  /** An IANA zone. An unknown or empty zone falls back to the host's. */
  timeZone?: string | null;
  weekStart?: number | null;
  /** `home.locale.timeFormat === "12h"`. Affects clock strings only. */
  hour12?: boolean;
}

/**
 * The calendar day an instant falls on, in a time zone, as a plain
 * `{ y, m, d }`. `Intl.DateTimeFormat` with `en-CA` yields `YYYY-MM-DD`, which
 * is the one locale-stable way to ask this question without a date library.
 *
 * An invalid zone string throws inside `Intl`; that must never take a page
 * down, so it falls back to the host zone and the caller is none the wiser.
 */
export function civilDayIn(instant: Date, timeZone?: string | null): { y: number; m: number; d: number } {
  const iso = formatIsoDay(instant, timeZone);
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return { y, m, d };
}

/** "YYYY-MM-DD" for an instant in a zone. Never throws. */
export function formatIsoDay(instant: Date, timeZone?: string | null): string {
  const zone = (timeZone ?? "").trim();
  if (zone) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(instant);
    } catch {
      // Fall through to the host zone below.
    }
  }
  const y = instant.getFullYear();
  const m = String(instant.getMonth() + 1).padStart(2, "0");
  const d = String(instant.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from `a` to `b`, counting calendar days, not 24-hour spans. */
export function dayDifference(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }): number {
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

/** 0 = Sunday .. 6 = Saturday for a civil day. */
export function weekdayOf(day: { y: number; m: number; d: number }): number {
  return new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
}

/**
 * How many days are left in the viewer's week, counting today. A week that
 * starts on Monday and a `today` that is Monday leaves 7; a Sunday leaves 1.
 */
export function daysLeftInWeek(today: { y: number; m: number; d: number }, weekStart: number): number {
  const start = ((weekStart % 7) + 7) % 7;
  const offsetIntoWeek = (weekdayOf(today) - start + 7) % 7;
  return 7 - offsetIntoWeek;
}

/**
 * The bucket a due date falls in.
 *
 * `due` is the instant stored on the task (`dueAt`, else `startAt`); `now` is
 * the instant the page is rendering at. Both are compared as CIVIL DAYS in the
 * viewer's zone, so "overdue" means "its day has passed where you are", not
 * "its timestamp is behind the server clock" — a task due today at 09:00 is
 * Today all day, not Overdue from 09:01.
 */
export function bucketFor(due: Date | string | null | undefined, now: Date, locale: LocaleContext = {}): DueBucket {
  if (due === null || due === undefined || due === "") return "none";
  const instant = due instanceof Date ? due : new Date(due);
  if (Number.isNaN(instant.getTime())) return "none";

  const zone = locale.timeZone ?? null;
  const today = civilDayIn(now, zone);
  const dueDay = civilDayIn(instant, zone);
  const delta = dayDifference(today, dueDay);

  if (delta < 0) return "overdue";
  if (delta === 0) return "today";
  if (delta === 1) return "tomorrow";

  const weekStart = normaliseWeekStart(locale.weekStart);
  // "This week" runs to the end of the viewer's current week. Tomorrow has
  // already been claimed above, so a week with two days left has no "week"
  // rows at all — which is correct, and is why the empty groups collapse.
  const left = daysLeftInWeek(today, weekStart);
  if (delta < left) return "week";
  return "later";
}

export function normaliseWeekStart(value: number | null | undefined): WeekStart {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 1;
  return (((n % 7) + 7) % 7) as WeekStart;
}

/**
 * The three groups the Home "My work" widget prints: Overdue, Today and the
 * rest of the week. Tomorrow folds into "This week" there, because a widget of
 * ten rows with six headers is a header list, not a work list.
 */
export type HomeBucket = "overdue" | "today" | "week";

export function homeBucketFor(due: Date | string | null | undefined, now: Date, locale: LocaleContext = {}): HomeBucket | null {
  const bucket = bucketFor(due, now, locale);
  if (bucket === "overdue") return "overdue";
  if (bucket === "today") return "today";
  if (bucket === "tomorrow" || bucket === "week") return "week";
  return null;
}

/**
 * The instant range a bucket covers, as UTC instants, so a server query can
 * narrow on `dueAt` before it pages. `null` on either end means unbounded.
 *
 * The edges are the viewer's civil midnights expressed as instants. Working
 * those out without a date library means asking the zone what offset it had at
 * a nearby instant and subtracting it, which is exact except across the one
 * hour a DST transition moves — and a bucket edge that is an hour out for one
 * night a year is the correct trade against shipping a tz database.
 */
export function zonedStartOfDay(day: { y: number; m: number; d: number }, timeZone?: string | null): Date {
  const naiveUtc = Date.UTC(day.y, day.m - 1, day.d, 0, 0, 0, 0);
  const offset = zoneOffsetMs(new Date(naiveUtc), timeZone);
  return new Date(naiveUtc - offset);
}

/** The zone's UTC offset in milliseconds at an instant. 0 when unknown. */
export function zoneOffsetMs(at: Date, timeZone?: string | null): number {
  const zone = (timeZone ?? "").trim();
  if (!zone) return -at.getTimezoneOffset() * 60_000;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
    // `hour` comes back as 24 at midnight under hour12:false in some engines.
    const hour = get("hour") % 24;
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return -at.getTimezoneOffset() * 60_000;
  }
}

/**
 * The instant at which the viewer's current week ends (exclusive): the start of
 * the day after the last day of their week.
 */
export function endOfWeekInstant(now: Date, locale: LocaleContext = {}): Date {
  const zone = locale.timeZone ?? null;
  const today = civilDayIn(now, zone);
  const left = daysLeftInWeek(today, normaliseWeekStart(locale.weekStart));
  const end = addDays(today, left);
  return zonedStartOfDay(end, zone);
}

/** The instant at which the viewer's today begins. */
export function startOfTodayInstant(now: Date, locale: LocaleContext = {}): Date {
  return zonedStartOfDay(civilDayIn(now, locale.timeZone ?? null), locale.timeZone ?? null);
}

export function addDays(day: { y: number; m: number; d: number }, n: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d) + n * 86_400_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// Month and weekday words are spelled out here rather than asked of `Intl`.
// `Intl` is right about dates and wrong about this one thing for us: en-GB
// short months render as "Sept" on current ICU and "Sep" on older ones, so the
// same build prints two different chips depending on the Node that serves it.
// Six labels do not justify that, and the spec writes "8 Sep".
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "8 Sep", and "8 Sep 2025" when the year differs from the reference. */
export function shortDate(day: { y: number; m: number; d: number }, referenceYear?: number): string {
  const base = `${day.d} ${MONTH_SHORT[day.m - 1]}`;
  return referenceYear !== undefined && day.y !== referenceYear ? `${base} ${day.y}` : base;
}

/**
 * The sticky date label an Inbox row sits under (spec section 2 /inbox List):
 * Today, Yesterday, one label per day for the last seven days, then one per
 * month. The old page had exactly three buckets and filed a notification from
 * 2019 under "Last 7 days".
 */
export function inboxDateLabel(at: Date | string, now: Date, locale: LocaleContext = {}): string {
  const instant = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(instant.getTime())) return "Earlier";
  const zone = locale.timeZone ?? null;
  const day = civilDayIn(instant, zone);
  const today = civilDayIn(now, zone);
  const delta = dayDifference(day, today);
  if (delta <= 0) return "Today";
  if (delta === 1) return "Yesterday";
  if (delta < 7) return `${WEEKDAY_SHORT[weekdayOf(day)]} ${shortDate(day)}`;
  const month = MONTH_LONG[day.m - 1];
  return day.y === today.y ? month : `${month} ${day.y}`;
}

/**
 * The short time an Inbox row prints at the right of its first line: "9:41"
 * today, "Mon" this week, "8 Sep" beyond it.
 */
export function inboxRowTime(at: Date | string, now: Date, locale: LocaleContext = {}): string {
  const instant = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(instant.getTime())) return "";
  const zone = locale.timeZone ?? null;
  const day = civilDayIn(instant, zone);
  const delta = dayDifference(day, civilDayIn(now, zone));
  if (delta <= 0) return clockIn(instant, zone, locale.hour12);
  if (delta < 7) return WEEKDAY_SHORT[weekdayOf(day)];
  return shortDate(day);
}

/** "9:41" or "9:41 am", in the viewer's zone. Never throws. */
export function clockIn(instant: Date, timeZone?: string | null, hour12 = false): string {
  const zone = (timeZone ?? "").trim();
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12,
      timeZone: zone || undefined,
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12 }).format(instant);
  }
}

/** A short due chip: "Today", "Tomorrow", "Yesterday", "8 Sep", "8 Sep 2025". */
export function dueChipLabel(due: Date | string | null | undefined, now: Date, locale: LocaleContext = {}): string | null {
  if (!due) return null;
  const instant = due instanceof Date ? due : new Date(due);
  if (Number.isNaN(instant.getTime())) return null;
  const zone = locale.timeZone ?? null;
  const day = civilDayIn(instant, zone);
  const today = civilDayIn(now, zone);
  const delta = dayDifference(today, day);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  return shortDate(day, today.y);
}
