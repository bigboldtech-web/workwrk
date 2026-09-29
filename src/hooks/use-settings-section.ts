"use client";

// useSettingsSection(section, select) (settings-architecture 8.6, spec
// section 3): the fetch-failure rule, implemented once.
//
//   const s = useSettingsSection("locale", (body) => body.settings);
//   if (s.status === "loading") return <Skeleton />;
//   if (s.status === "error") return <ErrorState what="Locale settings" onRetry={s.retry} />;
//   ... s.data ...; await s.save({ timezone });
//
// A Save-bar page NEVER renders an empty form after a failed GET: the hook
// answers `status: "error"` with `data: null`, the page renders ErrorState
// with a wired Retry in place of the form, and `save` refuses to write while
// nothing was loaded, so a Save can never overwrite live values with empty
// strings (Identity's live data-loss bug, identity/page.tsx:56,70).
//
// `save` is one PATCH per section ({ section, data }), never two sequential
// ones; a 400 carries the server's message, which names the offending key.

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";

export type SettingsSectionKey = "general" | "culture" | "scoring" | "security" | "access" | "process";

/** The GET /api/settings body, loosely typed (each page selects its own part). */
export interface SettingsGetBody {
  organization?: { id?: string; name?: string; slug?: string; domain?: string | null; logo?: string | null; plan?: string; status?: string };
  settings?: Record<string, unknown>;
  usage?: Record<string, unknown>;
}

export type SectionStatus = "loading" | "ready" | "error";

export interface SectionState<T> {
  status: SectionStatus;
  data: T | null;
  error: string | null;
}

/** The pure transition after a GET (tested): a failure never keeps stale-looking data. */
export function sectionAfterLoad<T>(result: { ok: true; data: T } | { ok: false; error: string }): SectionState<T> {
  if (result.ok) return { status: "ready", data: result.data, error: null };
  return { status: "error", data: null, error: result.error || "Couldn't load settings" };
}

/** Whether a save may run (tested): only over values that were actually loaded. */
export function canSaveSection(state: Pick<SectionState<unknown>, "status">): boolean {
  return state.status === "ready";
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export function useSettingsSection<T>(section: SettingsSectionKey, select: (body: SettingsGetBody) => T) {
  const [state, setState] = useState<SectionState<T>>({ status: "loading", data: null, error: null });
  const selectRef = useRef(select);
  const stateRef = useRef(state);
  useEffect(() => {
    selectRef.current = select;
    stateRef.current = state;
  });

  const load = useCallback(async () => {
    setState((s) => (s.status === "ready" ? s : { status: "loading", data: null, error: null }));
    const r = await apiFetch<SettingsGetBody>("/api/settings", { cache: "no-store" });
    setState(sectionAfterLoad(r.ok ? { ok: true, data: selectRef.current(r.data) } : { ok: false, error: r.error }));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const retry = useCallback(() => {
    setState({ status: "loading", data: null, error: null });
    void load();
  }, [load]);

  const save = useCallback(
    async (data: Record<string, unknown>): Promise<SaveResult> => {
      if (!canSaveSection(stateRef.current)) return { ok: false, error: "Nothing was loaded, so nothing was saved. Try again." };
      const r = await apiFetch("/api/settings", { method: "PATCH", json: { section, data } });
      if (!r.ok) return { ok: false, error: r.error };
      await load();
      return { ok: true };
    },
    [section, load],
  );

  return { ...state, retry, save, reload: load };
}
