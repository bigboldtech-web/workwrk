// The next-run reader every schedule uses (docs/plans/ai-teammates-phase2.md).
//
// The old autonomous loop stopped in Phase 2: it ran a scheduled Workspace
// agent as whoever it could find (the first admin, at worst) and ran every
// tool with no card. Its schedules are routines now (legacy-schedules.ts), and
// Run now is a chat turn of the person who clicks. computeNextRunAt is the
// one next-run reader every schedule uses: routines, and the words and the
// next-run column of Workspace agents.

import { nextCronRun } from "@/lib/agents/cron";

export type AutonomousTrigger = "MANUAL" | "SCHEDULED";

/**
 * Compute the next run time given a schedule string: the keywords
 * "hourly", "daily", "weekly", "every <N> minutes", "every <N> hours", and
 * a five-field cron (src/lib/agents/cron.ts), which is what the Agents
 * drawer's schedule picker writes ("0 9 * * 1-5" is every weekday at 9:00).
 * Anything else runs an hour out, so a bad string never fire-loops.
 */
export function computeNextRunAt(schedule: string, from: Date = new Date()): Date {
  const s = schedule.trim().toLowerCase();
  const now = new Date(from);

  // Simple keywords first — these cover 90% of org usage.
  if (s === "hourly" || s === "@hourly") return new Date(now.getTime() + 60 * 60 * 1000);
  if (s === "daily" || s === "@daily") {
    const next = new Date(now);
    next.setDate(now.getDate() + 1);
    next.setHours(9, 0, 0, 0); // 9am next day
    return next;
  }
  if (s === "weekly" || s === "@weekly") {
    const next = new Date(now);
    next.setDate(now.getDate() + 7);
    next.setHours(9, 0, 0, 0);
    return next;
  }

  // "every N minutes" / "every N hours"
  const everyMin = s.match(/^every\s+(\d+)\s+minute/);
  if (everyMin) return new Date(now.getTime() + parseInt(everyMin[1], 10) * 60 * 1000);
  const everyHr = s.match(/^every\s+(\d+)\s+hour/);
  if (everyHr) return new Date(now.getTime() + parseInt(everyHr[1], 10) * 60 * 60 * 1000);

  // A five-field cron: its next matching minute on the server's clock.
  const cron = nextCronRun(schedule, now);
  if (cron) return cron;

  // Unknown schedule — default to one hour out so a bad string doesn't
  // cause a fire-loop.
  return new Date(now.getTime() + 60 * 60 * 1000);
}
