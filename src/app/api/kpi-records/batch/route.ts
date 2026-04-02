import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { triggerRecalculation } from "@/services/performanceScoreService";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { userId, period, records } = body;

  if (!userId || !period || !Array.isArray(records) || records.length === 0) {
    return jsonError("userId, period, and records[] are required");
  }

  // Verify user belongs to org
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId },
    select: { id: true },
  });
  if (!user) return jsonError("User not found", 404);

  // Fetch all KPIs in one query
  const kpiIds = records.map((r: any) => r.kpiId);
  const kpis = await prisma.kPI.findMany({
    where: { id: { in: kpiIds }, organizationId: orgId },
    select: { id: true, targetValue: true },
  });
  const kpiMap = new Map(kpis.map((k) => [k.id, k]));

  // Build upsert operations
  const ops = records.map((r: any) => {
    const kpi = kpiMap.get(r.kpiId);
    if (!kpi) return null;

    const target = kpi.targetValue ?? r.targetValue ?? null;
    const actual = r.actualValue != null ? Number(r.actualValue) : null;
    const score = actual != null && target != null && target > 0
      ? Math.min(Math.round((actual / target) * 100), 120)
      : null;

    return prisma.kPIRecord.upsert({
      where: { kpiId_userId_period: { kpiId: r.kpiId, userId, period } },
      create: {
        kpiId: r.kpiId,
        userId,
        period,
        targetValue: target ?? 0,
        actualValue: actual,
        score,
        managerNotes: r.managerNotes || null,
        status: actual != null ? "SUBMITTED" : "PENDING",
      },
      update: {
        actualValue: actual,
        targetValue: target ?? 0,
        score,
        managerNotes: r.managerNotes || null,
        status: actual != null ? "SUBMITTED" : "PENDING",
      },
    });
  }).filter(Boolean);

  const results = await prisma.$transaction(ops as any[]);

  // Recalculate performance score once
  triggerRecalculation(userId, orgId);

  return jsonSuccess({ saved: results.length, period });
}
