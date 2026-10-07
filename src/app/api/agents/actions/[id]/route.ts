// GET /api/agents/actions/[id]: one of this person's own requests, as its
// card shows it, with the teammate it came from (the Inbox's approval pane).
// Anyone else's id, an Admin's view of it included, is the same 404 as a
// missing one, so an id never says that a request exists. Ask AI's own
// requests (no teammate) are read with their chat, never here.
//
// `actions` is every request the same run asked of this person, in the order
// it asked, this one among them: a routine that asks several things writes
// ONE Inbox row, linked to the first (routines-server.ts noticeApprovals), and
// the pane shows them all on one card. `action` is this one, as before.
//
// docs/plans/ai-teammates.md 4.

import { NextResponse } from "next/server";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { MAX_DECISIONS, actionViews } from "@/lib/agents/actions";
import { hueForAgent } from "@/lib/agents/hues";
import { TEAMMATE_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { id } = await params;
  const row = await prisma.agentAction.findFirst({
    where: { id, organizationId: viewer.organizationId, actingForId: viewer.userId, agentId: { not: null } },
    select: { id: true, runId: true, agentId: true, agent: { select: { slug: true, name: true, hue: true, avatar: true } } },
  });
  const agent = row?.agent;
  if (!row || !row.agentId || !agent) return teammateError(404, "not_found", TEAMMATE_ROUTE_ERRORS.actionNotFound);
  // The run's requests of this person, as many as one decision may carry.
  const run = row.runId
    ? await prisma.agentAction.findMany({
        where: { runId: row.runId, agentId: row.agentId, organizationId: viewer.organizationId, actingForId: viewer.userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_DECISIONS,
        select: { id: true },
      })
    : [];
  const ids = run.some((r) => r.id === row.id) ? run.map((r) => r.id) : [row.id, ...run.map((r) => r.id)].slice(0, MAX_DECISIONS);
  const views = await actionViews(ids, viewer.userId);
  const action = views[row.id];
  if (!action) return teammateError(404, "not_found", TEAMMATE_ROUTE_ERRORS.actionNotFound);
  return NextResponse.json({
    action,
    actions: ids.flatMap((x) => (views[x] ? [views[x]] : [])),
    agent: { slug: agent.slug, name: agent.name, hue: hueForAgent({ hue: agent.hue, slug: agent.slug }), avatar: agent.avatar },
  });
}
