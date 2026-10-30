// One per-person budget for the counts a request triggers
// (docs/plans/recurring-goals.md C7, I; final review, privacy M2).
//
// Every one of these runs a full List or table count in the one Node
// process, a table's formula engine included: the target editor's preview,
// the first count of a source just connected or reconnected (the
// key-results POST and PATCH), and the goal page's Refresh. Each had its own
// limit or none, so one person could keep the process busy by alternating
// them. They now share ONE bucket per person, `goal-count:<userId>`, 30 a
// minute. The preview and Refresh are refused once it is spent (429, before
// anything is written); a save that connects a source never is (fixes
// review L4): the target is saved uncounted, and the cron or the next page
// open counts it. Refresh keeps its own limit too, per person and goal
// (refresh/route.ts).
//
// Per process, like every limiter of rate-limit-memory.ts (one pm2 instance).

import { rateLimit } from "@/lib/rate-limit-memory";

/** The shared budget: 30 counts a minute per person. */
export const GOAL_COUNT_RATE = { max: 30, windowMs: 60_000 } as const;

/** The 429's words, for every request the budget refuses. */
export const COUNTING_TOO_OFTEN = "You're counting too often. Try again in a minute.";

/** Take one count from this person's budget. False once it is spent for the minute. */
export function takeGoalCount(userId: string): boolean {
  return rateLimit(`goal-count:${userId}`, GOAL_COUNT_RATE).ok;
}
