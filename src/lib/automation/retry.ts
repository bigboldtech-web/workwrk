import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { getAction, type ActionContext } from "./registry-actions";
import { recordUsage } from "./usage";
import { loadAuthor, runReach } from "./author-reach";
import { teammateStepData } from "./engine";

/**
 * Retry queue: re-runs FAILED/PARTIAL runs whose failed steps are ALL
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
 * retry state seeded), and each retry re-runs exactly the FAILED steps;
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

/**
 * What the run's latest "Ask an AI teammate" step before `order` answered,
 * when it succeeded: a retried step reads {{teammate.answer}} as it would have.
 */
export function stepDataBefore(
  steps: ReadonlyArray<{ order: number; stepType: string; stepKey: string; status: string; outputJson: unknown }>,
  order: number,
): NonNullable<ActionContext["stepData"]> {
  // The engine's own rule: the latest teammate step before it, and only if
  // it answered (one that failed leaves no answer, never an earlier one's).
  const earlier = steps
    .filter((s) => s.stepType === "ACTION" && s.stepKey === "ask_teammate" && s.order < order)
    .sort((a, b) => a.order - b.order)
    .at(-1);
  if (!earlier) return {};
  if (earlier.status !== "SUCCESS") return { teammateFailed: true };
  return teammateStepData(earlier.outputJson && typeof earlier.outputJson === "object" ? (earlier.outputJson as Record<string, unknown>) : null);
}

/** Whether a run's steps include an "Ask an AI teammate" step, wherever it sits. */
export function teammateInSteps(steps: ReadonlyArray<{ stepType: string; stepKey: string }>): boolean {
  return steps.some((s) => s.stepType === "ACTION" && s.stepKey === "ask_teammate");
}

/**
 * A run still RUNNING this long after it started never finished: its process
 * stopped mid-run. Wide on purpose: each AI teammate step is a whole turn,
 * and an automation may hold several (review round 6).
 */
export const RUN_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * A run whose process stopped part way (a restart, out of memory) stays
 * RUNNING and reads "Running" in Logs for good; nothing retries it, since it
 * has no retry state. Each tick, one RUNNING past RUN_STALE_MS becomes
 * FAILED with that said. An AI teammate step can keep a run going for
 * minutes, so the window is wide (review round 5). Steps it already logged
 * are kept as they are.
 */
export async function failStaleRuns(now: Date = new Date()): Promise<number> {
  const stale = await prisma.automationRun.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - RUN_STALE_MS) } },
    data: { status: "FAILED", completedAt: now, errorMessage: STALE_RUN_MESSAGE },
  });
  return stale.count;
}

export const STALE_RUN_MESSAGE = "This run didn't finish: it stopped part way, so a step may not have run. Check the steps before running it again.";

export async function processAutomationRetries(): Promise<{
  scanned: number;
  retried: number;
  recovered: number;
}> {
  const now = Date.now();

  // Candidate scan: retry state only exists on runs the engine judged
  // retry-safe, and is taken off when the retries run out; the 48h window
  // keeps the scan bounded. Only runs that still hold it are read: failures
  // that can never be retried (an AI teammate step past its daily cap, a
  // spent plan) filled the 100 places before, and every workspace's real
  // retries waited behind them (review round 8). A partial index answers it
  // (prisma/sql/2026-10-08-ai-teammates-round8.sql).
  const since = new Date(now - 48 * 3_600_000);
  const due = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "AutomationRun"
    WHERE "status" IN ('FAILED', 'PARTIAL') AND "completedAt" >= ${since}
      AND "triggerPayload" ? '__retryState'
    ORDER BY "completedAt" ASC
    LIMIT 100`;
  if (due.length === 0) return { scanned: 0, retried: 0, recovered: 0 };
  const candidates = await prisma.automationRun.findMany({
    where: { id: { in: due.map((d) => d.id) } },
    orderBy: { completedAt: "asc" },
    include: {
      steps: { orderBy: { order: "asc" } },
      workflow: { select: { status: true, name: true, createdById: true, updatedById: true } },
      // Who published the version that ran: a retry is capped like the run (runReach).
      workflowVersion: { select: { createdById: true } },
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
      // Double-check retry safety: the engine only seeds state for safe
      // failures, but the catalog may have changed since.
      const allSafe = failedSteps.every((s) => getAction(s.stepKey)?.safeToRetry === true);
      if (!allSafe) continue;

      retried++;
      const cleanPayload = { ...payload };
      delete cleanPayload.__retryState;
      const depth = typeof cleanPayload.__automationDepth === "number" ? cleanPayload.__automationDepth : 0;
      const publisherId = run.workflowVersion ? run.workflowVersion.createdById : run.workflow.updatedById;
      const ctx: ActionContext = {
        organizationId: run.organizationId,
        eventKey: run.triggerEventKey,
        payload: cleanPayload,
        recordId: run.recordId,
        recordType: run.recordType,
        workflowId: run.workflowId,
        runId: run.id,
        depth,
        workflowCreatorId: run.workflow.createdById,
        // Capped as the run was: the creator and whoever published the
        // version that ran (or last saved the draft, for a run with no version).
        author: await runReach((id) => loadAuthor(run.organizationId, id), {
          creatorId: run.workflow.createdById,
          publisherId,
        }),
        publisherId,
        workflowName: run.workflow.name,
        teammateInRun: teammateInSteps(run.steps),
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
          // An earlier teammate step's answer, as the run's own steps read it.
          const stepData = stepDataBefore(run.steps, step.order);
          const output = await impl.execute({ ...ctx, stepOrder: step.order, stepData }, (step.inputJson ?? {}) as Record<string, unknown>);
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
        // Fully recovered: every ACTION step is now SUCCESS.
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

      // Still failing: advance or exhaust the backoff schedule.
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
