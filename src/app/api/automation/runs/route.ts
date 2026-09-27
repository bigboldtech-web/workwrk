// GET /api/automation/runs
//
// The run log, one page at a time (spec-ai-automation /automation/logs).
// Every parameter is optional and matches a Logs URL parameter:
//   ?status=     view words or stored statuses, comma separated
//   ?workflowId= ?severity= ?record= (task, kpi, kudos, schedule)
//   ?days=7|30|90, or an exact ?from= ?to= (which wins)
//   ?sort=newest|oldest  ?take= (default 50, at most 100)  ?cursor=<run id>
// Returns { runs, total, nextCursor }. Each run carries its workflow's name,
// the trigger as words (`triggerName`) and the record it happened to
// (`record`, or null when it cannot be shown: see run-records-server).
// Payloads are never in the list; the run detail route returns them.

import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { requireAutomation } from "@/lib/automation/gate";
import { parseRunQuery, runOrderBy, runWhere } from "@/lib/automation/run-query";
import { resolveRunRecords } from "@/lib/automation/run-records-server";
import { triggerDisplayName } from "@/lib/automation/registry-triggers";

export async function GET(req: NextRequest) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;

  const parsed = parseRunQuery(req.nextUrl.searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const q = parsed.query;
  const where = runWhere(ctx.orgId, q) as Prisma.AutomationRunWhereInput;

  // A cursor from another workspace (or a deleted run) restarts at page one
  // instead of erroring.
  let cursor: string | null = null;
  if (q.cursor) {
    const hit = await prisma.automationRun.findFirst({ where: { id: q.cursor, organizationId: ctx.orgId }, select: { id: true } });
    cursor = hit?.id ?? null;
  }

  const [rows, total] = await Promise.all([
    prisma.automationRun.findMany({
      where,
      orderBy: runOrderBy(q) as Prisma.AutomationRunOrderByWithRelationInput[],
      take: q.take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        workflowId: true,
        workflow: { select: { id: true, name: true } },
        workflowVersionId: true,
        triggerEventKey: true,
        status: true,
        severity: true,
        recordType: true,
        recordId: true,
        userId: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        durationMs: true,
        createdAt: true,
      },
    }),
    prisma.automationRun.count({ where }),
  ]);
  const page = rows.slice(0, q.take);
  const nextCursor = rows.length > q.take ? page[page.length - 1]?.id ?? null : null;
  const records = await resolveRunRecords(ctx.viewer, ctx.orgId, ctx.isAdmin, page);

  return NextResponse.json(
    {
      runs: page.map((r) => ({
        ...r,
        triggerName: triggerDisplayName(r.triggerEventKey),
        record: records.record(r.recordType, r.recordId),
      })),
      total,
      nextCursor,
      restarted: Boolean(q.cursor && !cursor),
      take: q.take,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
