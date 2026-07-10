// Space modules ("ClickApps") — the toggleable capabilities a Space enables.
// Stored in Space.settings.workflow.modules (a ModuleKey[]), set by the Space
// wizard + the Modules settings screen. This is the single read side that
// features gate on (mirrors how readWorkflow reads workflow.statuses).

import type { ModuleKey } from "@/components/layout/os/space-wizard-types";

/**
 * Read a Space's enabled modules from its `settings` JSON. Returns `null` when
 * the Space has no explicit modules list — i.e. a legacy Space, or one created
 * before modules gated anything. Callers treat `null` as "ungated" (all on).
 */
export function readSpaceModules(settings: unknown): ModuleKey[] | null {
  if (!settings || typeof settings !== "object") return null;
  const workflow = (settings as Record<string, unknown>).workflow;
  if (!workflow || typeof workflow !== "object") return null;
  const mods = (workflow as Record<string, unknown>).modules;
  if (!Array.isArray(mods)) return null;
  return mods.filter((m): m is ModuleKey => typeof m === "string");
}

/**
 * Whether a module is enabled for a Space, given its `settings` JSON.
 *
 * BACKWARD-COMPATIBLE by design: a Space with no modules list returns `true`
 * for every key, so gating never hides a feature an existing Space already
 * shows. Only a Space that explicitly set its modules array is gated — turning
 * a module off there hides that feature, on shows it.
 */
export function hasModule(settings: unknown, key: ModuleKey): boolean {
  const mods = readSpaceModules(settings);
  if (mods === null) return true; // legacy / ungated → feature on
  return mods.includes(key);
}
