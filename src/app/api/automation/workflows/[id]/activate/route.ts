// POST /api/automation/workflows/[id]/activate
//
// Re-enables a previously published workflow. A workflow that was never
// published has nothing safe to run, so activation requires a published
// version (use /publish for the first go-live).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canManageAutomations,
  forbidden,
  resolveAutomationContext,
} from "@/lib/automation/hub-access";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;
  if (!canManageAutomations(ctx)) return forbidden();
  const { id } = await params;

  const workflow = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, status: true, publishedVersionId: true },
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
  if (workflow.status === "ACTIVE") {
    const unchanged = await prisma.automationWorkflow.findUnique({ where: { id } });
    return NextResponse.json({ workflow: unchanged });
  }

  const updated = await prisma.automationWorkflow.update({
    where: { id },
    data: { status: "ACTIVE", updatedById: ctx.userId },
  });
  return NextResponse.json({ workflow: updated });
}
