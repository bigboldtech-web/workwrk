// Dates on a task, in the VIEWER's zone, pure.
//
// critic #13: `/api/me/work` bucketed from the server's local time, the bulk
// bar wrote UTC midnight, and every surface formatted with whatever
// `toLocaleDateString()` felt like — while `home.locale.{timezone,weekStart,
// dateFormat,timeFormat}` had been in the preferences schema the whole time
// with nothing reading it. spec-task-detail section 2 says every date this
// unit renders reads those keys and every write carries the viewer's zone.
//
// The rule for a WRITE, which is the half that loses data when it is wrong:
// a date picked in a calendar grid means midnight of that day WHERE THE
// VIEWER IS. `localDayIso` builds it from the zone's own offset rather than
// from `new Date(y, m, d)`, which uses the browser's zone and silently shifts
// a day for anyone who has set a different one.
//
// Pure module: no imports, so vitest loads it in the node environment.

export interface LocalePrefs {
  timezone?: string | null;
  /** 0 = Sunday .. 6 = Saturday. */
  weekStart?: number | null;
  /** An Intl-ish hint: "dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd", or absent. */
  dateFormat?: string | null;
  timeFormat?: "12h" | "24h" | null;
}

/** The zone to format and write in: the stored one, else the browser's. */
export function resolveZone(prefs: LocalePrefs | null | undefined): string | undefined {
  const tz = prefs?.timezone?.trim();
  if (tz) return tz;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** 0..6, defaulting to Monday, which is what a work week starts on here. */
export function resolveWeekStart(prefs: LocalePrefs | null | undefined): number {
  const w = prefs?.weekStart;
  return typeof w === "number" && w >= 0 && w <= 6 ? w : 1;
}

function parts(date: Date, zone: string | undefined): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** The calendar day a moment falls on IN THE VIEWER'S ZONE, as "YYYY-MM-DD". */
export function dayKeyInZone(value: Date | string, prefs?: LocalePrefs | null): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = parts(d, resolveZone(prefs));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * The ISO instant for a wall-clock time in the viewer's zone.
 *
 * `dayKey` is "YYYY-MM-DD"; `hh`/`mm` default to midnight. The offset is
 * measured by asking Intl what that instant reads as in the zone and closing
 * the gap, which is correct across DST because it uses the offset in force on
 * that day rather than today's.
 */
export function zonedIso(dayKey: string, hh = 0, mm = 0, prefs?: LocalePrefs | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey.trim());
  if (!m) return null;
  const zone = resolveZone(prefs);
  const wanted = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm, 0, 0);
  if (!zone) return new Date(wanted).toISOString();
  // First guess: treat the wall clock as UTC, then correct by the difference
  // between what the zone reads at that instant and what we asked for.
  let guess = wanted;
  for (let i = 0; i < 2; i += 1) {
    const p = parts(new Date(guess), zone);
    const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), 0, 0);
    const drift = wanted - seen;
    if (drift === 0) break;
    guess += drift;
  }
  return new Date(guess).toISOString();
}

/** Midnight of a calendar day, in the viewer's zone, as an ISO instant. */
export function localDayIso(dayKey: string, prefs?: LocalePrefs | null): string | null {
  return zonedIso(dayKey, 0, 0, prefs);
}

function dateStyleOptions(prefs: LocalePrefs | null | undefined): Intl.DateTimeFormatOptions {
  const f = (prefs?.dateFormat ?? "").toLowerCase();
  if (f.includes("yyyy-mm-dd")) return { year: "numeric", month: "2-digit", day: "2-digit" };
  return { day: "numeric", month: "short" };
}

/**
 * A due or start date as the field strip shows it: "Fri 12 Sep", with the year
 * when it is not this one, and the time only when one was set.
 */
export function formatTaskDate(
  value: Date | string | null | undefined,
  prefs?: LocalePrefs | null,
  opts?: { withWeekday?: boolean; withTime?: boolean },
): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const zone = resolveZone(prefs);
  const thisYear = new Date().getFullYear();
  const yearOfValue = Number(parts(d, zone).year);
  const base: Intl.DateTimeFormatOptions = {
    timeZone: zone,
    ...dateStyleOptions(prefs),
    ...(opts?.withWeekday === false ? {} : { weekday: "short" }),
    ...(yearOfValue === thisYear ? {} : { year: "numeric" }),
  };
  let out = new Intl.DateTimeFormat(undefined, base).format(d);
  if (opts?.withTime) {
    const t = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hour12: (prefs?.timeFormat ?? "12h") === "12h",
    }).format(d);
    out = `${out}, ${t}`;
  }
  return out;
}

/** Does this moment carry a time of day, or is it a plain date? */
export function hasTimeOfDay(value: Date | string | null | undefined, prefs?: LocalePrefs | null): boolean {
  if (!value) return false;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const p = parts(d, resolveZone(prefs));
  return !(p.hour === "00" && p.minute === "00");
}

/** Is a due date in the past, measured by calendar day in the viewer's zone? */
export function isOverdue(due: Date | string | null | undefined, prefs?: LocalePrefs | null, now: Date = new Date()): boolean {
  if (!due) return false;
  const key = dayKeyInZone(due, prefs);
  if (!key) return false;
  return key < dayKeyInZone(now, prefs);
}

/** "just now", "12m ago", "3h ago", "2d ago", then the date. */
export function relativeTime(value: Date | string, prefs?: LocalePrefs | null, now: Date = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const diff = now.getTime() - d.getTime();
  if (diff < 0) return formatTaskDate(d, prefs);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatTaskDate(d, prefs, { withWeekday: false });
}
