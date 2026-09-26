// The two time triggers (registry-triggers task.date_arrives and
// schedule.every), as pure date arithmetic the schedule cron and the tests
// share. Times are read in the server's own calendar, the same calendar the
// usage meter counts months in; the builder names that zone beside the time.
//
//   schedule.every     when = { every: day | weekday | week | month,
//                       at: "HH:MM", weekday: 0..6 (Sunday 0),
//                       monthDay: 1..28 }
//   task.date_arrives  when = { dateField: dueAt | startAt,
//                       offsetDays: -30..30 } (negative = days before)
//
// The cron runs every few minutes and fires what came due inside a look-back
// window, never older: a server that was down for a day does not replay a
// day of "every morning" runs when it comes back. Each fire carries the
// scheduled instant as its event time, so the engine's idempotency key
// collapses a second tick that sees the same instant.

export const SCHEDULE_LOOKBACK_MS = 2 * 60 * 60 * 1000;

export type Every = "day" | "weekday" | "week" | "month";

export interface ScheduleWhen {
  every: Every;
  hour: number;
  minute: number;
  weekday: number;
  monthDay: number;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The schedule options a definition carries, with defaults (every day at 09:00). */
export function readScheduleWhen(when: unknown): ScheduleWhen {
  const w = asRecord(when);
  const every: Every = w.every === "weekday" || w.every === "week" || w.every === "month" ? w.every : "day";
  const m = typeof w.at === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(w.at) : null;
  const weekday = typeof w.weekday === "number" && Number.isInteger(w.weekday) && w.weekday >= 0 && w.weekday <= 6 ? w.weekday : 1;
  const monthDay = typeof w.monthDay === "number" && Number.isInteger(w.monthDay) && w.monthDay >= 1 && w.monthDay <= 28 ? w.monthDay : 1;
  return { every, hour: m ? Number(m[1]) : 9, minute: m ? Number(m[2]) : 0, weekday, monthDay };
}

function matchesDay(s: ScheduleWhen, d: Date): boolean {
  if (s.every === "day") return true;
  if (s.every === "weekday") return d.getDay() >= 1 && d.getDay() <= 5;
  if (s.every === "week") return d.getDay() === s.weekday;
  return d.getDate() === s.monthDay;
}

/** The most recent scheduled instant at or before `now` (looks back up to 32 days). */
export function lastScheduledAt(when: unknown, now: Date): Date | null {
  const s = readScheduleWhen(when);
  for (let back = 0; back <= 32; back++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, s.hour, s.minute, 0, 0);
    if (d.getTime() > now.getTime()) continue;
    if (matchesDay(s, d)) return d;
  }
  return null;
}

/**
 * Should the cron fire this schedule now? Only for an instant inside the
 * look-back window and after the automation went live (a workflow published
 * at 10:00 does not fire for 09:00 the same morning).
 */
export function dueScheduleInstant(when: unknown, now: Date, liveSince: Date | null): Date | null {
  const at = lastScheduledAt(when, now);
  if (!at) return null;
  if (now.getTime() - at.getTime() > SCHEDULE_LOOKBACK_MS) return null;
  if (liveSince && at.getTime() < liveSince.getTime()) return null;
  return at;
}

export interface DateArrivesWhen {
  dateField: "dueAt" | "startAt";
  offsetDays: number;
  /** Also fire for finished tasks (a Done-group status). Off unless asked for. */
  includeDone: boolean;
}

export function readDateArrivesWhen(when: unknown): DateArrivesWhen {
  const w = asRecord(when);
  const offset = typeof w.offsetDays === "number" && Number.isInteger(w.offsetDays) ? Math.max(-30, Math.min(30, w.offsetDays)) : 0;
  return { dateField: w.dateField === "startAt" ? "startAt" : "dueAt", offsetDays: offset, includeDone: w.includeDone === true };
}

/**
 * The range of task dates whose moment (date + offset) arrived inside the
 * look-back window: [from, to). A task due tomorrow with "1 day before"
 * arrives now, so its date is one day AFTER the window.
 */
export function dateArrivesRange(when: unknown, now: Date, liveSince: Date | null): { from: Date; to: Date; offsetMs: number } {
  const w = readDateArrivesWhen(when);
  const offsetMs = w.offsetDays * 86_400_000;
  let start = now.getTime() - SCHEDULE_LOOKBACK_MS;
  if (liveSince && liveSince.getTime() > start) start = liveSince.getTime();
  // fireAt = date + offset, so date = fireAt - offset.
  return { from: new Date(start - offsetMs), to: new Date(now.getTime() - offsetMs + 1), offsetMs };
}

/** "Every weekday at 09:00", "On the 1st of every month at 08:30". */
export function scheduleWords(when: unknown): string {
  const s = readScheduleWhen(when);
  const time = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (s.every === "weekday") return `Every weekday at ${time}`;
  if (s.every === "week") return `Every ${DAYS[s.weekday]} at ${time}`;
  if (s.every === "month") {
    const n = s.monthDay;
    const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
    return `On the ${n}${suffix} of every month at ${time}`;
  }
  return `Every day at ${time}`;
}

/** "On the due date", "2 days before the start date". */
export function dateArrivesWords(when: unknown): string {
  const w = readDateArrivesWhen(when);
  const field = w.dateField === "startAt" ? "start date" : "due date";
  if (w.offsetDays === 0) return `On the ${field}`;
  const n = Math.abs(w.offsetDays);
  return `${n} day${n === 1 ? "" : "s"} ${w.offsetDays < 0 ? "before" : "after"} the ${field}`;
}
