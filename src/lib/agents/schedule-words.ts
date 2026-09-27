// An agent's schedule in words, for the Agents table and drawer. Mirrors the
// strings computeNextRunAt (src/lib/agents/autonomous.ts) understands: the
// keywords hourly, daily and weekly (with or without "@"), "every N minutes"
// / "every N hours", and a five-field cron (src/lib/agents/cron.ts), which is
// what the drawer's schedule picker writes. A cron with no simple reading is
// shown as typed, because it is what the person saved and hiding it would be
// worse than showing it.

import { parseCron, splitScheduleZone } from "./cron";

const WEEKDAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}

function only<T>(set: ReadonlySet<T>): T | null {
  return set.size === 1 ? [...set][0] : null;
}

/** "Weekdays at 9:00" for the cron shapes a person picks; null for the rest. */
export function cronWords(expr: string): string | null {
  const spec = parseCron(expr);
  if (!spec) return null;
  const minute = only(spec.minutes);
  const hour = only(spec.hours);
  if (minute === null || hour === null) return null;
  if (spec.months.size !== 12) return null;
  const at = `${hour}:${String(minute).padStart(2, "0")}`;
  if (!spec.daysRestricted && !spec.weekdaysRestricted) return `Every day at ${at}`;
  if (!spec.daysRestricted && spec.weekdaysRestricted) {
    const days = [...spec.weekdays].sort((a, b) => a - b);
    if (days.join(",") === "1,2,3,4,5") return `Weekdays at ${at}`;
    if (days.join(",") === "0,6") return `Weekends at ${at}`;
    if (days.length === 1) return `${WEEKDAY_PLURAL[days[0]]} at ${at}`;
    return null;
  }
  if (spec.daysRestricted && !spec.weekdaysRestricted) {
    const day = only(spec.days);
    if (day === null) return null;
    return `The ${ordinal(day)} of each month at ${at}`;
  }
  return null;
}

export function describeSchedule(schedule: string | null | undefined, enabled: boolean): string {
  if (!enabled || !schedule || !schedule.trim()) return "Not scheduled";
  const s = schedule.trim().toLowerCase();
  if (s === "hourly" || s === "@hourly") return "Every hour";
  if (s === "daily" || s === "@daily") return "Every day at 9:00";
  if (s === "weekly" || s === "@weekly") return "Every week at 9:00";
  const min = s.match(/^every\s+(\d+)\s+minute/);
  if (min) return Number(min[1]) === 1 ? "Every minute" : `Every ${Number(min[1])} minutes`;
  const hr = s.match(/^every\s+(\d+)\s+hour/);
  if (hr) return Number(hr[1]) === 1 ? "Every hour" : `Every ${Number(hr[1])} hours`;
  return cronWords(schedule) ?? splitScheduleZone(schedule).body;
}

/** "Kolkata time", "New York time", "UTC": a zone the way a person says it. */
const ZONE_ALIAS: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
};

export function zoneName(zone: string): string {
  if (zone === "UTC" || zone === "GMT" || zone.startsWith("Etc/")) return "UTC";
  const city = (ZONE_ALIAS[zone] ?? zone).split("/").pop() ?? zone;
  return `${city.replace(/_/g, " ")} time`;
}

/**
 * The zone a schedule's times are read in: its CRON_TZ= prefix, else the
 * server's clock (every schedule saved before the prefix, and the keywords).
 */
export function scheduleZone(schedule: string | null | undefined, serverZone: string): string {
  return splitScheduleZone(schedule).zone ?? serverZone;
}

/**
 * The words with the zone named when it is not the viewer's own, so a person
 * in New York never reads "Weekdays at 9:00" as their 9:00 when it is 9:00 in
 * Kolkata: "Weekdays at 9:00, Kolkata time". Schedules with no clock time
 * ("Every hour", "When you ask") are left as they are.
 */
export function wordsInZone(words: string, zone: string | null, viewerZone: string | null): string {
  if (!zone || !/\d:\d\d/.test(words)) return words;
  if (viewerZone && sameZone(zone, viewerZone)) return words;
  return `${words}, ${zoneName(zone)}`;
}

/** Whether two zone names are the same clock. */
export function sameZone(a: string, b: string): boolean {
  if (a === b) return true;
  // Two names for one clock (Asia/Calcutta and Asia/Kolkata) compare equal
  // when they agree on the offset now and six months from now.
  try {
    const at = (tz: string, t: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(t);
    const now = Date.now();
    const later = now + 182 * 24 * 60 * 60 * 1000;
    return at(a, now) === at(b, now) && at(a, later) === at(b, later);
  } catch {
    return false;
  }
}

/**
 * The Agents table's "Runs on" column (spec-ai-automation section 2): the
 * schedule in words, "When you ask" for an agent that only runs on demand.
 */
export function runsOnWords(schedule: string | null | undefined, autonomousEnabled: boolean): string {
  if (!autonomousEnabled) return "When you ask";
  if (!schedule || !schedule.trim()) return "No schedule set";
  return describeSchedule(schedule, true);
}

export type AgentState = "on" | "paused" | "needs-setup";

/**
 * The Status column: On, Paused, or Needs setup (the agent is set to run by
 * itself but has no schedule to run on).
 */
export function agentState(a: { status: string; autonomousEnabled: boolean; scheduleCron: string | null }): AgentState {
  if (a.status !== "ENABLED") return "paused";
  if (a.autonomousEnabled && !(a.scheduleCron ?? "").trim()) return "needs-setup";
  return "on";
}

/** The three presets the schedule picker offers before Custom. */
export const SCHEDULE_PRESETS: ReadonlyArray<{ key: "weekday" | "monday" | "month"; label: string; cron: string }> = [
  { key: "weekday", label: "Every weekday morning", cron: "0 9 * * 1-5" },
  { key: "monday", label: "Every Monday", cron: "0 9 * * 1" },
  { key: "month", label: "Every month start", cron: "0 9 1 * *" },
];

/** Which preset a saved schedule is, or "custom" for anything else. */
export function presetFor(schedule: string | null | undefined): "weekday" | "monday" | "month" | "custom" | null {
  const s = splitScheduleZone(schedule).body.replace(/\s+/g, " ");
  if (!s) return null;
  return SCHEDULE_PRESETS.find((p) => p.cron === s)?.key ?? "custom";
}

/**
 * Whether a schedule string is one the scheduler can read (computeNextRunAt):
 * the keywords, "every N minutes / hours" (N at least 5 minutes, so a typo
 * cannot fire an agent every minute), or a five-field cron. The schedule
 * API refuses anything else instead of silently running it hourly.
 */
export function isValidSchedule(schedule: string | null | undefined): boolean {
  const s = (schedule ?? "").trim().toLowerCase();
  if (!s) return false;
  if (["hourly", "@hourly", "daily", "@daily", "weekly", "@weekly"].includes(s)) return true;
  const min = s.match(/^every\s+(\d+)\s+minutes?$/);
  if (min) return Number(min[1]) >= 5 && Number(min[1]) <= 1440;
  const hr = s.match(/^every\s+(\d+)\s+hours?$/);
  if (hr) return Number(hr[1]) >= 1 && Number(hr[1]) <= 168;
  return parseCron(schedule) !== null;
}
