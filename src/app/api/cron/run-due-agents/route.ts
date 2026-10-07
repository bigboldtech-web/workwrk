// POST /api/cron/run-due-agents
//
// Cron-tickable endpoint, call this from Vercel Cron, a server cron, or any
// scheduler. Each tick, in this order:
//   1. AI teammates' approval requests nobody answered in time expire, and
//      one stuck running is failed (src/lib/agents/actions.ts sweepActions).
//   2. AI teammates' routines that are due run, each slot claimed once
//      (src/lib/agents/routines-server.ts processDueRoutines), within their
//      own budget: they are time-sensitive (a 9:00 brief), so they go first.
//   3. Old Workspace agents schedules become routines
//      (src/lib/agents/legacy-schedules.ts convertLegacySchedules): each one
//      its creator's routine, or stopped with the reason shown, never run as
//      anyone else. The old autonomous loop, which ran them as the first
//      admin it found and ran every tool with no card, is gone
//      (docs/plans/ai-teammates-phase2.md step 2).
// Each step is its own: one that throws is logged and fails the tick, and the
// steps after it still run. The body is counts only: no workspace, teammate
// or person is named (docs/plans/ai-teammates.md 3.9).
//
// Auth: the shared cron door (src/lib/cron-auth.ts): CRON_SECRET in
// `x-cron-secret` or `Authorization: Bearer`, fail-closed, constant time.
// It used to fall through to ANY signed-in admin when the header did not
// match, and the query below is not scoped to one workspace, so a customer
// workspace's admin could fire every workspace's due agents. Locally, set
// CRON_SECRET for the dev server and send it.

import { sweepActions } from "@/lib/agents/actions";
import { convertLegacySchedules, type LegacyScheduleCounts } from "@/lib/agents/legacy-schedules";
import { processDueRoutines, type DueRoutineCounts } from "@/lib/agents/routines-server";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob, cronResult } from "@/lib/cron-result";

/** AI teammate routines: 20 a tick, 4 at a time, none started after 180 seconds. */
const ROUTINE_RUNNER = { limit: 20, budgetMs: 180_000, concurrency: 4 } as const;

/** Old schedules moved per tick: each is one read of its creator and one transaction. */
const LEGACY_MOVER = { limit: 100 } as const;

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

async function handle(req: Request) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const now = new Date();
  let stepsFailed = 0;

  // 1. Requests past their time expire; a run stuck RUNNING fails.
  let actions: { expired: number; stuck: number } | null = null;
  try {
    actions = await sweepActions(now);
  } catch (err) {
    stepsFailed += 1;
    console.error(`[cron-failure] run-due-agents: the approval sweep threw: ${errorLine(err)}`);
  }

  // 2. Due routines, first of the work and within their own budget.
  let routines: DueRoutineCounts | null = null;
  try {
    routines = await processDueRoutines(now, ROUTINE_RUNNER);
  } catch (err) {
    stepsFailed += 1;
    console.error(`[cron-failure] run-due-agents: the routine runner threw: ${errorLine(err)}`);
  }

  // 3. Old Workspace agents schedules become routines.
  let legacy: LegacyScheduleCounts | null = null;
  try {
    legacy = await convertLegacySchedules(now, LEGACY_MOVER);
  } catch (err) {
    stepsFailed += 1;
    console.error(`[cron-failure] run-due-agents: the schedule move threw: ${errorLine(err)}`);
  }

  // A step that threw fails the tick, and so does a schedule that did not
  // move: it is left for the next tick, but nothing runs it until it moves,
  // so someone is told (review of step 2). One routine's failure stays on
  // the routine and in its chat.
  return cronResult("run-due-agents", { actions, routines, legacySchedules: legacy }, stepsFailed + (legacy?.failed ?? 0));
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("run-due-agents", handle);

// Vercel Cron sends GET, not POST — accept both so the same endpoint
// works under any scheduler.
export const GET = POST;
