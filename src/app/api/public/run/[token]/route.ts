import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";

// GET: Fetch process run by share token (public, no auth required)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const run = await prisma.processRun.findUnique({
    where: { shareToken: token },
    include: {
      sop: { select: { id: true, title: true, description: true, content: true } },
    },
  });

  if (!run) return jsonError("Process not found or link expired", 404);

  const content = run.sop.content as {
    sections?: { id: string; title: string; steps: unknown[] }[];
  };

  return jsonSuccess({
    id: run.id,
    title: run.title,
    sopTitle: run.sop.title,
    description: run.sop.description || "",
    progress: run.progress,
    status: run.status,
    dueDate: run.dueDate,
    sections: content.sections || [],
    completedSteps: run.completedSteps || [],
    stepData: run.stepData || {},
  });
}

// PATCH: Complete/uncomplete step via share token (public, no auth required)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await req.json();
  const { action, stepId, inputValues } = body;

  const run = await prisma.processRun.findUnique({
    where: { shareToken: token },
    include: { sop: true },
  });

  if (!run) return jsonError("Process not found or link expired", 404);
  if (run.status === "CANCELLED") return jsonError("This process has been cancelled", 400);

  const content = run.sop.content as { sections?: { steps?: { id: string }[] }[] };
  const totalSteps = content.sections?.reduce((sum, s) => sum + (s.steps?.length || 0), 0) || 1;

  if (action === "complete_step" && stepId) {
    const completedSteps = (run.completedSteps as string[]) || [];
    const stepData = (run.stepData as Record<string, unknown>) || {};

    if (!completedSteps.includes(stepId)) {
      completedSteps.push(stepId);
    }

    stepData[stepId] = {
      completedAt: new Date().toISOString(),
      completedBy: "public",
      inputValues: inputValues || null,
    };

    const progress = Math.round((completedSteps.length / totalSteps) * 100);
    const isComplete = progress >= 100;

    await prisma.processRun.update({
      where: { id: run.id },
      data: {
        completedSteps: completedSteps as unknown as Prisma.InputJsonValue,
        stepData: stepData as unknown as Prisma.InputJsonValue,
        progress,
        status: isComplete ? "COMPLETED" : "ACTIVE",
        completedAt: isComplete ? new Date() : null,
      },
    });

    return jsonSuccess({ progress, completedSteps, status: isComplete ? "COMPLETED" : "ACTIVE" });
  }

  if (action === "uncomplete_step" && stepId) {
    const completedSteps = ((run.completedSteps as string[]) || []).filter(s => s !== stepId);
    const stepData = (run.stepData as Record<string, unknown>) || {};
    delete stepData[stepId];

    const progress = Math.round((completedSteps.length / totalSteps) * 100);

    await prisma.processRun.update({
      where: { id: run.id },
      data: {
        completedSteps: completedSteps as unknown as Prisma.InputJsonValue,
        stepData: stepData as unknown as Prisma.InputJsonValue,
        progress,
        status: "ACTIVE",
        completedAt: null,
      },
    });

    return jsonSuccess({ progress, completedSteps, status: "ACTIVE" });
  }

  return jsonError("Invalid action");
}
