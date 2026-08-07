// POST /api/automation/workflows/[id]/publish
//
// Snapshots the current definition into an AutomationWorkflowVersion
// (next versionNumber), marks it the published version, and flips the
// workflow ACTIVE. Validates the definition first so a broken workflow
// can never go live: it needs a known trigger, at least one action, and
// every action must exist in the registry and be available today.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canManageAutomations,
  forbidden,
  resolveAutomationContext,
} from "@/lib/automation/hub-access";
import { parseDefinition } from "@/lib/automation/engine";
import { getAction } from "@/lib/automation/registry-actions";
import { getTrigger } from "@/lib/automation/registry-triggers";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;
  if (!canManageAutomations(ctx)) return forbidden();
  const { id } = await params;

  const workflow = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, status: true, triggerEvent: true, definition: true },
  });
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (workflow.status === "ARCHIVED") {
    return NextResponse.json({ error: "Archived workflows cannot be published" }, { status: 400 });
  }

  if (!workflow.triggerEvent) {
    return NextResponse.json({ error: "Pick a trigger before publishing" }, { status: 400 });
  }
  if (!getTrigger(workflow.triggerEvent)) {
    return NextResponse.json(
      { error: `Unknown trigger event: ${workflow.triggerEvent}` },
      { status: 400 },
    );
  }

  const def = parseDefinition(workflow.definition);
  if (def.actions.length === 0) {
    return NextResponse.json({ error: "Add at least one action before publishing" }, { status: 400 });
  }
  for (const action of def.actions) {
    const impl = getAction(action.key);
    if (!impl) {
      return NextResponse.json({ error: `Unknown action: ${action.key}` }, { status: 400 });
    }
    if (!impl.available) {
      return NextResponse.json(
        { error: `The action "${impl.name}" is not available yet` },
        { status: 400 },
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const latest = await tx.automationWorkflowVersion.aggregate({
      where: { workflowId: workflow.id },
      _max: { versionNumber: true },
    });
    const versionNumber = (latest._max.versionNumber ?? 0) + 1;

    const version = await tx.automationWorkflowVersion.create({
      data: {
        organizationId: ctx.orgId,
        workflowId: workflow.id,
        versionNumber,
        definitionJson: workflow.definition ?? {},
        isPublished: true,
        createdById: ctx.userId,
      },
    });

    // Only the newest snapshot carries the published flag.
    await tx.automationWorkflowVersion.updateMany({
      where: { workflowId: workflow.id, id: { not: version.id }, isPublished: true },
      data: { isPublished: false },
    });

    const updated = await tx.automationWorkflow.update({
      where: { id: workflow.id },
      data: {
        publishedVersionId: version.id,
        publishedAt: new Date(),
        status: "ACTIVE",
        updatedById: ctx.userId,
      },
    });

    return { workflow: updated, version };
  });

  return NextResponse.json(result);
}
