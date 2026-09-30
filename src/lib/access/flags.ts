// The access migration flags (access-model-spec section 10, steps 1, 4, 7;
// Phase 8 stage E). ONE place, read at request time (never cached at module
// load), so a local test flips them in .env.local and the next request sees
// the change once the server has read its environment.
//
//   ACCESS_V2_RESOLVER   step 1. The legacy helpers delegate to can() for the
//                        questions the parity job has PROVEN equal (see
//                        PROVEN_DELEGATES below); every other question keeps
//                        today's resolver. Default OFF.
//   ACCESS_V2_TABLES     steps 4 and 7. The engine's loader answers node
//                        objects (Space, Folder, List, task, Doc, Table,
//                        Canvas, Form) from node-access, which already unions
//                        the Table, Canvas and Form AccessGrant rows with the
//                        member tables. The org role: the live Owner pick
//                        refines the level mirror, the stored User.orgRole is
//                        read only to narrow a Member to a Guest (org-role.ts
//                        effectiveOrgRole), and the stored Admin scopes count.
//                        NOT read in this release: the step-7 container
//                        copies and the G5 rows in AccessGrant (a snapshot;
//                        the member tables stay the store, see
//                        container-copy-plan.ts). Default OFF.
//   SETTINGS_GATE_LOG_ONLY  the settings door gate's first week: the engine's
//                        answer is computed and every disagreement is logged,
//                        while today's answer still decides. Default OFF.
//
// Every flag is off unless the value is exactly "true". Turning one off is
// the rollback, and takes effect on the next request.

export type AccessFlag = "ACCESS_V2_RESOLVER" | "ACCESS_V2_TABLES" | "SETTINGS_GATE_LOG_ONLY";

export const ACCESS_FLAGS: readonly AccessFlag[] = ["ACCESS_V2_RESOLVER", "ACCESS_V2_TABLES", "SETTINGS_GATE_LOG_ONLY"];

export function flagOn(name: AccessFlag, env: Record<string, string | undefined> = process.env): boolean {
  return env[name] === "true";
}

export function accessV2Resolver(env?: Record<string, string | undefined>): boolean {
  return flagOn("ACCESS_V2_RESOLVER", env);
}

export function accessV2Tables(env?: Record<string, string | undefined>): boolean {
  return flagOn("ACCESS_V2_TABLES", env);
}

export function settingsGateLogOnly(env?: Record<string, string | undefined>): boolean {
  return flagOn("SETTINGS_GATE_LOG_ONLY", env);
}

/**
 * The app route gates enforce (FlaggedAppKeyGate's "engine" mode:
 * ACCESS_V2_RESOLVER on and the log-only week over). Boot reads it too, so
 * the rail, the hub sidebars and the Apps page's impact count follow the same
 * rule the routes enforce (viewer-tiers.ts engineTiers).
 */
export function appGatesEnforce(env?: Record<string, string | undefined>): boolean {
  return accessV2Resolver(env) && !settingsGateLogOnly(env);
}

/**
 * The questions the parity job has proven, per flag state. A helper named
 * here delegates to can() when ACCESS_V2_RESOLVER is on; a helper absent
 * keeps today's resolver whatever the flag says.
 *
 *   engine-org     answered from the viewer's org role alone (isOrgAdmin,
 *                  the org-admin tier): identical by construction, proven in
 *                  every run (the viewer pairs).
 *   node           the node helpers (Space, Folder, List, task, Doc). Proven
 *                  ONLY with ACCESS_V2_TABLES on, where the engine's loader
 *                  reads node-access (parity-tables-on). With the tables flag
 *                  off the engine reads the old tables without the
 *                  AccessGrant rows, the docSharing store or the Private rule,
 *                  and node-access stays the answer (a delegation there would
 *                  regress the node-access rules).
 *   settings       the Workspace settings door, through the engine's page
 *                  table (the stage E expected mismatches are the named
 *                  settings rows in node-parity.ts).
 */
export type DelegateGroup = "engine-org" | "node" | "settings";

export function delegateOn(group: DelegateGroup, env?: Record<string, string | undefined>): boolean {
  if (!accessV2Resolver(env)) return false;
  if (group === "node") return accessV2Tables(env);
  if (group === "settings") return !settingsGateLogOnly(env);
  return true;
}

/** A one-line summary for logs and the parity report header. */
export function flagSummary(env?: Record<string, string | undefined>): string {
  return ACCESS_FLAGS.map((f) => `${f}=${flagOn(f, env) ? "on" : "off"}`).join(" ");
}
