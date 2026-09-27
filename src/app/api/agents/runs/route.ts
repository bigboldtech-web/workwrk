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
//   summary, sessionId, error }.
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
import { canReadRunDetail, runDurationMs, runSummary, runSummaryWithheld, runTrigger } from "@/lib/agents/run-view";

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
        input: true, output: true, error: true, triggeredBy: true,
        agent: { select: { name: true, slug: true } },
      },
    }),
    prisma.agentRun.count({ where }),
  ]);
  const page = rows.slice(0, q.take);
  const nextCursor = rows.length > q.take ? page[page.length - 1]?.id ?? null : null;

  return NextResponse.json({
    runs: page.map((r) => {
      const readable = canReadRunDetail(r, { userId: viewer.userId, admin });
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
        // AgentRun has no chat link today; the field is in the envelope so a
        // reader can rely on it when one is added.
        sessionId: null as string | null,
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
