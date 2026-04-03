import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const orgId = getOrgId(session);
  const body = await req.json();
  const { period, records } = body;

  if (!period || !Array.isArray(records) || records.length === 0) {
    return jsonError("period and records[] are required");
  }

  // Verify KPIs belong to this user's KRA assignments
  const assignments = await prisma.kRAAssignment.findMany({
    where: { userId, status: "ACTIVE" },
    include: { kra: { select: { kpis: { select: { id: true, targetValue: true, lowerIsBetter: true } } } } },
  });
  const allowedKpiIds = new Set(assignments.flatMap((a) => a.kra.kpis.map((k) => k.id)));
  const kpiMap = new Map(
    assignments.flatMap((a) => a.kra.kpis.map((k) => [k.id, k]))
  );

  const ops = records
    .filter((r: any) => allowedKpiIds.has(r.kpiId))
    .map((r: any) => {
      const kpi = kpiMap.get(r.kpiId);
      if (!kpi) return null;

      const target = kpi.targetValue ?? 0;
      const actual = r.actualValue != null ? Number(r.actualValue) : null;
      let score: number | null = null;
      if (actual != null && target > 0) {
        score = kpi.lowerIsBetter
          ? (actual === 0 ? 120 : Math.min(Math.round((target / actual) * 100), 120))
          : Math.min(Math.round((actual / target) * 100), 120);
      }

      return prisma.kPIRecord.upsert({
        where: { kpiId_userId_period: { kpiId: r.kpiId, userId, period } },
        create: {
          kpiId: r.kpiId,
          userId,
          period,
          targetValue: target,
          actualValue: actual,
          score,
          notes: r.notes || null,
          evidence: r.evidence || null,
          status: actual != null ? "SUBMITTED" : "PENDING",
        },
        update: {
          actualValue: actual,
          targetValue: target,
          score,
          notes: r.notes || null,
          evidence: r.evidence || null,
          status: actual != null ? "SUBMITTED" : "PENDING",
        },
      });
    })
    .filter(Boolean);

  const results = await prisma.$transaction(ops as any[]);

  return jsonSuccess({ saved: results.length, period, status: "SUBMITTED" });
}
