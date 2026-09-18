"use client";

// The hierarchy breadcrumb (spec-shell 2.1, design-system 4.3): the one
// location row in the app. Pages declare their crumbs with
// `<Breadcrumb items={[{ label, href, tile? }]} />`, a client component that
// writes into shell context and clears on unmount; the bar prepends the hub
// label from `resolveHub` and, when a page declares nothing, falls back to
// `Hub > ROUTE_TITLES[prefix]` through `resolveCrumbFallback`.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { EntityTileProps } from "@/components/ui/entity-tile";

export interface BreadcrumbItem {
  label: string;
  /** Omit on the last crumb (the page itself, never clickable). */
  href?: string;
  /** `EntityTile size="xs"` on the Space crumb only. */
  tile?: EntityTileProps;
}

type BreadcrumbState = {
  items: BreadcrumbItem[] | null;
  pathname: string | null;
  setItems: (items: BreadcrumbItem[] | null, pathname: string) => void;
};

const Ctx = createContext<BreadcrumbState | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ items: BreadcrumbItem[] | null; pathname: string | null }>({ items: null, pathname: null });
  // A stable identity: the declaring effect below lists it as a dependency,
  // so a setter rebuilt on every state change would re-run that effect after
  // each commit and never settle (the "Maximum update depth" loop).
  const setItems = useCallback((items: BreadcrumbItem[] | null, pathname: string) => {
    setState((prev) => (prev.items === items && prev.pathname === pathname ? prev : { items, pathname }));
  }, []);
  const value = useMemo<BreadcrumbState>(
    () => ({ items: state.items, pathname: state.pathname, setItems }),
    [state, setItems],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The declared crumbs for the CURRENT path, or null (the bar then falls back). */
export function useDeclaredBreadcrumb(): BreadcrumbItem[] | null {
  const ctx = useContext(Ctx);
  const pathname = usePathname();
  if (!ctx || !ctx.items) return null;
  // A stale declaration from the previous page never survives a navigation:
  // the crumbs are trusted only for the path they were declared on.
  return ctx.pathname === pathname ? ctx.items : null;
}

/**
 * Declare this page's crumbs after the hub. Render it anywhere inside the
 * page; it paints nothing. Dynamic routes (`/boards/[slug]`, `/docs/[id]`)
 * must render it, because no static table knows the object's name.
 */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const setItems = useContext(Ctx)?.setItems;
  const pathname = usePathname() || "";
  const key = JSON.stringify(items);
  useEffect(() => {
    if (!setItems) return;
    setItems(items, pathname);
    return () => setItems(null, pathname);
    // `key` captures the items' content; `items` itself is a fresh array per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pathname, setItems]);
  return null;
}
