// A KPI reading from an integration, written: POST /api/v1/kpi-records and
// the kpi.record action of /api/integrations/ingest, so both follow the one
// rule in src/lib/kpi-integration.ts (a month key; a second reading for the
// same KPI, person and month replaces, repeats or is refused, never a 500).
//
// The person must be in the caller's workspace. The ingest action used to
// write a reading for any user id it was sent, another workspace's people
// included.
//
// Server-only.

import { prisma } from "@/lib/prisma";
import { parseKpiNumber } from "@/lib/kpi-record-status";
import { triggerRecalculation } from "@/services/performanceScoreService";
import { dispatchEvent } from "@/services/webhookDispatcher";
import { KPI_CLOSED_MONTH, integrationKpiWrite, integrationPeriodProblem } from "@/lib/kpi-integration";

const RECORD_SELECT = {
  id: true,
  kpiId: true,
  userId: true,
  period: true,
  targetValue: true,
  actualValue: true,
  score: true,
  createdAt: true,
} as const;

export type KpiReading = {
  id: string;
  kpiId: string;
  userId: string;
  period: string;
  targetValue: number;
  actualValue: number | null;
  score: number | null;
  createdAt: Date;
};

export type KpiReadingAnswer =
  | { status: 201 | 200; record: KpiReading; changed: boolean }
  | { status: 400 | 404; error: string }
  | { status: 409; error: string; code: "kpi_month_closed"; id: string };

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

export async function recordIntegrationKpi(
  organizationId: string,
  body: { kpiId?: unknown; userId?: unknown; period?: unknown; actualValue?: unknown; targetValue?: unknown; notes?: unknown; evidence?: unknown },
  opts: { notes?: string | null; now?: Date } = {},
): Promise<KpiReadingAnswer> {
  const now = opts.now ?? new Date();
  const kpiId = typeof body.kpiId === "string" ? body.kpiId : "";
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!kpiId || !userId || body.period == null || body.period === "" || body.actualValue == null || body.actualValue === "") {
    return { status: 400, error: "kpiId, userId, period, and actualValue are required" };
  }
  const actual = parseKpiNumber(body.actualValue);
  if (!actual.ok || actual.value === null) return { status: 400, error: "actualValue must be a number" };
  const periodProblem = integrationPeriodProblem(body.period, now);
  if (periodProblem) return { status: 400, error: periodProblem };
  const period = body.period as string;
  const givenTarget = parseKpiNumber(body.targetValue);
  if (!givenTarget.ok) return { status: 400, error: "targetValue must be a number" };
  const notes = typeof body.notes === "string" ? body.notes : undefined;
  const evidence = typeof body.evidence === "string" ? body.evidence : undefined;

  const kpi = await prisma.kPI.findFirst({ where: { id: kpiId, organizationId }, select: { id: true, targetValue: true } });
  if (!kpi) return { status: 404, error: "KPI not found" };
  const user = await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
  if (!user) return { status: 404, error: "User not in org" };

  // KPI.targetValue is nullable on the model; the caller may override.
  const target = givenTarget.value ?? kpi.targetValue ?? 0;
  const score = target > 0 ? Math.min(100, Math.round((actual.value / target) * 100)) : 0;
  const key = { kpiId_userId_period: { kpiId, userId, period } };

  const value = actual.value;
  const readExisting = () => prisma.kPIRecord.findUnique({ where: key, select: { id: true, actualValue: true, targetValue: true } });

  // Twice at most: a create that loses to another call writing the same
  // reading a moment ago decides again against what that call wrote.
  let answer: KpiReadingAnswer | null = null;
  let existing = await readExisting();
  for (let attempt = 0; attempt < 2 && !answer; attempt++) {
    const decision = integrationKpiWrite({ existing, actual: value, target, period, now });
    if (decision === "unchanged") {
      const kept = await prisma.kPIRecord.findUnique({ where: key, select: RECORD_SELECT });
      if (kept) answer = { status: 200, record: kept, changed: false };
      else existing = null;
    } else if (decision === "closed") {
      answer = { status: 409, error: KPI_CLOSED_MONTH, code: "kpi_month_closed", id: existing!.id };
    } else if (decision === "update") {
      const record = await prisma.kPIRecord.update({
        where: key,
        data: {
          targetValue: target,
          actualValue: value,
          score,
          status: "PENDING",
          reviewedById: null,
          ...(notes !== undefined ? { notes } : {}),
          ...(evidence !== undefined ? { evidence } : {}),
        },
        select: RECORD_SELECT,
      });
      answer = { status: 200, record, changed: true };
    } else {
      try {
        const record = await prisma.kPIRecord.create({
          data: { kpiId, userId, period, targetValue: target, actualValue: value, score, notes: notes ?? opts.notes ?? null, evidence: evidence ?? null },
          select: RECORD_SELECT,
        });
        answer = { status: 201, record, changed: true };
      } catch (err) {
        if (!isUniqueViolation(err) || attempt > 0) throw err;
        existing = await readExisting();
        if (!existing) throw err;
      }
    }
  }
  if (!answer) throw new Error("The KPI reading could not be written");
  if ("record" in answer && answer.changed) {
    // Non-blocking fan-out, only for a reading that changed something.
    triggerRecalculation(userId, organizationId);
    dispatchEvent({ organizationId, event: "kpi.recorded", payload: answer.record }).catch(() => {});
  }
  return answer;
}
