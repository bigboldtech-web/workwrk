import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { Prisma } from "@/generated/prisma";
import crypto from "crypto";

// GET: List process runs
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const sopId = url.searchParams.get("sopId");

  const where: Record<string, unknown> = { organizationId: orgId };
  if (status) where.status = status;
  if (sopId) where.sopId = sopId;

  const runs = await prisma.processRun.findMany({
    where,
    include: {
      sop: { select: { id: true, title: true, category: true, sopType: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonSuccess(runs);
}

// POST: Start a new process run
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { sopId, title, assigneeId, dueDate } = body;

  if (!sopId) return jsonError("SOP ID is required");

  const sop = await prisma.sOP.findFirst({
    where: { id: sopId, organizationId: orgId, sopType: "CHECKLIST" },
  });

  if (!sop) return jsonError("Checklist SOP not found", 404);

  const shareToken = crypto.randomBytes(16).toString("hex");

  const run = await prisma.processRun.create({
    data: {
      sopId,
      title: title || sop.title,
      assigneeId: assigneeId || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      shareToken,
      organizationId: orgId,
    },
    include: {
      sop: { select: { id: true, title: true } },
    },
  });

  return jsonSuccess({
    ...run,
    shareLink: `${process.env.NEXTAUTH_URL || "https://workwrk.com"}/run/${shareToken}`,
  }, 201);
}

// PATCH: Update a process run (complete step, update status)
export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();
  const { id, action, stepId, notes, inputValues } = body;

  if (!id) return jsonError("Process run ID is required");

  const run = await prisma.processRun.findFirst({
    where: { id, organizationId: orgId },
    include: { sop: true },
  });

  if (!run) return jsonError("Process run not found", 404);

  if (action === "complete_step" && stepId) {
    const completedSteps = (run.completedSteps as string[]) || [];
    const stepData = (run.stepData as Record<string, unknown>) || {};

    if (!completedSteps.includes(stepId)) {
      completedSteps.push(stepId);
    }

    stepData[stepId] = {
      completedAt: new Date().toISOString(),
      completedBy: userId,
      notes: notes || null,
      inputValues: inputValues || null,
    };

    // Calculate progress
    const content = run.sop.content as { sections?: { steps?: { id: string }[] }[] };
    const totalSteps = content.sections?.reduce((sum, s) => sum + (s.steps?.length || 0), 0) || 1;
    const progress = Math.round((completedSteps.length / totalSteps) * 100);

    const isComplete = progress >= 100;

    await prisma.processRun.update({
      where: { id },
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

    const content = run.sop.content as { sections?: { steps?: { id: string }[] }[] };
    const totalSteps = content.sections?.reduce((sum, s) => sum + (s.steps?.length || 0), 0) || 1;
    const progress = Math.round((completedSteps.length / totalSteps) * 100);

    await prisma.processRun.update({
      where: { id },
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

  if (action === "cancel") {
    await prisma.processRun.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    return jsonSuccess({ status: "CANCELLED" });
  }

  return jsonError("Invalid action");
}
