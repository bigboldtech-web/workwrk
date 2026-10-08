// POST /api/cron/run-due-agents
//
// Cron-tickable endpoint, call this from Vercel Cron, a server cron, or any
// scheduler. Each tick, in this order:
//   1. AI teammates' approval requests nobody answered in time expire, and
//      one stuck running is failed (src/lib/agents/actions.ts sweepActions);
//      a teammate run whose process stopped mid-turn reads as not finished
//      (src/lib/agents/budget.ts sweepStaleRuns).
//   2. AI teammates' routines that are due run, each slot claimed once
//      (src/lib/agents/routines-server.ts processDueRoutines), within their
//      own budget: they are time-sensitive (a 9:00 brief), so they go first.
//   3. Old Workspace agents schedules become routines
//      (src/lib/agents/legacy-schedules.ts convertLegacySchedules): each one
//      its creator's routine, or stopped with the reason shown, never run as
//      anyone else. The old autonomous loop, which ran them as the first
//      admin it found and ran every tool with no card, is gone
//      (docs/plans/ai-teammates-phase2.md step 2).
//   4. Google connections for AI teammates are kept honest
//      (src/lib/connectors/connections.ts sweepConnections): connects nobody
//      finished are deleted, the connections of people deleted, deactivated
//      or no longer in the workspace end, and revokes Google has not confirmed
//      are tried again (docs/plans/ai-teammates-phase3.md step 2).
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
import { sweepStaleRuns } from "@/lib/agents/budget";
import { convertLegacySchedules, type LegacyScheduleCounts } from "@/lib/agents/legacy-schedules";
import { processDueRoutines, type DueRoutineCounts } from "@/lib/agents/routines-server";
import { sweepConnections } from "@/lib/connectors/connections";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob, cronResult } from "@/lib/cron-result";

/**
 * AI teammate routines: up to 200 a tick, picked fairly across workspaces
 * (routines-server.ts pickDueFairly), 10 at a time, none started after 120
 * seconds. The budget and the 10 at a time set the pace: what has not
 * started by then stays due for the next tick (review rounds 10 and 11: 20,
 * then 40, a tick capped the platform well below what the budget can run).
 * 120 seconds leaves the turns still running, and the steps after, inside
 * the crontab's curl --max-time 290 (review round 12).
 */
const ROUTINE_RUNNER = { limit: 200, budgetMs: 120_000, concurrency: 10 } as const;

/** Old schedules moved per tick: each is one read of its creator and one transaction. */
const LEGACY_MOVER = { limit: 100 } as const;

/**
 * The connector sweep (docs/plans/ai-teammates-phase3.md step 2): up to 500
 * leavers ended and 50 revokes tried a tick, within 20 seconds, so the tick
 * stays inside the crontab's curl --max-time 290 after the routines' 120.
 */
const CONNECTOR_SWEEP = { leaversLimit: 500, revokeLimit: 50, budgetMs: 20_000 } as const;

type ConnectorSweepCounts = Awaited<ReturnType<typeof sweepConnections>>;

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

  // A run whose process stopped mid-turn reads "didn't finish", not "Running now" for good.
  let staleRuns: number | null = null;
  try {
    staleRuns = await sweepStaleRuns(now);
  } catch (err) {
    stepsFailed += 1;
    console.error(`[cron-failure] run-due-agents: the stale run sweep threw: ${errorLine(err)}`);
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

  // 4. Google connections for AI teammates: connects never finished, leavers
  //    the hooks missed, and revokes Google has not confirmed yet.
  let connectors: ConnectorSweepCounts | null = null;
  try {
    connectors = await sweepConnections(now, CONNECTOR_SWEEP);
  } catch (err) {
    stepsFailed += 1;
    console.error(`[cron-failure] run-due-agents: the connector sweep threw: ${errorLine(err)}`);
  }

  // A step that threw fails the tick, and so does a schedule that did not
  // move: it is left for the next tick, but nothing runs it until it moves,
  // so someone is told (review of step 2). One routine's failure stays on
  // the routine and in its chat.
  return cronResult("run-due-agents", { actions, staleRuns, routines, legacySchedules: legacy, connectors }, stepsFailed + (legacy?.failed ?? 0));
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("run-due-agents", handle);

// Vercel Cron sends GET, not POST — accept both so the same endpoint
// works under any scheduler.
export const GET = POST;
