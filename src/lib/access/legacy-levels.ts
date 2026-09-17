// The legacy AccessLevel ladder, in ONE place.
//
// Today the same four tier lists are hand-copied into roughly 28 files
// (space.ts:14, board.ts:29, folder.ts:13, access.ts:68-70, api-helpers.ts:56
// and :72, page-gates.ts:18-22, route-guard.ts:12-13, access-tiers.ts:14-23,
// and on down the list). Step 1 of the migration order points every one of
// those gates at this file, so the ladder has a single definition while the
// engine's own four org roles (types.ts OrgRole) take over in step 4.
//
// This file is DESCRIPTIVE, not aspirational: each set is exactly what the
// code answers today, so a delegate that routes through it cannot change an
// answer. The spec's replacements ("manager" becomes hasReports, "hr-admin"
// becomes the People team) are recorded in parity.ts EXPECTED_MISMATCHES and
// land later, never here.
//
// Pure and dependency free on purpose: this is imported by client components
// (access-tiers.ts) as well as by server gates, and by the golden suite, which
// runs in node with no "@/" alias.

/** space.ts:14-17, board.ts:29, folder.ts:13, access.ts:68, api-helpers.ts:72-77,
 *  route-guard.ts:13, doc-sharing.ts:38, access-tiers.ts:21-23. */
export const LEGACY_ADMIN_LEVELS: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
]);

/** api-helpers.ts:56-67, access-tiers.ts:14-17, page-gates.ts:18-21,
 *  access.ts:70. The eight-level list, HR included. */
export const LEGACY_MANAGER_LEVELS: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "C_LEVEL",
  "VP",
  "DIRECTOR",
  "MANAGER",
  "TEAM_LEAD",
  "HR",
]);

/** access-tiers.ts:18-20, page-gates.ts:22. */
export const LEGACY_HR_ADMIN_LEVELS: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "HR",
]);

/** access.ts:69, apps-catalog.tsx:1136. */
export const LEGACY_DIRECTOR_LEVELS: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "C_LEVEL",
  "VP",
  "DIRECTOR",
]);

/** route-guard.ts:12. A DENY list, not an allow list: it is the only tier
 *  test in the codebase phrased the other way round, so a level outside both
 *  it and LEGACY_MANAGER_LEVELS behaves oppositely in the two files. Kept
 *  verbatim rather than derived, because deriving it would change that. */
export const LEGACY_EMPLOYEE_LEVELS: ReadonlySet<string> = new Set(["EMPLOYEE", "AGENT"]);

/** Every gate that says "org admin" today. Missing or empty means no. */
export function legacyIsAdminLevel(level: string | null | undefined): boolean {
  return !!level && LEGACY_ADMIN_LEVELS.has(level);
}

/** api-helpers.ts isManager, page-gates.ts requireManagerPage, access.ts isManagerOrAbove. */
export function legacyIsManagerLevel(level: string | null | undefined): boolean {
  return !!level && LEGACY_MANAGER_LEVELS.has(level);
}

/** page-gates.ts requireHrAdminPage, access-tiers.ts "hr-admin". */
export function legacyIsHrAdminLevel(level: string | null | undefined): boolean {
  return !!level && LEGACY_HR_ADMIN_LEVELS.has(level);
}

/** access.ts isDirectorOrAbove. */
export function legacyIsDirectorLevel(level: string | null | undefined): boolean {
  return !!level && LEGACY_DIRECTOR_LEVELS.has(level);
}

export type LegacyTier = "manager" | "hr-admin" | "org-admin";

/**
 * access-tiers.ts:26-32 canAccessTier, minus its `if (!tier) return true`
 * preamble, which stays at the call site because it is about the absence of a
 * requirement rather than about the ladder.
 *
 * Note the shape: a null or empty accessLevel is FALSE for every tier, so an
 * unhydrated session hides gated rows. shell-context.tsx:512 reads an
 * undefined level as true for the org-admin tier, which is the opposite; both
 * behaviours are preserved at their own call sites.
 */
export function legacyTierAllows(tier: LegacyTier, level: string | null | undefined): boolean {
  if (!level) return false;
  if (tier === "manager") return LEGACY_MANAGER_LEVELS.has(level);
  if (tier === "hr-admin") return LEGACY_HR_ADMIN_LEVELS.has(level);
  return LEGACY_ADMIN_LEVELS.has(level);
}
