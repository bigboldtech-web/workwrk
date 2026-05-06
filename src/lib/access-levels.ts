/**
 * Canonical list of access levels.
 *
 * Both "level on a Role" (Role.level) and "access level on a User"
 * (User.accessLevel) are stored as the same `AccessLevel` Prisma
 * enum, so they should always be picked from the same option set.
 * Until this file existed, the Roles management UI and the Invite
 * Team Member dialog each maintained their own hard-coded list and
 * they drifted (people-page was missing C_LEVEL).
 *
 * Rules:
 *   · COMPANY_ADMIN and SUPER_ADMIN are intentionally excluded from
 *     this list. They're sensitive privileges granted manually by
 *     the WorkwrK staff (SUPER_ADMIN) or the existing org admin
 *     (COMPANY_ADMIN). Letting anyone hand them out via a Role
 *     dropdown would be a footgun.
 *   · Order goes seniority-first so the dropdown reads top→down as
 *     "highest authority → lowest." Matches the visual hierarchy in
 *     the org chart.
 */

export type AccessLevelValue =
  | "C_LEVEL"
  | "VP"
  | "DIRECTOR"
  | "MANAGER"
  | "TEAM_LEAD"
  | "HR"
  | "EMPLOYEE"
  | "AGENT";

export interface AccessLevelOption {
  value: AccessLevelValue;
  label: string;
  /** Short descriptor used as a hint inline. */
  hint?: string;
}

export const ACCESS_LEVELS: ReadonlyArray<AccessLevelOption> = [
  { value: "C_LEVEL",   label: "C-Level",    hint: "CEO/CTO/CFO etc." },
  { value: "VP",        label: "VP" },
  { value: "DIRECTOR",  label: "Director" },
  { value: "MANAGER",   label: "Manager" },
  { value: "TEAM_LEAD", label: "Team Lead" },
  { value: "HR",        label: "HR",         hint: "People-ops scope" },
  { value: "EMPLOYEE",  label: "Employee" },
  { value: "AGENT",     label: "Agent",      hint: "Limited frontline" },
] as const;

export const ACCESS_LEVEL_VALUES: ReadonlyArray<AccessLevelValue> =
  ACCESS_LEVELS.map((l) => l.value);

/** Friendly label for any AccessLevel-string we receive. Returns the
 *  value with underscores stripped if we don't recognise it (so
 *  COMPANY_ADMIN / SUPER_ADMIN render readably on display surfaces). */
export function labelForAccessLevel(value: string): string {
  const match = ACCESS_LEVELS.find((l) => l.value === value);
  if (match) return match.label;
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
