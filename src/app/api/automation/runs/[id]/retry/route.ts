// POST /api/automation/runs/[id]/retry
//
// Manual retry (manager+): re-executes exactly the FAILED action steps
// of a FAILED/PARTIAL run. Mirrors the cron in
// src/lib/automation/retry.ts but skips its backoff schedule; a human
// clicking "Retry" wants it now.
//
// Duplicate-side-effect guard: only runs whose failed steps are ALL
// `safeToRetry` actions can be retried; succeeded steps never re-run.
// On full recovery the run flips SUCCESS and its cron retry state is
// cleared; a still-failing run keeps its payload (and any pending cron
// schedule) untouched.

import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  canManageAutomations,
  forbidden,
  resolveAutomationContext,
} from "@/lib/automation/hub-access";
import { getAction, type ActionContext } from "@/lib/automation/registry-actions";
import { recordUsage } from "@/lib/automation/usage";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;
  if (!canManageAutomations(ctx)) return forbidden();
  const { id } = await params;

  const run = await prisma.automationRun.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      steps: { orderBy: { order: "asc" } },
      workflow: { select: { id: true, status: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  if (run.status !== "FAILED" && run.status !== "PARTIAL") {
    return NextResponse.json(
      { error: "Only failed or partial runs can be retried" },
      { status: 400 },
    );
  }
  if (run.workflow.status === "ARCHIVED") {
    return NextResponse.json(
      { error: "This workflow is archived; its runs cannot be retried" },
      { status: 400 },
    );
  }

  const failedSteps = run.steps.filter((s) => s.stepType === "ACTION" && s.status === "FAILED");
  if (failedSteps.length === 0) {
    return NextResponse.json({ error: "This run has no failed action steps" }, { status: 400 });
  }
  const unsafe = failedSteps.filter((s) => getAction(s.stepKey)?.safeToRetry !== true);
  if (unsafe.length > 0) {
    return NextResponse.json(
      {
        error: `Not safe to retry: ${[...new Set(unsafe.map((s) => s.stepKey))].join(", ")} could cause duplicate side effects`,
      },
      { status: 400 },
    );
  }

  const payload = (run.triggerPayload ?? {}) as Record<string, unknown>;
  const cleanPayload = { ...payload };
  delete cleanPayload.__retryState;
  const depth = typeof cleanPayload.__automationDepth === "number" ? cleanPayload.__automationDepth : 0;

  const actionCtx: ActionContext = {
    organizationId: run.organizationId,
    eventKey: run.triggerEventKey,
    payload: cleanPayload,
    recordId: run.recordId,
    recordType: run.recordType,
    workflowId: run.workflowId,
    runId: run.id,
    depth,
  };

  let stillFailing = 0;
  let lastError: string | null = null;

  for (const step of failedSteps) {
    const impl = getAction(step.stepKey);
    if (!impl) {
      stillFailing++;
      continue;
    }
    const stepStartedAt = new Date();
    try {
      const output = await impl.execute(actionCtx, (step.inputJson ?? {}) as Record<string, unknown>);
      const completedAt = new Date();
      await prisma.automationRunStep.update({
        where: { id: step.id },
        data: {
          status: "SUCCESS",
          outputJson: output as Prisma.InputJsonObject,
          errorMessage: null,
          startedAt: stepStartedAt,
          completedAt,
          durationMs: completedAt.getTime() - stepStartedAt.getTime(),
        },
      });
      await recordUsage({
        organizationId: run.organizationId,
        workflowId: run.workflowId,
        runId: run.id,
        actionKey: step.stepKey,
        userId: run.userId,
        boardId: typeof cleanPayload.boardId === "string" ? cleanPayload.boardId : null,
        moduleName: run.recordType,
      });
    } catch (err) {
      stillFailing++;
      lastError = err instanceof Error ? err.message.slice(0, 500) : "Action failed";
      const completedAt = new Date();
      await prisma.automationRunStep.update({
        where: { id: step.id },
        data: {
          status: "FAILED",
          errorMessage: lastError,
          startedAt: stepStartedAt,
          completedAt,
          durationMs: completedAt.getTime() - stepStartedAt.getTime(),
        },
      });
    }
  }

  if (stillFailing === 0) {
    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        errorMessage: null,
        completedAt: new Date(),
        // Recovery also clears any pending cron retry schedule.
        triggerPayload: cleanPayload as Prisma.InputJsonObject,
      },
    });
  } else {
    const succeededBefore = run.steps.filter(
      (s) => s.stepType === "ACTION" && s.status === "SUCCESS",
    ).length;
    const succeededNow = failedSteps.length - stillFailing;
    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: succeededBefore + succeededNow > 0 ? "PARTIAL" : "FAILED",
        errorMessage: lastError,
        completedAt: new Date(),
      },
    });
  }

  const refreshed = await prisma.automationRun.findUnique({
    where: { id: run.id },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  return NextResponse.json({
    retried: failedSteps.length,
    recovered: stillFailing === 0,
    run: refreshed,
  });
}
