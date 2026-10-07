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
import { ANSWER_WITHOUT_TEAMMATE, firstAnswerWithoutTeammate, firstConditionMissingValue } from "@/lib/automation/builder-state";

class ChangedWhilePublishing extends Error {}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;
  const refused = await refuseWorkflowWrite(ctx, id, "edit");
  if (refused) return refused;

  const workflow = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, status: true, triggerEvent: true, definition: true, createdById: true, publishedVersionId: true },
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
  // A step that uses a teammate's answer with no teammate step before it would fail on every run.
  const early = firstAnswerWithoutTeammate(def.actions);
  if (early !== null) {
    return NextResponse.json({ error: ANSWER_WITHOUT_TEAMMATE, section: "then", index: early, issues: { section: "then", index: early } }, { status: 400 });
  }
  // An AI teammate step works as the creator: only they may publish one, and
  // only with a teammate they can use (the version records its publisher,
  // and a run checks both again).
  let teammate = await teammateStepProblem(workflow.definition, { saverId: ctx.userId, creatorId: workflow.createdById, viewer: ctx.viewer });
  // Nor publish one away: a live version that holds one is the creator's to replace (review round 3).
  if (!teammate && workflow.publishedVersionId) {
    const live = await prisma.automationWorkflowVersion.findFirst({ where: { id: workflow.publishedVersionId, organizationId: ctx.orgId }, select: { definitionJson: true } });
    const p = await teammateStepProblem(live?.definitionJson ?? null, { saverId: ctx.userId, creatorId: workflow.createdById, viewer: ctx.viewer });
    if (p?.status === 403) teammate = p;
  }
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
    // Everything above was checked on a read made before the lock. A save or
    // publish that landed in between (a teammate step added, the live version
    // replaced) must not go live unchecked: the row is read again under the
    // lock, and any change sends this publish back (review round 4).
    const now = await tx.automationWorkflow.findFirst({
      where: { id: workflow.id, organizationId: ctx.orgId },
      select: { status: true, definition: true, createdById: true, publishedVersionId: true },
    });
    if (
      !now ||
      now.status === "ARCHIVED" ||
      now.createdById !== workflow.createdById ||
      now.publishedVersionId !== workflow.publishedVersionId ||
      JSON.stringify(now.definition ?? null) !== JSON.stringify(workflow.definition ?? null)
    ) {
      throw new ChangedWhilePublishing();
    }
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
    if (err instanceof ChangedWhilePublishing) {
      return NextResponse.json({ error: "This automation changed while it was being published. Reload and publish again.", code: "changed" }, { status: 409 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Somebody published this automation at the same moment. Reload to see the live version." }, { status: 409 });
    }
    throw err;
  }

  // The answer carries the definition as this editor may see it: places they
  // cannot open stay out of the row and out of the version's snapshot.
  return NextResponse.json({ workflow: await workflowForViewer(ctx.viewer, result.workflow), version: await versionForViewer(ctx.viewer, result.version, result.workflow.createdById) });
}
