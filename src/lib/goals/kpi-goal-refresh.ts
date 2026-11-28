// A goal fed by a KPI keeps its stored progress in step with the KPI's
// numbers (pen test 2026-11-28, V-32). The goal page, the goals list and a
// person's profile compute a KPI-fed result live, but OKR.progress and status
// are stored, and Home's "My goals", the review self-assessment, the task
// drawer's goal trail, parent rollups, the export and the AI and MCP goal
// tools read the stored value. A KPI number written, reviewed or deleted, and
// a KPI edited or deleted, now re-saves the rollup of every goal it feeds.

import { prisma } from "@/lib/prisma";
import { persistGoalRollupChains } from "@/lib/alignment";

/** The goals fed by these KPIs (read BEFORE a KPI delete, which unlinks them). */
export async function goalsFedBy(organizationId: string, kpiIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(kpiIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const krs = await prisma.keyResult.findMany({
    where: { kpiId: { in: ids }, okr: { organizationId } },
    select: { okrId: true },
  });
  return [...new Set(krs.map((k) => k.okrId))];
}

/** Re-save these goals' rollups (and their parents'). Never throws. */
export async function refreshGoals(organizationId: string, okrIds: readonly string[]): Promise<void> {
  if (okrIds.length === 0) return;
  try {
    await persistGoalRollupChains(organizationId, okrIds);
  } catch (err) {
    console.error("[kpi-goal-refresh] rollup failed", err);
  }
}

/** After a KPI's numbers changed: refresh every goal it feeds, in the background. */
export function refreshGoalsFedBy(organizationId: string, kpiIds: readonly string[]): void {
  void goalsFedBy(organizationId, kpiIds)
    .then((okrIds) => refreshGoals(organizationId, okrIds))
    .catch((err) => console.error("[kpi-goal-refresh] lookup failed", err));
}
