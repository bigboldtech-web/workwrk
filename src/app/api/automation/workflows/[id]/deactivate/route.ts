// POST /api/automation/workflows/[id]/deactivate
//
// Pauses a workflow: the engine's matcher only picks up ACTIVE rows, so
// INACTIVE workflows stop firing immediately (and the retry cron stops
// retrying their runs).

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
    select: { id: true, status: true },
  });
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (workflow.status === "ARCHIVED") {
    return NextResponse.json({ error: "Archived workflows cannot be deactivated" }, { status: 400 });
  }

  const updated = await prisma.automationWorkflow.update({
    where: { id },
    data: { status: "INACTIVE", updatedById: ctx.userId },
  });
  return NextResponse.json({ workflow: updated });
}
