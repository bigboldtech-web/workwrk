// GET /api/agents/runs
//   ?agentSlug=<slug>              (the older ?agent= still works)
//   ?status=succeeded,failed,running
//   ?trigger=SCHEDULED|MANUAL
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD the start date range
//   ?sort=newest|oldest
//   ?take=1..100 (default 50; the older ?limit= still works)
//   ?cursor=<id>                   from nextCursor
//
// The Run history tab (spec-ai-automation section 2, /agents), in the cursor
// envelope { runs, total, nextCursor }. Each run is
// { id, agentSlug, agentName, status, trigger, startedAt, durationMs,
//   summary, sessionId, chatHref, error }.
//
// sessionId and chatHref name the chat a run belongs to (an AI teammate's
// turn records it, docs/plans/ai-teammates.md 3.15), and only when that chat
// is the viewer's own: a teammate's chat opens at /agents?chat=<slug>, an
// Ask AI chat at /sidekick?session=<id>.
//
// Every Member reads on the ai app key; what they read is narrower than the
// org because the rows carry tool results (src/lib/agents/run-query.ts):
// everyone reads the autonomous runs and the runs they triggered
// themselves, and nobody reads another person's chat rows. Inside an
// autonomous run somebody else started, a Member reads that it ran and how
// it went, never its words or results (run-view.ts canReadRunDetail): it
// acted with an admin's rights. `detailHidden` says so. Every filter is in
// the database query, so `total` is the real count.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isOwnerOrAdmin, requireApp } from "@/lib/app-gate";
import { agentRunsOrder, agentRunsWhere, parseRunQuery } from "@/lib/agents/run-query";
import { canReadRunDetail, runChatHref, runDurationMs, runSummary, runSummaryWithheld, runTrigger } from "@/lib/agents/run-view";

export async function GET(req: Request) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const q = parseRunQuery(new URL(req.url).searchParams);
  const admin = isOwnerOrAdmin(viewer);
  const where = agentRunsWhere(q, { organizationId: viewer.organizationId, userId: viewer.userId, admin });

  // A cursor that no longer names a row this viewer can read starts again
  // at the first page rather than erroring.
  const cursorValid = q.cursor ? (await prisma.agentRun.count({ where: { AND: [where, { id: q.cursor }] } })) > 0 : false;
  const [rows, total] = await Promise.all([
    prisma.agentRun.findMany({
      where,
      orderBy: agentRunsOrder(q.sort),
      take: q.take + 1,
      ...(q.cursor && cursorValid ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true, status: true, startedAt: true, endedAt: true, tokensIn: true, tokensOut: true,
        input: true, output: true, error: true, triggeredBy: true, sessionId: true,
        agent: { select: { name: true, slug: true } },
      },
    }),
    prisma.agentRun.count({ where }),
  ]);
  const page = rows.slice(0, q.take);
  const nextCursor = rows.length > q.take ? page[page.length - 1]?.id ?? null : null;

  // The chats of this page's runs that are the viewer's own, and what kind
  // each is. Anyone else's chat is not named.
  const sessionIds = [...new Set(page.flatMap((r) => (r.sessionId ? [r.sessionId] : [])))];
  const ownChats = sessionIds.length
    ? await prisma.chatSession.findMany({
        where: { id: { in: sessionIds }, userId: viewer.userId, organizationId: viewer.organizationId },
        select: { id: true, kind: true },
      })
    : [];
  const chatKind = new Map(ownChats.map((c) => [c.id, c.kind]));

  return NextResponse.json({
    runs: page.map((r) => {
      const readable = canReadRunDetail(r, { userId: viewer.userId, admin });
      const sessionId = r.sessionId && chatKind.has(r.sessionId) ? r.sessionId : null;
      return {
        id: r.id,
        agentName: r.agent.name,
        agentSlug: r.agent.slug,
        trigger: runTrigger(r.input),
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt?.toISOString() ?? null,
        durationMs: runDurationMs(r.startedAt, r.endedAt),
        summary: readable ? runSummary(r) : runSummaryWithheld(r),
        detailHidden: !readable,
        sessionId,
        chatHref: runChatHref(sessionId, sessionId ? chatKind.get(sessionId) : null, r.agent.slug),
        error: readable ? r.error : r.error ? "The run didn't finish." : null,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        // Kept for the Work home "Agent runs" card, which reads output.text.
        output: readable ? r.output : null,
      };
    }),
    total,
    nextCursor,
    restarted: Boolean(q.cursor) && !cursorValid,
  });
}
