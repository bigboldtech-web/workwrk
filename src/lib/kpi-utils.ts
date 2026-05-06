export const KPI_UNIT_OPTIONS = [
  { value: "%", label: "Percentage (%)" },
  { value: "count", label: "Count" },
  { value: "₹", label: "₹ (INR)" },
  { value: "$", label: "$ (USD)" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "rating", label: "Rating (1-5)" },
] as const;

export function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function getLastPeriod(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function formatPeriodLabel(period: string): string {
  const [year, month] = period.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleString("default", { month: "short", year: "numeric" });
}

export type KpiFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUALLY";

/**
 * Approximate # of times a KPI defined at `defined` cadence fires
 * inside a single period of `record` cadence. Used to convert a
 * KPI's stored target (which is per-defined-period) into the target
 * for the period the user is actually recording.
 *
 * Example — KPI defined weekly with target 40, user records monthly:
 *   periodMultiplier("WEEKLY", "MONTHLY") ≈ 4.35
 *   displayed monthly target ≈ 40 × 4.35 ≈ 174
 */
export function periodMultiplier(defined: KpiFrequency, record: KpiFrequency): number {
  const days: Record<KpiFrequency, number> = {
    DAILY: 1,
    WEEKLY: 7,
    MONTHLY: 30.4375,    // mean Gregorian month
    QUARTERLY: 91.3125,
    ANNUALLY: 365.25,
  };
  return days[record] / days[defined];
}

/** Per-period target derived from a KPI's stored target + the
 *  recording period. Returns both the value and a short hint string
 *  explaining the derivation. */
export function adjustedTarget(
  baseTarget: number | null,
  defined: KpiFrequency,
  record: KpiFrequency,
): { value: number | null; hint: string | null } {
  if (baseTarget == null) return { value: null, hint: null };
  if (defined === record) return { value: baseTarget, hint: null };
  const m = periodMultiplier(defined, record);
  const v = Math.round(baseTarget * m * 100) / 100;
  return {
    value: v,
    hint: `${baseTarget} × ${m.toFixed(2)} (${defined.toLowerCase()} → ${record.toLowerCase()})`,
  };
}

export function calculateScore(actual: number | null, target: number | null, lowerIsBetter: boolean = false): number | null {
  if (actual == null || target == null || target === 0) return null;
  if (lowerIsBetter) {
    // Lower actual = better score. At target = 100%, above target = worse
    // Example: target 5 errors, actual 2 → score = 160% (capped at 120)
    // Example: target 5 errors, actual 8 → score = 40% (bad)
    if (actual === 0) return 120;
    return Math.min(Math.round((target / actual) * 100), 120);
  }
  return Math.min(Math.round((actual / target) * 100), 120);
}
