// The KPI score a manager sees BEFORE saving (KPI reviews' Score column),
// the client mirror of the server's scoreKpiRecord + resolveKpiLine in
// src/lib/kpi-record.ts, so the preview is exactly what the POST stores:
// direction from the enum, else the legacy lowerIsBetter; a qualitative KPI
// with no target scores against the 1 to 5 rubric; capped at 120; null when
// there is no baseline. Pure, client safe (kpi-record.ts imports Prisma).

export type KpiDirection = "HIGHER" | "LOWER" | "MAINTAIN";
export const QUALITATIVE_SCALE_MAX = 5;

export function previewKpiScore(
  kpi: { type?: string | null; target: number | null; direction?: KpiDirection | null; lowerIsBetter?: boolean | null },
  actual: number | null,
): number | null {
  if (actual == null || !Number.isFinite(actual)) return null;
  const raw = kpi.target ?? 0;
  const target = kpi.type === "QUALITATIVE" && raw <= 0 ? QUALITATIVE_SCALE_MAX : raw;
  if (!Number.isFinite(target) || target === 0) return null;
  const dir: KpiDirection = kpi.direction ?? (kpi.lowerIsBetter ? "LOWER" : "HIGHER");
  if (dir === "MAINTAIN") {
    const deviation = Math.abs(actual - target) / Math.abs(target);
    return Math.max(0, Math.round((1 - deviation) * 100));
  }
  if (dir === "LOWER") {
    if (actual === 0) return 120;
    return Math.min(Math.round((target / actual) * 100), 120);
  }
  return Math.min(Math.round((actual / target) * 100), 120);
}
