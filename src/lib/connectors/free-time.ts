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
// quarter hour on the wall too.

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

/** The wall clock in `zone` at `at`. */
function wallClock(at: number, zone: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
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
function momentOf(y: number, mo: number, d: number, h: number, mi: number, zone: string): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const first = asUtc - offsetAt(asUtc, zone);
  return asUtc - offsetAt(first, zone);
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

function isZone(zone: string): boolean {
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
    const dayOpen = momentOf(y, mo, d, open.h, open.m, a.zone);
    if (dayOpen >= end) break;
    if (!days.has(day.getUTCDay())) continue;
    const windowStart = Math.max(dayOpen, start);
    const windowEnd = Math.min(momentOf(y, mo, d, close.h, close.m, a.zone), end);
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
