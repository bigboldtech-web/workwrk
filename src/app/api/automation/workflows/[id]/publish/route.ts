// POST /api/automation/workflows/[id]/publish
//
// Snapshots the current definition into an AutomationWorkflowVersion
// (next versionNumber), marks it the published version, and flips the
// workflow ACTIVE. Validates the definition first so a broken workflow
// can never go live: it needs a known trigger, at least one action,
// every action must exist in the registry and be available today, and
// every condition whose operator takes a value must carry one.

import { Prisma, type AutomationWorkflow, type AutomationWorkflowVersion } from "@/generated/prisma";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { refuseWorkflowWrite, requireAutomation } from "@/lib/automation/gate";
import { parseDefinition } from "@/lib/automation/engine";
import { getAction } from "@/lib/automation/registry-actions";
import { teammateStepProblem } from "@/lib/automation/teammate-step";
import { getTrigger } from "@/lib/automation/registry-triggers";
import { draftTrigger } from "@/lib/automation/definition";
import { versionForViewer, workflowForViewer } from "@/lib/automation/definition-view";
import { firstConditionMissingValue } from "@/lib/automation/builder-state";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;
  const refused = await refuseWorkflowWrite(ctx, id, "edit");
  if (refused) return refused;

  const workflow = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, status: true, triggerEvent: true, definition: true, createdById: true },
  });
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (workflow.status === "ARCHIVED") {
    return NextResponse.json({ error: "Archived workflows cannot be published" }, { status: 400 });
  }

  // The DRAFT trigger goes live with this publish (the column is the live one).
  const trigger = draftTrigger(workflow.definition, workflow.triggerEvent);
  if (!trigger) {
    return NextResponse.json({ error: "Choose what starts this automation", section: "when", issues: { section: "when" } }, { status: 400 });
  }
  if (!getTrigger(trigger)) {
    return NextResponse.json({ error: "That trigger no longer exists. Choose another.", section: "when", issues: { section: "when" } }, { status: 400 });
  }

  const def = parseDefinition(workflow.definition);
  if (def.actions.length === 0) {
    return NextResponse.json({ error: "Add at least one action", section: "then", issues: { section: "then" } }, { status: 400 });
  }
  for (const [index, action] of def.actions.entries()) {
    const impl = getAction(action.key);
    if (!impl) {
      return NextResponse.json({ error: "One of the actions no longer exists. Remove it.", section: "then", index, issues: { section: "then", index } }, { status: 400 });
    }
    if (!impl.available) {
      return NextResponse.json({ error: `"${impl.name}" is not available yet. Remove it or choose another action.`, section: "then", index, issues: { section: "then", index } }, { status: 400 });
    }
  }
  // An AI teammate step works as the creator: only they may publish one, and
  // only with a teammate they can use (the version records its publisher,
  // and a run checks both again).
  const teammate = await teammateStepProblem(workflow.definition, { saverId: ctx.userId, creatorId: workflow.createdById, viewer: ctx.viewer });
  if (teammate) return NextResponse.json({ error: teammate.error, code: teammate.code, section: "then", issues: { section: "then" } }, { status: teammate.status });
  // A condition such as "priority equals" with no value would go live and
  // compare against "" on every event, never matching, so the automation
  // silently never runs. The builder refuses it too; this is for the API
  // path and for a draft saved before the builder learned to check.
  const emptyCondition = firstConditionMissingValue(def.conditions);
  if (emptyCondition !== null) {
    return NextResponse.json(
      { error: "One condition has no value. Pick one or remove it.", section: "only_if", index: emptyCondition, issues: { section: "only_if", index: emptyCondition } },
      { status: 400 },
    );
  }
  const snapshot = { ...((workflow.definition as Record<string, unknown> | null) ?? {}), trigger };

  // Two publishes at once (a double click on Republish, two editors) must
  // not both compute the same next versionNumber: the workflow row is locked
  // for the transaction, so the second waits and numbers after the first.
  // Should the unique index still trip, the answer is a sentence, not a 500.
  let result: { workflow: AutomationWorkflow; version: AutomationWorkflowVersion };
  try {
    result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AutomationWorkflow" WHERE "id" = ${workflow.id} FOR UPDATE`;
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
        definitionJson: snapshot as Prisma.InputJsonValue,
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
        triggerEvent: trigger,
        status: "ACTIVE",
        updatedById: ctx.userId,
      },
    });

    return { workflow: updated, version };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Somebody published this automation at the same moment. Reload to see the live version." }, { status: 409 });
    }
    throw err;
  }

  // The answer carries the definition as this editor may see it: places they
  // cannot open stay out of the row and out of the version's snapshot.
  return NextResponse.json({ workflow: await workflowForViewer(ctx.viewer, result.workflow), version: await versionForViewer(ctx.viewer, result.version) });
}
