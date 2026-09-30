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
