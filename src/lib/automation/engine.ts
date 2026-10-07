import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { evaluateConditions } from "./conditions";
import { isEverywhere, liveDefinition, readScope, readWhen, scopeMatches, whenMatches, type ScopePlace } from "./definition";
import { readAutomationSettings } from "./settings";
import { buildIdempotencyKey, extractEventTimestamp, extractRecordId, extractEventQualifier } from "./idempotency";
import { getAction, type ActionContext } from "./registry-actions";
import { getUsageState, notifyLimitExceeded, recordUsage } from "./usage";
import { triggerDisplayName } from "./registry-triggers";
import { authorCanRead, eventAllowedForAuthor, loadAuthor, runReach, type AutomationAuthor } from "./author-reach";

/**
 * Automation engine entry point: called by `dispatchEvent` in
 * src/services/webhookDispatcher.ts, fire-and-forget.
 *
 * HARD GUARANTEE: this function NEVER throws. It sits on product
 * write-paths (task PATCH, KPI record, kudos post); an engine bug must
 * never fail a user's save. Every workflow run is additionally
 * isolated, so one broken automation can't starve its siblings.
 *
 * Safeguards (per docs/plans/automation-hub.md):
 *   idempotency: run key = sha(org + event + recordId + eventTs),
 *                 enforced by AutomationRun @@unique(workflowId,
 *                 idempotencyKey); the duplicate insert P2002s → skip.
 *   anti-loop  : chain depth carried as `__automationDepth` in the
 *                 payload (max 3) + per-record cap of 20 runs/hour.
 *   conditions : no match → run logged SKIPPED, nothing charged.
 *   usage      : monthly action limit blocks execution (run FAILED,
 *                 admins notified once per month).
 *   paused     : settings.work.automationsPaused stops every automation
 *                 in the workspace: nothing runs, nothing is charged.
 *   published  : a workflow runs its PUBLISHED version (the snapshot
 *                 publishedVersionId names), never the draft the builder
 *                 is editing; a row with no version runs its definition.
 *   scope      : definition.scope limits a workflow to Lists, Folders or
 *                 Spaces; a missing scope reads as Everywhere.
 *   retry      : failed retry-safe steps get `__retryState` seeded on
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
      // The registry's words when the definition carries no name, so a run
      // step reads "Set a field", never the raw key.
      name: typeof a.name === "string" && a.name ? a.name : getAction(key)?.name ?? key,
      params: asRecord(a.params ?? a.config),
    });
  }
  return { conditions: def.conditions ?? null, actions };
}

/** A teammate step's output as later steps read it. */
export function teammateStepData(output: Record<string, unknown> | null | undefined): NonNullable<ActionContext["stepData"]> {
  const o = output ?? {};
  return { teammate: { answer: typeof o.answer === "string" ? o.answer : "", name: typeof o.teammate === "string" ? o.teammate : "" } };
}

export interface RunAutomationsInput {
  organizationId: string;
  event: string;
  payload: unknown;
}

interface MatchedWorkflow {
  id: string;
  name: string;
  severity: "CRITICAL" | "MAJOR" | "MINOR";
  definition: Prisma.JsonValue;
  publishedVersionId: string | null;
  createdById: string | null;
  /** Who last saved the draft: the reach cap for an older row that runs its draft. */
  updatedById: string | null;
}

const MATCH_SELECT = {
  id: true,
  name: true,
  severity: true,
  definition: true,
  publishedVersionId: true,
  createdById: true,
  updatedById: true,
} as const;

export async function runAutomationsForEvent(input: RunAutomationsInput): Promise<void> {
  try {
    const { organizationId, event } = input;
    if (!organizationId || !event) return;

    // Matcher: hot index (organizationId, triggerEvent, status). The
    // column is the LIVE trigger (a draft trigger waits for Republish).
    const workflows = await prisma.automationWorkflow.findMany({
      where: { organizationId, triggerEvent: event, status: "ACTIVE" },
      select: MATCH_SELECT,
      orderBy: { createdAt: "asc" },
    });
    await runMatched({ organizationId, event, payload: input.payload, workflows });
  } catch {
    // NEVER throw into product write-paths.
  }
}

/**
 * Run ONE workflow for an event the caller already matched to it (the
 * schedule cron: "a task's date arrives", "on a schedule"). Every guard the
 * event path applies (status, pause, scope, idempotency, usage) applies here.
 * Never throws.
 */
