// GET /api/agents/teammates/[slug]/activity: the Activity tab. The
// teammate's recent runs this person may read (the Run history's own rule,
// run-query.ts agentRunsWhere, narrowed to this teammate), this person's own
// requests to it and what became of them, and what it used this month in AI
// questions. Never a cost in cents: a teammate's use is counted in AI
// questions, the unit the plan sells.
//
// docs/plans/ai-teammates.md 4.

import { NextResponse } from "next/server";
import { isOwnerOrAdmin, requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { actionViews } from "@/lib/agents/actions";
import { agentMonthUsage } from "@/lib/agents/budget";
import { agentRunsOrder, agentRunsWhere, parseRunQuery } from "@/lib/agents/run-query";
import { canReadRunDetail, runDurationMs, runStatus, runSummary, runSummaryWithheld, runTrigger } from "@/lib/agents/run-view";
import { loadTeammate, teammateNotFound } from "@/lib/agents/teammate-server";
import type { ActionView } from "@/lib/agents/teammate-thread";
import type { TeammateRunRow } from "@/lib/agents/teammate-views";

/** How many recent runs and requests the tab shows. */
const RECENT = 20;

function isPractice(input: unknown): boolean {
  return Boolean(input) && typeof input === "object" && (input as { practice?: unknown }).practice === true;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();

  const admin = isOwnerOrAdmin(viewer);
  const readable = agentRunsWhere(parseRunQuery(new URLSearchParams()), { organizationId: viewer.organizationId, userId: viewer.userId, admin });
  const [runs, mine, usage] = await Promise.all([
    prisma.agentRun.findMany({
      where: { AND: [readable, { agentId: agent.id }] },
      orderBy: agentRunsOrder("newest"),
      take: RECENT,
      select: { id: true, status: true, startedAt: true, endedAt: true, input: true, output: true, error: true, triggeredBy: true },
    }),
    prisma.agentAction.findMany({
      where: { organizationId: viewer.organizationId, agentId: agent.id, actingForId: viewer.userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT,
      select: { id: true },
    }),
    agentMonthUsage(agent.id),
  ]);

  const views = await actionViews(
    mine.map((a) => a.id),
    viewer.userId,
  );
  const actions = mine.map((a) => views[a.id]).filter((v): v is ActionView => Boolean(v));

  return NextResponse.json({
    runs: runs.map((r): TeammateRunRow => {
      const open = canReadRunDetail(r, { userId: viewer.userId, admin });
      return {
        id: r.id,
        trigger: runTrigger(r.input),
        status: runStatus(r.status),
        summary: open ? runSummary(r) : runSummaryWithheld(r),
        detailHidden: !open,
        practice: isPractice(r.input),
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt?.toISOString() ?? null,
        durationMs: runDurationMs(r.startedAt, r.endedAt),
        error: open ? r.error : r.error ? "The run didn't finish." : null,
      };
    }),
    actions,
    usage: { month: usage.monthStart.toISOString().slice(0, 10), used: usage.used, cap: agent.monthlyQuestionCap },
  });
}
