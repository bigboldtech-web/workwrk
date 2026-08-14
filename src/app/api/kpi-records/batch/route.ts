import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canTouchUserAlignment } from "@/lib/alignment-scope";
import { scoreKpiRecord, resolveKpiLine } from "@/lib/kpi-record";
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

  // A manager records numbers for their own report tree only; org-wide
  // levels (admin / exec / HR) may record for anyone in the org.
  if (!(await canTouchUserAlignment(session, userId))) {
    return jsonError("You can only record KPI numbers for yourself or your reports.", 403);
  }

  interface BatchRecordInput {
    kpiId: string;
    actualValue?: number | string | null;
    targetValue?: number | string | null;
    managerNotes?: string | null;
  }
  const rows = records as BatchRecordInput[];

  // Fetch all KPIs in one query
  const kpiIds = rows.map((r) => r.kpiId);
  const kpis = await prisma.kPI.findMany({
    where: { id: { in: kpiIds }, organizationId: orgId },
    select: { id: true, type: true, targetValue: true, direction: true, lowerIsBetter: true },
  });
  const kpiMap = new Map(kpis.map((k) => [k.id, k]));

  // Build upsert operations
  const ops = rows.map((r) => {
    const kpi = kpiMap.get(r.kpiId);
    if (!kpi) return null;

    // NULL target = "no baseline yet": actual is stored, score stays null
    // (0 in the non-nullable column is only the empty sentinel). A
    // QUALITATIVE KPI instead scores its rubric rating against the scale
    // ceiling, so resolveKpiLine hands back a real line.
    const target = resolveKpiLine(
      kpi.type,
      kpi.targetValue ?? (r.targetValue != null ? Number(r.targetValue) : null),
    );
    const actual = r.actualValue != null ? Number(r.actualValue) : null;
    const score = scoreKpiRecord(
      { targetValue: target, direction: kpi.direction, lowerIsBetter: kpi.lowerIsBetter },
      actual,
    );

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
  }).filter((op): op is NonNullable<typeof op> => op !== null);

  const results = await prisma.$transaction(ops);

  // Recalculate performance score once
  triggerRecalculation(userId, orgId);

  return jsonSuccess({ saved: results.length, period });
}
