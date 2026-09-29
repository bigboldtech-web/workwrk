// The goal's quarter label, derived (spec-goals section 1 copy rules): the
// quarter of the goal's due date in the organization's fiscal year, which
// starts in the month Organization.settings.fiscalYearStart names (1 to 12,
// Settings > Locale). OKR.quarter, the old free-text field, is no longer
// written; it stays readable for one release.
//
// fiscalYearStart arrives as a number (4) or the legacy "MM-01" string
// ("04-01"); anything else reads as the default. The default is April (4),
// the value GET /api/settings reports when an org never set one, so the
// label matches what the Locale page shows.
//
// Labels name the fiscal year by the calendar year it ENDS in when the year
// does not start in January (FY starting April 2026 is "FY27"), and by the
// plain year when it does ("Q3 2026"). Pure.

export const DEFAULT_FISCAL_START = 4;

export function normalizeFiscalStart(v: unknown): number {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 12) return v;
  if (typeof v === "string") {
    const m = /^(\d{1,2})(?:-\d{1,2})?$/.exec(v.trim());
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 12) return n;
    }
  }
  return DEFAULT_FISCAL_START;
}

/** Fiscal quarter (1..4) and the fiscal year's label for a date (UTC month). */
export function fiscalQuarterOf(date: Date, fiscalStart: unknown): { quarter: number; yearLabel: string } {
  const start = normalizeFiscalStart(fiscalStart);
  const month = date.getUTCMonth() + 1; // 1..12
  const year = date.getUTCFullYear();
  const offset = (month - start + 12) % 12; // months since the fiscal year began
  const quarter = Math.floor(offset / 3) + 1;
  if (start === 1) return { quarter, yearLabel: String(year) };
  // The fiscal year ends in the calendar year after the one it starts in.
  const fyStartYear = month >= start ? year : year - 1;
  return { quarter, yearLabel: `FY${String((fyStartYear + 1) % 100).padStart(2, "0")}` };
}

/** "Q3 2026" or "Q2 FY27"; null when there is no due date. */
export function goalQuarterLabel(endDate: Date | string | null | undefined, fiscalStart: unknown): string | null {
  if (endDate == null) return null;
  const d = new Date(endDate);
  if (!Number.isFinite(d.getTime())) return null;
  const { quarter, yearLabel } = fiscalQuarterOf(d, fiscalStart);
  return `Q${quarter} ${yearLabel}`;
}

/** The first day (UTC) of the fiscal quarter `now` falls in. */
export function fiscalQuarterStart(now: Date, fiscalStart: unknown): Date {
  const start = normalizeFiscalStart(fiscalStart);
  const month = now.getUTCMonth() + 1;
  const offset = (month - start + 12) % 12;
  const qStartOffset = offset - (offset % 3); // months since FY start at quarter start
  let m = start + qStartOffset; // may exceed 12
  let y = now.getUTCFullYear();
  if (m > 12) m -= 12;
  if (m > month) y -= 1;
  return new Date(Date.UTC(y, m - 1, 1));
}
