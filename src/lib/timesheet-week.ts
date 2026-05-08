// Canonical Monday-anchored week calculations. Every Timesheet row's
// `weekStartDate` is Monday 00:00 UTC of that week. Anchoring server-
// side (rather than user-locale) means an entry typed at 11pm Sunday
// India time and 11pm Sunday US time both land in the same week row,
// which is what an HR admin in HQ expects when running reports.

const DAY_MS = 24 * 60 * 60 * 1000;

// JS Date.getUTCDay: 0 = Sunday … 6 = Saturday.
// We want Monday = 0 offset, Sunday = 6 offset.
function mondayOffset(d: Date): number {
  const day = d.getUTCDay();
  return day === 0 ? 6 : day - 1;
}

export function weekStartUTC(d: Date = new Date()): Date {
  const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(ms - mondayOffset(d) * DAY_MS);
}

export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
}

export function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function dayStartUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
