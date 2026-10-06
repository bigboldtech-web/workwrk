// POST /api/agents/teammates/[slug]/read: this person has read their chat
// with the teammate up to now (AgentPersonSetting.lastReadAt), which clears
// the list's unread dot. docs/plans/ai-teammates.md 4.

import { NextResponse } from "next/server";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { loadTeammate, teammateNotFound } from "@/lib/agents/teammate-server";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();

  const now = new Date();
  const where = { agentId_userId: { agentId: agent.id, userId: viewer.userId } };
  try {
    await prisma.agentPersonSetting.upsert({ where, create: { agentId: agent.id, userId: viewer.userId, lastReadAt: now }, update: { lastReadAt: now } });
  } catch (err) {
    // Two first reads at once: the other made the row, so move its cursor.
    if ((err as { code?: string } | null)?.code !== "P2002") throw err;
    await prisma.agentPersonSetting.update({ where, data: { lastReadAt: now } });
  }
  return NextResponse.json({ ok: true });
}
