"use client";

// Runs the one-time localStorage move (src/lib/local-prefs-migration.ts) in
// the browser. Costs nothing on a browser that holds none of the old keys
// (one getItem per key, no request). Otherwise: read the person's own row,
// plan, PATCH, and remove each key only after the write that carried it
// answered ok. A failure leaves the keys for the next load.

import { apiFetch } from "./api-fetch";
import type { EffectivePreferences } from "./preferences";
import {
  LEGACY_KEYS,
  hasLegacyLocalPrefs,
  planLocalPrefsMigration,
  type LegacyPresence,
  type LocalSnapshot,
  type RawPreferenceRow,
} from "./local-prefs-migration";
import { encodePresence } from "./people/presence-codec";

let ran = false;

function removeKeys(keys: readonly string[]) {
  for (const k of keys) {
    try { window.localStorage.removeItem(k); } catch { /* storage unavailable */ }
  }
}

export async function runLocalPrefsMigration(opts: {
  serverPresence: string | null;
  onPrefs: (effective: EffectivePreferences) => void;
  onPresence: (p: LegacyPresence) => void;
}): Promise<void> {
  if (ran || typeof window === "undefined") return;
  ran = true;
  const get = (k: string) => {
    try { return window.localStorage.getItem(k); } catch { return null; }
  };
  if (!hasLegacyLocalPrefs(get)) return;

  const local: LocalSnapshot = {};
  for (const k of Object.values(LEGACY_KEYS)) local[k] = get(k);

  const raw = await apiFetch<{ preference?: RawPreferenceRow | null }>("/api/preferences?raw=1", { cache: "no-store" });
  if (!raw.ok) { ran = false; return; }
  const plan = planLocalPrefsMigration(local, raw.data?.preference ?? null, { serverPresence: opts.serverPresence });
  removeKeys(plan.removeNow);

  if (plan.patch) {
    const r = await apiFetch<{ effective?: EffectivePreferences }>("/api/preferences", { method: "PATCH", json: plan.patch });
    if (r.ok) {
      removeKeys(plan.removeAfterWrite);
      if (r.data?.effective) opts.onPrefs(r.data.effective);
    }
  } else {
    removeKeys(plan.removeAfterWrite);
  }

  if (plan.presence) {
    const status = encodePresence(plan.presence);
    const r = await apiFetch("/api/me/presence", {
      method: "PUT",
      json: { status, until: status ? plan.presence.expiresAt : null },
    });
    if (r.ok) {
      removeKeys([LEGACY_KEYS.presence]);
      opts.onPresence(plan.presence);
    }
  }
}
