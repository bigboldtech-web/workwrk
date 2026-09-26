// GET /api/automation/runs/[id]
//
// One run for the Logs drawer: the trigger payload and every step (trigger,
// condition, action) in order with its input, output and error, plus
//   triggerName   the trigger as words
//   record        the record it happened to (null when it cannot be shown)
//   detailHidden  true when the run is about a task in a List the viewer
//                 cannot open: the payloads are withheld, the steps keep
//                 their names, statuses, durations and errors
//   retry         { can, blockedBy }: Retry failed steps renders only when
//                 the viewer can edit the automation, the run failed or
//                 partly failed, and every failed step is safe to repeat
// A run from another workspace is a 404, the same as one that never existed.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAutomation, workflowRights } from "@/lib/automation/gate";
import { getAction } from "@/lib/automation/registry-actions";
import { resolveRunRecords } from "@/lib/automation/run-records-server";
import { triggerDisplayName } from "@/lib/automation/registry-triggers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const run = await prisma.automationRun.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      workflow: { select: { id: true, name: true, status: true, severity: true, createdById: true } },
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

  const records = await resolveRunRecords(ctx.viewer, ctx.orgId, ctx.isAdmin, [run]);
  const detailHidden = !records.canSeeDetail(run.recordType, run.recordId);

  const failedActions = run.steps.filter((s) => s.stepType === "ACTION" && s.status === "FAILED");
  const blockedBy = [...new Set(failedActions.filter((s) => getAction(s.stepKey)?.safeToRetry !== true).map((s) => s.stepName || s.stepKey))];
  const retryable =
    (run.status === "FAILED" || run.status === "PARTIAL") &&
    run.workflow.status !== "ARCHIVED" &&
    failedActions.length > 0 &&
    blockedBy.length === 0;

  const steps = run.steps.map((s) => ({
    ...s,
    stepName:
      s.stepType === "TRIGGER"
        ? triggerDisplayName(s.stepKey)
        : s.stepType === "ACTION" && (!s.stepName || s.stepName === s.stepKey)
          ? getAction(s.stepKey)?.name ?? s.stepName
          : s.stepName,
    ...(detailHidden ? { inputJson: null, outputJson: null } : {}),
  }));

  return NextResponse.json(
    {
      run: {
        ...run,
        steps,
        triggerPayload: detailHidden ? null : run.triggerPayload,
        triggerName: triggerDisplayName(run.triggerEventKey),
        record: records.record(run.recordType, run.recordId),
        detailHidden,
        retry: { can: retryable && workflowRights(ctx, run.workflow.createdById).edit, blockedBy: failedActions.length > 0 ? blockedBy : [] },
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
