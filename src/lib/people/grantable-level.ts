// Which access level may a caller give a person they are creating? The one
// rule for POST /api/users and POST /api/people/bulk-import, which both took
// the level straight from the request, so any manager could mint a
// COMPANY_ADMIN account (a live privilege escalation, found in the Phase 6
// reconnaissance).
//
// The rule, by the smallest worst case:
//   - An org admin (COMPANY_ADMIN, SUPER_ADMIN) may give any level except
//     SUPER_ADMIN, which only a SUPER_ADMIN may give.
//   - Everyone else who may create people at all gives EMPLOYEE or AGENT,
//     the two levels that carry no management or admin right. Placing
//     someone higher is an admin's act in Members.
//   - An absent level is EMPLOYEE (the column default); an unknown string is
//     refused, never guessed.
//
// Pure: no imports.

export const ACCESS_LEVELS = [
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "AGENT", "HR",
] as const;
export type GrantableLevel = (typeof ACCESS_LEVELS)[number];

const LEVEL_SET: ReadonlySet<string> = new Set(ACCESS_LEVELS);

/** The level to write, or null when the caller may not give it. */
export function grantableAccessLevel(callerLevel: string | null | undefined, requested: unknown): GrantableLevel | null {
  if (requested === undefined || requested === null || requested === "") return "EMPLOYEE";
  if (typeof requested !== "string" || !LEVEL_SET.has(requested)) return null;
  const level = requested as GrantableLevel;
  if (callerLevel === "SUPER_ADMIN") return level;
  if (callerLevel === "COMPANY_ADMIN") return level === "SUPER_ADMIN" ? null : level;
  return level === "EMPLOYEE" || level === "AGENT" ? level : null;
}
