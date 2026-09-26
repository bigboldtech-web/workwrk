// GET /api/agents/runs/[id]: one agent run for the run detail inside the
// agent drawer (spec-ai-automation section 2, /agents "Agent run detail"):
// { run: { id, agentSlug, agentName, status, trigger, startedAt, endedAt,
//   durationMs, summary, error, sessionId, toolCalls: [{ tool, input,
//   result, error, durationMs }] } }.
//
// The same visibility as the list (src/lib/agents/run-query.ts): Owner and
// Admin read any run in the workspace; everyone else reads the autonomous
// runs and their own. Anything else, another org's id included, is the same
// 404, so an id never confirms that a run exists.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isOwnerOrAdmin, requireApp } from "@/lib/app-gate";
import { agentRunsWhere, parseRunQuery } from "@/lib/agents/run-query";
import { runDurationMs, runSummary, runToolCalls, runTrigger } from "@/lib/agents/run-view";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { id } = await params;
  const where = agentRunsWhere(parseRunQuery(new URLSearchParams()), {
    organizationId: viewer.organizationId,
    userId: viewer.userId,
    admin: isOwnerOrAdmin(viewer),
  });
  const run = await prisma.agentRun.findFirst({
    where: { AND: [where, { id }] },
    select: {
      id: true, status: true, startedAt: true, endedAt: true, tokensIn: true, tokensOut: true, costCents: true,
      input: true, output: true, error: true, triggeredBy: true,
      agent: { select: { name: true, slug: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    run: {
      id: run.id,
      agentSlug: run.agent.slug,
      agentName: run.agent.name,
      agent: run.agent,
      status: run.status,
      trigger: runTrigger(run.input),
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt?.toISOString() ?? null,
      durationMs: runDurationMs(run.startedAt, run.endedAt),
      summary: runSummary(run),
      error: run.error,
      sessionId: null as string | null,
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      toolCalls: runToolCalls(run).map((c) => ({ tool: c.name, input: c.input, result: c.result, error: c.error, durationMs: c.durationMs })),
      // The raw rows, as before, for any reader that wants them.
      input: run.input,
      output: run.output,
    },
  });
}
