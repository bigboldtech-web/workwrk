// The audit line every agent write leaves (spec-ai-automation section 2,
// /agents: "Every write goes through requireCan(manage, settings apps) and is
// audited"). Best effort: a failed log never fails the write it records.

import { logActivity } from "@/lib/activity";

export type AgentAuditAction =
  | "added"
  | "turned_on"
  | "paused"
  | "removed"
  | "schedule_changed"
  | "run_now"
  | "edited"
  | "approvals_changed"
  | "schedule_moved"
  | "schedule_stopped";

const WORDS: Record<AgentAuditAction, string> = {
  added: "added the agent",
  turned_on: "turned on the agent",
  paused: "paused the agent",
  removed: "removed the agent",
  schedule_changed: "changed the agent's schedule",
  run_now: "ran the agent",
  // AI teammates (docs/plans/ai-teammates.md 3.11): its name, job,
  // instructions, tools, colour or limit; and what it asks before doing.
  edited: "changed the agent",
  approvals_changed: "changed what the agent asks before doing",
  // AI teammates, Phase 2 (legacy-schedules.ts): no person did these; the
  // move of the old Workspace agents schedules did.
  schedule_moved: "moved the agent's schedule to a routine",
  schedule_stopped: "stopped the agent's schedule",
};

export async function auditAgent(args: {
  organizationId: string;
  /** Null when no person did it (actorType "system"). */
  actorId: string | null;
  /** Who did it: the person by default, or the system (a schedule moved). */
  actorType?: "person" | "system";
  agent: { id: string; name?: string | null; slug: string };
  action: AgentAuditAction;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await logActivity({
      type: `agent_${args.action}`,
      actorId: args.actorId,
      organizationId: args.organizationId,
      description: `${WORDS[args.action]} ${args.agent.name ?? args.agent.slug}`,
      targetId: args.agent.id,
      targetType: "agent",
      // The person acted for themselves; an agent run records its own actor.
      metadata: { actorType: args.actorType ?? "person", agentSlug: args.agent.slug, ...(args.metadata ?? {}) },
      ...(args.actorType === "system" ? { actorType: "system", actorLabel: "WorkwrK" } : {}),
    });
  } catch {
    /* best effort */
  }
}
