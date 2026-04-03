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
