// Task recurrence ("Repeat") — a small, pure module shared by the client
// DatePlanner (to edit + describe a rule) and the server (PATCH route + the
// recurring-tasks cron). No server deps so it's safe to import from a
// "use client" component.
//
// Spawn model: the rule lives on the SERIES ANCHOR task as columns
//   recurRule   = { freq, interval, weekdays?, monthDay?, yearMonth?, yearDay?, ... }
//   recurNextAt = when the cron spawns the next fresh copy.
// The anchor's due date IS the series anchor: occurrences are computed from it
// (preserving its time-of-day) and changing the due date re-anchors the series.
// Spawn bookkeeping lives in Item.metadata:
//   anchor:  lastSpawnedKey (occurrence key of the last handled cycle) +
//            skippedOccurrences (keys collapsed by the catch-up cap)
//   copies:  recurrenceSourceId + recurrenceKey (per-occurrence idempotency).

export type RecurFreq = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR";

/** When the next cycle fires:
 *  - SCHEDULE    — "On schedule": the cron spawns a NEW task per occurrence
 *                  (Item.recurNextAt drives it). Default.
 *  - ON_COMPLETE — "After completion": marking the task done rolls ITS due
 *                  date forward; recurNextAt stays null, no new rows. */
export type RecurTrigger = "SCHEDULE" | "ON_COMPLETE";

export interface RecurrenceRule {
  freq: RecurFreq;
  /** Repeat every N units (>= 1). */
  interval: number;
  /** What advances the series. Default SCHEDULE. */
  trigger?: RecurTrigger;
  /** true  = spawn a fresh copy each cycle (each period gets its own record);
   *  false = roll THIS same task forward. Default true (back-compat). The new
   *  UI derives it from the trigger (SCHEDULE=true, ON_COMPLETE=false). */
  createNew?: boolean;
  /** false = the series ends after `count` occurrences or once a cycle passes
   *  `until`. Default true (never ends until Repeat is turned off). */
  forever?: boolean;
  /** Remaining occurrences when !forever (decremented as each cycle runs). */
  count?: number | null;
  /** ISO end date when !forever. Once a cycle would land after this, stop. */
  until?: string | null;
  /** Status value to set when the task recurs (the new copy, or the rolled-
   *  forward task). null/absent = the board's first open status. */
  resetStatus?: string | null;
  /** Legacy: keep the due date in step with the recurrence each cycle.
   *  Default true. The new UI never writes it (always-sync). */
  syncDue?: boolean;
  /** WEEK only — ISO weekdays (1=Mon .. 7=Sun) the rule fires on, within every
   *  Nth week. null/absent = plain every-N-weeks stepping (legacy rules). */
  weekdays?: number[] | null;
  /** MONTH only — day of month (1-31; 29-31 clamp to the month's last day).
   *  null/absent = plain every-N-months stepping (legacy rules). */
  monthDay?: number | null;
  /** YEAR only — month (1-12). null/absent = plain yearly stepping. */
  yearMonth?: number | null;
  /** YEAR only — day of `yearMonth` (1-31, clamped to the month's length). */
  yearDay?: number | null;
  /** Explicit time-of-day for every occurrence, "HH:MM" 24-hour LOCAL time
   *  (e.g. "09:00"). null/absent = inherit the anchor's time-of-day (the
   *  behavior every stored rule had before this field existed). */
  atTime?: string | null;
  /** The IANA zone the rule was set in (pen test 2026-11-28, V-42). Every
   *  weekday, day, month and "HH:MM" of the rule is read on the wall clock
   *  THERE, so "every Friday at 17:00" stays a Friday at 17:00 for the person
   *  who set it, across UTC midnight and across a DST change. null/absent =
   *  the host's zone, which is what every rule got before this field. */
  tz?: string | null;
}

/** A zone name Intl knows, or null. */
export function validZone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const z = raw.trim();
  if (!z || z.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return null;
  }
}

// ── The wall clock in a zone ───────────────────────────────────────────
// The arithmetic runs on a "wall date": a Date whose UTC fields ARE the wall
// clock in the rule's zone, so setUTCDate / setUTCMonth step whole calendar
// days and months there, never 24-hour lumps across a DST change. Without a
// zone, the host's local fields, exactly as before.

