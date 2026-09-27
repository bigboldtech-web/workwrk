// PATCH  /api/agents/[slug]  { status?: "ENABLED" | "DISABLED", name?, description? }
// DELETE /api/agents/[slug]  remove the agent from this workspace
//
// Owner and Admin (the Apps settings gate, access section 9; spec-ai-
// automation 1.4 and section 4 step 2). DELETE is a soft remove: the row goes
// to status ARCHIVED, so its run history and every chat bound to it are kept,
// and adding the same catalog agent again (POST .../install) brings it back.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireManageApps } from "@/lib/app-gate";
import { computeNextRunAt } from "@/lib/agents/autonomous";
import { auditAgent } from "@/lib/agents/audit";

const patchSchema = z
  .object({
    status: z.enum(["ENABLED", "DISABLED"]).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

async function findAgent(slug: string, organizationId: string) {
  return prisma.agent.findFirst({
    where: { slug, organizationId, status: { not: "ARCHIVED" } },
    select: { id: true, slug: true, name: true, status: true, autonomousEnabled: true, scheduleCron: true },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireManageApps();
  if ("error" in gate) return gate.error;
  const { slug } = await params;
  const agent = await findAgent(slug, gate.viewer.organizationId);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });

  const pausing = parsed.data.status === "DISABLED";
  // Turning a paused scheduled agent back on computes its next slot from
  // now. Left null, run-due-agents reads it as "never run" and fires it on
  // the next cron tick instead of at its schedule.
  const resuming = parsed.data.status === "ENABLED" && agent.status === "DISABLED";
  const resumeAt = resuming && agent.autonomousEnabled && agent.scheduleCron
    ? computeNextRunAt(agent.scheduleCron)
    : null;
  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: {
      ...parsed.data,
      // A paused agent must not run on its schedule; the schedule itself is
      // kept, so turning it back on resumes at its next scheduled time.
      ...(pausing ? { nextRunAt: null } : {}),
      ...(resumeAt ? { nextRunAt: resumeAt } : {}),
    },
    select: { id: true, slug: true, name: true, description: true, status: true, autonomousEnabled: true, scheduleCron: true, nextRunAt: true },
  });
  if (parsed.data.status && parsed.data.status !== agent.status) {
    await auditAgent({
      organizationId: gate.viewer.organizationId,
      actorId: gate.viewer.userId,
      agent,
      action: parsed.data.status === "ENABLED" ? "turned_on" : "paused",
    });
  }
  return NextResponse.json({ ok: true, agent: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireManageApps();
  if ("error" in gate) return gate.error;
  const { slug } = await params;
  const agent = await findAgent(slug, gate.viewer.organizationId);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.agent.update({
    where: { id: agent.id },
    data: { status: "ARCHIVED", autonomousEnabled: false, nextRunAt: null },
  });
  await auditAgent({ organizationId: gate.viewer.organizationId, actorId: gate.viewer.userId, agent, action: "removed" });
  return NextResponse.json({ ok: true });
}
