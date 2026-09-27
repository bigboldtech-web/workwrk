// POST /api/kpi-records/self-report — the employee door for recording
// their own KPI numbers. Validates every kpiId against the caller's own
// ACTIVE KRA assignments, scores direction-aware via the shared
// scoreKpiRecord rule, and writes SUBMITTED records so the existing
// /team/kpi-reviews approval loop (PENDING → SUBMITTED → APPROVED |
// REJECTED) picks them up unchanged.
//
// NULL-target spine: a KPI with no targetValue still accepts a reading —
// the actual is stored with score null (health derives as "no_target").
// We never substitute 0 for a missing line.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { notifyKpiSubmitted } from "@/lib/kpi-review.server";
import { kpiWriteStatus } from "@/lib/kpi-record-status";
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

  const before = await prisma.kPIRecord.findMany({
    where: { userId, period, kpiId: { in: rows.map((r) => r.kpiId) } },
    select: { kpiId: true, status: true },
  });
  const wasSubmitted = new Set(before.filter((b) => b.status === "SUBMITTED").map((b) => b.kpiId));
  const beforeBy = new Map(before.map((b) => [b.kpiId, b]));

  const ops = rows
    .filter((r) => allowedKpiIds.has(r.kpiId))
    .map((r) => {
      const kpi = kpiMap.get(r.kpiId);
      if (!kpi) return null;

      const actual = r.actualValue != null ? Number(r.actualValue) : null;
      // A blank on a row a manager already decided is not a change: skip it
      // rather than wipe the approved number.
      const prior = beforeBy.get(r.kpiId);
      if (actual == null && (prior?.status === "APPROVED" || prior?.status === "REJECTED")) return null;
      // Direction-aware, null-target-safe. Score null when no line exists —
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
          notes: r.notes || null,
          evidence: r.evidence || null,
          status: actual != null ? "SUBMITTED" : "PENDING",
          reviewedById: null,
        },
        update: {
          actualValue: actual,
          targetValue: target ?? 0,
          score,
          notes: r.notes || null,
          evidence: r.evidence || null,
          // src/lib/kpi-record-status.ts: SUBMITTED with a number; a blank
          // save never undoes a manager's decision.
          status: kpiWriteStatus({ actorId: userId, subjectId: userId, actual, existing: beforeBy.get(r.kpiId) ?? null }).status,
          // The person's own number: no manager has decided on it yet.
          ...(actual != null ? { reviewedById: null } : {}),
        },
      });
    })
    .filter((op): op is NonNullable<typeof op> => op !== null);

  const results = await prisma.$transaction(ops);
  // The people whose queue these land in hear about it once (kpi_submitted).
  const fresh = results.filter((r) => r.status === "SUBMITTED" && !wasSubmitted.has(r.kpiId)).length;
  void notifyKpiSubmitted({ userId, organizationId: getOrgId(session), period, count: fresh });

  return jsonSuccess({ saved: results.length, period, status: "SUBMITTED" });
}