function wallOf(instant: Date, zone: string | null | undefined): Date {
  if (!zone) {
    return new Date(Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate(), instant.getHours(), instant.getMinutes(), instant.getSeconds(), instant.getMilliseconds()));
  }
  const p: Record<string, string> = {};
  // hourCycle h23, never hour12:false (which answers "24" for midnight on Node 20).
  for (const x of new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant)) p[x.type] = x.value;
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second), instant.getUTCMilliseconds()));
}

/** How far `zone`'s wall clock is ahead of UTC at this instant, in ms. */
function offsetAt(ms: number, zone: string): number {
  return wallOf(new Date(ms), zone).getTime() - ms;
}

/**
 * The instant whose wall clock in `zone` reads as `wall`'s UTC fields. A wall
 * time a DST change repeats takes the later one; one a change skips moves on
 * by the jump (02:30 on a spring-forward night is 03:30), as a JS Date does,
 * in every zone, east or west of UTC (the step 6 review: an iterated guess
 * swung across the gap and could land on the day before).
 */
function instantOf(wall: Date, zone: string | null | undefined): Date {
  if (!zone) {
    return new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds(), wall.getUTCMilliseconds());
  }
  const wanted = wall.getTime();
  const o1 = offsetAt(wanted, zone);
  const t1 = wanted - o1;
  const o2 = offsetAt(t1, zone);
  if (o2 === o1) return new Date(t1);
  const t2 = wanted - o2;
  if (offsetAt(t2, zone) === o2) return new Date(t2);
  // Neither offset reads back: the wall time falls in a gap. The offset in
  // force before the change (the smaller) carries it past the gap.
  return new Date(wanted - Math.min(o1, o2));
}

