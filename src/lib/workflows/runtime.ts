// Autopilot runtime — Phase D5.
//
// `triggerEvent(orgId, type, payload)` is fire-and-forget from API
// routes. It finds all active AUTOMATION workflows matching the event,
// evaluates conditions, then runs each action step. Every run creates
// a WorkflowRun row for audit.
//
// Failure model: actions throw → we log the error in WorkflowRun and
// continue to the next step (best-effort). One failing action does
// not abort the rest of the chain. Callers should never await the
// trigger — it's intentionally fire-and-forget so a slow workflow
// can't slow down a user-facing POST.

import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────

/** Fire-and-forget — call from any API route after writing to DB. */
export function triggerEvent(orgId: string, eventType: string, payload: Record<string, unknown>) {
  // Don't await — workflows should never block the user's request.
  runMatching(orgId, eventType, payload).catch((e) => {
    console.error("[autopilot] trigger error:", eventType, e);
  });
}

// ─────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────

interface Condition {
  field?: string;
  op?: "eq" | "ne" | "gt" | "lt" | "contains" | "in";
  value?: unknown;
}

interface ActionStep {
  id?: string;
  type: string;
  config?: Record<string, unknown>;
}

interface WorkflowDecisionLog {
  step: number;
  action: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  at: string;
}

async function runMatching(orgId: string, eventType: string, payload: Record<string, unknown>) {
  const workflows = await prisma.workflow.findMany({
    where: {
      organizationId: orgId,
      kind: "AUTOMATION",
      triggerEvent: eventType,
      active: true,
    },
  });
  if (workflows.length === 0) return;

  for (const wf of workflows) {
    // 1. Evaluate conditions. Empty {} = always run.
    const cond = (wf.conditions ?? {}) as Condition;
    if (!evaluateCondition(cond, payload)) continue;

    // 2. Materialize the run row so the audit trail starts immediately.
    const entityType = typeof payload.entityType === "string" ? payload.entityType : wf.targetType;
    const entityId = typeof payload.id === "string" ? payload.id : "";
    const run = await prisma.workflowRun.create({
      data: {
        organizationId: orgId,
        workflowId: wf.id,
        entityType,
        entityId,
        status: "IN_PROGRESS",
        currentStep: 0,
      },
    });

    // 3. Execute steps in order.
    const steps = (wf.steps as unknown as ActionStep[]) ?? [];
    const decisions: WorkflowDecisionLog[] = [];
    let overallStatus: "COMPLETED" | "FAILED" = "COMPLETED";

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const at = new Date().toISOString();
      try {
        const result = await executeAction(orgId, step, payload);
        decisions.push({ step: i, action: step.type, ok: true, result, at });
      } catch (err) {
        const error = err instanceof Error ? err.message : "action failed";
        decisions.push({ step: i, action: step.type, ok: false, error, at });
        overallStatus = "FAILED";
        // Continue to next step rather than abort the chain.
      }
    }

    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: overallStatus,
        currentStep: steps.length,
        decisions: decisions as object,
        completedAt: new Date(),
      },
    });
  }
}

function evaluateCondition(cond: Condition, payload: Record<string, unknown>): boolean {
  if (!cond.field) return true;
  const fieldVal = (payload as Record<string, unknown>)[cond.field];
  switch (cond.op) {
    case "eq":
      return fieldVal === cond.value;
    case "ne":
      return fieldVal !== cond.value;
    case "gt":
      return typeof fieldVal === "number" && typeof cond.value === "number" && fieldVal > cond.value;
    case "lt":
      return typeof fieldVal === "number" && typeof cond.value === "number" && fieldVal < cond.value;
    case "contains":
      return typeof fieldVal === "string" && typeof cond.value === "string" && fieldVal.toLowerCase().includes(cond.value.toLowerCase());
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(fieldVal);
    default:
      return true;
  }
}

// ─────────────────────────────────────────────────────────
// Action registry
// ─────────────────────────────────────────────────────────

async function executeAction(orgId: string, step: ActionStep, payload: Record<string, unknown>): Promise<unknown> {
  const cfg = step.config ?? {};
  switch (step.type) {
    case "notify":
      return executeNotify(orgId, cfg, payload);
    case "create_task":
      return executeCreateTask(orgId, cfg, payload);
    case "log":
      return { logged: true, payloadKeys: Object.keys(payload) };
    default:
      throw new Error(`Unknown action type: ${step.type}`);
  }
}

async function executeNotify(orgId: string, cfg: Record<string, unknown>, payload: Record<string, unknown>) {
  // Resolve recipient: cfg.toUserId | cfg.toUserEmail | payload.assigneeId | payload.ownerId
  let userId: string | null = (cfg.toUserId as string | undefined) ?? null;
  if (!userId && typeof cfg.toUserEmail === "string") {
    const u = await prisma.user.findFirst({
      where: { email: cfg.toUserEmail as string, organizationId: orgId },
      select: { id: true },
    });
    userId = u?.id ?? null;
  }
  if (!userId) {
    userId = (payload.assigneeId as string | undefined) ?? (payload.ownerId as string | undefined) ?? null;
  }
  if (!userId) {
    throw new Error("notify: no recipient (cfg.toUserId, cfg.toUserEmail, payload.assigneeId, or payload.ownerId required)");
  }

  const title = renderTemplate((cfg.title as string) ?? "Autopilot", payload);
  const message = renderTemplate((cfg.message as string) ?? "An automation fired", payload);
  const type = (cfg.notificationType as string) ?? "AUTOMATION";
  const link = (cfg.link as string | undefined) ?? undefined;

  const n = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      message,
      ...(link ? { link } : {}),
    },
    select: { id: true },
  });
  return { notificationId: n.id, userId };
}

async function executeCreateTask(orgId: string, cfg: Record<string, unknown>, payload: Record<string, unknown>) {
  const title = renderTemplate((cfg.title as string) ?? "Autopilot task", payload);
  const description = cfg.description ? renderTemplate(String(cfg.description), payload) : null;
  // Assignee: cfg.assigneeId > payload.ownerId > payload.assigneeId > first admin in org
  let assigneeId: string | null =
    (cfg.assigneeId as string | undefined)
    ?? (payload.ownerId as string | undefined)
    ?? (payload.assigneeId as string | undefined)
    ?? null;
  if (!assigneeId) {
    const admin = await prisma.user.findFirst({
      where: { organizationId: orgId, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
      select: { id: true },
    });
    assigneeId = admin?.id ?? null;
  }
  if (!assigneeId) throw new Error("create_task: no assignee resolvable");

  const priorityRaw = (cfg.priority as string) ?? "NORMAL";
  const priority: "LOW" | "NORMAL" | "HIGH" | "URGENT" =
    priorityRaw === "LOW" || priorityRaw === "HIGH" || priorityRaw === "URGENT" ? priorityRaw : "NORMAL";

  const t = await prisma.task.create({
    data: {
      organizationId: orgId,
      title,
      ...(description ? { description } : {}),
      priority,
      date: new Date(),
      assigneeId,
      source: "MANUAL",
    },
    select: { id: true, title: true },
  });
  return { taskId: t.id, title: t.title };
}

// Tiny template renderer — substitutes {{field}} with payload[field].
// Keeps the workflow JSON readable without a real template engine.
function renderTemplate(tpl: string, payload: Record<string, unknown>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = payload[key];
    return v == null ? "" : String(v);
  });
}
