// The three display tiers the rail, the hub sidebars and the create menus
// read ("manager", "hr-admin", "org-admin"), answered ONCE on the server and
// shipped in /api/boot as `viewer.tiers` (access step 6, the Nav batch).
//
// Before this, every client surface read `accessLevel` off the session and ran
// the ladder itself (access-tiers.ts canAccessTier, deleted). Now the ladder
// runs here, beside the engine, and the client asks `clearsTier(tiers, t)`:
// the same answer by construction (tiersOfLevel is legacyTierAllows per tier),
// with no level on the client. The engine's own reading of these tiers
// (manager becomes "has reports", hr-admin becomes the People team) lands with
// the flip, recorded in parity.ts EXPECTED_MISMATCHES, and changes only
// tiersOfLevel's inputs, never a call site.
//
// Pure: no session, no database.

import { legacyTierAllows, type LegacyTier } from "./legacy-levels";

export type ViewerTier = LegacyTier;

export type ViewerTiers = Readonly<Record<ViewerTier, boolean>>;

/** Nobody clears a tier until boot has answered (the rail shows no tiered app for a moment rather than a wrong one). */
export const NO_TIERS: ViewerTiers = Object.freeze({ manager: false, "hr-admin": false, "org-admin": false });

export const VIEWER_TIER_KEYS: readonly ViewerTier[] = ["manager", "hr-admin", "org-admin"];

/** Today's ladder for a level (legacy-levels.ts), per tier. */
export function tiersOfLevel(level: string | null | undefined): ViewerTiers {
  return {
    manager: legacyTierAllows("manager", level),
    "hr-admin": legacyTierAllows("hr-admin", level),
    "org-admin": legacyTierAllows("org-admin", level),
  };
}

/**
 * Does a viewer with these tiers clear `tier`? No requirement always clears
 * (canAccessTier's `if (!tier) return true`); unknown tiers never do.
 */
export function clearsTier(tiers: ViewerTiers | null | undefined, tier: string | null | undefined): boolean {
  if (!tier) return true;
  if (!tiers) return false;
  return (VIEWER_TIER_KEYS as readonly string[]).includes(tier) ? tiers[tier as ViewerTier] === true : false;
}

/** Parse the boot field defensively (an older payload has none). */
export function parseViewerTiers(raw: unknown): ViewerTiers {
  if (!raw || typeof raw !== "object") return NO_TIERS;
  const r = raw as Record<string, unknown>;
  return { manager: r.manager === true, "hr-admin": r["hr-admin"] === true, "org-admin": r["org-admin"] === true };
}
