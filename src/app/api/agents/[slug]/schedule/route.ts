// PATCH  /api/agents/[slug]/schedule — set autonomous run config
// POST   /api/agents/[slug]/run-now  — fire one autonomous run immediately
//
// Both endpoints scope to the caller's org and require manager+ to mutate.
// Run-now is the manual sibling of the cron path so a user can hit
// "Run autonomous now" to dry-run a schedule.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { computeNextRunAt, runAgentAutonomously } from "@/lib/agents/autonomous";

const ADMIN_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);

async function resolveAgent(slug: string, organizationId: string) {
  return prisma.agent.findFirst({
    where: { slug, organizationId },
    select: {
      id: true, name: true, status: true, scheduleCron: true,
      autonomousEnabled: true, autonomousPrompt: true,
      lastRunAt: true, nextRunAt: true,
    },
  });
}

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userId = (session.user as { id?: string }).id;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const organizationId = (session.user as { organizationId?: string }).organizationId;
  if (!userId || !organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId, accessLevel, organizationId };
}

const patchSchema = z.object({
  autonomousEnabled: z.boolean().optional(),
  scheduleCron: z.string().max(80).optional().nullable(),
  autonomousPrompt: z.string().max(4000).optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required" }, { status: 403 });
  }
  const { slug } = await params;
  const agent = await resolveAgent(slug, c.organizationId);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
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
  return NextResponse.json({ agent: updated });
}

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required" }, { status: 403 });
  }
  const { slug } = await params;
  const agent = await resolveAgent(slug, c.organizationId);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (agent.status !== "ENABLED") {
    return NextResponse.json({ error: "Agent is disabled; enable it before running." }, { status: 400 });
  }

  // Long-running model call — let it run on the request thread (the
  // user clicked Run Now and is waiting). 60–90s typical.
  const result = await runAgentAutonomously({
    agentId: agent.id,
    trigger: "MANUAL",
    triggeredBy: c.userId,
  });
  return NextResponse.json({ result });
}
