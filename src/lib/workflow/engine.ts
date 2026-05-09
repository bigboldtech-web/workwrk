// Workflow runtime.
//
// A Workflow has an ordered array of steps stored as JSON. Each step
// declares an `approverRule` (MANAGER / ADMIN / ROLE / USER) and an
// optional `approverValue` (the role name or user id, depending on
// rule). When a record is submitted (an Expense, PO, comp decision,
// etc.), `startRun()` finds an active workflow targeting that record
// type and creates a WorkflowRun rooted at step 0.
//
// `decideStep()` records the actor's vote, advances the run to the
// next step or marks it APPROVED / REJECTED, and emits an
// ActivityLog row so reviewers see the audit trail.

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export type WorkflowStep = {
  id: string;
  name: string;
  approverRule: "MANAGER" | "ADMIN" | "ROLE" | "USER";
  approverValue?: string;
  slaHours?: number;
  requireNote?: boolean;
};

export type WorkflowDecision = {
  step: number;
  decidedBy: string;     // userId
  decision: "APPROVE" | "REJECT";
  note: string | null;
  at: string;            // ISO timestamp
};

/**
 * Find the active Workflow for an entityType and start a run on it.
 * Returns null if no workflow is configured (caller should fall back
 * to legacy approval flow).
 */
export async function startRun(args: {
  organizationId: string;
  entityType: string;
  entityId: string;
}): Promise<{ id: string; workflowId: string; status: "IN_PROGRESS" } | null> {
  const wf = await prisma.workflow.findFirst({
    where: {
      organizationId: args.organizationId,
      targetType: args.entityType,
      active: true,
    },
    select: { id: true, steps: true },
  });
  if (!wf) return null;
  const steps = parseSteps(wf.steps);
  if (steps.length === 0) return null;

  const run = await prisma.workflowRun.create({
    data: {
      organizationId: args.organizationId,
      workflowId: wf.id,
      entityType: args.entityType,
      entityId: args.entityId,
      status: "IN_PROGRESS",
      currentStep: 0,
      decisions: [],
    },
    select: { id: true, workflowId: true },
  });
  return { id: run.id, workflowId: run.workflowId, status: "IN_PROGRESS" };
}

/**
 * Decide the current step. Advances to the next step on APPROVE or
 * marks the run REJECTED on REJECT. Validates that the actor is
 * eligible per the step's approver rule.
 */
export async function decideStep(args: {
  runId: string;
  actorId: string;
  decision: "APPROVE" | "REJECT";
  note?: string | null;
}): Promise<{
  status: "IN_PROGRESS" | "APPROVED" | "REJECTED";
  step: number;
  totalSteps: number;
}> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: args.runId },
    include: { workflow: { select: { steps: true, organizationId: true, name: true } } },
  });
  if (!run) throw new Error("WorkflowRun not found");
  if (run.status !== "IN_PROGRESS") throw new Error(`Run is ${run.status}`);

  const steps = parseSteps(run.workflow.steps);
  const step = steps[run.currentStep];
  if (!step) throw new Error("Step out of bounds");

  const allowed = await actorMatchesRule({
    organizationId: run.workflow.organizationId,
    actorId: args.actorId,
    rule: step.approverRule,
    value: step.approverValue,
  });
  if (!allowed) throw new Error("Actor not eligible to decide this step");

  if (step.requireNote && !args.note?.trim()) {
    throw new Error("Note is required for this step");
  }

  const decisions = parseDecisions(run.decisions);
  decisions.push({
    step: run.currentStep,
    decidedBy: args.actorId,
    decision: args.decision,
    note: args.note?.trim() || null,
    at: new Date().toISOString(),
  });

  if (args.decision === "REJECT") {
    await prisma.workflowRun.update({
      where: { id: args.runId },
      data: {
        status: "REJECTED",
        decisions,
        completedAt: new Date(),
      },
    });
    logActivity({
      type: "workflow_rejected",
      actorId: args.actorId,
      organizationId: run.workflow.organizationId,
      description: `Rejected workflow ${run.workflow.name} at step ${run.currentStep + 1}`,
      targetType: run.entityType,
      targetId: run.entityId,
      severity: "warning",
    });
    return { status: "REJECTED", step: run.currentStep, totalSteps: steps.length };
  }

  // APPROVE — advance.
  const nextIdx = run.currentStep + 1;
  if (nextIdx >= steps.length) {
    await prisma.workflowRun.update({
      where: { id: args.runId },
      data: {
        status: "APPROVED",
        currentStep: nextIdx,
        decisions,
        completedAt: new Date(),
      },
    });
    logActivity({
      type: "workflow_approved",
      actorId: args.actorId,
      organizationId: run.workflow.organizationId,
      description: `Approved workflow ${run.workflow.name} (${steps.length} steps)`,
      targetType: run.entityType,
      targetId: run.entityId,
      severity: "info",
    });
    return { status: "APPROVED", step: nextIdx, totalSteps: steps.length };
  }

  await prisma.workflowRun.update({
    where: { id: args.runId },
    data: { currentStep: nextIdx, decisions },
  });
  return { status: "IN_PROGRESS", step: nextIdx, totalSteps: steps.length };
}

/**
 * Cancel an IN_PROGRESS run. Used when the underlying record is
 * deleted or retracted.
 */
export async function cancelRun(runId: string): Promise<void> {
  await prisma.workflowRun.update({
    where: { id: runId },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
}

// ────────────────────────────────────────────────────────────────

function parseSteps(raw: unknown): WorkflowStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is WorkflowStep => {
    if (!s || typeof s !== "object") return false;
    const o = s as Record<string, unknown>;
    return typeof o.id === "string" && typeof o.name === "string" && typeof o.approverRule === "string";
  });
}

function parseDecisions(raw: unknown): WorkflowDecision[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is WorkflowDecision => {
    if (!d || typeof d !== "object") return false;
    const o = d as Record<string, unknown>;
    return typeof o.step === "number" && typeof o.decidedBy === "string";
  });
}

/**
 * Check if `actorId` satisfies the step's approver rule.
 *
 *   MANAGER → actor must be the entity-subject's manager (resolved
 *             via User.managerId chain), OR any user with manager+
 *             access level if the entity has no specific subject.
 *   ADMIN   → actor must hold an admin-tier access level.
 *   ROLE    → actor must hold the named role (Role.name).
 *   USER    → actor.id must equal approverValue.
 */
async function actorMatchesRule(args: {
  organizationId: string;
  actorId: string;
  rule: WorkflowStep["approverRule"];
  value?: string;
}): Promise<boolean> {
  const actor = await prisma.user.findUnique({
    where: { id: args.actorId },
    select: { id: true, accessLevel: true, organizationId: true, roleId: true, role: { select: { title: true } } },
  });
  if (!actor || actor.organizationId !== args.organizationId) return false;

  const MANAGER_ROLES = new Set([
    "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
    "MANAGER", "TEAM_LEAD", "HR",
  ]);
  const ADMIN_ROLES = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "HR"]);

  switch (args.rule) {
    case "MANAGER":
      return MANAGER_ROLES.has(actor.accessLevel);
    case "ADMIN":
      return ADMIN_ROLES.has(actor.accessLevel);
    case "ROLE":
      return !!args.value && actor.role?.title === args.value;
    case "USER":
      return !!args.value && actor.id === args.value;
    default:
      return false;
  }
}
