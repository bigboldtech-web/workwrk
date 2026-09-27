// KPI manager-approval helpers. Mirrors src/lib/weekly-review.ts: a
// manager sees KPI scores their reports SUBMITTED and approves them or
// sends them back. The KPIRecord status enum already models the loop
// (PENDING → SUBMITTED → APPROVED | REJECTED), so no migration is needed.

import { notifyKpiDecision } from "@/lib/kpi-review.server";
import { prisma } from "@/lib/prisma";
import { getEffectiveReportTree } from "@/lib/reporting-line";
import { kpiDirection } from "@/lib/alignment";
import type { KpiDirection, KPIRecordStatus, KPIType } from "@/generated/prisma";

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
 * Default rubric ceiling for a QUALITATIVE KPI. Its "actual" is a 1..N
 * anchor rating rather than a raw metric, so the healthy line is the top
 * of the scale unless the KPI defines its own target rating.
 */
export const QUALITATIVE_SCALE_MAX = 5;

/**
 * The effective healthy line a reading is scored/stored against.
 *
 * - QUANTITATIVE → the KPI's target as-is (null = "no baseline yet",
 *   scored null so we never invent a line).
 * - QUALITATIVE  → the KPI's target rating if it set one, otherwise the
 *   rubric ceiling ({@link QUALITATIVE_SCALE_MAX}). A qualitative KPI
 *   therefore ALWAYS has a line, so a rubric rating always yields a
 *   score (rating / ceiling · 100) instead of a null "no_target".
 *
 * Callers pass the target they already resolved (KPI target ?? manual
 * fallback); this only substitutes the rubric ceiling for a qualitative
 * KPI that has no usable line of its own.
 */
export function resolveKpiLine(
  type: KPIType | string | null | undefined,
  targetValue: number | null,
): number | null {
  if (type === "QUALITATIVE" && (targetValue == null || targetValue <= 0)) {
    return QUALITATIVE_SCALE_MAX;
  }
  return targetValue;
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
  opts: { status?: KPIRecordStatus; statuses?: KPIRecordStatus[]; take?: number; since?: Date; sinceDays?: number } = {},
): Promise<KpiReviewQueueItem[]> {
  if (opts.sinceDays && !opts.since) opts = { ...opts, since: new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000) };
  const tree = await getEffectiveReportTree(managerId);
  const reportIds = tree.filter((id) => id !== managerId);
  if (reportIds.length === 0) return [];

  const statusWhere = opts.statuses
    ? { status: { in: opts.statuses } }
    : opts.status
      ? { status: opts.status }
      : {};

  const rows = await prisma.kPIRecord.findMany({
    where: { userId: { in: reportIds }, kpi: { organizationId }, ...statusWhere, ...(opts.since ? { updatedAt: { gte: opts.since } } : {}) },
    include: {
      kpi: { select: { id: true, name: true, unit: true, targetLabel: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { updatedAt: "desc" },
    // Uncapped unless the caller asks: a queue shows every row its badge
    // counts (countKpiReviewsForManager), never the first 50.
    ...(opts.take ? { take: opts.take } : {}),
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
 * How many KPI numbers await `managerId`'s approval: the SAME where clause
 * as listKpiReviewsForManager with status SUBMITTED, uncapped, so the Teams
 * sidebar's KPI reviews badge and the page's queue can never disagree.
 */
export async function countKpiReviewsForManager(managerId: string, organizationId: string): Promise<number> {
  const tree = await getEffectiveReportTree(managerId);
  const reportIds = tree.filter((id) => id !== managerId);
  if (reportIds.length === 0) return 0;
  return prisma.kPIRecord.count({
    where: { userId: { in: reportIds }, kpi: { organizationId }, status: "SUBMITTED" },
  });
}

/**
 * Decide on a SUBMITTED KPI record: approve, send back with a note, or
 * reopen a decision (the Undo on the toast) back to SUBMITTED. The caller
 * authorizes. reviewedById records who decided; a manager note is written
 * only when one is given, so approving without a note never wipes the note
 * already on the row. The Inbox row goes through src/lib/kpi-review.server.ts
 * with literal types the inbox-kinds completeness test can see.
 */
export async function actOnKpiRecord(
  recordId: string,
  args: { action: "approve" | "request_changes" | "reopen"; notes?: string; actorId: string },
): Promise<{ status: KPIRecordStatus }> {
  const next: KPIRecordStatus = args.action === "approve" ? "APPROVED" : args.action === "request_changes" ? "REJECTED" : "SUBMITTED";
  const note = typeof args.notes === "string" && args.notes.trim() ? args.notes.trim() : undefined;
  const updated = await prisma.kPIRecord.update({
    where: { id: recordId },
    data: {
      status: next,
      ...(note !== undefined ? { managerNotes: note } : {}),
      reviewedById: args.action === "reopen" ? null : args.actorId,
    },
    include: { kpi: { select: { name: true } } },
  });
  if (args.action !== "reopen") {
    await notifyKpiDecision({
      userId: updated.userId,
      actorId: args.actorId,
      kpiName: updated.kpi.name,
      period: updated.period,
      decision: args.action,
      notes: note ?? null,
    });
  }
  return { status: next };
}
