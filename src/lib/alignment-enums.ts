// The values the alignment tables' enums take (prisma/schema.prisma), checked
// before a write (pen test 2026-11-28, V-52): an unknown KPI type, frequency
// or KRA assignment status reached Prisma and answered an empty 500.
//
// Pure module.

export const KPI_TYPES = ["QUANTITATIVE", "QUALITATIVE"] as const;
export const KPI_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"] as const;
export const KRA_ASSIGNMENT_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] as const;

/** The refusal text for a value outside `allowed`, or null when it is one of them (or absent). */
export function enumRefusal(field: string, value: unknown, allowed: readonly string[]): string | null {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && allowed.includes(value) ? null : `${field} must be one of ${allowed.join(", ")}.`;
}
