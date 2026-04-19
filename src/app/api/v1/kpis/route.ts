import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";
import type { Frequency } from "@/generated/prisma";

/**
 * GET /api/v1/kpis — list all KPIs in the org.
 *   • limit, cursor (id-based pagination)
 *   • kraId filter
 */
export async function GET(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "READ");
  if (error || !ctx) return error!;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const kraId = url.searchParams.get("kraId");

  const where: Record<string, unknown> = { organizationId: ctx.organizationId };
  if (kraId) where.kraId = kraId;

  const rows = await prisma.kPI.findMany({
    where,
    take: limit + 1,
    orderBy: { createdAt: "asc" },
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      name: true,
      description: true,
      targetValue: true,
      unit: true,
      frequency: true,
      kraId: true,
      kra: { select: { id: true, name: true } },
      createdAt: true,
      _count: { select: { records: true } },
    },
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return Response.json({
    data,
    nextCursor: hasMore ? data[data.length - 1].id : null,
  });
}

/**
 * POST /api/v1/kpis — create a KPI under a KRA.
 * Body: { kraId, name, targetValue, unit?, frequency?, description? }
 * frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUALLY"
 */
export async function POST(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "WRITE");
  if (error || !ctx) return error!;

  const body = (await req.json().catch(() => ({}))) as {
    kraId?: string;
    name?: string;
    targetValue?: number;
    unit?: string;
    frequency?: Frequency;
    description?: string;
  };
  if (!body.kraId || !body.name || body.targetValue == null) {
    return Response.json({ error: "kraId, name, and targetValue are required" }, { status: 400 });
  }

  const kra = await prisma.kRA.findFirst({
    where: { id: body.kraId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!kra) return Response.json({ error: "KRA not found" }, { status: 404 });

  const kpi = await prisma.kPI.create({
    data: {
      name: body.name.slice(0, 120),
      description: body.description?.slice(0, 500) ?? null,
      targetValue: body.targetValue,
      unit: body.unit ?? null,
      frequency: body.frequency ?? "MONTHLY",
      kraId: body.kraId,
      organizationId: ctx.organizationId,
    },
    select: {
      id: true,
      name: true,
      targetValue: true,
      unit: true,
      frequency: true,
      createdAt: true,
    },
  });
  return Response.json(kpi, { status: 201 });
}
