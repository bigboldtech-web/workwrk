"use client";

// useSurfaceState(key): one list surface's per-viewer view state (columns,
// sort, view options) read from UserPreference.home.work.surface[key] and
// written back debounced 400ms through the shell's patchPrefs (settings-
// architecture 9.2, spec-ai-automation 1.7). The shape lives in
// src/lib/surface-prefs.ts. The value shows at once; the write follows.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOsShell } from "@/components/layout/os/shell-context";
import type { PreferencesPatch } from "@/lib/preferences-schema";
import { readSurface, surfacePatch, type SurfaceState } from "@/lib/surface-prefs";

export function useSurfaceState(key: string): [SurfaceState, (patch: SurfaceState) => void] {
  const { prefs, patchPrefs } = useOsShell();
  const stored = useMemo(() => readSurface(prefs, key), [prefs, key]);
  const [local, setLocal] = useState<SurfaceState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<SurfaceState | null>(null);

  useEffect(() => () => {
    // Leaving the page flushes a write that is still waiting.
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) void patchPrefs(surfacePatch(key, pending.current) as unknown as PreferencesPatch);
  }, [key, patchPrefs]);

  const value = local ?? stored;
  const update = useCallback((patch: SurfaceState) => {
    setLocal((prev) => {
      const base = prev ?? stored;
      const next: SurfaceState = {
        ...base,
        ...patch,
        viewOptions: patch.viewOptions ? { ...(base.viewOptions ?? {}), ...patch.viewOptions } : base.viewOptions,
      };
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const body = pending.current;
        pending.current = null;
        timer.current = null;
        if (body) void patchPrefs(surfacePatch(key, body) as unknown as PreferencesPatch);
      }, 400);
      return next;
    });
  }, [key, patchPrefs, stored]);

  return [value, update];
}
