// Routines: one AI teammate run on a schedule for one person, its report
// posted into that person's chat with it (docs/plans/ai-teammates.md 3.9).
// This is the pure half: the schedule a routine is saved with, the rule that
// it runs at most once an hour, the limits, and the words for why a routine
// paused or skipped. The runner is routines-server.ts.
//
// THE SCHEDULE IS AN AGENT SCHEDULE. A routine stores the same text an
// agent's scheduleCron does, so computeNextRunAt (autonomous.ts) reads it and
// the words (describeSchedule, wordsInZone), the picker and the next-run
// maths are the ones /agents already uses: a CRON_TZ= cron in the person's
// own zone, "hourly" or "every N hours".
//
// AT MOST ONCE AN HOUR. Every run spends one AI question, so a routine every
// five minutes could use up a Starter workspace's 50 questions in about four
// hours. isValidSchedule lets an agent run every five minutes; a routine
// refuses every "every N minutes", and any cron that names more than one
// minute of the hour.

import { isValidTimeZone } from "@/lib/reports/schedule";
import { nextCronRun, parseCron, splitScheduleZone, withScheduleZone } from "./cron";
import { isValidSchedule } from "./schedule-words";

export const ROUTINE_LIMITS = {
  /** Routines one person may have with one teammate. */
  perTeammate: 10,
  /** Routines one person may have across every teammate. */
  perPerson: 30,
  nameMax: 80,
  promptMax: 4000,
  /** "every N hours" takes N from 1 to this. */
  everyHoursMax: 24,
} as const;

/** A slot the scheduler reaches later than this is skipped ("missed"), not run late. */
export const ROUTINE_STALE_MS = 3 * 60 * 60 * 1000;

export const ROUTINE_SCHEDULE_KINDS = ["weekdays", "daily", "weekly", "monthly", "hourly", "every_hours"] as const;

export type RoutineScheduleKind = (typeof ROUTINE_SCHEDULE_KINDS)[number];

