import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { triggerRecalculation } from "@/services/performanceScoreService";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const kpiId = url.searchParams.get("kpiId");

  const records = await prisma.kPIRecord.findMany({
    where: {
      kpi: { organizationId: orgId },
      ...(userId ? { userId } : {}),
      ...(kpiId ? { kpiId } : {}),
    },
    include: {
      user: { select: { firstName: true, lastName: true } },
      kpi: { select: { name: true, unit: true, type: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return jsonSuccess(records);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const { kpiId, userId, period, targetValue, actualValue, notes, evidence } = body;

  if (!kpiId || !userId || !period || targetValue == null) {
    return jsonError("kpiId, userId, period, and targetValue are required");
  }

  // Calculate score: actual/target * 100, capped at 120%
  const score = actualValue != null ? Math.min(Math.round((actualValue / targetValue) * 100), 120) : null;

  const record = await prisma.kPIRecord.create({
    data: {
      kpiId,
      userId,
      period,
      targetValue,
      actualValue,
      score,
      notes,
      evidence,
      status: actualValue != null ? "SUBMITTED" : "PENDING",
    },
  });

  // Auto-recalculate performance score
  const kpi = await prisma.kPI.findUnique({ where: { id: kpiId }, select: { organizationId: true } });
  if (kpi) triggerRecalculation(userId, kpi.organizationId);

  return jsonSuccess(record, 201);
}
