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
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const skip = (page - 1) * limit;

  const where = {
    kpi: { organizationId: orgId },
    ...(userId ? { userId } : {}),
    ...(kpiId ? { kpiId } : {}),
  };

  const [records, total] = await Promise.all([
    prisma.kPIRecord.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, department: { select: { name: true } } } },
        kpi: { select: { name: true, unit: true, type: true, lowerIsBetter: true, kra: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
    }),
    prisma.kPIRecord.count({ where }),
  ]);

  return jsonSuccess({ records, total, page, limit, totalPages: Math.ceil(total / limit) });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const { kpiId, userId, period, targetValue: manualTarget, actualValue, notes, managerNotes, evidence } = body;

  if (!kpiId || !userId || !period) {
    return jsonError("kpiId, userId, and period are required");
  }

  // Auto-pull target from KPI definition, fallback to manual
  const kpi = await prisma.kPI.findUnique({ where: { id: kpiId }, select: { targetValue: true, organizationId: true } });
  if (!kpi) return jsonError("KPI not found", 404);

  const target = kpi.targetValue ?? manualTarget;
  if (target == null) return jsonError("Target value not set on this KPI. Please set it first.");

  // Calculate score: actual/target * 100, capped at 120%
  const score = actualValue != null ? Math.min(Math.round((actualValue / target) * 100), 120) : null;

  const record = await prisma.kPIRecord.upsert({
    where: { kpiId_userId_period: { kpiId, userId, period } },
    create: {
      kpiId,
      userId,
      period,
      targetValue: target,
      actualValue,
      score,
      notes,
      managerNotes,
      evidence,
      status: actualValue != null ? "SUBMITTED" : "PENDING",
    },
    update: {
      actualValue,
      targetValue: target,
      score,
      notes,
      managerNotes,
      evidence,
      status: actualValue != null ? "SUBMITTED" : "PENDING",
    },
  });

  // Auto-recalculate performance score
  if (kpi.organizationId) triggerRecalculation(userId, kpi.organizationId);

  return jsonSuccess(record, 201);
}
