// access-tiers — the OS shell's access-level ladder. Standalone (imports
// nothing from the app catalog) so both apps-catalog AND the individual hub
// sidebars can gate links by tier without a circular import.
//
//   "manager"   — TEAM_LEAD, MANAGER, DIRECTOR, VP, C_LEVEL, HR, admin
//   "hr-admin"  — HR + COMPANY_ADMIN + SUPER_ADMIN (people management)
//   "org-admin" — COMPANY_ADMIN + SUPER_ADMIN only (finance/legal)
//
// Rail/sidebar visibility is display-level only; every gated page ALSO enforces
// the same tier server-side (src/lib/page-gates.ts).

export type AccessTier = "manager" | "hr-admin" | "org-admin";

export const MANAGER_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);
export const HR_ADMIN_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "HR",
]);
export const ORG_ADMIN_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN",
]);

/** Tier check shared by app-level, per-CreateAction, and folded-link gates. */
export function canAccessTier(tier: AccessTier | undefined, accessLevel: string | null | undefined): boolean {
  if (!tier) return true;
  if (!accessLevel) return false;
  if (tier === "manager") return MANAGER_LEVELS.has(accessLevel);
  if (tier === "hr-admin") return HR_ADMIN_LEVELS.has(accessLevel);
  return ORG_ADMIN_LEVELS.has(accessLevel);
}
