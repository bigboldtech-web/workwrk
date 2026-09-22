// Hours in, hours out. The one place the Planner unit turns what a person
// typed into minutes, and minutes back into the "h:mm" the naming canon
// fixes for Timesheets, Clock and the task Time tracker
// (docs/plans/ui-refresh/spec-planner.md section 1, Naming canon:
// "Hours render as h:mm everywhere in this unit ... Inputs accept 1:30,
// 1.5, 90m").
//
// Pure: no imports, no Date, no locale. Safe in a vitest node run and on
// both sides of the wire. Minutes are the storage unit here because the
// database column is Decimal(5,2) hours and going through minutes is what
// stops 1:20 from becoming 1.33 and back to 1:19.

/** Upper bound for a single entry, from POST /api/time-entries. */
export const MAX_ENTRY_MINUTES = 24 * 60;

/**
 * Parse what a person typed into whole minutes.
 *
 * Accepted, in the order they are tried:
 *   "1:30"   colon form, minutes clamped to 0..59
 *   "1h30"   / "1h 30m" / "1h" / "30m"   unit form
 *   "1.5"    / "1,5"    decimal hours
 *   "90m"    minutes
 *   "0"      zero is a legal input and a legal value
 *
 * Returns null for anything it cannot read, including a negative number,
 * so a caller can tell "nothing typed yet" from "typed something wrong"
 * by checking the raw string itself.
 */
export function parseHoursInput(raw: string): number | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;

  // "1:30" or ":30"
  const colon = /^(\d*):([0-5]?\d)$/.exec(s);
  if (colon) {
    const h = colon[1] === "" ? 0 : Number(colon[1]);
    const m = Number(colon[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  // "1h30m", "1h30", "1h", "30m"
  const unit = /^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+)m?)?$/.exec(s);
  if (unit && (unit[1] || unit[2]) && /[hm]/.test(s)) {
    const h = unit[1] ? Number(unit[1].replace(",", ".")) : 0;
    const m = unit[2] ? Number(unit[2]) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return Math.round(h * 60 + m);
  }

  // Bare decimal hours: "1.5", "1,5", "2"
  const dec = /^(\d+(?:[.,]\d+)?)$/.exec(s);
  if (dec) {
    const h = Number(dec[1].replace(",", "."));
    if (!Number.isFinite(h) || h < 0) return null;
    return Math.round(h * 60);
  }

  return null;
}

/** Whole minutes as "h:mm". Negative input reads as zero, never as "-0:30". */
export function formatHm(minutes: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Decimal hours (what TimeEntry.hours stores) as "h:mm". */
export function hoursToHm(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(Number(hours))) return "0:00";
  return formatHm(Math.round(Number(hours) * 60));
}

/** Whole minutes as the decimal hours the column stores, to 2 places. */
export function minutesToHours(minutes: number): number {
  return Math.round((Math.max(0, minutes) / 60) * 100) / 100;
}

/**
 * An elapsed duration as "h:mm:ss", for a running clock. Durations are the
 * same number in every time zone, which is why this takes milliseconds and
 * never a Date.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(ms) ? ms : 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * "2026-09-07" for a Date, read in UTC.
 *
 * The timesheet week and day are both anchored at 00:00 UTC
 * (src/lib/timesheet-week.ts says why), so the key of a stored row is its
 * UTC calendar date and never the viewer's. Formatting that key for a
 * human is a separate job and belongs to src/lib/format/date.ts.
 */
export function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * "2026-09-21" for an instant, read in a named IANA zone.
 *
 * WHY THIS EXISTS. The day column is a UTC midnight instant, and until now
 * the only way a punch got one was `dayStartUTC(new Date())`, which is the
 * SERVER's calendar day. For anybody west of UTC that files an evening
 * session under tomorrow: a clock-in at 20:19 in New York is 00:19 UTC, so
 * "Today" on the Clock page listed sessions whose times beside them read as
 * last night, and a Today total could exceed 24 hours (audit T-7, TC-4).
 *
 * spec-planner section 2 /planner: "every date bucket is computed in this
 * zone, on the server, from the IANA name". This is that computation.
 * An absent or unusable zone falls back to UTC, which is exactly the old
 * behaviour, so a person with no zone preference sees no change.
 */
export function dayKeyInZone(d: Date, zone: string | null | undefined): string {
  if (!zone) return utcDayKey(d);
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
    const key = `${parts.year}-${parts.month}-${parts.day}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : utcDayKey(d);
  } catch {
    // An unknown zone name is a preference the product should survive, not
    // a reason to refuse a clock-in.
    return utcDayKey(d);
  }
}

/**
 * The UTC midnight instant the day column stores for the calendar day this
 * instant falls on IN `zone`. The pair to dayKeyInZone.
 */
export function dayStartInZone(d: Date, zone: string | null | undefined): Date {
  return utcDayFromKey(dayKeyInZone(d, zone)) ?? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Read a "YYYY-MM-DD" the client sent back into the UTC midnight instant the
 * day column stores. Returns null on anything else, including "2026-13-01",
 * so a bad `?week=` is a 400 rather than an Invalid Date that silently
 * becomes the epoch.
 */
export function utcDayFromKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const out = new Date(Date.UTC(y, mo - 1, d));
  // Rejects 2026-02-31, which Date.UTC would roll forward to 3 March.
  if (out.getUTCMonth() !== mo - 1 || out.getUTCDate() !== d) return null;
  return out;
}
