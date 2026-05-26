"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lens = "me" | "we";

export type OpenItem = {
  moduleId: string;
  itemId: string;
  name: string;
  groupColor?: string;
  /**
   * Snapshot of the row's cell values at the moment the drawer opened.
   * The drawer renders inline fields from this so users see the *actual*
   * status / owner / due / tags / etc. for the row they clicked, instead
   * of placeholder copy. Shape matches the OsMainTable Row.cells map.
   */
  payload?: Record<string, unknown>;
};

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

  openItem: OpenItem | null;
  openItemDrawer: (it: OpenItem) => void;
  closeItemDrawer: () => void;

  /**
   * Tiny pub/sub for cross-component "row changed" notifications.
   * Bumped by the drawer (or Sidekick tool calls) whenever an item is
   * mutated; pages subscribe via `rowVersion(moduleId)` to know when to
   * re-fetch. Keeps shell state minimal — no global cache of row data.
   */
  bumpRowVersion: (moduleId: string) => void;
  rowVersion: (moduleId: string) => number;
};

const Ctx = createContext<ShellState | null>(null);

const LENS_KEY = "workwrk:os:lens";

export function OsShellProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidekickOpen, setSidekickOpen] = useState(false);
  const [lens, setLensState] = useState<Lens>("me");
  const [openItem, setOpenItem] = useState<OpenItem | null>(null);
  const [rowVersions, setRowVersions] = useState<Record<string, number>>({});

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
  const openItemDrawer = useCallback((it: OpenItem) => setOpenItem(it), []);
  const closeItemDrawer = useCallback(() => setOpenItem(null), []);
  const bumpRowVersion = useCallback((moduleId: string) => {
    setRowVersions((v) => ({ ...v, [moduleId]: (v[moduleId] ?? 0) + 1 }));
  }, []);
  const rowVersion = useCallback((moduleId: string) => rowVersions[moduleId] ?? 0, [rowVersions]);

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
        setOpenItem(null);
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
      openItem, openItemDrawer, closeItemDrawer,
      bumpRowVersion, rowVersion,
    }),
    [paletteOpen, openPalette, closePalette, sidekickOpen, openSidekick, closeSidekick, toggleSidekick, lens, setLens, openItem, openItemDrawer, closeItemDrawer, bumpRowVersion, rowVersion],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOsShell() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOsShell must be used within OsShellProvider");
  return ctx;
}
