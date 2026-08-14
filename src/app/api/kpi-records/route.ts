import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canTouchUserAlignment, visibleAlignmentUserIds } from "@/lib/alignment-scope";
import { scoreKpiRecord, resolveKpiLine } from "@/lib/kpi-record";
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

  // Three-door scoping: employees read their own records, managers their
  // report tree's, admin/exec/HR the whole org. A record is a person's
  // performance data — never org-public.
  const visibleIds = await visibleAlignmentUserIds(session);
  if (visibleIds !== null && userId && !visibleIds.includes(userId)) {
    return jsonError("You can only view KPI records for yourself or your reports.", 403);
  }

  const where = {
    kpi: { organizationId: orgId },
    ...(userId ? { userId } : visibleIds !== null ? { userId: { in: visibleIds } } : {}),
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

  // Write gate: self-report, manager-in-report-tree, or org-wide level.
  // Peers can no longer overwrite each other's submitted numbers.
  const callerId = getUserId(session);
  const isSelf = userId === callerId;
  if (!(await canTouchUserAlignment(session, userId))) {
    return jsonError("You can only record KPI numbers for yourself or your reports.", 403);
  }

  const orgId = getOrgId(session);
  const kpi = await prisma.kPI.findFirst({
    where: { id: kpiId, organizationId: orgId },
    select: { type: true, targetValue: true, direction: true, lowerIsBetter: true, organizationId: true },
  });
  if (!kpi) return jsonError("KPI not found", 404);

  const subject = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId },
    select: { id: true },
  });
  if (!subject) return jsonError("User not found", 404);

  // Target comes from the KPI definition, falling back to a manual one.
  // NULL means "no baseline yet" — the actual is stored with score null
  // (health derives as no_target); we never invent a line. The record
  // column is non-nullable, so 0 is stored purely as the empty sentinel.
  // A QUALITATIVE KPI is the exception: its actual is a rubric rating, so
  // resolveKpiLine substitutes the scale ceiling and the rating always
  // scores (rating / ceiling · 100).
  const target = resolveKpiLine(
    kpi.type,
    kpi.targetValue ?? (manualTarget != null ? Number(manualTarget) : null),
  );
  const actual = actualValue != null ? Number(actualValue) : null;
  const score = scoreKpiRecord(
    { targetValue: target, direction: kpi.direction, lowerIsBetter: kpi.lowerIsBetter },
    actual,
  );

  // Manager notes belong to the review loop — a self-report can't write them.
  const reviewNotes = isSelf ? undefined : managerNotes;

  const record = await prisma.kPIRecord.upsert({
    where: { kpiId_userId_period: { kpiId, userId, period } },
    create: {
      kpiId,
      userId,
      period,
      targetValue: target ?? 0,
      actualValue: actual,
      score,
      notes,
      managerNotes: reviewNotes ?? null,
      evidence,
      status: actual != null ? "SUBMITTED" : "PENDING",
    },
    update: {
      actualValue: actual,
      targetValue: target ?? 0,
      score,
      notes,
      ...(reviewNotes !== undefined && { managerNotes: reviewNotes }),
      evidence,
      status: actual != null ? "SUBMITTED" : "PENDING",
    },
  });

  // Auto-recalculate performance score
  triggerRecalculation(userId, orgId);

  return jsonSuccess(record, 201);
}
