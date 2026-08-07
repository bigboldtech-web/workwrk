import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { evaluateConditions } from "./conditions";
import { buildIdempotencyKey, extractEventTimestamp, extractRecordId } from "./idempotency";
import { getAction, type ActionContext } from "./registry-actions";
import { getUsageState, notifyLimitExceeded, recordUsage } from "./usage";

/**
 * Automation engine entry point — called by `dispatchEvent` in
 * src/services/webhookDispatcher.ts, fire-and-forget.
 *
 * HARD GUARANTEE: this function NEVER throws. It sits on product
 * write-paths (task PATCH, KPI record, kudos post); an engine bug must
 * never fail a user's save. Every workflow run is additionally
 * isolated, so one broken automation can't starve its siblings.
 *
 * Safeguards (per docs/plans/automation-hub.md):
 *   idempotency — run key = sha(org + event + recordId + eventTs),
 *                 enforced by AutomationRun @@unique(workflowId,
 *                 idempotencyKey); the duplicate insert P2002s → skip.
 *   anti-loop   — chain depth carried as `__automationDepth` in the
 *                 payload (max 3) + per-record cap of 20 runs/hour.
 *   conditions  — no match → run logged SKIPPED, nothing charged.
 *   usage       — monthly action limit blocks execution (run FAILED,
 *                 admins notified once per month).
 *   retry       — failed retry-safe steps get `__retryState` seeded on
 *                 the run's triggerPayload; /api/cron/automation-retry
 *                 re-runs them with immediate → 5m → 30m backoff.
 */

export const MAX_CHAIN_DEPTH = 3;
export const MAX_RUNS_PER_RECORD_PER_HOUR = 20;

export interface NormalizedAction {
  key: string;
  name: string;
  params: Record<string, unknown>;
}

