// GET /api/agents/actions/[id]: one of this person's own requests, as its
// card shows it, with the teammate it came from (the Inbox's approval pane).
// Anyone else's id, an Admin's view of it included, is the same 404 as a
// missing one, so an id never says that a request exists.
//
// docs/plans/ai-teammates.md 4.

import { NextResponse } from "next/server";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { actionViews } from "@/lib/agents/actions";
import { hueForAgent } from "@/lib/agents/hues";
import { TEAMMATE_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { id } = await params;
  const row = await prisma.agentAction.findFirst({
    where: { id, organizationId: viewer.organizationId, actingForId: viewer.userId },
    select: { id: true, agent: { select: { slug: true, name: true, hue: true, avatar: true } } },
  });
  const action = row ? (await actionViews([row.id], viewer.userId))[row.id] : undefined;
  if (!row || !action) return teammateError(404, "not_found", TEAMMATE_ROUTE_ERRORS.actionNotFound);
  return NextResponse.json({
    action,
    agent: { slug: row.agent.slug, name: row.agent.name, hue: hueForAgent({ hue: row.agent.hue, slug: row.agent.slug }), avatar: row.agent.avatar },
  });
}
