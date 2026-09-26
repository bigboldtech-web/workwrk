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

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  if (!ctx.canManage) return forbidden();
  const { id } = await params;

  const src = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { name: true, description: true, severity: true, triggerEvent: true, definition: true },
  });
  if (!src) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

  const trigger = draftTrigger(src.definition, src.triggerEvent);
  const definition = { ...((src.definition as Record<string, unknown> | null) ?? {}), trigger };
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
