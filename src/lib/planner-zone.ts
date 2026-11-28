// The Planner's zone rule (pen test 2026-11-28, V-41), in its own module
// because a route file may export only its handlers.
//
// Pure module.

/**
 * The zone the viewer reads the grid in: ?tz=, an IANA name the Planner sends
 * (its own resolved zone), else UTC, which is what a caller that sends none
 * always got.
 */
export function plannerZone(raw: string | null): string {
  const z = (raw ?? "").trim();
  if (!z || z.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return "UTC";
  }
}

/**
 * The calendar day an instant falls on in `zone`, and whether it is exactly
 * midnight there: a task date at midnight where the viewer is has no time of
 * day (src/lib/item-date.ts hasTimeOfDay, the rule the List Calendar, the
 * Table and My work read by). hourCycle h23, never hour12:false, which answers
 * "24" for midnight on Node 20.
 */
export function wallClockIn(d: Date, zone: string): { day: string; midnight: boolean } {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d)) p[x.type] = x.value;
  const hour = p.hour === "24" ? "00" : p.hour;
  return { day: `${p.year}-${p.month}-${p.day}`, midnight: hour === "00" && p.minute === "00" && p.second === "00" && d.getUTCMilliseconds() === 0 };
}

/**
 * The all-day reading of a task date for a grid drawn in `zone`: midnight in
 * that zone (the app's own rule, V-41), on that zone's day; null when the date
 * carries a time. Exactly midnight UTC is NOT read as all-day (the final
 * review): it is 5 PM in Los Angeles in summer, the date picker's own default,
 * and 7 PM in New York in winter. Dates the Gantt wrote at UTC midnight before
 * V-41 therefore show with their time outside UTC.
 */
export function allDayKey(d: Date, zone: string): string | null {
  const wall = wallClockIn(d, zone);
  return wall.midnight ? wall.day : null;
}
