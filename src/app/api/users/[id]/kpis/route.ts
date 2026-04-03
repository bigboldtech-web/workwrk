import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// GET /api/users/[id]/kpis?period=2026-04
// Returns all KPIs assigned to this user (via KRA assignments) with existing records for the period
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { id: userId } = await params;
  const period = new URL(req.url).searchParams.get("period") || "";

  // Verify user belongs to org
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!user) return jsonError("User not found", 404);

  // Get all KRA assignments for this user
  const assignments = await prisma.kRAAssignment.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      kra: {
        include: {
          kpis: {
            select: {
              id: true,
              name: true,
              unit: true,
              type: true,
              frequency: true,
              targetValue: true,
              targetLabel: true,
              lowerIsBetter: true,
            },
          },
        },
      },
    },
  });

  // Collect all KPI IDs
  const allKpiIds = assignments.flatMap((a) => a.kra.kpis.map((k) => k.id));

  // Fetch existing records for this period
  const existingRecords = period
    ? await prisma.kPIRecord.findMany({
        where: { userId, period, kpiId: { in: allKpiIds } },
      })
    : [];

  const recordMap = new Map(existingRecords.map((r) => [r.kpiId, r]));

  // Build response grouped by KRA
  const kras = assignments.map((a) => ({
    kraId: a.kra.id,
    kraName: a.kra.name,
    category: (a.kra as any).category || null,
    kpis: a.kra.kpis.map((kpi) => {
      const record = recordMap.get(kpi.id);
      return {
        kpiId: kpi.id,
        name: kpi.name,
        unit: kpi.unit,
        type: kpi.type,
        frequency: kpi.frequency,
        targetValue: kpi.targetValue,
        targetLabel: kpi.targetLabel,
        lowerIsBetter: kpi.lowerIsBetter,
        existingRecord: record
          ? {
              id: record.id,
              actualValue: record.actualValue,
              score: record.score,
              managerNotes: record.managerNotes,
              notes: record.notes,
              status: record.status,
            }
          : null,
      };
    }),
  }));

  return jsonSuccess({
    userId,
    userName: `${user.firstName} ${user.lastName}`,
    period,
    kras,
    totalKpis: allKpiIds.length,
    recordedKpis: existingRecords.filter((r) => r.actualValue != null).length,
  });
}
