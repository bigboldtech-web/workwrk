// When a person, and the colleagues they asked about, are free for a meeting
// (docs/plans/ai-teammates-phase3.md Decision 11, find_free_time). Pure: busy
// blocks in, free windows out. Busy blocks carry no words, so nothing here
// is anyone's text.
//
// THE WORKING DAY IS THE PERSON'S, IN THEIR ZONE. Each day's hours are read in
// `zone` through Intl with hourCycle "h23" (never hour12, which prints
// midnight as "24" on some runtimes), so a day across a daylight saving
// change keeps its 09:00 to 18:00 on the wall clock. Every zone in use today
// is a whole number of quarter hours from UTC, so a quarter hour in UTC is a
// quarter hour on the wall too. A day starts at its first moment on the wall
// clock, even where a change skips its midnight (startOfDay, review of step 4).

export interface Interval {
  /** Milliseconds since the epoch. */
  start: number;
  end: number;
}

const QUARTER_MS = 15 * 60_000;

/** The most days one search walks, whatever window it is given. */
const MAX_DAYS = 400;

const formats = new Map<string, Intl.DateTimeFormat>();

function formatFor(zone: string): Intl.DateTimeFormat {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formats.set(zone, f);
  }
  return f;
}

/** The wall clock in `zone` at `at` (also the calendar tools' clock, google/calendar.ts). */
export function wallClock(at: number, zone: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const p: Record<string, string> = {};
  for (const part of formatFor(zone).formatToParts(new Date(at))) p[part.type] = part.value;
  // A runtime that still says "24" means the midnight that starts the day.
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: p.hour === "24" ? 0 : Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

/** How far `zone`'s wall clock is ahead of UTC at `at`, in milliseconds. */
function offsetAt(at: number, zone: string): number {
  const w = wallClock(at, zone);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(at / 1000) * 1000;
}

/** The moment a wall-clock time happens in `zone`: guessed, then corrected once for a change of offset in between. */
export function momentOf(y: number, mo: number, d: number, h: number, mi: number, zone: string): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const first = asUtc - offsetAt(asUtc, zone);
  return asUtc - offsetAt(first, zone);
}

/** How far either side of momentOf's guess the first moment of a day is looked for: no change of offset moves a day by more. */
const DAY_SEARCH_MS = 26 * 60 * 60_000;

/**
 * The first moment of a day on the clock of `zone`: usually its 00:00. Where
 * a daylight saving change skips midnight (America/Santiago on 6 September
 * 2026 goes from 23:59:59 straight to 01:00), the day starts where the
 * change ends, and momentOf's guess for 00:00 lands an hour early, on the
 * day before: a window ending that day lost its last hour, and the next began
 * an hour early (review of step 4). Then the first moment whose wall-clock day
 * is this one is found by halving, to the millisecond.
 */
export function startOfDay(y: number, mo: number, d: number, zone: string): number {
  const want = Date.UTC(y, mo - 1, d);
  const dayAt = (at: number) => {
    const w = wallClock(at, zone);
    return Date.UTC(w.y, w.mo - 1, w.d);
  };
  const guess = momentOf(y, mo, d, 0, 0, zone);
  if (dayAt(guess) === want && dayAt(guess - 1) < want) return guess;
  // On a day before this one, and on this one or after.
  let lo = guess - DAY_SEARCH_MS;
  let hi = guess + DAY_SEARCH_MS;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (dayAt(mid) >= want) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** A working day's opening or closing moment: a day's 00:00, or "24:00" (the next day's start), is a day boundary, read as startOfDay reads one. */
function boundaryOrMoment(y: number, mo: number, d: number, h: number, mi: number, zone: string): number {
  if (h === 0 && mi === 0) return startOfDay(y, mo, d, zone);
  if (h === 24) {
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    return startOfDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), zone);
  }
  return momentOf(y, mo, d, h, mi, zone);
}

/** "09:00" as hours and minutes; "24:00" ends a day. Null for anything else. */
function hoursMinutes(s: string): { h: number; m: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return null;
  return { h, m: mi };
}

/** Whether Intl knows `zone`. */
export function isZone(zone: string): boolean {
  try {
    formatFor(zone);
    return true;
  } catch {
    return false;
  }
}

/** The busy blocks as one sorted list, overlapping and touching ones merged. */
function merged(busy: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  const sorted = busy
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)
    .map((b) => ({ start: b.start, end: b.end }))
    .sort((a, b) => a.start - b.start);
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push(b);
  }
  return out;
}

/**
 * The free windows of at least `durationMinutes` between `from` and `to`, in
 * the working hours (`dayStart` to `dayEnd`, "HH:MM" on the wall clock in
 * `zone`) of the working days (`workDays`, 0 = Sunday, as Date.getDay), with
 * the busy blocks taken out. Nothing starts before `now` rounded up to the
 * quarter hour; each window starts and ends on a quarter hour. At most `max`,
 * earliest first. A zone, an hour or a length that makes no sense finds
 * nothing rather than a guess.
 */
export function freeSlots(a: {
  busy: readonly Interval[];
  from: Date;
  to: Date;
  durationMinutes: number;
  zone: string;
  workDays: readonly number[];
  dayStart: string;
  dayEnd: string;
  now: Date;
  max: number;
}): Interval[] {
  const open = hoursMinutes(a.dayStart);
  const close = hoursMinutes(a.dayEnd);
  const max = Number.isFinite(a.max) ? Math.floor(a.max) : 0;
  const length = a.durationMinutes * 60_000;
  if (!open || !close || close.h * 60 + close.m <= open.h * 60 + open.m) return [];
  if (!(length > 0) || max <= 0 || !isZone(a.zone)) return [];
  const start = Math.max(a.from.getTime(), Math.ceil(a.now.getTime() / QUARTER_MS) * QUARTER_MS);
  const end = a.to.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const days = new Set(a.workDays);
  const busy = merged(a.busy);
  const out: Interval[] = [];
  const first = wallClock(start, a.zone);
  for (let k = 0; k < MAX_DAYS; k += 1) {
    const day = new Date(Date.UTC(first.y, first.mo - 1, first.d + k));
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const dayOpen = boundaryOrMoment(y, mo, d, open.h, open.m, a.zone);
    if (dayOpen >= end) break;
    if (!days.has(day.getUTCDay())) continue;
    const windowStart = Math.max(dayOpen, start);
    const windowEnd = Math.min(boundaryOrMoment(y, mo, d, close.h, close.m, a.zone), end);
    if (windowEnd <= windowStart) continue;

    // The gaps between the busy blocks inside this day's window.
    const gaps: Interval[] = [];
    let cursor = windowStart;
    for (const b of busy) {
      if (b.end <= cursor) continue;
      if (b.start >= windowEnd) break;
      if (b.start > cursor) gaps.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
      if (cursor >= windowEnd) break;
    }
    if (cursor < windowEnd) gaps.push({ start: cursor, end: windowEnd });

    for (const g of gaps) {
      const s = Math.ceil(g.start / QUARTER_MS) * QUARTER_MS;
      const e = Math.floor(g.end / QUARTER_MS) * QUARTER_MS;
      if (e - s < length) continue;
      out.push({ start: s, end: e });
      if (out.length >= max) return out;
    }
  }
  return out;
}
