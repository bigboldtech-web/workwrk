// Seniority (spec-teams-people naming canon): what Role.level means on a
// job title. It is display only and never grants access (access 2.1, D14);
// the column keeps its name until access step 8 renames it, and every
// reader goes through this file.
//
// Pure: no imports. Client safe.

/** The six values a picker offers, in order. */
export const SENIORITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "EMPLOYEE", label: "Employee" },
  { value: "TEAM_LEAD", label: "Team lead" },
  { value: "MANAGER", label: "Manager" },
  { value: "DIRECTOR", label: "Director" },
  { value: "VP", label: "VP" },
  { value: "C_LEVEL", label: "C-level" },
];

/** Stored values the picker never offers but a legacy row can carry. */
const LEGACY_LABELS: Record<string, string> = {
  HR: "HR",
  COMPANY_ADMIN: "Company admin",
  SUPER_ADMIN: "Super admin",
  AGENT: "Agent",
};

export function seniorityLabel(level: string | null | undefined): string {
  if (!level) return "Employee";
  return SENIORITY_OPTIONS.find((o) => o.value === level)?.label ?? LEGACY_LABELS[level] ?? level;
}

/** A value POST/PATCH /api/roles may store: the six, or the row's current legacy value. */
export function isAssignableSeniority(value: unknown, current?: string | null): value is string {
  if (typeof value !== "string") return false;
  if (SENIORITY_OPTIONS.some((o) => o.value === value)) return true;
  return current != null && value === current;
}

/** The order a Seniority sort or group uses; legacy values sort last. */
export function seniorityRank(level: string | null | undefined): number {
  const i = SENIORITY_OPTIONS.findIndex((o) => o.value === level);
  return i === -1 ? SENIORITY_OPTIONS.length : i;
}
