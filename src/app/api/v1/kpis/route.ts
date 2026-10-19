import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";
import { Frequency } from "@/generated/prisma";
import { parseKpiNumber } from "@/lib/kpi-record-status";

/** The values a KPI's frequency may hold: the Frequency enum. */
const FREQUENCIES: readonly string[] = Object.values(Frequency);

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

  // A body of null reads as an empty one, never a 500.
  const body = ((await req.json().catch(() => ({}))) ?? {}) as {
    kraId?: string;
    name?: string;
    targetValue?: unknown;
    unit?: string;
    frequency?: unknown;
    description?: string;
  };
  if (!body.kraId || !body.name || body.targetValue == null) {
    return Response.json({ error: "kraId, name, and targetValue are required" }, { status: 400 });
  }
  // A value the columns can't hold is the caller's mistake, answered as one:
  // an unknown frequency, or a target that is not a number (a numeric
  // string is read as its number, as the KPI recorders read it), used to fail
  // inside the create and answer a bare 500. A frequency in any case is
  // taken and stored in capitals, as a task's priority is.
  const target = parseKpiNumber(body.targetValue);
  if (!target.ok || target.value === null) return Response.json({ error: "targetValue must be a number" }, { status: 400 });
  const targetValue = target.value;
  const frequency = body.frequency === undefined || body.frequency === null
    ? "MONTHLY"
    : typeof body.frequency === "string" && FREQUENCIES.includes(body.frequency.trim().toUpperCase())
      ? (body.frequency.trim().toUpperCase() as Frequency)
      : null;
  if (!frequency) return Response.json({ error: `frequency must be one of ${FREQUENCIES.join(", ")}` }, { status: 400 });

  const kra = await prisma.kRA.findFirst({
    where: { id: body.kraId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!kra) return Response.json({ error: "KRA not found" }, { status: 404 });

  const kpi = await prisma.kPI.create({
    data: {
      name: body.name.slice(0, 120),
      description: body.description?.slice(0, 500) ?? null,
      targetValue,
      unit: body.unit ?? null,
      frequency,
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
