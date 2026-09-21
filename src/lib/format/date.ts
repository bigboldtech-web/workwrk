// The ONE date, size and count formatter (spec-docs-knowledge section 1,
// "Dates, times and numbers", critic #13).
//
// No route formats a date itself. Every "smart date", "Uploaded", "Edited",
// "When", "Date viewed" and tooltip goes through `formatDate(value, prefs)`,
// which reads `home.locale.dateFormat`, `.timeFormat` and `.timezone` from the
// effective preferences the caller hands it (client: `useDatePrefs()` in
// ./use-date-prefs.ts; server: getEffectivePreferences().home.locale).
//
// SMART DATE, DEFINED ONCE:
//   today                    the time            "14:05" / "2:05 PM"
//   the last seven days      the weekday         "Tue"
//   the current year         day and month       "12 Sep" / "Sep 12"
//   anything older           day, month, year    "12 Sep 2025" / "Sep 12, 2025"
// The exact date and time in the viewer's zone is the `title` tooltip on every
// one of them (`formatDateTitle`).
//
// `dateFormat` accepts the three canon words (DMY / MDY / YMD) and, because the
// locale settings page stores an Intl-ish hint ("dd/MM/yyyy", "MM/dd/yyyy",
// "yyyy-MM-dd"), those spellings too. Anything else reads as DMY, the order
// most of the world writes.
//
// Pure module: no imports, so vitest loads it in the node environment and the
// smart-date rule is provable with an injected `now`.

export interface DateFormatPrefs {
  timezone?: string | null;
  dateFormat?: string | null;
  timeFormat?: "12h" | "24h" | null;
  /** The BCP-47 tag Intl formats numbers with; absent = the runtime default. */
  language?: string | null;
}

export type DateOrder = "DMY" | "MDY" | "YMD";

export type DateStyle = "smart" | "date" | "datetime" | "time" | "weekday";

const DAY_MS = 86_400_000;

/** The three orders, from either the canon word or the settings page's hint. */
export function resolveDateOrder(prefs: DateFormatPrefs | null | undefined): DateOrder {
  const raw = (prefs?.dateFormat ?? "").trim();
  const f = raw.toLowerCase();
  if (f === "mdy" || f.startsWith("mm/") || f.startsWith("mm-")) return "MDY";
  if (f === "ymd" || f.startsWith("yyyy")) return "YMD";
  return "DMY";
}

