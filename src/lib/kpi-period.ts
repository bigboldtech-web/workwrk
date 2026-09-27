// The month a KPI "Record numbers" view writes to (KPIRecord.period, always
// the canonical "YYYY-MM" month key, see lib/alignment.ts latestKpiValues).
//
// /kra-kpi/review 308s to /team/kpi-reviews carrying ?period=
// (spec-goals section 0), so a stored link to a past month opens that month.
// A future month, a malformed value or nothing at all falls back to the
// current month: a manager can never record a number for a month that has
// not started, and a typo never lands a number somewhere unexpected.
// A past month OPENS READ ONLY (isKpiPeriodOpen): saving there would upsert
// over a closed month's numbers and set an APPROVED record back to
// SUBMITTED, silently rescoring history. The old page never wrote a past
// month, so none of its capability is lost.
//
// The month is the UTC month, the same one the boot "My KPIs due" badge
// counts (src/lib/people/teams-counts.ts re-exports this helper), so the
// badge and the Record numbers view always name the same month and server
// render and hydration agree whatever the browser's timezone.
//
// Pure: no React, no Prisma.

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The current month's key (UTC), e.g. "2026-09". */
export function currentKpiPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Only the current month takes new numbers from the Record numbers view. */
export function isKpiPeriodOpen(period: string, now: Date = new Date()): boolean {
  return period === currentKpiPeriod(now);
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

/** The month key `delta` months from `period` ("2026-09", -1 -> "2026-08"). */
export function shiftKpiPeriod(period: string, delta: number): string {
  const m = MONTH_KEY.exec(period);
  if (!m) return period;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/**
 * May a manager record a number for this month on KPI reviews? The current
 * month and the one before it, the same two the employee's own recorder
 * offers (spec-goals /people/me?tab=kras contract), so a number a person
 * forgot at month end can still land. Older months open read only: saving
 * there would rescore a closed month. Approving a submitted number is
 * allowed in any month (the person already wrote it).
 */
export function isKpiPeriodWritable(period: string, now: Date = new Date()): boolean {
  const current = currentKpiPeriod(now);
  return period === current || period === shiftKpiPeriod(current, -1);
}
