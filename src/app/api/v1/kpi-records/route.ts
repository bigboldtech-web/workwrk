import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";
import { triggerRecalculation } from "@/services/performanceScoreService";
import { dispatchEvent } from "@/services/webhookDispatcher";

/**
 * POST /api/v1/kpi-records — log a KPI reading.
 *
 * This is the integration sweet-spot: connected tools (HubSpot, Razorpay,
 * Keka, etc.) POST here to push a KPI value into workwrk. Triggers
 * composite score recalc on the user and fans out a `kpi.recorded`
 * webhook to subscribers.
 *
 * Body: { kpiId, userId, period, actualValue, targetValue?, notes?, evidence? }
 */
export async function POST(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "WRITE");
  if (error || !ctx) return error!;

  const body = (await req.json().catch(() => ({}))) as {
    kpiId?: string;
    userId?: string;
    period?: string;
    actualValue?: number;
    targetValue?: number;
    notes?: string;
    evidence?: string;
  };
  if (!body.kpiId || !body.userId || !body.period || body.actualValue == null) {
    return Response.json(
      { error: "kpiId, userId, period, and actualValue are required" },
      { status: 400 },
    );
  }

  const kpi = await prisma.kPI.findFirst({
    where: { id: body.kpiId, organizationId: ctx.organizationId },
    select: { id: true, targetValue: true },
  });
  if (!kpi) return Response.json({ error: "KPI not found" }, { status: 404 });

  const user = await prisma.user.findFirst({
    where: { id: body.userId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!user) return Response.json({ error: "User not in org" }, { status: 404 });

  // KPI.targetValue is nullable on the model; caller may override.
  const target = body.targetValue ?? kpi.targetValue ?? 0;
  const score =
    target > 0 ? Math.min(100, Math.round((body.actualValue / target) * 100)) : 0;

  const record = await prisma.kPIRecord.create({
    data: {
      kpiId: body.kpiId,
      userId: body.userId,
      period: body.period,
      targetValue: target,
      actualValue: body.actualValue,
      score,
      notes: body.notes ?? null,
      evidence: body.evidence ?? null,
    },
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

  // Non-blocking fan-out.
  triggerRecalculation(body.userId, ctx.organizationId);
  dispatchEvent({
    organizationId: ctx.organizationId,
    event: "kpi.recorded",
    payload: record,
  }).catch(() => {});

  return Response.json(record, { status: 201 });
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
