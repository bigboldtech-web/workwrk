"use client";

// ThemeApplier — mounts once at the OsShell level and applies the user's
// effective preferences to the document. Sets:
//   - data-theme on <html> ("light" | "dark" — AUTO resolves to system)
//   - data-accent on <html> (the brand accent key — "mint", "purple", ...)
//   - data-density on <html> ("compact" | "cozy")
//
// CSS then keys off these attributes via variables (e.g. --os-brand maps
// per data-accent). This component renders nothing — it's pure side
// effects on the document root.

import { useEffect, useState } from "react";
import type { EffectivePreferences } from "@/lib/preferences";

function applySystemThemeListener(onChange: (dark: boolean) => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (e: MediaQueryListEvent) => onChange(e.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

export function ThemeApplier() {
  const [prefs, setPrefs] = useState<EffectivePreferences | null>(null);

  // Fetch once on mount; the CustomizePanel does its own optimistic
  // updates so we don't need to subscribe to its changes here — instead
  // we listen for a window event "workwrk:prefs-changed" to re-fetch
  // when the user saves.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/preferences", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { effective: EffectivePreferences };
        if (active) setPrefs(data.effective);
      } catch {
        // ignore; keep defaults
      }
    };
    void load();
    const handler = () => void load();
    window.addEventListener("workwrk:prefs-changed", handler);
    return () => {
      active = false;
      window.removeEventListener("workwrk:prefs-changed", handler);
    };
  }, []);

  // Resolve appearance: LIGHT / DARK explicit; AUTO follows system.
  useEffect(() => {
    if (!prefs) return;
    const root = document.documentElement;

    const apply = (isDark: boolean) => {
      root.setAttribute("data-theme", isDark ? "dark" : "light");
      root.classList.toggle("dark", isDark);
    };

    if (prefs.theme.appearance === "AUTO") {
      const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
      apply(!!mq?.matches);
      return applySystemThemeListener(apply);
    } else {
      apply(prefs.theme.appearance === "DARK");
    }
  }, [prefs]);

  // Accent + density are simple attribute writes.
  useEffect(() => {
    if (!prefs) return;
    const root = document.documentElement;
    root.setAttribute("data-accent", prefs.theme.accent || "mint");
    root.setAttribute("data-density", prefs.density || "cozy");
  }, [prefs]);

  return null;
}