export async function runAutomationForWorkflow(input: RunAutomationsInput & { workflowId: string }): Promise<number> {
  try {
    const workflows = await prisma.automationWorkflow.findMany({
      where: { id: input.workflowId, organizationId: input.organizationId, triggerEvent: input.event, status: "ACTIVE" },
      select: MATCH_SELECT,
    });
    return await runMatched({ organizationId: input.organizationId, event: input.event, payload: input.payload, workflows });
  } catch {
    // Never throws.
    return 0;
  }
}

async function runMatched(args: {
  organizationId: string;
  event: string;
  payload: unknown;
  workflows: MatchedWorkflow[];
}): Promise<number> {
  const { organizationId, event } = args;
  if (args.workflows.length === 0) return 0;
  const payload = toJsonSafe(asRecord(args.payload));

  // Anti-loop 1: chain depth. Events re-dispatched by automation
  // actions carry __automationDepth = parent depth + 1.
  const depth = typeof payload.__automationDepth === "number" ? payload.__automationDepth : 0;
  if (depth >= MAX_CHAIN_DEPTH) return 0;

  // Pause all automations (Settings > Apps and modules > Automations).
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
  if (readAutomationSettings(org?.settings).paused) return 0;

  // The published snapshot each workflow runs.
  const versionIds = args.workflows.map((w) => w.publishedVersionId).filter((v): v is string => !!v);
  const versions = versionIds.length
    ? await prisma.automationWorkflowVersion.findMany({
        where: { id: { in: versionIds }, organizationId },
        // createdById: who published the version that runs (its reach caps the run).
        select: { id: true, definitionJson: true, createdById: true },
      })
    : [];
  const versionById = new Map(versions.map((v) => [v.id, v]));

  // Where the record lives, looked up once and only when a workflow is scoped.
  let place: ScopePlace | null | undefined;
  const placeOf = async (): Promise<ScopePlace | null> => {
    if (place !== undefined) return place;
    const boardId = typeof payload.boardId === "string" && payload.boardId ? payload.boardId : null;
    if (!boardId) return (place = null);
    const board = await prisma.board.findFirst({
      where: { id: boardId, organizationId },
      select: { id: true, folderId: true, spaceId: true },
    });
    return (place = board ? { boardId: board.id, folderId: board.folderId, spaceId: board.spaceId } : null);
  };

  // The creator's reach (author-reach.ts), looked up once per creator.
  const authors = new Map<string, AutomationAuthor | null>();
  const authorOf = async (id: string): Promise<AutomationAuthor | null> => {
    if (!authors.has(id)) authors.set(id, await loadAuthor(organizationId, id));
    return authors.get(id) ?? null;
  };
  const eventBoardId = typeof payload.boardId === "string" && payload.boardId ? payload.boardId : null;

  const runnable: Array<MatchedWorkflow & { live: Prisma.JsonValue; author: AutomationAuthor | null | undefined; publisherId: string | null }> = [];
  for (const wf of args.workflows) {
    const version = wf.publishedVersionId ? versionById.get(wf.publishedVersionId) : undefined;
    const live = liveDefinition(wf, version ?? null) as Prisma.JsonValue;
    if (!whenMatches(event, readWhen(live), payload)) continue;
    // "On a schedule" fires for the workspace, not for a record, so it has
    // no place to match; its scope (if an older draft saved one) is moot.
    const placeless = event === "schedule.every";
    const scope = readScope(live);
    if (!placeless && !isEverywhere(scope) && !scopeMatches(scope, await placeOf())) continue;
    // The run's reach (runReach): the creator and whoever published what
    // runs, or last saved the draft when an older row runs its draft.
    const publisherId = version ? version.createdById ?? null : wf.updatedById;
    const author = await runReach(authorOf, { creatorId: wf.createdById, publisherId });
    if (author !== undefined) {
      if (!eventAllowedForAuthor(event, payload, author)) continue;
      if (eventBoardId && !(await authorCanRead(author, eventBoardId))) continue;
    }
    runnable.push({ ...wf, live, author, publisherId });
  }
  if (runnable.length === 0) return 0;

  const recordId = extractRecordId(payload);
  const recordType = event.includes(".") ? event.slice(0, event.indexOf(".")) : event;

  // Anti-loop 2: per-record runs/hour cap. Counts every run row for
  // the record (including SKIPPED), so a ping-pong pair of workflows
  // burns out fast and quietly.
  if (recordId) {
    const recent = await prisma.automationRun.count({
      where: { organizationId, recordId, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= MAX_RUNS_PER_RECORD_PER_HOUR) return 0;
  }

  const idempotencyKey = buildIdempotencyKey({
    organizationId,
    eventKey: event,
    recordId,
    eventTimestamp: extractEventTimestamp(payload),
    qualifier: extractEventQualifier(payload),
  });

  // Sequential per workflow: keeps per-record write ordering sane and
  // the DB load bounded. Each workflow's failure is isolated.
  let ran = 0;
  for (const wf of runnable) {
    try {
      const created = await runWorkflow({
        workflow: { ...wf, definition: wf.live },
        author: wf.author,
        publisherId: wf.publisherId,
        organizationId,
        event,
        payload,
        recordId,
        recordType,
        idempotencyKey,
        depth,
      });
      if (created) ran++;
    } catch {
      // One workflow's crash never blocks its siblings.
    }
  }
  return ran;
}

async function runWorkflow(args: {
  workflow: {
    id: string;
    name: string;
    severity: "CRITICAL" | "MAJOR" | "MINOR";
    definition: Prisma.JsonValue;
    publishedVersionId: string | null;
    createdById: string | null;
  };
  organizationId: string;
  event: string;
  payload: Record<string, unknown>;
  recordId: string | null;
  recordType: string | null;
  idempotencyKey: string;
  depth: number;
  author?: AutomationAuthor | null;
  /** Who published the version that runs: a teammate step runs only for its creator's own. */
  publisherId?: string | null;
}): Promise<boolean> {
  const { workflow, organizationId, event, payload, recordId, recordType, idempotencyKey, depth } = args;
  const startedAt = new Date();

  // Idempotency: the unique(workflowId, idempotencyKey) insert is the
  // dedupe gate: a duplicate trigger P2002s here and we skip silently.
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
    if (isP2002(err)) return false; // duplicate trigger event, already handled
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

    // Step 0: the trigger itself, for the run-detail drawer.
    await logStep({
      stepType: "TRIGGER",
      stepKey: event,
      stepName: triggerDisplayName(event),
      status: "SUCCESS",
      inputJson: payload,
      startedAt,
    });

    // Conditions: no match logs the run SKIPPED, nothing charged.
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
      return true;
    }

    if (def.actions.length === 0) {
      await finish("SUCCESS", "Workflow has no actions");
      return true;
    }

    // Usage gate: block the whole run when the monthly limit is spent.
    const usage = await getUsageState(organizationId);
    if (usage.blocked) {
      await finish("FAILED", `Monthly automation limit reached (${usage.used}/${usage.limit} actions used)`);
      await notifyLimitExceeded(organizationId, usage.limit);
      return true;
    }

    // Executor: each action isolated; failures downgrade the run to
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
      workflowCreatorId: workflow.createdById,
      author: args.author,
      publisherId: args.publisherId ?? null,
      workflowName: workflow.name,
    };

    let succeeded = 0;
    let failed = 0;
    let failedUnretryable = 0;
    let firstError: string | null = null;
    // What the latest "Ask an AI teammate" step that succeeded answered, for
    // the steps after it ({{teammate.answer}}).
    let stepData: NonNullable<ActionContext["stepData"]> = {};

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
        // The step's own order rides along, so a webhook delivery id is
        // unique per step and the same on every retry of that step.
        const output = await impl.execute({ ...ctx, stepOrder, stepData }, action.params);
        succeeded++;
        if (action.key === "ask_teammate") stepData = teammateStepData(output);
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
    // Seed retry state only when every failed step is retry-safe: the
    // cron re-runs exactly those steps (immediate → 5m → 30m).
    const retryable = failed > 0 && failedUnretryable === 0;
    await finish(
      status,
      firstError,
      retryable ? { attempt: 0, nextAttemptAt: new Date().toISOString() } : undefined,
    );
  } catch (err) {
    // Engine-level crash inside this run: mark it FAILED, never rethrow
    // to the caller loop (which also swallows).
    const message = err instanceof Error ? err.message.slice(0, 500) : "Automation engine error";
    await finish("FAILED", message).catch(() => {});
  }
  return true;
}
