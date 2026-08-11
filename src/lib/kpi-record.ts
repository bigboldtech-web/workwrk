// KPI manager-approval helpers. Mirrors src/lib/weekly-review.ts: a
// manager sees KPI scores their reports SUBMITTED and approves them or
// sends them back. The KPIRecord status enum already models the loop
// (PENDING → SUBMITTED → APPROVED | REJECTED), so no migration is needed.

import { prisma } from "@/lib/prisma";
import { getEffectiveReportTree } from "@/lib/reporting-line";
import { kpiDirection } from "@/lib/alignment";
import type { KpiDirection, KPIRecordStatus } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Scoring — the ONE rule all three KPIRecord writers share
// (/api/kpi-records POST, /batch, /self-report), so they stop disagreeing.
// ---------------------------------------------------------------------------

export interface ScoreKpiInput {
  targetValue: number | null;
  direction?: KpiDirection | null;
  lowerIsBetter?: boolean | null;
}

/**
 * Score a reading against its KPI's healthy line, direction-aware.
 *
 * - NULL (or zero / non-finite) target → null score. "No baseline yet"
 *   is a real state: we store the actual and NEVER invent a line
 *   (health derives as "no_target" via src/lib/alignment.ts).
 * - HIGHER   → actual/target · 100, capped at 120.
 * - LOWER    → target/actual · 100 (actual 0 = 120), capped at 120.
 * - MAINTAIN → 100 minus the % deviation from the line, floored at 0.
 */
export function scoreKpiRecord(
  kpi: ScoreKpiInput,
  actual: number | null | undefined,
): number | null {
  if (actual == null || !Number.isFinite(actual)) return null;
  const target = kpi.targetValue;
  if (target == null || !Number.isFinite(target) || target === 0) return null;

  const direction = kpiDirection(kpi);
  if (direction === "MAINTAIN") {
    const deviation = Math.abs(actual - target) / Math.abs(target);
    return Math.max(0, Math.round((1 - deviation) * 100));
  }
  if (direction === "LOWER") {
    if (actual === 0) return 120;
    return Math.min(Math.round((target / actual) * 100), 120);
  }
  return Math.min(Math.round((actual / target) * 100), 120);
}

export interface KpiReviewQueueItem {
  id: string;
  period: string;
  targetValue: number;
  actualValue: number | null;
  score: number | null;
  notes: string | null;
  managerNotes: string | null;
  evidence: string | null;
  status: KPIRecordStatus;
  updatedAt: Date;
  kpi: { id: string; name: string; unit: string | null; targetLabel: string | null };
  subject: { id: string; firstName: string | null; lastName: string | null } | null;
}

/**
 * KPI records belonging to `managerId`'s reports (solid + dotted),
 * filtered by status. Excludes the manager's own records.
 */
export async function listKpiReviewsForManager(
  managerId: string,
  organizationId: string,
  opts: { status?: KPIRecordStatus; statuses?: KPIRecordStatus[]; take?: number } = {},
): Promise<KpiReviewQueueItem[]> {
  const tree = await getEffectiveReportTree(managerId);
  const reportIds = tree.filter((id) => id !== managerId);
  if (reportIds.length === 0) return [];

  const statusWhere = opts.statuses
    ? { status: { in: opts.statuses } }
    : opts.status
      ? { status: opts.status }
      : {};

  const rows = await prisma.kPIRecord.findMany({
    where: { userId: { in: reportIds }, kpi: { organizationId }, ...statusWhere },
    include: {
      kpi: { select: { id: true, name: true, unit: true, targetLabel: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: opts.take ?? 50,
  });

  return rows.map((r) => ({
    id: r.id,
    period: r.period,
    targetValue: r.targetValue,
    actualValue: r.actualValue,
    score: r.score,
    notes: r.notes,
    managerNotes: r.managerNotes,
    evidence: r.evidence,
    status: r.status,
    updatedAt: r.updatedAt,
    kpi: r.kpi,
    subject: r.user,
  }));
}

/**
 * Transition a SUBMITTED KPI record to APPROVED / REJECTED, store the
 * manager note, and notify the report. (Caller authorizes.) REJECTED
 * records re-surface in the IC's "to score" list so they can resubmit.
 */
export async function actOnKpiRecord(
  recordId: string,
  args: { action: "approve" | "request_changes"; notes?: string },
): Promise<void> {
  const next: KPIRecordStatus = args.action === "approve" ? "APPROVED" : "REJECTED";
  const updated = await prisma.kPIRecord.update({
    where: { id: recordId },
    data: { status: next, managerNotes: args.notes ?? null },
    include: { kpi: { select: { name: true } } },
  });

  await prisma.notification.create({
    data: {
      userId: updated.userId,
      type: args.action === "approve" ? "kpi_approved" : "kpi_changes_requested",
      title: args.action === "approve" ? "KPI score approved" : "KPI score sent back",
      message:
        args.action === "approve"
          ? `Your "${updated.kpi.name}" KPI for ${updated.period} was approved.`
          : `Your "${updated.kpi.name}" KPI for ${updated.period} needs changes.${args.notes ? ` Note: ${args.notes}` : ""}`,
      link: "/today",
    },
  });
}
