"use client";

// SidebarSearchContext — tiny shared state so the sidebar header
// (which lives in ClickSidebar) can broadcast a filter query down
// to whichever app-Sidebar is currently mounted (HomeSidebar etc.).
//
// Each app reads `useSidebarSearch().query` and filters its lists.
// Apps that don't read it are unaffected.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface Ctx {
  query: string;
  setQuery: (q: string) => void;
}

const SidebarSearchCtx = createContext<Ctx>({ query: "", setQuery: () => {} });

export function SidebarSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const value = useMemo(() => ({ query, setQuery }), [query]);
  return <SidebarSearchCtx.Provider value={value}>{children}</SidebarSearchCtx.Provider>;
}

export function useSidebarSearch(): Ctx {
  return useContext(SidebarSearchCtx);
}
