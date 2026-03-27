import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

// POST: Toggle step completion for an onboarding instance
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: instanceId } = await params;
  const userId = getUserId(session);
  const body = await req.json();
  const { stepIndex, completed } = body;

  if (stepIndex === undefined || completed === undefined) {
    return jsonError("stepIndex and completed are required");
  }

  const instance = await prisma.onboardingInstance.findFirst({
    where: { id: instanceId },
    include: { template: { select: { steps: true, organizationId: true } } },
  });

  if (!instance) return jsonError("Onboarding instance not found", 404);

  // Only the assigned user or a manager can update steps
  if (instance.userId !== userId && !isManager(session)) {
    return jsonError("Not authorized", 403);
  }

  const steps = Array.isArray(instance.template.steps) ? instance.template.steps : [];
  if (stepIndex < 0 || stepIndex >= steps.length) {
    return jsonError("Invalid step index");
  }

  // Update progress array
  const progress: any[] = Array.isArray(instance.progress) ? [...(instance.progress as any[])] : [];

  const existingIdx = progress.findIndex((p: any) => p.stepIndex === stepIndex);
  if (completed) {
    if (existingIdx >= 0) {
      progress[existingIdx] = { ...progress[existingIdx], completed: true, completedAt: new Date().toISOString() };
    } else {
      progress.push({ stepIndex, completed: true, completedAt: new Date().toISOString() });
    }
  } else {
    if (existingIdx >= 0) {
      progress[existingIdx] = { ...progress[existingIdx], completed: false, completedAt: null };
    }
  }

  const completedCount = progress.filter((p: any) => p.completed).length;
  const allDone = completedCount >= steps.length;

  const updated = await prisma.onboardingInstance.update({
    where: { id: instanceId },
    data: {
      progress,
      status: allDone ? "COMPLETED" : completedCount > 0 ? "IN_PROGRESS" : "NOT_STARTED",
      completedAt: allDone ? new Date() : null,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      template: { select: { name: true, steps: true } },
    },
  });

  if (allDone) {
    logActivity({
      type: "onboarding_completed",
      actorId: instance.userId,
      organizationId: instance.template.organizationId,
      description: `Completed all onboarding steps`,
      targetId: instanceId,
      targetType: "onboarding",
    });
  }

  return jsonSuccess(updated);
}

// GET: Get detailed progress for an onboarding instance (manager view)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: instanceId } = await params;
  const orgId = getOrgId(session);

  const instance = await prisma.onboardingInstance.findFirst({
    where: { id: instanceId, template: { organizationId: orgId } },
    include: {
      user: {
        select: {
          id: true, firstName: true, lastName: true, avatar: true,
          department: { select: { name: true } },
        },
      },
      buddy: { select: { id: true, firstName: true, lastName: true } },
      template: { select: { name: true, steps: true, durationDays: true } },
    },
  });

  if (!instance) return jsonError("Instance not found", 404);

  const steps = Array.isArray(instance.template.steps) ? instance.template.steps : [];
  const progress: any[] = Array.isArray(instance.progress) ? (instance.progress as any[]) : [];

  const enrichedSteps = steps.map((step: any, i: number) => {
    const p = progress.find((pr: any) => pr.stepIndex === i);
    return {
      index: i,
      title: step.title || step,
      description: step.description || "",
      completed: p?.completed || false,
      completedAt: p?.completedAt || null,
    };
  });

  const daysSinceStart = Math.floor(
    (Date.now() - new Date(instance.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return jsonSuccess({
    ...instance,
    enrichedSteps,
    daysSinceStart,
    completedCount: enrichedSteps.filter((s: any) => s.completed).length,
    totalSteps: enrichedSteps.length,
  });
}
