"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lens = "me" | "we";

type ShellState = {
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;

  sidekickOpen: boolean;
  openSidekick: () => void;
  closeSidekick: () => void;
  toggleSidekick: () => void;

  lens: Lens;
  setLens: (l: Lens) => void;
};

const Ctx = createContext<ShellState | null>(null);

const LENS_KEY = "workwrk:os:lens";

export function OsShellProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidekickOpen, setSidekickOpen] = useState(false);
  const [lens, setLensState] = useState<Lens>("me");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LENS_KEY);
      if (stored === "me" || stored === "we") setLensState(stored);
    } catch {}
  }, []);

  const setLens = useCallback((l: Lens) => {
    setLensState(l);
    try { window.localStorage.setItem(LENS_KEY, l); } catch {}
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openSidekick = useCallback(() => setSidekickOpen(true), []);
  const closeSidekick = useCallback(() => setSidekickOpen(false), []);
  const toggleSidekick = useCallback(() => setSidekickOpen((v) => !v), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSidekickOpen((v) => !v);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<ShellState>(
    () => ({
      paletteOpen, openPalette, closePalette,
      sidekickOpen, openSidekick, closeSidekick, toggleSidekick,
      lens, setLens,
    }),
    [paletteOpen, openPalette, closePalette, sidekickOpen, openSidekick, closeSidekick, toggleSidekick, lens, setLens],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOsShell() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOsShell must be used within OsShellProvider");
  return ctx;
}
