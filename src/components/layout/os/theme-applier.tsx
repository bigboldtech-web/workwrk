"use client";

// ThemeApplier: mounts once at the OsShell level and applies the user's
// effective preferences to the document. Sets, on <html>:
//   - `.dark` + data-theme "light" | "dark": handed to next-themes via
//                 setTheme ("light" / "dark" / "system" for AUTO). next-themes
//                 writes both pre-hydration from its localStorage key, so a
//                 returning browser paints the right palette before this
//                 component has fetched anything (no light/dark flash), and
//                 it owns the matchMedia listener for AUTO. The token layer
//                 keys on the class and on data-theme (its
//                 prefers-color-scheme guard is `:root:not([data-theme="light"])`).
//   - data-chrome "navy": the frame variant (design-system 1.2.1). Always
//                 navy for now: the tokens for the light flip exist, but the
//                 rail and top bar still paint white foregrounds on
//                 --os-brand-rail, so honouring a stored "light" would blank
//                 them. Step 3 rewires the shell on --os-chrome-fg; step 8
//                 exposes the control and reads theme.chrome here.
//   - data-density "comfortable" | "cozy" | "compact": data-row height
//                 (tokens.css keys --os-row-h on it; comfortable is the default)
//
// The old data-accent attribute is gone: there is one brand blue and the
// per-accent CSS blocks were deleted with it. This component renders
// nothing; it is pure side effects on the document root.

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import type { EffectivePreferences } from "@/lib/preferences";

export function ThemeApplier() {
  const [prefs, setPrefs] = useState<EffectivePreferences | null>(null);
  const { setTheme } = useTheme();

  // Fetch once on mount; the CustomizePanel does its own optimistic
  // updates so we don't need to subscribe to its changes here; instead
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

  // Resolve appearance: LIGHT / DARK explicit; AUTO follows the system
  // through next-themes' own "system" theme.
  useEffect(() => {
    if (!prefs) return;
    const appearance = prefs.theme.appearance;
    setTheme(appearance === "AUTO" ? "system" : appearance === "DARK" ? "dark" : "light");
  }, [prefs, setTheme]);

  // Chrome + density are simple attribute writes.
  useEffect(() => {
    if (!prefs) return;
    const root = document.documentElement;
    root.setAttribute("data-chrome", "navy");
    root.removeAttribute("data-accent");
    root.setAttribute("data-density", prefs.density || "comfortable");
  }, [prefs]);

  return null;
}
