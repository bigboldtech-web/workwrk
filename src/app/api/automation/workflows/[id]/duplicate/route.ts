// POST /api/automation/workflows/[id]/duplicate
//
// Copies an automation into a new DRAFT named "{name} (copy)", owned by the
// person who duplicated it, carrying the source's draft definition (its
// trigger, conditions, actions, trigger options and where it runs). The
// copy has no versions and no runs of its own, and the source is untouched.
// Body {}. Returns { id, name }.

import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { forbidden, requireAutomation } from "@/lib/automation/gate";
import { draftTrigger } from "@/lib/automation/definition";
import { teammateSlugsUsableBy } from "@/lib/automation/teammate-step";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  // Every Member may duplicate: the copy is a new draft they own.
  if (!ctx.canCreate) return forbidden();
  const { id } = await params;

  const src = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { name: true, description: true, severity: true, triggerEvent: true, definition: true, createdById: true },
  });
  if (!src) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

  const trigger = draftTrigger(src.definition, src.triggerEvent);
  const base = { ...((src.definition as Record<string, unknown> | null) ?? {}), trigger };
  // The copy's AI teammate steps ask the new owner's teammates: one the
  // owner cannot use (another person's private one) is left for them to
  // pick, and its slug, which carries its name, is never copied (review round 2).
  const definition = src.createdById === ctx.userId ? base : await teammateSlugsUsableBy(base, ctx.viewer);
  const name = `${src.name} (copy)`.slice(0, 200);
  const copy = await prisma.automationWorkflow.create({
    data: {
      organizationId: ctx.orgId,
      name,
      description: src.description,
      status: "DRAFT",
      severity: src.severity,
      triggerEvent: trigger,
      definition: definition as Prisma.InputJsonValue,
      createdById: ctx.userId,
      updatedById: ctx.userId,
    },
    select: { id: true, name: true },
  });
  return NextResponse.json(copy, { status: 201 });
}