function resolveZone(prefs: DateFormatPrefs | null | undefined): string | undefined {
  const tz = prefs?.timezone?.trim();
  if (tz) return tz;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function resolveLocale(prefs: DateFormatPrefs | null | undefined): string | undefined {
  const lang = prefs?.language?.trim();
  return lang || undefined;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Zone-aware calendar parts, `hourCycle: "h23"` so midnight reads 00 (see item-date.ts). */
function parts(date: Date, zone: string | undefined): { y: number; m: number; d: number; hh: number; mm: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  if (out.hour === "24") out.hour = "00";
  return { y: Number(out.year), m: Number(out.month), d: Number(out.day), hh: Number(out.hour), mm: Number(out.minute) };
}

/** "YYYY-MM-DD" in the viewer's zone; the unit the smart-date buckets compare. */
export function dayKey(value: Date | string | number, prefs?: DateFormatPrefs | null): string {
  const d = toDate(value);
  if (!d) return "";
  const p = parts(d, resolveZone(prefs));
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function dayNumber(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return NaN;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

function timeOptions(prefs: DateFormatPrefs | null | undefined): Intl.DateTimeFormatOptions {
  // 24h is always two digits ("09:05") whatever the locale's habit; 12h keeps
  // the natural "9:05 AM". h23 rather than hour12:false for the reason
  // item-date.ts records (Node 20's ICU answers "24" for midnight).
  return (prefs?.timeFormat ?? "12h") === "12h"
    ? { hour: "numeric", minute: "2-digit", hour12: true }
    : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
}

function dayMonthOptions(order: DateOrder, withYear: boolean): Intl.DateTimeFormatOptions {
  if (order === "YMD") return withYear ? { year: "numeric", month: "2-digit", day: "2-digit" } : { month: "short", day: "numeric" };
  return withYear ? { year: "numeric", month: "short", day: "numeric" } : { month: "short", day: "numeric" };
}

/**
 * Intl puts the month first under most locales for `{ month: "short", day }`.
 * The viewer chose an ORDER, so the day and month parts are assembled by hand
 * from `formatToParts`, which is the only way to honour DMY under an en-US
 * runtime (and MDY under an en-GB one).
 */
function dayMonth(d: Date, zone: string | undefined, locale: string | undefined, order: DateOrder, withYear: boolean): string {
  const fmt = new Intl.DateTimeFormat(locale, { timeZone: zone, ...dayMonthOptions(order, withYear) });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  const day = p.day ?? "";
  const month = p.month ?? "";
  const year = p.year ?? "";
  if (order === "YMD") return withYear ? `${year}-${month}-${day}` : `${month} ${day}`;
  if (order === "MDY") return withYear ? `${month} ${day}, ${year}` : `${month} ${day}`;
  return withYear ? `${day} ${month} ${year}` : `${day} ${month}`;
}

/**
 * The one date renderer. `style` defaults to the smart date; the others are
 * the fixed shapes a column header can promise ("date" = day month [year],
 * "datetime" = that plus the time, "time" = the time alone, "weekday").
 */
export function formatDate(
  value: Date | string | number | null | undefined,
  prefs?: DateFormatPrefs | null,
  style: DateStyle = "smart",
  now: Date = new Date(),
): string {
  const d = toDate(value);
  if (!d) return "";
  const zone = resolveZone(prefs);
  const locale = resolveLocale(prefs);
  const order = resolveDateOrder(prefs);
  const time = () => new Intl.DateTimeFormat(locale, { timeZone: zone, ...timeOptions(prefs) }).format(d);
  const weekday = () => new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "short" }).format(d);

  const thisYear = parts(now, zone).y;
  const sameYear = parts(d, zone).y === thisYear;

  if (style === "time") return time();
  if (style === "weekday") return weekday();
  if (style === "date") return dayMonth(d, zone, locale, order, !sameYear);
  if (style === "datetime") return `${dayMonth(d, zone, locale, order, !sameYear)} · ${time()}`;

  // smart
  const keyNow = dayKey(now, prefs);
  const keyThen = dayKey(d, prefs);
  if (keyThen === keyNow) return time();
  const delta = dayNumber(keyNow) - dayNumber(keyThen);
  if (delta > 0 && delta < 7) return weekday();
  return dayMonth(d, zone, locale, order, !sameYear);
}

/** The exact date and time in the viewer's zone: the `title` tooltip on every smart date. */
export function formatDateTitle(value: Date | string | number | null | undefined, prefs?: DateFormatPrefs | null): string {
  const d = toDate(value);
  if (!d) return "";
  const zone = resolveZone(prefs);
  const locale = resolveLocale(prefs);
  const order = resolveDateOrder(prefs);
  const time = new Intl.DateTimeFormat(locale, { timeZone: zone, ...timeOptions(prefs) }).format(d);
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "short" }).format(d);
  return `${weekday} ${dayMonth(d, zone, locale, order, true)} · ${time}`;
}

/** "just now", "12m ago", "3h ago", then the smart date. For "Edited {x}" meta lines. */
export function formatRelative(
  value: Date | string | number | null | undefined,
  prefs?: DateFormatPrefs | null,
  now: Date = new Date(),
): string {
  const d = toDate(value);
  if (!d) return "";
  const diff = now.getTime() - d.getTime();
  if (diff >= 0) {
    const mins = Math.round(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24 && dayKey(d, prefs) === dayKey(now, prefs)) return `${hours}h ago`;
  }
  return formatDate(d, prefs, "smart", now);
}

/** Bytes as the drive shows them: "0 B", "512 B", "1.2 KB", "3.4 MB", "1.1 GB". */
export function formatBytes(bytes: number | null | undefined, prefs?: DateFormatPrefs | null): string {
  const n = typeof bytes === "number" && Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const nf = new Intl.NumberFormat(resolveLocale(prefs), {
    maximumFractionDigits: i === 0 ? 0 : v < 10 ? 1 : 0,
    minimumFractionDigits: 0,
  });
  return `${nf.format(v)} ${units[i]}`;
}

/** Totals and counts, grouped per the viewer's locale: "1,284". */
export function formatCount(n: number | null | undefined, prefs?: DateFormatPrefs | null): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat(resolveLocale(prefs), { maximumFractionDigits: 0 }).format(v);
}
