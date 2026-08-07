import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { getAction, type ActionContext } from "./registry-actions";
import { recordUsage } from "./usage";

/**
 * Retry queue — re-runs FAILED/PARTIAL runs whose failed steps are ALL
 * retry-safe actions (notify/email/idempotent state-sets). Called by
 * POST /api/cron/automation-retry, mirroring `processWebhookRetries()`.
 *
 * Backoff lives on the run's triggerPayload as `__retryState`
 * (the AutomationRun table has no metadata column):
 *   { attempt: <retries done>, nextAttemptAt: <ISO> }
 * Seeded by the engine as { attempt: 0, nextAttemptAt: now } =
 * "retry on the next cron tick". Failed retries advance the schedule
 * immediate → +5m → +30m; after 3 retries the state is cleared and the
 * run stays FAILED for good.
 *
 * Duplicate-side-effect guard: only `safeToRetry` actions are ever
 * re-executed (create_task and other non-idempotent actions never get
 * retry state seeded), and each retry re-runs exactly the FAILED steps —
 * succeeded steps are never repeated.
 */

const MAX_RETRY_ATTEMPTS = 3;
const BACKOFF_AFTER_ATTEMPT_MS: Record<number, number> = {
  1: 5 * 60_000, // after 1st failed retry → wait 5m
  2: 30 * 60_000, // after 2nd failed retry → wait 30m
};

interface RetryState {
  attempt: number;
  nextAttemptAt: string;
}

function readRetryState(payload: Record<string, unknown>): RetryState | null {
  const raw = payload.__retryState;
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.attempt !== "number" || typeof s.nextAttemptAt !== "string") return null;
  return { attempt: s.attempt, nextAttemptAt: s.nextAttemptAt };
}

export async function processAutomationRetries(): Promise<{
  scanned: number;
  retried: number;
  recovered: number;
}> {
  const now = Date.now();

  // Candidate scan — retry state only exists on runs the engine judged
  // retry-safe; the 48h window keeps the scan cheap and bounded.
  const candidates = await prisma.automationRun.findMany({
    where: {
      status: { in: ["FAILED", "PARTIAL"] },
      completedAt: { gte: new Date(now - 48 * 3_600_000) },
    },
    orderBy: { completedAt: "asc" },
    take: 100,
    include: {
      steps: { orderBy: { order: "asc" } },
      workflow: { select: { status: true } },
    },
  });

  let retried = 0;
  let recovered = 0;

  for (const run of candidates) {
    try {
      const payload = (run.triggerPayload ?? {}) as Record<string, unknown>;
      const state = readRetryState(payload);
      if (!state) continue;
      if (state.attempt >= MAX_RETRY_ATTEMPTS) continue;
      if (new Date(state.nextAttemptAt).getTime() > now) continue;
      // A deactivated/archived workflow stops retrying too.
      if (run.workflow.status !== "ACTIVE") continue;

      const failedSteps = run.steps.filter((s) => s.stepType === "ACTION" && s.status === "FAILED");
      if (failedSteps.length === 0) continue;
      // Double-check retry safety — the engine only seeds state for safe
      // failures, but the catalog may have changed since.
      const allSafe = failedSteps.every((s) => getAction(s.stepKey)?.safeToRetry === true);
      if (!allSafe) continue;

      retried++;
      const cleanPayload = { ...payload };
      delete cleanPayload.__retryState;
      const depth = typeof cleanPayload.__automationDepth === "number" ? cleanPayload.__automationDepth : 0;
      const ctx: ActionContext = {
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
          const output = await impl.execute(ctx, (step.inputJson ?? {}) as Record<string, unknown>);
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
        // Fully recovered — every ACTION step is now SUCCESS.
        recovered++;
        await prisma.automationRun.update({
          where: { id: run.id },
          data: {
            status: "SUCCESS",
            errorMessage: null,
            completedAt: new Date(),
            triggerPayload: cleanPayload as Prisma.InputJsonObject,
          },
        });
        continue;
      }

      // Still failing — advance or exhaust the backoff schedule.
      const attempt = state.attempt + 1;
      const exhausted = attempt >= MAX_RETRY_ATTEMPTS;
      const nextPayload = exhausted
        ? cleanPayload
        : {
            ...cleanPayload,
            __retryState: {
              attempt,
              nextAttemptAt: new Date(now + (BACKOFF_AFTER_ATTEMPT_MS[attempt] ?? 30 * 60_000)).toISOString(),
            },
          };
      const succeededCount = run.steps.filter((s) => s.stepType === "ACTION" && s.status === "SUCCESS").length
        + (failedSteps.length - stillFailing);
      await prisma.automationRun.update({
        where: { id: run.id },
        data: {
          status: succeededCount > 0 ? "PARTIAL" : "FAILED",
          errorMessage: lastError,
          completedAt: new Date(),
          triggerPayload: nextPayload as Prisma.InputJsonObject,
        },
      });
    } catch {
      // One bad run never blocks the rest of the queue.
    }
  }

  return { scanned: candidates.length, retried, recovered };
}
