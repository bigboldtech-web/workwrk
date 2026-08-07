// /api/automation/workflows/[id]
//
// GET    → workflow detail: definition + version history + the last 10
//          runs (builder page data).
// PUT    → edit name/description/trigger/severity/definition (manager+).
//          Status transitions go through publish/activate/deactivate.
// DELETE → admin only. Hard-deletes a workflow that never ran;
//          otherwise archives it so run history is preserved.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  canManageAutomations,
  forbidden,
  resolveAutomationContext,
} from "@/lib/automation/hub-access";
import { getTrigger } from "@/lib/automation/registry-triggers";

const definitionSchema = z.object({
  conditions: z.unknown().optional(),
  actions: z.array(z.record(z.string(), z.unknown())).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  triggerEvent: z.string().trim().min(1).max(200).nullish(),
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]).optional(),
  definition: definitionSchema.optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const workflow = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        select: { id: true, versionNumber: true, isPublished: true, createdById: true, createdAt: true },
      },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          severity: true,
          triggerEventKey: true,
          recordType: true,
          recordId: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          createdAt: true,
        },
      },
    },
  });
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

  return NextResponse.json({ workflow });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;
  if (!canManageAutomations(ctx)) return forbidden();
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const existing = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (existing.status === "ARCHIVED") {
    return NextResponse.json({ error: "Archived workflows cannot be edited" }, { status: 400 });
  }

  if (parsed.data.triggerEvent && !getTrigger(parsed.data.triggerEvent)) {
    return NextResponse.json(
      { error: `Unknown trigger event: ${parsed.data.triggerEvent}` },
      { status: 400 },
    );
  }

  const data: Prisma.AutomationWorkflowUpdateInput = { updatedById: ctx.userId };
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description ?? null;
  if (parsed.data.triggerEvent !== undefined) data.triggerEvent = parsed.data.triggerEvent ?? null;
  if (parsed.data.severity !== undefined) data.severity = parsed.data.severity;
  if (parsed.data.definition !== undefined) {
    data.definition = parsed.data.definition as Prisma.InputJsonValue;
  }

  const workflow = await prisma.automationWorkflow.update({ where: { id }, data });
  return NextResponse.json({ workflow });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;
  if (ctx.role !== "admin") return forbidden("Forbidden: only workspace admins can delete workflows");
  const { id } = await params;

  const existing = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, _count: { select: { runs: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

  if (existing._count.runs === 0) {
    // Never ran: safe to remove outright (versions cascade).
    await prisma.automationWorkflow.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  }

  // Has run history: archive instead so logs/usage stay auditable.
  await prisma.automationWorkflow.update({
    where: { id },
    data: { status: "ARCHIVED", archivedAt: new Date(), updatedById: ctx.userId },
  });
  return NextResponse.json({ deleted: false, archived: true });
}
