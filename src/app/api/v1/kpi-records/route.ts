import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";
import { recordIntegrationKpi } from "@/lib/kpi-integration.server";

/**
 * POST /api/v1/kpi-records: log a KPI reading.
 *
 * This is the integration sweet-spot: connected tools (HubSpot, Razorpay,
 * Keka, etc.) POST here to push a KPI value into workwrk. A reading that
 * changes something recomputes the person's composite score and fans out a
 * `kpi.recorded` webhook to subscribers.
 *
 * Body: { kpiId, userId, period, actualValue, targetValue?, notes?, evidence? }
 *
 * The rule (src/lib/kpi-integration.ts, docs-found fixes batch 3): `period`
 * is a month, "YYYY-MM", and not one that has not started (400 otherwise:
 * goals read only month keys, and the published example used to be
 * "2026-Q1"). One reading per KPI, person and month: a new one answers 201,
 * the same number again 200 with nothing changed, a different number 200
 * replacing it while the month is open (this month or last), and 409 with the
 * reading's id for a closed month. A second reading used to answer a bare 500.
 */
export async function POST(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "WRITE");
  if (error || !ctx) return error!;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const answer = await recordIntegrationKpi(ctx.organizationId, body ?? {});
  if ("record" in answer) return Response.json(answer.record, { status: answer.status });
  if (answer.status === 409) return Response.json({ error: answer.error, code: answer.code, id: answer.id }, { status: 409 });
  return Response.json({ error: answer.error }, { status: answer.status });
}

/**
 * GET /api/v1/kpi-records — list recent KPI readings.
 * Query: limit, cursor, userId, kpiId, period
 */
export async function GET(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "READ");
  if (error || !ctx) return error!;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const userId = url.searchParams.get("userId");
  const kpiId = url.searchParams.get("kpiId");
  const period = url.searchParams.get("period");

  const where: Record<string, unknown> = {
    kpi: { organizationId: ctx.organizationId },
  };
  if (userId) where.userId = userId;
  if (kpiId) where.kpiId = kpiId;
  if (period) where.period = period;

  const rows = await prisma.kPIRecord.findMany({
    where,
    take: limit + 1,
    orderBy: { createdAt: "desc" },
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      kpiId: true,
      userId: true,
      period: true,
      targetValue: true,
      actualValue: true,
      score: true,
      createdAt: true,
    },
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return Response.json({
    data,
    nextCursor: hasMore ? data[data.length - 1].id : null,
  });
}
