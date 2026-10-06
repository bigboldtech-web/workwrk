// PUT /api/agents/teammates/[slug]/approvals
//   { rules: { [tool or "tool:target"]: "ask" | "always" | null } }
//
// This person's own choices of what the teammate asks them before doing
// (AgentPersonSetting.approvalRules), for anyone who can use it: theirs
// alone, never anyone else's, and never its managers' (who only tighten,
// through PATCH .../[slug]). null removes a choice. A choice the policy does
// not allow is dropped, not refused (tool-policy.ts sanitizeRules: never
// "Don't ask" for inviting people, for Talk only per conversation), and a
// "Don't ask" for one conversation or for a tool's calls for other people is
// only ever stored from an approval card, so here it can only be removed.
// Answers the whole table as it now stands: { tools: ToolSetting[] }.
//
// docs/plans/ai-teammates.md 3.5 and 4.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { auditAgent } from "@/lib/agents/audit";
import { invalidRequest, loadTeammate, teammateNotFound, toolTable } from "@/lib/agents/teammate-server";
import { ALL_TOOL_NAMES, editedPersonRules, sameRules } from "@/lib/agents/teammate-views";
import { sanitizeRules } from "@/lib/agents/tool-policy";

const putSchema = z.object({
  rules: z.record(z.string().max(120), z.enum(["ask", "always"]).nullable()).refine((r) => Object.keys(r).length <= 200),
});

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();

  const where = { agentId_userId: { agentId: agent.id, userId: viewer.userId } };
  const stored = (await prisma.agentPersonSetting.findUnique({ where, select: { approvalRules: true } }))?.approvalRules ?? {};
  const rules = editedPersonRules(stored, parsed.data.rules);
  if (!sameRules(rules, sanitizeRules(stored, { level: "person", allowedTools: ALL_TOOL_NAMES }))) {
    try {
      await prisma.agentPersonSetting.upsert({ where, create: { agentId: agent.id, userId: viewer.userId, approvalRules: rules }, update: { approvalRules: rules } });
    } catch (err) {
      // Two first saves at once: the other made the row, so this one updates it.
      if ((err as { code?: string } | null)?.code !== "P2002") throw err;
      await prisma.agentPersonSetting.update({ where, data: { approvalRules: rules } });
    }
    await auditAgent({ organizationId: viewer.organizationId, actorId: viewer.userId, agent, action: "approvals_changed", metadata: { scope: "person" } });
  }
  return NextResponse.json({ tools: await toolTable(agent, viewer.userId, { personRules: rules }) });
}
