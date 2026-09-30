// The Workspace settings door on the engine (access-model-spec 10 step 3,
// Phase 8 stage E), with the decided first week log-only.
//
//   flags off (the shipped default)   today's table decides (settings-legacy.ts)
//   SETTINGS_GATE_LOG_ONLY=true        today's table decides; the engine's
//                                      answer is computed and every
//                                      disagreement is logged, sampled per
//                                      person per page per 10 minutes
//   ACCESS_V2_RESOLVER=true (log-only off)  the engine decides
//
// The Owner pages (Billing, Security, API) keep the Owner split's rule in
// every state: until SETTINGS_OWNER_SPLIT is on, every Admin counts as an
// Owner there, so turning the resolver on can never lock the only Admin of a
// workspace out of Billing (22 of 27 local orgs have no SUPER_ADMIN, and a
// COMPANY_ADMIN reads as Admin until the backfill marks the Owner).

import { DENIAL_SAMPLE_WINDOW_MS, denialSampleKey } from "./guards";

export type SettingsGateMode = "legacy" | "observe" | "engine";

export function settingsGateMode(flags: { resolver: boolean; logOnly: boolean }): SettingsGateMode {
  if (flags.logOnly) return "observe";
  return flags.resolver ? "engine" : "legacy";
}

export interface SettingsGateInputs {
  /** Today's table (settings-legacy.ts) with the Owner split applied. */
  legacy: boolean;
  /** can(viewer, "view", { type: "settings", page }).allowed */
  engine: boolean;
  /** The page is Billing, Security or API. */
  ownerPage: boolean;
  /** The viewer is an Owner or an Admin today (SUPER_ADMIN, COMPANY_ADMIN). */
  workspaceAdmin: boolean;
  /** sessionMayManageOwnerPage: every Admin while the split is off, else the Owner. */
  mayManageOwnerPage: boolean;
}

/**
 * The engine's answer with the Owner split's floor. An Admin the engine
 * refuses on an Owner page (no scope, not yet marked Owner) still opens it
 * while the split says every Admin may; the split on means the engine's
 * Owner-or-scope rule, or the legacy Owner pick (earliest admin), decides.
 */
export function engineWithOwnerFloor(i: SettingsGateInputs): boolean {
  if (i.engine) return true;
  return i.ownerPage && i.workspaceAdmin && i.mayManageOwnerPage;
}

export function settingsGateDecision(mode: SettingsGateMode, i: SettingsGateInputs): { allowed: boolean; disagree: boolean } {
  const engine = engineWithOwnerFloor(i);
  const disagree = engine !== i.legacy;
  if (mode === "engine") return { allowed: engine, disagree };
  return { allowed: i.legacy, disagree };
}

const lastLogged = new Map<string, number>();
const MAX_KEYS = 20000;

/** Log one disagreement, at most once per person per page per window. */
export function logSettingsGateDisagreement(entry: {
  userId: string;
  organizationId: string;
  page: string;
  legacy: boolean;
  engine: boolean;
  mode: SettingsGateMode;
  now?: number;
}): boolean {
  const now = entry.now ?? Date.now();
  const key = denialSampleKey(entry.userId, "settings", entry.page);
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < DENIAL_SAMPLE_WINDOW_MS) return false;
  if (lastLogged.size >= MAX_KEYS) lastLogged.clear();
  lastLogged.set(key, now);
  console.warn(
    JSON.stringify({
      event: "access.settings_gate.disagree",
      mode: entry.mode,
      organizationId: entry.organizationId,
      userId: entry.userId,
      page: entry.page,
      legacy: entry.legacy,
      engine: entry.engine,
      at: new Date(now).toISOString(),
    }),
  );
  return true;
}

/** Test seam. */
export function resetSettingsGateLog(): void {
  lastLogged.clear();
}
