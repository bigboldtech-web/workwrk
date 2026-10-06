// PATCH  /api/agents/[slug]/schedule, set autonomous run config
// POST   /api/agents/[slug]/run-now, fire one autonomous run immediately
//
// Both endpoints scope to the caller's org and need Owner or Admin (the Apps
// settings gate, access section 9; spec-ai-automation 1.4). POST is Run now.
// Run-now is the manual sibling of the cron path so a user can hit
// "Run autonomous now" to dry-run a schedule.
//
// Workspace agents only (docs/plans/ai-teammates.md 3.15): a PRIVATE AI
// teammate answers exactly as a slug that does not exist, so an Admin who
// learns one can neither schedule it nor run it with their own rights. Its
// owner sets its routines in AI teammates.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireApp, requireManageApps } from "@/lib/app-gate";
import { aiOffResponse } from "@/lib/ai/ai-off-gate";
import { computeNextRunAt, runAgentAutonomously } from "@/lib/agents/autonomous";
import { isValidSchedule } from "@/lib/agents/schedule-words";
import { auditAgent } from "@/lib/agents/audit";

async function resolveAgent(slug: string, organizationId: string) {
  return prisma.agent.findFirst({
    where: { slug, organizationId, visibility: "WORKSPACE", status: { not: "ARCHIVED" } },
    select: {
      id: true, name: true, status: true, scheduleCron: true,
      autonomousEnabled: true, autonomousPrompt: true,
      lastRunAt: true, nextRunAt: true,
    },
  });
}

async function ctx() {
  const gate = await requireManageApps();
  if ("error" in gate) return { error: gate.error };
  return { userId: gate.viewer.userId, organizationId: gate.viewer.organizationId };
}

const patchSchema = z.object({
  autonomousEnabled: z.boolean().optional(),
  scheduleCron: z.string().max(80).optional().nullable(),
  autonomousPrompt: z.string().max(4000).optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { slug } = await params;
  const agent = await resolveAgent(slug, c.organizationId);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  // An empty schedule clears it; anything else must be one the scheduler
  // reads (a keyword, "every N minutes / hours" or a five-field cron), so a
  // typo is refused here instead of quietly running every hour.
  if (typeof parsed.data.scheduleCron === "string") {
    const trimmed = parsed.data.scheduleCron.trim().replace(/\s+/g, " ");
    if (!trimmed) parsed.data.scheduleCron = null;
    else if (!isValidSchedule(trimmed)) {
      return NextResponse.json({ error: "invalid_schedule", message: "That schedule isn't one we can run. Use a preset or a five-field cron." }, { status: 400 });
    } else parsed.data.scheduleCron = trimmed;
  }

  // Recompute nextRunAt whenever the schedule string OR the enabled
  // flag changes, so the cron picker sees fresh state right away.
  const willBeEnabled =
    parsed.data.autonomousEnabled !== undefined ? parsed.data.autonomousEnabled : agent.autonomousEnabled;
  const willBeCron =
    parsed.data.scheduleCron !== undefined ? parsed.data.scheduleCron : agent.scheduleCron;
  let nextRunAt: Date | null = agent.nextRunAt;
  if (parsed.data.scheduleCron !== undefined || parsed.data.autonomousEnabled !== undefined) {
    nextRunAt = willBeEnabled && willBeCron ? computeNextRunAt(willBeCron) : null;
  }

  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: {
      autonomousEnabled: parsed.data.autonomousEnabled,
      scheduleCron: parsed.data.scheduleCron,
      autonomousPrompt: parsed.data.autonomousPrompt,
      nextRunAt,
    },
    select: {
      autonomousEnabled: true, scheduleCron: true, autonomousPrompt: true,
      lastRunAt: true, nextRunAt: true,
    },
  });
  await auditAgent({
    organizationId: c.organizationId,
    actorId: c.userId,
    agent: { id: agent.id, name: agent.name, slug },
    action: "schedule_changed",
    metadata: { autonomousEnabled: updated.autonomousEnabled, scheduleCron: updated.scheduleCron },
  });
  return NextResponse.json({ agent: updated });
}

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  // Run now calls the model, so it answers to the same switch the scheduled
  // path does: with the ai app key off (AI features turned off for the
  // workspace, or the app hidden) it is refused, never run.
  const app = await requireApp("ai");
  if ("error" in app) return app.error;
  const c = await ctx();
  if ("error" in c) return c.error;
  const off = await aiOffResponse(c.organizationId);
  if (off) return off;
  const { slug } = await params;
  const agent = await resolveAgent(slug, c.organizationId);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (agent.status !== "ENABLED") {
    return NextResponse.json({ error: "Agent is disabled; enable it before running." }, { status: 400 });
  }

  // Long-running model call, let it run on the request thread (the
  // user clicked Run Now and is waiting). 60–90s typical.
  await auditAgent({ organizationId: c.organizationId, actorId: c.userId, agent: { id: agent.id, name: agent.name, slug }, action: "run_now" });
  const result = await runAgentAutonomously({
    agentId: agent.id,
    trigger: "MANUAL",
    triggeredBy: c.userId,
  });
  return NextResponse.json({ result });
}
