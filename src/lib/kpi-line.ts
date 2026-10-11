// The healthy line a KPI reading is scored and stored against, the ONE rule
// every KPIRecord writer shares: the in-app recorders (POST /api/kpi-records,
// /batch, /self-report, through src/lib/kpi-record.ts, which re-exports
// these) and an integration's reading (src/lib/kpi-integration.server.ts).
// Moved here from kpi-record.ts unchanged (docs-found fixes batch 4) so a
// pure caller can read it without that module's server imports.
//
// Pure: no Prisma. src/lib/kpi-preview-score.ts is the client's mirror.

import type { KPIType } from "@/generated/prisma";

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
