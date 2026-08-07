// GET /api/automation/runs/[id]
//
// Full run detail for the log drawer: trigger payload plus every step
// (trigger/condition/action) in execution order with input/output/error.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAutomationContext } from "@/lib/automation/hub-access";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const run = await prisma.automationRun.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      workflow: { select: { id: true, name: true, status: true, severity: true } },
      steps: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          stepType: true,
          stepKey: true,
          stepName: true,
          status: true,
          inputJson: true,
          outputJson: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
        },
      },
    },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  return NextResponse.json({ run });
}