// "HH:MM" 24-hour. parseRecurrence + applyTimeOfDay both gate on this so a
// malformed value degrades to "no explicit time", never to a wrong time.
const AT_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const FREQS: readonly RecurFreq[] = ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"];
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // index = ISO weekday - 1
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function intInRange(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

/** Validate an arbitrary blob (Item.recurRule column or legacy
 *  metadata.recurrence) into a rule. Returns null when absent/malformed so
 *  callers can treat "no recurrence" uniformly. Extra options are read when
 *  present and defaulted otherwise, so old {freq,interval} rules keep their
 *  original spawn-a-copy-on-schedule behavior; the calendar fields (weekdays /
 *  monthDay / yearMonth / yearDay) parse to null when absent so legacy rules
 *  fall back to plain interval stepping. */
export function parseRecurrence(raw: unknown): RecurrenceRule | null {
  if (!raw || typeof raw !== "object") return null;
  // Tolerate a legacy metadata wrapper ({ recurrence: {...} }).
  const obj = "recurrence" in (raw as Record<string, unknown>)
    ? (raw as Record<string, unknown>).recurrence
    : raw;
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const freq = o.freq;
  if (typeof freq !== "string" || !FREQS.includes(freq as RecurFreq)) return null;
  const rawInterval = o.interval;
  const interval = typeof rawInterval === "number" && rawInterval >= 1 ? Math.floor(rawInterval) : 1;

  const trigger: RecurTrigger = o.trigger === "ON_COMPLETE" ? "ON_COMPLETE" : "SCHEDULE";
  const createNew = typeof o.createNew === "boolean" ? o.createNew : true;
  const forever = typeof o.forever === "boolean" ? o.forever : true;
  const count = typeof o.count === "number" && o.count >= 0 ? Math.floor(o.count) : null;
  const until = typeof o.until === "string" && o.until ? o.until : null;
  const resetStatus = typeof o.resetStatus === "string" && o.resetStatus ? o.resetStatus : null;
  const syncDue = typeof o.syncDue === "boolean" ? o.syncDue : true;

  // Calendar-aware fields. An empty/invalid weekday set parses to null so a
  // malformed payload can never wedge the iterator (it falls back to stepping).
  let weekdays: number[] | null = null;
  if (Array.isArray(o.weekdays)) {
    const cleaned = Array.from(new Set(
      o.weekdays.filter((w): w is number => typeof w === "number" && Number.isInteger(w) && w >= 1 && w <= 7),
    )).sort((a, b) => a - b);
    weekdays = cleaned.length > 0 ? cleaned : null;
  }
  const monthDay = intInRange(o.monthDay, 1, 31);
  const yearMonth = intInRange(o.yearMonth, 1, 12);
  const yearDay = intInRange(o.yearDay, 1, 31);
  // Explicit time-of-day — absent/invalid parses to null, NEVER invented, so
  // every pre-existing rule keeps inheriting the anchor's time.
  const atTime = typeof o.atTime === "string" && AT_TIME_RE.test(o.atTime) ? o.atTime : null;
  const tz = validZone(o.tz);

  return {
    freq: freq as RecurFreq, interval, trigger, createNew, forever, count, until,
    resetStatus, syncDue, weekdays, monthDay, yearMonth, yearDay, atTime, tz,
  };
}

/** The date with the rule's explicit `atTime` applied on the wall clock of
 *  the rule's zone, or the date unchanged when the rule has none (occurrences
 *  then inherit the anchor's time-of-day exactly as before this field
 *  existed). Never shifts the calendar day: occurrenceKey() stays stable. */
export function applyTimeOfDay(date: Date, rule: RecurrenceRule): Date {
  const m = rule.atTime ? AT_TIME_RE.exec(rule.atTime) : null;
  if (!m) return date;
  const wall = wallOf(new Date(date), rule.tz);
  wall.setUTCHours(Number(m[1]), Number(m[2]), 0, 0);
  return instantOf(wall, rule.tz);
}

/** True once the series has run its course under a non-forever rule: the
 *  occurrence count is exhausted, or `nextCycle` would fall past `until`. */
export function seriesEnded(rule: RecurrenceRule, nextCycle: Date): boolean {
  if (rule.forever !== false) return false;
  if (typeof rule.count === "number" && rule.count <= 0) return true;
  if (rule.until) {
    const end = new Date(rule.until);
    if (!Number.isNaN(end.getTime()) && nextCycle.getTime() > end.getTime()) return true;
  }
  return false;
}

/** Advance a date by one cycle of the rule. Calendar-aware (setMonth /
 *  setFullYear handle month-length + leap years). QUARTER = 3 months. Legacy
 *  plain stepping — the calendar fields are handled by the iterator below. */
export function advanceDate(from: Date | string, rule: RecurrenceRule): Date {
  const d = wallOf(new Date(from), rule.tz);
  const n = Math.max(1, rule.interval);
  switch (rule.freq) {
    case "DAY": d.setUTCDate(d.getUTCDate() + n); break;
    case "WEEK": d.setUTCDate(d.getUTCDate() + 7 * n); break;
    case "MONTH": d.setUTCMonth(d.getUTCMonth() + n); break;
    case "QUARTER": d.setUTCMonth(d.getUTCMonth() + 3 * n); break;
    case "YEAR": d.setUTCFullYear(d.getUTCFullYear() + n); break;
  }
  return instantOf(d, rule.tz);
}

/** ISO weekday of a date (1=Mon .. 7=Sun), in `zone` (the rule's), else the host's. */
export function isoWeekday(d: Date, zone?: string | null): number {
  const w = wallOf(d, zone).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The occurrence key, YYYY-MM-DD, of the day `d` falls on in `zone` (the
 *  rule's), else the host's. Sorts lexicographically. Used for spawn
 *  idempotency (metadata.lastSpawnedKey / metadata.recurrenceKey). */
export function occurrenceKey(d: Date, zone?: string | null): string {
  const w = wallOf(d, zone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}`;
}

// Hard cap on iterator steps so a pathological rule can never spin forever.
const MAX_STEPS = 20000;

/**
 * Monotonic occurrence-grid iterator for a rule anchored at `anchor` (the
 * task's due date; its time-of-day is re-applied to every occurrence). Each
 * call returns the next grid point, STARTING AT OR BEFORE the anchor itself
 * (week 0 / month 0 can contain days before the anchor) — callers filter with
 * their own lower bound. Grids:
 *   WEEK + weekdays    — the selected weekdays within every Nth week.
 *   MONTH + monthDay   — day D of every Nth month, 29-31 clamped to month end.
 *   YEAR + yearMonth   — yearMonth/yearDay of every Nth year (clamped).
 *   everything else    — plain advanceDate stepping from the anchor (legacy).
 * Every emitted date passes through applyTimeOfDay, so a rule's explicit
 * atTime overrides the inherited time-of-day without moving the calendar day
 * (the grid stays monotonic: days are distinct, only the clock changes).
 */
function makeOccurrenceIterator(rule: RecurrenceRule, anchorInput: Date): () => Date {
  const raw = makeRawOccurrenceIterator(rule, anchorInput);
  return () => applyTimeOfDay(raw(), rule);
}

function makeRawOccurrenceIterator(rule: RecurrenceRule, anchorInput: Date): () => Date {
  // On the wall clock of the rule's zone (V-42): the anchor's weekday, day of
  // month and time of day are THERE, and each grid point is turned back into
  // the instant it names there. The host's zone when the rule has none.
  const zone = rule.tz;
  const anchor = wallOf(new Date(anchorInput), zone);
  const at = (y: number, m0: number, d: number) =>
    instantOf(new Date(Date.UTC(y, m0, d, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds())), zone);
  const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const n = Math.max(1, rule.interval);

  if (rule.freq === "WEEK" && rule.weekdays && rule.weekdays.length > 0) {
    const days = Array.from(new Set(rule.weekdays)).sort((a, b) => a - b);
    // Monday of the anchor's week, there. Week offsets count from here.
    const anchorDow = anchor.getUTCDay() === 0 ? 7 : anchor.getUTCDay();
    const monday = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - (anchorDow - 1)));
    let w = 0, i = 0;
    return () => {
      const d = at(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + w * 7 + (days[i] - 1));
      i++;
      if (i >= days.length) { i = 0; w += n; }
      return d;
    };
  }
  if (rule.freq === "MONTH" && rule.monthDay != null) {
    const wanted = Math.min(31, Math.max(1, rule.monthDay));
    let k = 0;
    return () => {
      const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + k, 1));
      k += n;
      const y = first.getUTCFullYear(), m0 = first.getUTCMonth();
      return at(y, m0, Math.min(wanted, daysIn(y, m0)));
    };
  }
  if (rule.freq === "YEAR" && rule.yearMonth != null) {
    const m0 = Math.min(12, Math.max(1, rule.yearMonth)) - 1;
    const wanted = rule.yearDay != null ? Math.min(31, Math.max(1, rule.yearDay)) : anchor.getUTCDate();
    let k = 0;
    return () => {
      const y = anchor.getUTCFullYear() + k;
      k += n;
      return at(y, m0, Math.min(wanted, daysIn(y, m0)));
    };
  }
  // Legacy grid: the anchor itself, then plain interval steps.
  let cur: Date | null = null;
  return () => {
    cur = cur === null ? new Date(anchorInput) : advanceDate(cur, rule);
    return new Date(cur);
  };
}

/** The next `count` occurrences strictly after `fromDate` (which doubles as
 *  the series anchor). Pure — drives both the engine and unit smoke tests. */
export function nextOccurrences(rule: RecurrenceRule, fromDate: Date | string, count: number): Date[] {
  const anchor = new Date(fromDate);
  const next = makeOccurrenceIterator(rule, anchor);
  const out: Date[] = [];
  for (let i = 0; i < MAX_STEPS && out.length < count; i++) {
    const d = next();
    if (d.getTime() > anchor.getTime()) out.push(d);
  }
  return out;
}

/** First occurrence of the series (anchored at `anchor`) strictly after
 *  `after`. Seeds recurNextAt and re-arms the cron after each spawn batch. */
export function nextOccurrenceAfter(after: Date | string, rule: RecurrenceRule, anchor: Date | string): Date {
  const cutoff = new Date(after).getTime();
  const next = makeOccurrenceIterator(rule, new Date(anchor));
  let d = new Date(anchor);
  for (let i = 0; i < MAX_STEPS; i++) {
    d = next();
    if (d.getTime() > cutoff) return d;
  }
  return applyTimeOfDay(advanceDate(d, rule), rule); // unreachable in practice; keeps the result monotonic
}

export interface OccurrenceBatch {
  /** Occurrences to spawn now, chronological. At most `cap`. */
  spawn: { key: string; date: Date }[];
  /** Occurrence keys collapsed by the catch-up cap (oldest first). */
  skipped: string[];
}

/**
 * All occurrences due for spawning: on the rule's grid (anchored at
 * `anchorDue`), at or after `from` (the claimed recurNextAt), strictly after
 * `afterKey` (the last handled occurrence key, when recorded), and not after
 * `now`. When more than `cap` are due (cron outage catch-up), the most recent
 * `cap` spawn and the older ones are returned as `skipped` keys.
 */
export function occurrencesSince(
  rule: RecurrenceRule,
  anchorDue: Date | string,
  afterKey: string | null,
  from: Date | string,
  now: Date = new Date(),
  cap = 7,
): OccurrenceBatch {
  const fromT = new Date(from).getTime();
  const nowT = now.getTime();
  const next = makeOccurrenceIterator(rule, new Date(anchorDue));
  const eligible: { key: string; date: Date }[] = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    const d = next();
    if (d.getTime() > nowT) break; // grid is monotonic
    if (d.getTime() < fromT) continue;
    const key = occurrenceKey(d, rule.tz);
    if (afterKey && key <= afterKey) continue;
    eligible.push({ key, date: d });
    if (eligible.length >= 400) break; // sanity ceiling
  }
  if (eligible.length <= cap) return { spawn: eligible, skipped: [] };
  return {
    spawn: eligible.slice(eligible.length - cap),
    skipped: eligible.slice(0, eligible.length - cap).map((e) => e.key),
  };
}

function ordinal(nth: number): string {
  const r10 = nth % 10, r100 = nth % 100;
  const suffix = r100 >= 11 && r100 <= 13 ? "th" : r10 === 1 ? "st" : r10 === 2 ? "nd" : r10 === 3 ? "rd" : "th";
  return `${nth}${suffix}`;
}

/** Plain-English summary of a rule, e.g. "Repeats every day at 9:00 AM",
 *  "Repeats every 2 weeks on Mon, Thu at 6:30 PM", "Repeats monthly on the
 *  15th · ends Dec 31, 2026", "Repeats yearly on Aug 8 · 12 times". The
 *  " at …" part appears only when the rule carries an explicit atTime. Shown
 *  live in the Repeat tab and as the recurrence badge tooltip. */
export function buildRecurrenceSummary(rule: RecurrenceRule): string {
  const n = Math.max(1, rule.interval);
  let s: string;
  switch (rule.freq) {
    case "DAY":
      s = n === 1 ? "Repeats every day" : `Repeats every ${n} days`;
      break;
    case "WEEK": {
      s = n === 1 ? "Repeats weekly" : `Repeats every ${n} weeks`;
      if (rule.weekdays && rule.weekdays.length > 0) {
        const names = Array.from(new Set(rule.weekdays)).sort((a, b) => a - b).map((w) => WEEKDAY_SHORT[w - 1]);
        s += ` on ${names.join(", ")}`;
      }
      break;
    }
    case "MONTH":
      s = n === 1 ? "Repeats monthly" : `Repeats every ${n} months`;
      if (rule.monthDay != null) s += ` on the ${ordinal(rule.monthDay)}`;
      break;
    case "QUARTER":
      s = n === 1 ? "Repeats quarterly" : `Repeats every ${n} quarters`;
      break;
    case "YEAR":
      s = n === 1 ? "Repeats yearly" : `Repeats every ${n} years`;
      if (rule.yearMonth != null) s += ` on ${MONTH_SHORT[rule.yearMonth - 1]} ${rule.yearDay ?? 1}`;
      break;
  }
  const t = rule.atTime ? AT_TIME_RE.exec(rule.atTime) : null;
  if (t) {
    const when = new Date(2000, 0, 1, Number(t[1]), Number(t[2]));
    s += ` at ${when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }
  if (rule.forever === false) {
    const end = rule.until ? new Date(rule.until) : null;
    if (end && !Number.isNaN(end.getTime())) {
      s += ` · ends ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    } else if (typeof rule.count === "number" && rule.count > 0) {
      s += ` · ${rule.count} ${rule.count === 1 ? "time" : "times"}`;
    }
  }
  return s;
}

/** Back-compat alias — existing imports keep compiling. */
export function describeRecurrence(rule: RecurrenceRule): string {
  return buildRecurrenceSummary(rule);
}
