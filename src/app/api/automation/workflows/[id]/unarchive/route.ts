// POST /api/automation/workflows/[id]/unarchive
//
// Brings an archived automation back (Owner or Admin, the same people who
// archive). It returns PAUSED when it had been published, so nothing starts
// running again until somebody turns it on, and as a DRAFT otherwise.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbidden, requireAutomation } from "@/lib/automation/gate";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  if (!ctx.isAdmin) return forbidden("Only workspace Owners and Admins can bring an automation back.");
  const { id } = await params;

  const wf = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, status: true, publishedVersionId: true },
  });
  if (!wf) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (wf.status !== "ARCHIVED") return NextResponse.json({ ok: true, status: wf.status });

  const status = wf.publishedVersionId ? "INACTIVE" : "DRAFT";
  await prisma.automationWorkflow.update({
    where: { id },
    data: { status, archivedAt: null, updatedById: ctx.userId },
  });
  return NextResponse.json({ ok: true, status });
}
