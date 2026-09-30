"use client";

// The one exception to "the URL alone picks the active settings row": a
// person below Admin on a Workspace URL is shown their own Profile under the
// Ask-an-admin strip (spec-settings-workspace 1.4), so the My settings list
// beside it highlights Profile. The strip's page mounts <ActiveSettingsRow>
// and SettingsShell reads it; unmounting clears it, so it never sticks.

import { useEffect, useSyncExternalStore } from "react";

let current: string | null = null;
const listeners = new Set<() => void>();

function set(v: string | null) {
  current = v;
  for (const l of listeners) l();
}

export function useActiveSettingsRowOverride(): string | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
    () => null,
  );
}

export function ActiveSettingsRow({ pageKey }: { pageKey: string }) {
  useEffect(() => {
    set(pageKey);
    return () => set(null);
  }, [pageKey]);
  return null;
}
