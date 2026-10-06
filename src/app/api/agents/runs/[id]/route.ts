// GET /api/agents/runs/[id]: one agent run for the run detail inside the
// agent drawer (spec-ai-automation section 2, /agents "Agent run detail"):
// { run: { id, agentSlug, agentName, status, trigger, startedAt, endedAt,
//   durationMs, summary, error, sessionId, chatHref, toolCalls: [{ tool,
//   input, result, error, durationMs, state }] } }.
//
// sessionId and chatHref name the run's chat only when it is the viewer's
// own (/agents?chat=<slug> for an AI teammate's, /sidekick?session=<id> for
// Ask AI's); `state` says how an AI teammate's call ended (a call that
// waited for approval, or a practice call, never ran).
//
// The same visibility as the list (src/lib/agents/run-query.ts): everyone
// reads the autonomous runs and their own, nobody another person's chat
// rows. A Member reading an autonomous run somebody else started gets the
// status, times and the tool names only (run-view.ts canReadRunDetail), with
// detailHidden: true. Anything else, another org's id included, is the same
// 404, so an id never confirms that a run exists.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isOwnerOrAdmin, requireApp } from "@/lib/app-gate";
import { agentRunsWhere, parseRunQuery } from "@/lib/agents/run-query";
import { canReadRunDetail, runChatHref, runDurationMs, runSummary, runSummaryWithheld, runToolCalls, runTrigger, withheldToolCalls } from "@/lib/agents/run-view";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { id } = await params;
  const admin = isOwnerOrAdmin(viewer);
  const where = agentRunsWhere(parseRunQuery(new URLSearchParams()), {
    organizationId: viewer.organizationId,
    userId: viewer.userId,
    admin,
  });
  const run = await prisma.agentRun.findFirst({
    where: { AND: [where, { id }] },
    select: {
      id: true, status: true, startedAt: true, endedAt: true, tokensIn: true, tokensOut: true, costCents: true,
      input: true, output: true, error: true, triggeredBy: true, sessionId: true,
      agent: { select: { name: true, slug: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const readable = canReadRunDetail(run, { userId: viewer.userId, admin });
  const calls = readable ? runToolCalls(run) : withheldToolCalls(run);
  // The run's chat, when it is the viewer's own; anyone else's is not named.
  const chat = run.sessionId
    ? await prisma.chatSession.findFirst({
        where: { id: run.sessionId, userId: viewer.userId, organizationId: viewer.organizationId },
        select: { id: true, kind: true },
      })
    : null;
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
      summary: readable ? runSummary(run) : runSummaryWithheld(run),
      detailHidden: !readable,
      error: readable ? run.error : run.error ? "The run didn't finish." : null,
      sessionId: chat?.id ?? null,
      chatHref: runChatHref(chat?.id ?? null, chat?.kind, run.agent.slug),
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      toolCalls: calls.map((c) => ({ tool: c.name, input: c.input, result: c.result, error: c.error, durationMs: c.durationMs, state: c.state ?? null })),
      // The raw rows, as before, for a reader who may read them.
      input: readable ? run.input : null,
      output: readable ? run.output : null,
    },
  });
}
