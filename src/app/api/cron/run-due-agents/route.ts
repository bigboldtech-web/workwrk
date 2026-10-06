// POST /api/cron/run-due-agents
//
// Cron-tickable endpoint, call this from Vercel Cron, a server cron, or any
// scheduler. Each tick, in this order:
//   1. AI teammates' approval requests nobody answered in time expire, and
//      one stuck running is failed (src/lib/agents/actions.ts sweepActions).
//   2. AI teammates' routines that are due run, each slot claimed once
//      (src/lib/agents/routines-server.ts processDueRoutines), within their
//      own budget: they are time-sensitive (a 9:00 brief), so they go first.
//   3. The autonomous agents run, with what is left of the tick's deadline.
//      The loop walks every agent that has:
//        - status = ENABLED
//        - autonomousEnabled = true
//        - scheduleCron set
//        - nextRunAt <= now (or null, meaning "first run")
//      and fires `runAgentAutonomously` on each. Results are persisted as
//      AgentRun rows. An agent the deadline left unstarted is still due, so
//      the next tick runs it.
// Steps 1 and 2 are each their own: one that throws is logged and fails the
// tick, and the steps after it still run, so the agents behave as they did
// before teammates. The body adds counts only for them: no workspace,
// teammate or person is named (docs/plans/ai-teammates.md 3.9).
//
// Auth: the shared cron door (src/lib/cron-auth.ts): CRON_SECRET in
// `x-cron-secret` or `Authorization: Bearer`, fail-closed, constant time.
// It used to fall through to ANY signed-in admin when the header did not
// match, and the query below is not scoped to one workspace, so a customer
// workspace's admin could fire every workspace's due agents. Locally, set
// CRON_SECRET for the dev server and send it.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sweepActions } from "@/lib/agents/actions";
import { computeNextRunAt, runAgentAutonomously } from "@/lib/agents/autonomous";
import { processDueRoutines, type DueRoutineCounts } from "@/lib/agents/routines-server";
import { aiEnabledFromSettings } from "@/lib/ai/ai-enabled";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob, cronResult } from "@/lib/cron-result";
import { LEGACY_AGENT } from "@/lib/agents/legacy-agents";

/** The whole tick's time: the crontab's curl stops waiting at 290 seconds (scripts/CRON-SETUP.md). */
const TICK_DEADLINE_MS = 260_000;

/** AI teammate routines: 20 a tick, 4 at a time, none started after 180 seconds. */
const ROUTINE_RUNNER = { limit: 20, budgetMs: 180_000, concurrency: 4 } as const;

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

async function handle(req: Request) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const now = new Date();
  const deadline = Date.now() + TICK_DEADLINE_MS;
  let stepsFailed = 0;

  // 1. Requests past their time expire; a run stuck RUNNING fails.
  let actions: { expired: number; stuck: number } | null = null;
  try {
    actions = await sweepActions(now);
  } catch (err) {
    stepsFailed += 1;
    console.error(`[cron-failure] run-due-agents: the approval sweep threw: ${errorLine(err)}`);
  }

  // 2. Due routines, before the agents and within their own budget.
  let routines: DueRoutineCounts | null = null;
  try {
    routines = await processDueRoutines(now, ROUTINE_RUNNER);
  } catch (err) {
    stepsFailed += 1;
    console.error(`[cron-failure] run-due-agents: the routine runner threw: ${errorLine(err)}`);
  }

  // 3. The autonomous agents.
  const due = await prisma.agent.findMany({
    where: {
      status: "ENABLED",
      autonomousEnabled: true,
      scheduleCron: { not: null },
      // Never a teammate: it runs through its routines (legacy-agents.ts).
      ...LEGACY_AGENT,
      OR: [
        { nextRunAt: null }, // never run before
        { nextRunAt: { lte: now } },
      ],
    },
    select: { id: true, slug: true, name: true, organizationId: true, scheduleCron: true, organization: { select: { settings: true } } },
    // Cap how many we fire per tick so a backlog doesn't run away.
    take: 50,
  });

  // AI features off for the workspace (settings.data.aiEnabled === false)
  // turns the `ai` app key off, and Agents are that key: a scheduled agent
  // does not run either. Its schedule is kept and moved to its next slot, so
  // it neither clogs this tick's cap nor fires the moment AI comes back on.
  const skipped: string[] = [];
  const runnable = [];
  for (const agent of due) {
    if (aiEnabledFromSettings(agent.organization?.settings)) { runnable.push(agent); continue; }
    skipped.push(agent.slug);
    await prisma.agent
      .update({ where: { id: agent.id }, data: { nextRunAt: agent.scheduleCron ? computeNextRunAt(agent.scheduleCron, now) : null } })
      .catch(() => {});
  }

  const fired: Array<{ agentSlug: string; status: string; runId?: string; error?: string; keySource?: "shared" | "byok"; refused?: boolean }> = [];
  let deferred = 0;
  for (const agent of runnable) {
    // Past the tick's deadline nothing more starts: the agent keeps its
    // due time, so the next tick fires it.
    if (Date.now() >= deadline) {
      deferred += 1;
      continue;
    }
    try {
      const result = await runAgentAutonomously({
        agentId: agent.id,
        trigger: "SCHEDULED",
        triggeredBy: null,
      });
      fired.push({
        agentSlug: agent.slug,
        status: result.status,
        runId: result.runId,
        error: result.errorText,
        keySource: result.keySource,
        ...(result.refused ? { refused: true } : {}),
      });
    } catch (err) {
      fired.push({
        agentSlug: agent.slug,
        status: "FAILED",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const body = {
    firedCount: fired.length,
    runs: fired,
    skippedAiOff: skipped,
    // Agents the deadline left for the next tick.
    deferred,
    // AI teammates, in counts only (null when the step threw).
    actions,
    routines,
  };
  // A failed tick is one where every run on WorkwrK's own AI key failed:
  // the model is unreachable or that key is bad, which is the server's to
  // fix. A run on a workspace's own key (BYOK) is that workspace's, a run
  // refused because its workspace used all its AI questions is a plan limit
  // (src/lib/ai-allowance.ts), and one agent's failure among runs that
  // worked stays in its run history. A teammate step that threw fails the
  // tick; one routine's failure stays on the routine and in its chat.
  const ours = fired.filter((r) => r.keySource !== "byok" && !r.refused);
  const failed = ours.filter((r) => r.status === "FAILED").length;
  return cronResult("run-due-agents", body, (ours.length > 0 && failed === ours.length ? failed : 0) + stepsFailed);
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("run-due-agents", handle);

// Vercel Cron sends GET, not POST — accept both so the same endpoint
// works under any scheduler.
export const GET = POST;
