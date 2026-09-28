import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canTouchUserAlignment, visibleAlignmentUserIds } from "@/lib/alignment-scope";
import { scoreKpiRecord, resolveKpiLine } from "@/lib/kpi-record";
import { triggerRecalculation } from "@/services/performanceScoreService";
import { kpiWriteStatus, parseKpiNumber } from "@/lib/kpi-record-status";
import { isKpiPeriodWritableAnyZone } from "@/lib/kpi-period";
import { kpiActorCtx, mayActOnKpisOf, notifyKpiRecordedForYou, notifyKpiSubmitted } from "@/lib/kpi-review.server";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const kpiId = url.searchParams.get("kpiId");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
  const skip = (page - 1) * limit;

  // Three-door scoping: employees read their own records, managers their
  // report tree's, admin/exec/HR the whole org. A record is a person's
  // performance data, never org-public.
  const visibleIds = await visibleAlignmentUserIds(session);
  if (visibleIds !== null && userId && !visibleIds.includes(userId)) {
    // The KPI reviews reach: dotted-line managers and the People team read
    // the people they act on.
    const ctx = await kpiActorCtx();
    if (!ctx || !mayActOnKpisOf(ctx, userId)) {
      return jsonError("You can only view KPI records for yourself or your reports.", 403);
    }
  }
  // ?period=YYYY-MM and ?status=SUBMITTED,APPROVED narrow the read.
  const period = url.searchParams.get("period");
  const statuses = (url.searchParams.get("status") ?? "").split(",").filter((x): x is "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED" => ["PENDING", "SUBMITTED", "APPROVED", "REJECTED"].includes(x));

  const where = {
    kpi: { organizationId: orgId },
    ...(userId ? { userId } : visibleIds !== null ? { userId: { in: visibleIds } } : {}),
    ...(kpiId ? { kpiId } : {}),
    ...(period && /^\d{4}-\d{2}$/.test(period) ? { period } : {}),
    ...(statuses.length ? { status: { in: statuses } } : {}),
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
  // A non-numeric value used to store NaN over an approved number
  // (src/lib/kpi-record-status.ts); nothing is written when either is bad.
  const parsedActual = parseKpiNumber(actualValue);
  const parsedTarget = parseKpiNumber(manualTarget);
  if (!parsedActual.ok || !parsedTarget.ok) return jsonError("KPI numbers must be numbers.", 400);
  // The current and previous month take numbers; a closed month is never
  // rescored (src/lib/kpi-period.ts).
  if (!isKpiPeriodWritableAnyZone(period)) {
    return jsonError("Numbers can only be recorded for this month or last month.", 400);
  }

  // Write gate: self-report, manager-in-report-tree, or org-wide level.
  // Peers can no longer overwrite each other's submitted numbers.
  const callerId = getUserId(session);
  const isSelf = userId === callerId;
  // Can edit on the person (src/lib/kpi-review.server.ts): the solid tree
  // as before, plus dotted-line managers, the People team and Admin, who
  // see the same people in the KPI reviews queue.
  if (!isSelf && !(await canTouchUserAlignment(session, userId))) {
    const ctx = await kpiActorCtx();
    if (!ctx || !mayActOnKpisOf(ctx, userId)) {
      return jsonError("You can only record KPI numbers for yourself or your reports.", 403);
    }
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
  // NULL means "no baseline yet", the actual is stored with score null
  // (health derives as no_target); we never invent a line. The record
  // column is non-nullable, so 0 is stored purely as the empty sentinel.
  // A QUALITATIVE KPI is the exception: its actual is a rubric rating, so
  // resolveKpiLine substitutes the scale ceiling and the rating always
  // scores (rating / ceiling · 100).
  const target = resolveKpiLine(
    kpi.type,
    kpi.targetValue ?? parsedTarget.value,
  );
  const actual = parsedActual.value;
  const score = scoreKpiRecord(
    { targetValue: target, direction: kpi.direction, lowerIsBetter: kpi.lowerIsBetter },
    actual,
  );

  // Manager notes belong to the review loop: a self-report can't write them.
  const reviewNotes = isSelf ? undefined : managerNotes;

  // The status rule (src/lib/kpi-record-status.ts, golden-tested): a number
  // a manager records on someone's behalf lands APPROVED with reviewedById;
  // a person's own number lands SUBMITTED; a blank save never downgrades a
  // decided row.
  const existing = await prisma.kPIRecord.findUnique({
    where: { kpiId_userId_period: { kpiId, userId, period } },
    select: { status: true, reviewedById: true, actualValue: true, notes: true, evidence: true },
  });
  const noteChanged = isSelf && existing != null && ((existing.notes ?? null) !== (notes || null) || (existing.evidence ?? null) !== (evidence || null));
  const decision = kpiWriteStatus({ actorId: callerId, subjectId: userId, actual, existing, noteChanged });

  const record = await prisma.kPIRecord.upsert({
    where: { kpiId_userId_period: { kpiId, userId, period } },
    create: {
      kpiId,
      userId,
      period,
      targetValue: target ?? 0,
      actualValue: actual,
      score,
      notes: isSelf ? notes : undefined,
      managerNotes: reviewNotes ?? null,
      evidence: isSelf ? evidence : undefined,
      status: decision.status,
      reviewedById: decision.reviewedById ?? null,
    },
    update: {
      // A blank or an unchanged number leaves the stored number alone.
      ...(decision.keepValue ? {} : { actualValue: actual, targetValue: target ?? 0, score }),
      // A manager's save never overwrites the person's own note or evidence.
      ...(isSelf ? { notes, evidence } : {}),
      ...(reviewNotes !== undefined && { managerNotes: reviewNotes }),
      status: decision.status,
      ...(decision.reviewedById !== undefined ? { reviewedById: decision.reviewedById } : {}),
    },
  });

  if (!isSelf && decision.status === "APPROVED" && decision.valueChanged) {
    void notifyKpiRecordedForYou({ userId, actorId: callerId, period, count: 1 });
  }
  if (isSelf && decision.status === "SUBMITTED" && existing?.status !== "SUBMITTED") {
    void notifyKpiSubmitted({ userId, organizationId: orgId, period, count: 1 });
  }

  // Auto-recalculate performance score
  triggerRecalculation(userId, orgId);

  return jsonSuccess(record, 201);
}
