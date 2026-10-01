// Today's Workspace settings door rule, per page (Phase 8 stage A's table,
// moved here in stage E so the parity job and the log-only gate can read it
// without loading a React module). Pure.
//
//   admin         route-guard isOrgAdminViewer: SUPER_ADMIN, COMPANY_ADMIN.
//   manager-tier  route-guard requireManagerTierViewer: everyone above
//                 Employee and Agent (HR included), read-only below Admin.
//
// The engine's rule (SETTINGS_PAGE_GATES in settings.ts, decideSettings in
// resolve.ts) replaces this table when ACCESS_V2_RESOLVER is on and
// SETTINGS_GATE_LOG_ONLY is off; the differences are the named settings rows
// in node-parity.ts SETTINGS_EXPECTED_MISMATCHES.

import { legacyIsAdminLevel, legacyIsManagerLevel } from "./legacy-levels";
import type { SettingsPageKey } from "./types";

export type LegacySettingsRule = "admin" | "manager-tier";

export const LEGACY_SETTINGS_RULES: Readonly<Partial<Record<SettingsPageKey, LegacySettingsRule>>> = {
  overview: "admin",
  identity: "admin",
  locale: "admin",
  apps: "admin",
  // Structure gated inside its page before; the same admin rule.
  structure: "admin",
  // Members, Access and Scoring admitted the manager tier (read-only below
  // Admin; the invitations API admits the tier).
  members: "manager-tier",
  access: "manager-tier",
  scoring: "manager-tier",
  tasks: "admin",
  security: "admin",
  data: "admin",
  audit: "admin",
  api: "admin",
  billing: "admin",
  all: "admin",
};

/** The Owner-or-scope pages (settings spec 1.2 rows 10, 13, 14). */
export const OWNER_SETTINGS_PAGES: ReadonlySet<SettingsPageKey> = new Set<SettingsPageKey>(["security", "api", "billing"]);

/** Today's answer from the level alone (the Owner split is applied by the caller). */
export function legacySettingsAllows(page: SettingsPageKey, accessLevel: string | null | undefined): boolean {
  const rule = LEGACY_SETTINGS_RULES[page];
  if (!rule) return true;
  return rule === "admin" ? legacyIsAdminLevel(accessLevel) : legacyIsManagerLevel(accessLevel);
}

/**
 * Who saves the Scoring section of PATCH /api/settings (and sees its controls
 * live). Owners and Admins always. C-level kept the write the manager-tier
 * Scoring page gave it while today's door table decides; once the engine's
 * door decides (ACCESS_V2_RESOLVER on, log-only off) the page itself closes
 * to C-level unless they are on the People team, so the write goes with it
 * (access-model-spec 10.1: C-level loses the accidental settings PATCH; the
 * backfill pre-flight names every C-level person this touches).
 */
export function scoringWriteAllowed(accessLevel: string | null | undefined, opts: { admin: boolean; engineDoor: boolean }): boolean {
  if (opts.admin) return true;
  if (opts.engineDoor) return false;
  return accessLevel === "C_LEVEL";
}

/** scoringWriteAllowed over a session (GET /api/settings's canEditScoring flag). */
export function sessionScoringWriteAllowed(session: unknown, opts: { admin: boolean; engineDoor: boolean }): boolean {
  return scoringWriteAllowed((session as { user?: { accessLevel?: string } } | null)?.user?.accessLevel, opts);
}
