// The audit line every agent write leaves (spec-ai-automation section 2,
// /agents: "Every write goes through requireCan(manage, settings apps) and is
// audited"). Best effort: a failed log never fails the write it records.

import { logActivity } from "@/lib/activity";

export type AgentAuditAction = "added" | "turned_on" | "paused" | "removed" | "schedule_changed" | "run_now";

const WORDS: Record<AgentAuditAction, string> = {
  added: "added the agent",
  turned_on: "turned on the agent",
  paused: "paused the agent",
  removed: "removed the agent",
  schedule_changed: "changed the agent's schedule",
  run_now: "ran the agent",
};

export async function auditAgent(args: {
  organizationId: string;
  actorId: string;
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
      metadata: { actorType: "person", agentSlug: args.agent.slug, ...(args.metadata ?? {}) },
    });
  } catch {
    /* best effort */
  }
}
