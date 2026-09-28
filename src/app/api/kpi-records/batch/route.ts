import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { kpiWriteStatus, parseKpiNumber } from "@/lib/kpi-record-status";
import { isKpiPeriodWritableAnyZone } from "@/lib/kpi-period";
import { kpiActorCtx, mayActOnKpisOf, notifyKpiRecordedForYou } from "@/lib/kpi-review.server";
import { canTouchUserAlignment } from "@/lib/alignment-scope";
import { scoreKpiRecord, resolveKpiLine } from "@/lib/kpi-record";
import { triggerRecalculation } from "@/services/performanceScoreService";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { userId, period, records } = body;

  if (!userId || !period || !Array.isArray(records) || records.length === 0) {
    return jsonError("userId, period, and records[] are required");
  }
  // The current and previous month take numbers; a closed month is never
  // rescored (src/lib/kpi-period.ts).
  if (!isKpiPeriodWritableAnyZone(period)) {
    return jsonError("Numbers can only be recorded for this month or last month.", 400);
  }

  // Verify user belongs to org
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId },
    select: { id: true },
  });
  if (!user) return jsonError("User not found", 404);

  // A manager records numbers for their own report tree only; org-wide
  // levels (admin / exec / HR) may record for anyone in the org.
  // Can edit on the person: the solid tree as before, plus dotted-line
  // managers, the People team and Admin (src/lib/kpi-review.server.ts).
  // Yesterday this door was manager tier only; a manager tier still passes.
  const actorId = getUserId(session);
  const isSelf = userId === actorId;
  if (isSelf ? !isManager(session) : !(await canTouchUserAlignment(session, userId))) {
    const ctx = isSelf ? null : await kpiActorCtx();
    if (!ctx || !mayActOnKpisOf(ctx, userId)) {
      return jsonError("You can only record KPI numbers for yourself or your reports.", 403);
    }
  }

  interface BatchRecordInput {
    kpiId: string;
    actualValue?: number | string | null;
    targetValue?: number | string | null;
    managerNotes?: string | null;
  }
  const rows = records as BatchRecordInput[];
  // Every number is checked before any row is touched: a non-numeric value
  // used to store NaN over an approved number (src/lib/kpi-record-status.ts).
  const badRow = rows.find((r) => !parseKpiNumber(r.actualValue).ok || !parseKpiNumber(r.targetValue).ok);
  if (badRow) return jsonError(`KPI numbers must be numbers (KPI ${String(badRow.kpiId)}).`, 400);

  // Fetch all KPIs in one query
  const kpiIds = rows.map((r) => r.kpiId);
  const kpis = await prisma.kPI.findMany({
    where: { id: { in: kpiIds }, organizationId: orgId },
    select: { id: true, type: true, targetValue: true, direction: true, lowerIsBetter: true },
  });
  const kpiMap = new Map(kpis.map((k) => [k.id, k]));

  // The rows as they stand, for the status rule (a manager's number lands
  // APPROVED; a blank save never downgrades a decided row).
  const existingRows = await prisma.kPIRecord.findMany({
    where: { userId, period, kpiId: { in: kpiIds } },
    select: { kpiId: true, status: true, reviewedById: true, actualValue: true, managerNotes: true },
  });
  const existingBy = new Map(existingRows.map((e) => [e.kpiId, e]));
  let newlyApproved = 0;

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
      kpi.targetValue ?? numberOrNull(r.targetValue),
    );
    const actual = numberOrNull(r.actualValue);
    const score = scoreKpiRecord(
      { targetValue: target, direction: kpi.direction, lowerIsBetter: kpi.lowerIsBetter },
      actual,
    );

    const prev = existingBy.get(r.kpiId) ?? null;
    const decision = kpiWriteStatus({ actorId, subjectId: userId, actual, existing: prev });
    // Only the numbers this save actually changed count as recorded for the
    // person: resending their own number is not an approval.
    if (decision.status === "APPROVED" && decision.valueChanged) newlyApproved += 1;
    // managerNotes is written only when the row sends it: a save that does
    // not carry a note never wipes the one already there.
    const notes = r.managerNotes === undefined || isSelf ? undefined : r.managerNotes || null;
    // Nothing changed on this row (the recorder resends the whole month):
    // leave it exactly as it is.
    if (prev && decision.keepValue && decision.status === prev.status && (notes === undefined || notes === (prev.managerNotes ?? null))) return null;

    return prisma.kPIRecord.upsert({
      where: { kpiId_userId_period: { kpiId: r.kpiId, userId, period } },
      create: {
        kpiId: r.kpiId,
        userId,
        period,
        targetValue: target ?? 0,
        actualValue: actual,
        score,
        managerNotes: notes ?? null,
        status: decision.status,
        reviewedById: decision.reviewedById ?? null,
      },
      update: {
        // A blank or an unchanged number leaves the stored number alone.
        ...(decision.keepValue ? {} : { actualValue: actual, targetValue: target ?? 0, score }),
        ...(notes !== undefined ? { managerNotes: notes } : {}),
        status: decision.status,
        ...(decision.reviewedById !== undefined ? { reviewedById: decision.reviewedById } : {}),
      },
    });
  }).filter((op): op is NonNullable<typeof op> => op !== null);

  const results = await prisma.$transaction(ops);

  // Recalculate performance score once
  triggerRecalculation(userId, orgId);
  if (!isSelf) void notifyKpiRecordedForYou({ userId, actorId, period, count: newlyApproved });

  return jsonSuccess({ saved: results.length, period });
}

/** The value parseKpiNumber already accepted above; a blank is null. */
function numberOrNull(raw: unknown): number | null {
  const p = parseKpiNumber(raw);
  return p.ok ? p.value : null;
}
