"use client";

// ThemeApplier: applies the effective preferences (from boot, then every
// change through the shell) to the document root. Writes on <html>:
//   - `.dark` + data-theme "light" | "dark": handed to next-themes via
//     setTheme ("light" / "dark" / "system" for AUTO), which also owns the
//     matchMedia listener for AUTO and paints the right palette before
//     hydration from its own localStorage key.
//   - data-chrome "navy" | "light": the frame variant (design-system 1.2.1),
//     from theme.chrome. The rail, the bar and the splash read only the
//     chrome tokens, so the flip is one attribute.
//   - data-density "comfortable" | "cozy" | "compact": the data-row height.
//
// No fetch of its own: the preferences arrive with boot, so the first paint
// already carries the right density and chrome (no flash).

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useOsShell } from "./shell-context";

export function ThemeApplier() {
  const { prefs } = useOsShell();
  const { setTheme } = useTheme();

  useEffect(() => {
    const appearance = prefs.theme.appearance;
    setTheme(appearance === "AUTO" ? "system" : appearance === "DARK" ? "dark" : "light");
  }, [prefs.theme.appearance, setTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-chrome", prefs.theme.chrome === "light" ? "light" : "navy");
    root.removeAttribute("data-accent");
    root.setAttribute("data-density", prefs.density || "comfortable");
  }, [prefs.theme.chrome, prefs.density]);

  return null;
}
