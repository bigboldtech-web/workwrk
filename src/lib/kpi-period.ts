// The month a KPI "Record numbers" view writes to (KPIRecord.period, always
// the canonical "YYYY-MM" month key, see lib/alignment.ts latestKpiValues).
//
// /kra-kpi/review 308s to /team/kpi-reviews?view=record carrying ?period=
// (spec-goals section 0), so a stored link to a past month opens that month.
// A future month, a malformed value or nothing at all falls back to the
// current month: a manager can never record a number for a month that has
// not started, and a typo never lands a number somewhere unexpected.
//
// Pure: no React, no Prisma.

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The current month's key in local time, e.g. "2026-09". */
export function currentKpiPeriod(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** A requested month when it is a valid, not-future month key; else the current one. */
export function resolveKpiPeriod(requested: unknown, now: Date = new Date()): string {
  const current = currentKpiPeriod(now);
  if (typeof requested !== "string") return current;
  const m = MONTH_KEY.exec(requested.trim());
  if (!m) return current;
  const key = `${m[1]}-${m[2]}`;
  // Keys are fixed width, so string order is month order.
  return key > current ? current : key;
}

/** "September 2026" for "2026-09". */
export function kpiPeriodLabel(period: string): string {
  const m = MONTH_KEY.exec(period);
  if (!m) return period;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
