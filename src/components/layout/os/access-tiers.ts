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

import {
  LEGACY_ADMIN_LEVELS,
  LEGACY_HR_ADMIN_LEVELS,
  LEGACY_MANAGER_LEVELS,
  legacyTierAllows,
} from "@/lib/access/legacy-levels";

export type AccessTier = "manager" | "hr-admin" | "org-admin";

// Re-exported from the engine's one copy of the ladder (migration step 1) so
// the rail, the page gates and the object gates cannot drift apart. The
// engine's own answer for these tiers is different on purpose (manager becomes
// "has reports", hr-admin becomes the People team); that change is recorded in
// src/lib/access/parity.ts EXPECTED_MISMATCHES and lands with the flip, not
// here. Rail visibility also stays DISPLAY-LEVEL: routes remain reachable by
// URL exactly as today.
export const MANAGER_LEVELS = LEGACY_MANAGER_LEVELS;
export const HR_ADMIN_LEVELS = LEGACY_HR_ADMIN_LEVELS;
export const ORG_ADMIN_LEVELS = LEGACY_ADMIN_LEVELS;

/** Tier check shared by app-level, per-CreateAction, and folded-link gates. */
export function canAccessTier(tier: AccessTier | undefined, accessLevel: string | null | undefined): boolean {
  if (!tier) return true;
  return legacyTierAllows(tier, accessLevel);
}
