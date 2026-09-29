// POST /api/kpi-records/self-report, the employee door for recording
// their own KPI numbers. Validates every kpiId against the caller's own
// ACTIVE KRA assignments, scores direction-aware via the shared
// scoreKpiRecord rule, and writes SUBMITTED records so the existing
// /team/kpi-reviews approval loop (PENDING → SUBMITTED → APPROVED |
// REJECTED) picks them up unchanged.
//
// NULL-target spine: a KPI with no targetValue still accepts a reading,
// the actual is stored with score null (health derives as "no_target").
// We never substitute 0 for a missing line.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { notifyKpiSubmitted } from "@/lib/kpi-review.server";
import { kpiWriteStatus, parseKpiNumber } from "@/lib/kpi-record-status";
import { isKpiPeriodWritableAnyZone } from "@/lib/kpi-period";
import { scoreKpiRecord, resolveKpiLine } from "@/lib/kpi-record";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const body = await req.json();
  const { period, records } = body;

  if (!period || !Array.isArray(records) || records.length === 0) {
    return jsonError("period and records[] are required");
  }
  if (!isKpiPeriodWritableAnyZone(period)) {
    return jsonError("Numbers can only be recorded for this month or last month.", 400);
  }

  // Verify KPIs belong to this user's KRA assignments
  const assignments = await prisma.kRAAssignment.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      kra: {
        select: {
          kpis: { select: { id: true, type: true, targetValue: true, direction: true, lowerIsBetter: true } },
        },
      },
    },
  });
  const allowedKpiIds = new Set(assignments.flatMap((a) => a.kra.kpis.map((k) => k.id)));
  const kpiMap = new Map(
    assignments.flatMap((a) => a.kra.kpis.map((k) => [k.id, k] as const))
  );

  interface SelfReportRecordInput {
    kpiId: string;
    actualValue?: number | string | null;
    notes?: string | null;
    evidence?: string | null;
  }
  const rows = records as SelfReportRecordInput[];
  // Every number is checked before any row is touched: a non-numeric value
  // used to store NaN over an approved number (src/lib/kpi-record-status.ts).
  const badRow = rows.find((r) => !parseKpiNumber(r.actualValue).ok);
  if (badRow) return jsonError(`KPI numbers must be numbers (KPI ${String(badRow.kpiId)}).`, 400);

  const before = await prisma.kPIRecord.findMany({
    where: { userId, period, kpiId: { in: rows.map((r) => r.kpiId) } },
    select: { kpiId: true, status: true, reviewedById: true, actualValue: true, notes: true, evidence: true },
  });
  const wasSubmitted = new Set(before.filter((b) => b.status === "SUBMITTED").map((b) => b.kpiId));
  const beforeBy = new Map(before.map((b) => [b.kpiId, b]));

  const ops = rows
    .filter((r) => allowedKpiIds.has(r.kpiId))
    .map((r) => {
      const kpi = kpiMap.get(r.kpiId);
      if (!kpi) return null;

      const actual = numberOrNull(r.actualValue);
      const prior = beforeBy.get(r.kpiId) ?? null;
      const noteText = r.notes || null;
      const evidenceText = r.evidence || null;
      // A KPI left blank that has no row yet stays without one. The recorder
      // sends every KPI of the month, and a blank with no row used to be
      // created as a PENDING row with no value: History gained "Not
      // recorded" rows the person never touched and `saved` counted them.
      if (!prior && actual == null && !noteText && !evidenceText) return null;
      const noteChanged = (prior?.notes ?? null) !== noteText || (prior?.evidence ?? null) !== evidenceText;
      // src/lib/kpi-record-status.ts: the recorder resends the whole month,
      // so an unchanged number keeps the manager's decision, a blank on a
      // decided row keeps the number, and only a changed number is a new
      // submission.
      const decision = kpiWriteStatus({ actorId: userId, subjectId: userId, actual, existing: prior, noteChanged });
      // Nothing changed on this row: do not touch it at all.
      if (prior && decision.keepValue && !noteChanged && decision.status === prior.status) return null;
      // Direction-aware, null-target-safe. Score null when no line exists,
      // except a QUALITATIVE KPI, whose rubric rating scores against the
      // scale ceiling resolveKpiLine supplies.
      const target = resolveKpiLine(kpi.type, kpi.targetValue);
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
          // Non-nullable column: 0 is only the "no baseline yet" sentinel.
          targetValue: target ?? 0,
          actualValue: actual,
          score,
          notes: noteText,
          evidence: evidenceText,
          status: decision.status,
          reviewedById: null,
        },
        update: {
          ...(decision.keepValue ? {} : { actualValue: actual, targetValue: target ?? 0, score }),
          notes: noteText,
          evidence: evidenceText,
          status: decision.status,
          ...(decision.reviewedById !== undefined ? { reviewedById: decision.reviewedById } : {}),
        },
      });
    })
    .filter((op): op is NonNullable<typeof op> => op !== null);

  const results = await prisma.$transaction(ops);
  // The people whose queue these land in hear about it once (kpi_submitted).
  const fresh = results.filter((r) => r.status === "SUBMITTED" && !wasSubmitted.has(r.kpiId)).length;
  void notifyKpiSubmitted({ userId, organizationId: getOrgId(session), period, count: fresh });

  // `saved` counts the rows this save changed; an unchanged resend is 0.
  // `skipped` counts rows for a KPI no longer in this person's active KRA
  // assignments (a job title change mid-month): those take no number, and
  // the recorder says so instead of "already saved".
  const skipped = rows.filter((r) => !allowedKpiIds.has(r.kpiId)).length;
  return jsonSuccess({ saved: results.length, skipped, period, status: "SUBMITTED" });
}

/** The value parseKpiNumber already accepted above; a blank is null. */
function numberOrNull(raw: unknown): number | null {
  const p = parseKpiNumber(raw);
  return p.ok ? p.value : null;
}
