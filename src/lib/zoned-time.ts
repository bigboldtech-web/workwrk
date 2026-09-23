// Wall clock in a named time zone, to and from the UTC instant it means.
//
// WHY THIS EXISTS. The announcement composer asks two questions that only
// make sense in somebody's own zone: "publish this on 12 September at 09:00"
// and "stop showing it after 30 November". Before Phase 4 both were turned
// into instants by string surgery: the expiry was built as
// `new Date(yyyy-mm-dd + "T23:59:59.999Z")`, which is 23:59 UTC, so a post
// scheduled to expire on the 30th in Mumbai vanished at 05:29 on the 1st,
// and a reader in Los Angeles still saw it most of the day after.
//
// The rule spec-talk section 1 (Dates and times) sets is one sentence: every
// instant is stored UTC, every picker reads and writes the viewer's zone, and
// the cron compares instants and never local strings. That needs exactly one
// primitive, and this is it.
//
// NO IMPORTS, on purpose: the API routes, the composer and vitest's node
// environment all read this.
//
// Only Intl is used, so there is no tz database to ship and no dependency to
// keep current. `hourCycle: "h23"` and NOT `hour12: false`: on Node 20 the
// latter formats midnight as hour "24", which silently moved every date a day
// early in production once already.

/** A yyyy-mm-dd calendar day, as the date pickers hand it over. */
export type DateKey = string;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^(\d{1,2}):(\d{2})$/;

/**
 * The offset of `zone` at `instant`, in minutes east of UTC (Kolkata is +330).
 * Returns 0 for an unknown zone rather than throwing, so a stale preference
 * degrades to UTC instead of breaking a save.
 */
export function zoneOffsetMinutes(zone: string | undefined | null, instant: Date): number {
  if (!zone) return 0;
  let f: Intl.DateTimeFormat;
  try {
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
  } catch {
    return 0;
  }
  const map: Record<string, string> = {};
  for (const p of f.formatToParts(instant)) map[p.type] = p.value;
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  // Whole minutes: every zone in the database is a whole number of minutes,
  // and rounding here keeps a sub-second formatting wobble out of the result.
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * The UTC instant that a wall clock reading in `zone` names.
 *
 * Two passes, because the offset itself depends on the instant: guess with the
 * offset at the naive UTC reading, then re-measure at the guess. That settles
 * every case except the one hour that does not exist on a spring-forward day,
 * where the second pass lands on the hour after, which is the same choice the
 * platform date pickers make.
 */
export function zonedWallClockToUtc(
  dateKey: DateKey,
  timeHhmm: string,
  zone: string | undefined | null,
): Date | null {
  const dm = DATE_KEY.exec(dateKey ?? "");
  if (!dm) return null;
  const tm = HHMM.exec(timeHhmm ?? "");
  if (!tm) return null;
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);
  if (hh > 23 || mm > 59) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  const naive = Date.UTC(y, mo - 1, d, hh, mm, 0, 0);
  const pass1 = naive - zoneOffsetMinutes(zone, new Date(naive)) * 60000;
  const pass2 = naive - zoneOffsetMinutes(zone, new Date(pass1)) * 60000;
  const out = new Date(pass2);
  return Number.isNaN(out.getTime()) ? null : out;
}

/**
 * The last instant of `dateKey` in `zone`: 23:59:59.999 local.
 *
 * This is what "Expires 30 Nov" means to the person who typed it. Stored UTC,
 * compared as an instant, so everybody in the audience loses the post at the
 * same moment and that moment is the end of the author's 30th.
 */
export function endOfZonedDay(dateKey: DateKey, zone: string | undefined | null): Date | null {
  const start = zonedWallClockToUtc(dateKey, "23:59", zone);
  if (!start) return null;
  return new Date(start.getTime() + 59_999);
}

/** The yyyy-mm-dd `dateKey` of an instant, read in `zone`. */
export function zonedDateKey(instant: Date, zone: string | undefined | null): DateKey {
  const off = zoneOffsetMinutes(zone, instant);
  const shifted = new Date(instant.getTime() + off * 60000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The HH:mm wall-clock reading of an instant in `zone`, 24 hour. */
export function zonedHhmm(instant: Date, zone: string | undefined | null): string {
  const off = zoneOffsetMinutes(zone, instant);
  const shifted = new Date(instant.getTime() + off * 60000);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * The short zone name to print beside a scheduled time when the viewer's zone
 * differs from the organization's, so "09:00 IST" states which 09:00 it is.
 * Empty when the two agree or when either is unknown: a label nobody needs is
 * noise, and a label nobody can read is worse.
 */
export function zoneAbbreviation(zone: string | undefined | null, instant: Date): string {
  if (!zone) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(instant);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** Should a scheduled time print its zone? Only when the two zones differ. */
export function needsZoneSuffix(
  viewerZone: string | undefined | null,
  orgZone: string | undefined | null,
): boolean {
  if (!viewerZone || !orgZone) return false;
  return viewerZone !== orgZone;
}
