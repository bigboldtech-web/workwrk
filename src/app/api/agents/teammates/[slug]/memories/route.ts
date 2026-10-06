// GET  /api/agents/teammates/[slug]/memories: what the teammate remembers
//      for this person: their own memories, then (a workspace teammate only)
//      the ones its managers saved for everyone. Never another person's.
// POST /api/agents/teammates/[slug]/memories { key, value, scope? }
//      Remember one fact. scope "person" (the default) for anyone who can
//      use it; scope "agent", shared by everyone who uses it, only for a
//      manager of a workspace teammate. A private teammate keeps only its
//      owner's own. The same key (matched without case) is replaced.
//
// docs/plans/ai-teammates.md 3.8 and 4. Every refusal is { error, code }.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApp } from "@/lib/app-gate";
import { MEMORY_LIMITS, listMemories, rememberFact } from "@/lib/agents/memory";
import { canManageAgent } from "@/lib/agents/teammate-access";
import { TEAMMATE_ROUTE_ERRORS, TEAMMATE_TOOL_ERRORS, removedComposer } from "@/lib/agents/teammate-copy";
import { invalidRequest, loadTeammate, notManager, teammateError, teammateNotFound } from "@/lib/agents/teammate-server";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();
  const memories = await listMemories(agent.id, viewer.userId, { includeAgent: agent.visibility === "WORKSPACE" });
  return NextResponse.json({ memories });
}

const postSchema = z.object({
  key: z.string().trim().max(MEMORY_LIMITS.keyMax),
  value: z.string().trim().max(MEMORY_LIMITS.valueMax),
  scope: z.enum(["person", "agent"]).optional(),
});

export async function POST(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (agent.status === "ARCHIVED") return teammateError(409, "agent_removed", removedComposer(agent.name));
  const scope = parsed.data.scope ?? "person";
  if (scope === "agent") {
    if (agent.visibility !== "WORKSPACE") return teammateError(400, "invalid", TEAMMATE_ROUTE_ERRORS.privateMemoryScope);
    if (!canManageAgent(agent, viewer)) return notManager();
  }

  const saved = await rememberFact({
    agentId: agent.id,
    userId: viewer.userId,
    scope,
    key: parsed.data.key,
    value: parsed.data.value,
    source: "settings",
    createdById: viewer.userId,
  });
  if (!saved.ok) {
    return teammateError(400, saved.error === TEAMMATE_TOOL_ERRORS.memoryEmpty ? "invalid" : "limit", saved.error);
  }
  return NextResponse.json({ memory: saved.memory }, { status: saved.created ? 201 : 200 });
}
