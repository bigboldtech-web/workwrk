// The three display tiers the rail, the hub sidebars and the create menus
// read ("manager", "hr-admin", "org-admin"), answered ONCE on the server and
// shipped in /api/boot as `viewer.tiers` (access step 6, the Nav batch).
//
// Before this, every client surface read `accessLevel` off the session and ran
// the ladder itself (access-tiers.ts canAccessTier, deleted). Now the ladder
// runs here, beside the engine, and the client asks `clearsTier(tiers, t)`:
// the same answer by construction (tiersOfLevel is legacyTierAllows per tier),
// with no level on the client.
//
// THE ENGINE'S READING (engineTiers). When the engine decides the app routes
// (ACCESS_V2_RESOLVER on and the log-only week over: settingsGateMode is
// "engine"), boot ships engineTiers instead: "manager" is has reports (solid
// or dotted) or the People team, "hr-admin" is the People team, "org-admin"
// is an Owner or Admin, each cleared by Owners and Admins. That is
// resolve.ts clearsAppFloor word for word, so a floored app's rail row, its
// hub sidebar rows and its route (FlaggedAppKeyGate) give one answer, and the
// Apps page's "N people lose access" count (app-floor-impact.ts, rule
// "engine") counts the same people. Recorded in parity.ts
// EXPECTED_MISMATCHES; no call site changes, only the tiers boot ships.
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

/** The facts the engine reads for the three tiers (boot has all three). */
export interface EngineTierFacts {
  /** OWNER | ADMIN | MEMBER | GUEST */
  orgRole: string;
  peopleTeam: boolean;
  /** Reports, solid or dotted. */
  hasReports: boolean;
}

/**
 * The engine's reading of the tiers (resolve.ts clearsAppFloor): Owners and
 * Admins clear all three, the People team clears "manager" and "hr-admin",
 * anyone with a report clears "manager". A Guest clears none, whatever the
 * facts say: a Guest's apps are the shared ones (spec 5.2.1), never a tier.
 */
export function engineTiers(f: EngineTierFacts): ViewerTiers {
  if (f.orgRole === "GUEST") return NO_TIERS;
  const admin = f.orgRole === "OWNER" || f.orgRole === "ADMIN";
  return {
    manager: admin || f.peopleTeam || f.hasReports,
    "hr-admin": admin || f.peopleTeam,
    "org-admin": admin,
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
