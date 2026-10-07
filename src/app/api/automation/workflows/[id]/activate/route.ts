// POST /api/automation/workflows/[id]/activate
//
// Re-enables a previously published workflow. A workflow that was never
// published has nothing safe to run, so activation requires a published
// version (use /publish for the first go-live).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { refuseWorkflowWrite, requireAutomation } from "@/lib/automation/gate";
import { workflowForViewer } from "@/lib/automation/definition-view";
import { teammateStepProblem } from "@/lib/automation/teammate-step";
import { AUTOMATION_TEAMMATE_COPY } from "@/lib/agents/teammate-copy";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;
  const refused = await refuseWorkflowWrite(ctx, id, "edit");
  if (refused) return refused;

  const workflow = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, status: true, publishedVersionId: true, createdById: true },
  });
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (workflow.status === "ARCHIVED") {
    return NextResponse.json({ error: "Archived workflows cannot be activated" }, { status: 400 });
  }
  if (!workflow.publishedVersionId) {
    return NextResponse.json(
      { error: "Publish this workflow before activating it" },
      { status: 400 },
    );
  }
  // An AI teammate step works as the creator: a version with one goes back
  // on only by them, so a pause they chose (it was spending, or acting
  // wrongly) is never undone by someone else. Pausing stays open.
  if (workflow.status !== "ACTIVE") {
    const live = await prisma.automationWorkflowVersion.findFirst({ where: { id: workflow.publishedVersionId, organizationId: ctx.orgId }, select: { definitionJson: true } });
    const teammate = await teammateStepProblem(live?.definitionJson ?? null, { saverId: ctx.userId, creatorId: workflow.createdById, viewer: ctx.viewer });
    if (teammate) return NextResponse.json({ error: teammate.status === 403 ? AUTOMATION_TEAMMATE_COPY.creatorOnlyOn : teammate.error, code: teammate.code }, { status: teammate.status });
  }
  if (workflow.status === "ACTIVE") {
    const unchanged = await prisma.automationWorkflow.findUnique({ where: { id } });
    return NextResponse.json({ workflow: unchanged ? await workflowForViewer(ctx.viewer, unchanged) : null });
  }

  const updated = await prisma.automationWorkflow.update({
    where: { id },
    data: { status: "ACTIVE", updatedById: ctx.userId },
  });
  return NextResponse.json({ workflow: await workflowForViewer(ctx.viewer, updated) });
}
