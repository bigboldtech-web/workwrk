// POST /api/cron/run-due-agents
//
// Cron-tickable endpoint — call this from Vercel Cron, a server cron,
// or any scheduler. Walks every agent that has:
//   - status = ENABLED
//   - autonomousEnabled = true
//   - scheduleCron set
//   - nextRunAt <= now (or null, meaning "first run")
// and fires `runAgentAutonomously` on each. Results are persisted as
// AgentRun rows.
//
// Auth: the shared cron door (src/lib/cron-auth.ts): CRON_SECRET in
// `x-cron-secret` or `Authorization: Bearer`, fail-closed, constant time.
// It used to fall through to ANY signed-in admin when the header did not
// match, and the query below is not scoped to one workspace, so a customer
// workspace's admin could fire every workspace's due agents. Locally, set
// CRON_SECRET for the dev server and send it.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeNextRunAt, runAgentAutonomously } from "@/lib/agents/autonomous";
import { aiEnabledFromSettings } from "@/lib/ai/ai-enabled";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob, cronResult } from "@/lib/cron-result";

async function handle(req: Request) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const now = new Date();
  const due = await prisma.agent.findMany({
    where: {
      status: "ENABLED",
      autonomousEnabled: true,
      scheduleCron: { not: null },
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

  const fired: Array<{ agentSlug: string; status: string; runId?: string; error?: string; keySource?: "shared" | "byok" }> = [];
  for (const agent of runnable) {
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
  };
  // A failed tick is one where every run on WorkwrK's own AI key failed:
  // the model is unreachable or that key is bad, which is the server's to
  // fix. A run on a workspace's own key (BYOK) is that workspace's, and one
  // agent's failure among runs that worked stays in its run history.
  const ours = fired.filter((r) => r.keySource !== "byok");
  const failed = ours.filter((r) => r.status === "FAILED").length;
  return cronResult("run-due-agents", body, ours.length > 0 && failed === ours.length ? failed : 0);
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("run-due-agents", handle);

// Vercel Cron sends GET, not POST — accept both so the same endpoint
// works under any scheduler.
export const GET = POST;
