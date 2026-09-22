// The timesheet week, as arithmetic.
//
// Everything the week card, the Timesheet drawer and the Past weeks table
// need to turn a list of TimeEntry rows into seven day columns, without any
// of the three doing it their own way. Pure: no React, no prisma, no Date
// formatting, so it runs in a vitest node pass and on both sides of the wire.
//
// THE DAY KEY IS THE UNIT. Timesheet.weekStartDate and TimeEntry.day are
// both 00:00 UTC (src/lib/timesheet-week.ts says why: an hour typed at 11pm
// Sunday in Mumbai and 11pm Sunday in Denver must land in the same payroll
// week). So every function here takes and returns "YYYY-MM-DD" strings read
// as UTC calendar dates, and NOTHING here builds a local Date out of one.
// Formatting a key for a human is src/lib/format/date.ts's job, and the
// callers hand it midday UTC so no zone on earth moves the date.

/** A "YYYY-MM-DD" calendar key. */
export type DayKey = string;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(v: unknown): v is DayKey {
  return typeof v === "string" && DAY_KEY_RE.test(v);
}

/** Add whole days to a key, in UTC, and hand back a key. */
export function shiftDayKey(key: DayKey, days: number): DayKey {
  const d = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return key;
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** The seven keys of the week beginning at `weekStartKey`, in order. */
export function weekDayKeys(weekStartKey: DayKey): DayKey[] {
  return Array.from({ length: 7 }, (_, i) => shiftDayKey(weekStartKey, i));
}

/**
 * The Monday-00:00-UTC week a day key belongs to, computed from the key and
 * never from a local Date.
 *
 * This deliberately mirrors weekStartUTC in src/lib/timesheet-week.ts rather
 * than importing it: that one takes a Date, and handing it `new Date(key)`
 * is exactly the zone hop this module exists to prevent.
 */
export function weekStartKeyOf(key: DayKey): DayKey {
  const d = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return key;
  // getUTCDay: 0 Sunday .. 6 Saturday. Monday is the anchor, so Sunday
  // steps back six days rather than forward one.
  const offset = (d.getUTCDay() + 6) % 7;
  return shiftDayKey(key, -offset);
}

/** Is this key inside the week beginning at `weekStartKey`? */
export function isInWeek(weekStartKey: DayKey, key: DayKey): boolean {
  return weekStartKeyOf(key) === weekStartKeyOf(weekStartKey);
}

// ── Entries ───────────────────────────────────────────────────────

export interface GridEntry {
  id: string;
  /** Either a key or an ISO instant; only the first ten characters are read. */
  day: string;
  /** Decimal hours as the column stores them; null while a punch is running. */
  hours: number | null;
  description?: string | null;
  source?: string | null;
  billable?: boolean | null;
  tags?: string[] | null;
  clockedInAt?: string | null;
  clockedOutAt?: string | null;
  item?: { id: string; title: string } | null;
  task?: { id: string; title: string } | null;
}

/** The stored day of an entry as a key. */
export function entryDayKey(e: Pick<GridEntry, "day">): DayKey {
  return String(e.day ?? "").slice(0, 10);
}

/** Decimal hours to whole minutes. Nulls and nonsense read as zero. */
export function entryMinutes(e: Pick<GridEntry, "hours">): number {
  const h = Number(e.hours);
  return Number.isFinite(h) && h > 0 ? Math.round(h * 60) : 0;
}

/** Total minutes across a list. */
export function sumMinutes(entries: readonly Pick<GridEntry, "hours">[]): number {
  return entries.reduce((acc, e) => acc + entryMinutes(e), 0);
}

/** An entry that started and has not stopped: the running punch. */
export function isRunningPunch(e: Pick<GridEntry, "clockedInAt" | "clockedOutAt">): boolean {
  return Boolean(e.clockedInAt) && !e.clockedOutAt;
}

/**
 * Seven day buckets for the week, plus any stray entry outside it.
 *
 * The strays matter: an import, a week boundary that moved or a punch that
 * rolled past midnight can leave a row whose day is not one of the seven.
 * Dropping it would make hours disappear from a payroll surface, so it is
 * kept, in its own bucket, at the end.
 */
export interface WeekGrid<E extends GridEntry> {
  weekStartKey: DayKey;
  /** The seven days, always present and always in order. */
  days: { key: DayKey; entries: E[]; minutes: number }[];
  /** Entries whose day is outside the seven, grouped and sorted. */
  strays: { key: DayKey; entries: E[]; minutes: number }[];
  /** Every entry counted, strays included. */
  totalMinutes: number;
}

export function buildWeekGrid<E extends GridEntry>(
  weekStartKey: DayKey,
  entries: readonly E[],
): WeekGrid<E> {
  const buckets = new Map<DayKey, E[]>();
  for (const e of entries) {
    const k = entryDayKey(e);
    const list = buckets.get(k);
    if (list) list.push(e);
    else buckets.set(k, [e]);
  }

  const keys = weekDayKeys(weekStartKey);
  const inWeek = new Set(keys);
  const days = keys.map((key) => {
    const list = buckets.get(key) ?? [];
    return { key, entries: list, minutes: sumMinutes(list) };
  });

  const strays = [...buckets.keys()]
    .filter((k) => !inWeek.has(k))
    .sort()
    .map((key) => {
      const list = buckets.get(key) ?? [];
      return { key, entries: list, minutes: sumMinutes(list) };
    });

  return {
    weekStartKey,
    days,
    strays,
    totalMinutes: sumMinutes(entries),
  };
}

// ── Week status ───────────────────────────────────────────────────

export type WeekStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

export const WEEK_STATUS_LABELS: Readonly<Record<WeekStatus, string>> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/**
 * May the owner add, edit or remove hours in this week?
 *
 * The same three answers POST /api/time-entries gives, resolved before the
 * click so the add row is simply absent rather than rendered and refused.
 * A REJECTED week is NOT editable until its owner reopens it, which is the
 * transition the page offers beside this answer.
 */
export function weekAcceptsHours(status: WeekStatus | null | undefined, isOwner: boolean): boolean {
  if (!isOwner) return false;
  return status === "DRAFT" || status == null;
}

/** The sentence the API would answer with, resolved before the click. */
export function weekBlockReason(status: WeekStatus | null | undefined): string | null {
  if (status === "SUBMITTED") return "This week is submitted. Retract it to change the hours.";
  if (status === "REJECTED") return "This week was sent back. Reopen it to fix the hours.";
  if (status === "APPROVED") return "This week is approved. Ask your approver to reopen it.";
  return null;
}

// ── Per-entry tags (Phase 4, time-tracking depth) ─────────────────

const MAX_TAGS = 10;
const MAX_TAG_LEN = 40;

/**
 * Labels on ONE entry, which is a different thing from the cost-center
 * TagAssignment that rides the parent Timesheet: that one tags a whole
 * week, this one tags an hour.
 *
 * Anything that is not a list of strings reads as "no tags" rather than
 * throwing. A stale client sending the wrong shape must not lose the hour
 * the tags were attached to, which is the whole rule on this surface.
 */
export function normaliseEntryTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().slice(0, MAX_TAG_LEN);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * The one word for where an hour came from (audit T-15, the Show source
 * display option). TimeEntrySource has more members than the four words
 * people recognise, so anything unknown reads "Manual" rather than shouting
 * an enum at somebody.
 */
export function entrySourceLabel(source: string | null | undefined): string {
  switch (String(source ?? "").toUpperCase()) {
    case "TIMER": return "From timer";
    case "CLOCK":
    case "PUNCH": return "Clocked";
    case "IMPORT":
    case "IMPORTED": return "Imported";
    case "KIOSK": return "Kiosk";
    default: return "Manual";
  }
}