export interface ParsedDefinition {
  conditions: unknown;
  actions: NormalizedAction[];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Strip functions/Dates/cycles so the payload stores cleanly as Json. */
function toJsonSafe(payload: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isP2002(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

/** Accepts both builder shapes: {key|action|type, name, params|config}. */
export function parseDefinition(definition: unknown): ParsedDefinition {
  const def = asRecord(definition);
  const rawActions = Array.isArray(def.actions) ? def.actions : [];
  const actions: NormalizedAction[] = [];
  for (const raw of rawActions) {
    const a = asRecord(raw);
    const key = typeof a.key === "string" ? a.key : typeof a.action === "string" ? a.action : typeof a.type === "string" ? a.type : null;
    if (!key) continue;
    actions.push({
      key,
      name: typeof a.name === "string" && a.name ? a.name : key,
      params: asRecord(a.params ?? a.config),
    });
  }
  return { conditions: def.conditions ?? null, actions };
}

export interface RunAutomationsInput {
  organizationId: string;
  event: string;
  payload: unknown;
}

export async function runAutomationsForEvent(input: RunAutomationsInput): Promise<void> {
  try {
    const { organizationId, event } = input;
    if (!organizationId || !event) return;
    const payload = toJsonSafe(asRecord(input.payload));

    // Anti-loop 1: chain depth. Events re-dispatched by automation
    // actions carry __automationDepth = parent depth + 1.
    const depth = typeof payload.__automationDepth === "number" ? payload.__automationDepth : 0;
    if (depth >= MAX_CHAIN_DEPTH) return;

    // Matcher — hot index (organizationId, triggerEvent, status).
    const workflows = await prisma.automationWorkflow.findMany({
      where: { organizationId, triggerEvent: event, status: "ACTIVE" },
      select: { id: true, name: true, severity: true, definition: true, publishedVersionId: true },
      orderBy: { createdAt: "asc" },
    });
    if (workflows.length === 0) return;

    const recordId = extractRecordId(payload);
    const recordType = event.includes(".") ? event.slice(0, event.indexOf(".")) : event;

    // Anti-loop 2: per-record runs/hour cap. Counts every run row for
    // the record (including SKIPPED), so a ping-pong pair of workflows
    // burns out fast and quietly.
    if (recordId) {
      const recent = await prisma.automationRun.count({
        where: { organizationId, recordId, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
      });
      if (recent >= MAX_RUNS_PER_RECORD_PER_HOUR) return;
    }

    const idempotencyKey = buildIdempotencyKey({
      organizationId,
      eventKey: event,
      recordId,
      eventTimestamp: extractEventTimestamp(payload),
    });

    // Sequential per workflow — keeps per-record write ordering sane and
    // the DB load bounded. Each workflow's failure is isolated.
    for (const wf of workflows) {
      try {
        await runWorkflow({
          workflow: wf,
          organizationId,
          event,
          payload,
          recordId,
          recordType,
          idempotencyKey,
          depth,
        });
      } catch {
        // One workflow's crash never blocks its siblings.
      }
    }
  } catch {
    // NEVER throw into product write-paths.
  }
}

async function runWorkflow(args: {
  workflow: {
    id: string;
    name: string;
    severity: "CRITICAL" | "MAJOR" | "MINOR";
    definition: Prisma.JsonValue;
    publishedVersionId: string | null;
  };
  organizationId: string;
  event: string;
  payload: Record<string, unknown>;
  recordId: string | null;
  recordType: string | null;
  idempotencyKey: string;
  depth: number;
}): Promise<void> {
  const { workflow, organizationId, event, payload, recordId, recordType, idempotencyKey, depth } = args;
  const startedAt = new Date();

  // Idempotency: the unique(workflowId, idempotencyKey) insert is the
  // dedupe gate — a duplicate trigger P2002s here and we skip silently.
  let runId: string;
  try {
    const run = await prisma.automationRun.create({
      data: {
        organizationId,
        workflowId: workflow.id,
        workflowVersionId: workflow.publishedVersionId,
        triggerEventKey: event,
        triggerPayload: payload as Prisma.InputJsonObject,
        status: "RUNNING",
        severity: workflow.severity,
        idempotencyKey,
        recordType,
        recordId,
        userId: typeof payload.actorId === "string" ? payload.actorId : null,
        startedAt,
      },
      select: { id: true },
    });
    runId = run.id;
  } catch (err) {
    if (isP2002(err)) return; // duplicate trigger event — already handled
    throw err;
  }

  const finish = async (
    status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED",
    errorMessage: string | null,
    retryState?: { attempt: number; nextAttemptAt: string },
  ) => {
    const completedAt = new Date();
    await prisma.automationRun.update({
      where: { id: runId },
      data: {
        status,
        errorMessage,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        ...(retryState
          ? { triggerPayload: { ...payload, __retryState: retryState } as Prisma.InputJsonObject }
          : {}),
      },
    });
    await prisma.automationWorkflow.update({
      where: { id: workflow.id },
      data: { lastRunAt: completedAt },
    }).catch(() => {});
  };

  let stepOrder = 0;
  const logStep = async (input: {
    stepType: "TRIGGER" | "CONDITION" | "ACTION";
    stepKey: string;
    stepName: string;
    status: "SUCCESS" | "FAILED" | "SKIPPED";
    inputJson?: Record<string, unknown>;
    outputJson?: Record<string, unknown>;
    errorMessage?: string | null;
    startedAt: Date;
  }) => {
    const completedAt = new Date();
    await prisma.automationRunStep.create({
      data: {
        organizationId,
        runId,
        order: stepOrder++,
        stepType: input.stepType,
        stepKey: input.stepKey,
        stepName: input.stepName,
        status: input.status,
        inputJson: (input.inputJson ?? {}) as Prisma.InputJsonObject,
        outputJson: (input.outputJson ?? {}) as Prisma.InputJsonObject,
        errorMessage: input.errorMessage ?? null,
        startedAt: input.startedAt,
        completedAt,
        durationMs: completedAt.getTime() - input.startedAt.getTime(),
      },
    });
  };

  try {
    const def = parseDefinition(workflow.definition);

    // Step 0 — the trigger itself, for the run-detail drawer.
    await logStep({
      stepType: "TRIGGER",
      stepKey: event,
      stepName: `Trigger: ${event}`,
      status: "SUCCESS",
      inputJson: payload,
      startedAt,
    });

    // Conditions — no match logs the run SKIPPED, nothing charged.
    const condStartedAt = new Date();
    const evaluation = evaluateConditions(def.conditions, payload);
    if (def.conditions) {
      await logStep({
        stepType: "CONDITION",
        stepKey: "conditions",
        stepName: "Check conditions",
        status: evaluation.matched ? "SUCCESS" : "SKIPPED",
        inputJson: asRecord(def.conditions),
        outputJson: { matched: evaluation.matched, trace: evaluation.trace },
        startedAt: condStartedAt,
      });
    }
    if (!evaluation.matched) {
      await finish("SKIPPED", null);
      return;
    }

    if (def.actions.length === 0) {
      await finish("SUCCESS", "Workflow has no actions");
      return;
    }

    // Usage gate — block the whole run when the monthly limit is spent.
    const usage = await getUsageState(organizationId);
    if (usage.blocked) {
      await finish("FAILED", `Monthly automation limit reached (${usage.used}/${usage.limit} actions used)`);
      await notifyLimitExceeded(organizationId, usage.limit);
      return;
    }

    // Executor — each action isolated; failures downgrade the run to
    // PARTIAL/FAILED instead of aborting the remainder.
    const ctx: ActionContext = {
      organizationId,
      eventKey: event,
      payload,
      recordId,
      recordType,
      workflowId: workflow.id,
      runId,
      depth,
    };

    let succeeded = 0;
    let failed = 0;
    let failedUnretryable = 0;
    let firstError: string | null = null;

    for (const action of def.actions) {
      const stepStartedAt = new Date();
      const impl = getAction(action.key);
      if (!impl) {
        failed++;
        failedUnretryable++;
        firstError ??= `Unknown action: ${action.key}`;
        await logStep({
          stepType: "ACTION",
          stepKey: action.key,
          stepName: action.name,
          status: "FAILED",
          inputJson: action.params,
          errorMessage: `Unknown action: ${action.key}`,
          startedAt: stepStartedAt,
        });
        continue;
      }
      try {
        const output = await impl.execute(ctx, action.params);
        succeeded++;
        await logStep({
          stepType: "ACTION",
          stepKey: action.key,
          stepName: action.name,
          status: "SUCCESS",
          inputJson: action.params,
          outputJson: output,
          startedAt: stepStartedAt,
        });
        await recordUsage({
          organizationId,
          workflowId: workflow.id,
          runId,
          actionKey: action.key,
          userId: typeof payload.actorId === "string" ? payload.actorId : null,
          boardId: typeof payload.boardId === "string" ? payload.boardId : null,
          moduleName: recordType,
        });
      } catch (err) {
        failed++;
        if (!impl.safeToRetry) failedUnretryable++;
        const message = err instanceof Error ? err.message.slice(0, 500) : "Action failed";
        firstError ??= message;
        await logStep({
          stepType: "ACTION",
          stepKey: action.key,
          stepName: action.name,
          status: "FAILED",
          inputJson: action.params,
          errorMessage: message,
          startedAt: stepStartedAt,
        });
      }
    }

    const status = failed === 0 ? "SUCCESS" : succeeded > 0 ? "PARTIAL" : "FAILED";
    // Seed retry state only when every failed step is retry-safe — the
    // cron re-runs exactly those steps (immediate → 5m → 30m).
    const retryable = failed > 0 && failedUnretryable === 0;
    await finish(
      status,
      firstError,
      retryable ? { attempt: 0, nextAttemptAt: new Date().toISOString() } : undefined,
    );
  } catch (err) {
    // Engine-level crash inside this run — mark it FAILED, never rethrow
    // to the caller loop (which also swallows).
    const message = err instanceof Error ? err.message.slice(0, 500) : "Automation engine error";
    await finish("FAILED", message).catch(() => {});
  }
}