/** A schedule as create_routine takes it, in the person's own zone. */
export interface RoutineScheduleInput {
  kind: RoutineScheduleKind;
  /** "HH:MM" on a 24-hour clock: weekdays, daily, weekly and monthly. */
  time?: string;
  /** ISO weekday, 1 Monday to 7 Sunday: weekly. */
  weekday?: number;
  /** Day of the month, 1 to 28 so every month has it: monthly. */
  day?: number;
  /** every_hours: 1 to 24. */
  hours?: number;
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function intIn(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

/**
 * The schedule text a routine is saved with, or null when the input does not
 * name one (no time, a weekday of 0, the 31st). A clock time is the person's
 * own: the cron leads with CRON_TZ=<zone>, and a zone that is not a real one
 * falls back to UTC, named, rather than to whatever clock the server runs on.
 */
export function routineScheduleFrom(input: RoutineScheduleInput, zone: string | null | undefined): string | null {
  if (input.kind === "hourly") return "hourly";
  if (input.kind === "every_hours") {
    if (!intIn(input.hours, 1, ROUTINE_LIMITS.everyHoursMax)) return null;
    return input.hours === 1 ? "every 1 hour" : `every ${input.hours} hours`;
  }
  const t = TIME.exec((input.time ?? "").trim());
  if (!t) return null;
  const at = `${Number(t[2])} ${Number(t[1])}`;
  let cron: string;
  if (input.kind === "weekdays") cron = `${at} * * 1-5`;
  else if (input.kind === "daily") cron = `${at} * * *`;
  else if (input.kind === "weekly") {
    if (!intIn(input.weekday, 1, 7)) return null;
    // Cron counts Sunday as 0; ISO counts it as 7.
    cron = `${at} * * ${input.weekday === 7 ? 0 : input.weekday}`;
  } else if (input.kind === "monthly") {
    if (!intIn(input.day, 1, 28)) return null;
    cron = `${at} ${input.day} * *`;
  } else return null;
  return withScheduleZone(cron, isValidTimeZone(zone) ? zone : "UTC");
}

export type RoutineScheduleProblem = "invalid" | "too_often";

/**
 * Why a schedule cannot be a routine's, or null when it can: "invalid" when
 * the scheduler cannot read it (or it is every more than 24 hours), and
 * "too_often" when it would run more than once an hour.
 */
export function routineScheduleProblem(schedule: string | null | undefined, now: Date = new Date()): RoutineScheduleProblem | null {
  const s = (schedule ?? "").trim().toLowerCase();
  if (/^every\s+\d+\s+minutes?$/.test(s)) return "too_often";
  if (!isValidSchedule(schedule)) return "invalid";
  const hours = /^every\s+(\d+)\s+hours?$/.exec(s);
  if (hours) return Number(hours[1]) <= ROUTINE_LIMITS.everyHoursMax ? null : "invalid";
  if (["hourly", "@hourly", "daily", "@daily", "weekly", "@weekly"].includes(s)) return null;
  const cron = parseCron(schedule);
  if (!cron) return "invalid";
  if (cron.minutes.size !== 1) return "too_often";
  // A date that never comes within a year (a 31st of February) is no
  // schedule: the runner's hourly fallback would run it every hour (review
  // round 1).
  return schedule && nextCronRun(schedule, now) ? null : "invalid";
}

export type LegacyRoutineSchedule = { ok: true; schedule: string; changed: boolean } | { ok: false };

/**
 * The routine schedule an old Workspace agents schedule becomes when it moves
 * (legacy-schedules.ts; docs/plans/ai-teammates-phase2.md Decision 3), never
 * one that runs more often than it did: "every N minutes" becomes "hourly"
 * up to an hour and "every N hours" (rounded up) beyond,
 * a cron naming several minutes of the hour keeps only its first, and
 * anything a routine cannot run (every more than 24 hours, unreadable,
 * blank) is { ok: false }, so the schedule stops instead.
 */
export function legacyRoutineSchedule(schedule: string | null | undefined, now: Date = new Date()): LegacyRoutineSchedule {
  const raw = (schedule ?? "").trim();
  if (!raw) return { ok: false };
  const problem = routineScheduleProblem(raw, now);
  if (problem === null) return { ok: true, schedule: raw, changed: false };
  const minutes = /^every\s+(\d+)\s+minutes?$/i.exec(raw);
  if (minutes) {
    // Up to an hour becomes hourly; longer becomes every N hours, rounded
    // up, so it never runs more often than it did (review of step 2: "every
    // 1440 minutes" had become hourly, 24 times as often).
    const hours = Math.ceil(Number(minutes[1]) / 60);
    if (hours <= 1) return { ok: true, schedule: "hourly", changed: true };
    if (hours > ROUTINE_LIMITS.everyHoursMax) return { ok: false };
    return { ok: true, schedule: `every ${hours} hours`, changed: true };
  }
  if (problem !== "too_often") return { ok: false };
  const cron = parseCron(raw);
  if (!cron || cron.minutes.size < 2) return { ok: false };
  const { zone, body } = splitScheduleZone(raw);
  const fields = body.split(/\s+/);
  fields[0] = String(Math.min(...cron.minutes));
  const next = zone ? withScheduleZone(fields.join(" "), zone) : fields.join(" ");
  return routineScheduleProblem(next, now) === null ? { ok: true, schedule: next, changed: true } : { ok: false };
}

/** Why a routine paused or skipped a run (AgentRoutine.pausedReason, lastReason). */
export type RoutineReason =
  | "person_gone"
  | "guest"
  | "agent_account"
  | "ai_off"
  | "agent_removed"
  | "agent_paused"
  | "no_access"
  | "out_of_questions"
  | "person_free_used"
  | "free_ai_day"
  | "agent_cap"
  | "not_configured"
  | "ai_failed"
  | "no_answer"
  | "no_next_run"
  | "missed"
  | "teammate_changed";

export const ROUTINE_REASON_TEXT: Record<RoutineReason, string> = {
  person_gone: "The person it works for is no longer in the workspace.",
  guest: "A guest can't run routines.",
  agent_account: "An agent account can't run routines.",
  ai_off: "AI isn't available to the person it works for.",
  agent_removed: "This teammate was removed.",
  agent_paused: "This teammate is paused.",
  no_access: "The person it works for can no longer use this teammate.",
  out_of_questions: "This workspace has used all its AI questions. Resume it after the plan changes.",
  person_free_used: "The person it works for has used the free AI questions one person gets across free workspaces. Resume it after the plan changes.",
  free_ai_day: "Free AI reached its limit for today across WorkwrK, so this run was skipped. It runs again at its next time.",
  agent_cap: "This teammate has used its AI questions for the month.",
  not_configured: "AI isn't set up for this workspace yet.",
  ai_failed: "The AI service didn't answer.",
  no_answer: "The AI gave no usable answer, so nothing was done.",
  no_next_run: "Its schedule names no time in the next year. Change when it runs to start it again.",
  missed: "Skipped: the scheduler reached it more than three hours late.",
  teammate_changed: "Its teammate's settings changed since this routine was set up or last resumed, or it was set up before such changes were checked. Check the teammate, then resume the routine.",
};

export function isRoutineReason(v: unknown): v is RoutineReason {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ROUTINE_REASON_TEXT, v);
}

/** The sentence for a stored reason; null for one this code does not know. */
export function routineReasonText(reason: string | null | undefined): string | null {
  return isRoutineReason(reason) ? ROUTINE_REASON_TEXT[reason] : null;
}

/**
 * Why resolveActingPerson (src/lib/agents/acting.ts) refused the person a
 * routine works for: its ActingRefusal, spelled here so this file stays pure.
 */
export type PersonRefusal = "gone" | "inactive" | "guest" | "agent_account" | "ai_off";

const PERSON_REASON: Record<PersonRefusal, RoutineReason> = {
  // A deactivated person is gone as far as their routines are concerned.
  gone: "person_gone",
  inactive: "person_gone",
  guest: "guest",
  agent_account: "agent_account",
  ai_off: "ai_off",
};

/** The reason a routine pauses with when the person it works for is refused. */
export function routineReasonForPerson(refusal: PersonRefusal): RoutineReason {
  return PERSON_REASON[refusal];
}
