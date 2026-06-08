"use client";

// SpaceOverviewGrid — client wrapper that turns the Space Overview tab
// into a react-grid-layout. Cards are passed in as React nodes (rendered
// server-side); the grid handles drag, resize, hide/show, and persistence.
// Layout persists to UserPreference.home.overviewCardLayout.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X, Plus } from "lucide-react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

type LayoutShape = Record<string, Layout[]>;

const DEFAULT_LAYOUTS: LayoutShape = {
  lg: [
    { i: "recent",    x: 0, y: 0,  w: 4, h: 5 },
    { i: "docs",      x: 4, y: 0,  w: 4, h: 5 },
    { i: "bookmarks", x: 8, y: 0,  w: 4, h: 5 },
    { i: "folders",   x: 0, y: 5,  w: 12, h: 3 },
    { i: "lists",     x: 0, y: 8,  w: 12, h: 4 },
    { i: "resources", x: 0, y: 12, w: 6, h: 4 },
    { i: "workload",  x: 6, y: 12, w: 6, h: 4 },
  ],
  md: [
    { i: "recent",    x: 0, y: 0,  w: 4, h: 5 },
    { i: "docs",      x: 4, y: 0,  w: 4, h: 5 },
    { i: "bookmarks", x: 8, y: 0,  w: 4, h: 5 },
    { i: "folders",   x: 0, y: 5,  w: 12, h: 3 },
    { i: "lists",     x: 0, y: 8,  w: 12, h: 4 },
    { i: "resources", x: 0, y: 12, w: 6, h: 4 },
    { i: "workload",  x: 6, y: 12, w: 6, h: 4 },
  ],
  sm: [
    { i: "recent",    x: 0, y: 0,  w: 12, h: 4 },
    { i: "docs",      x: 0, y: 4,  w: 12, h: 4 },
    { i: "bookmarks", x: 0, y: 8,  w: 12, h: 4 },
    { i: "folders",   x: 0, y: 12, w: 12, h: 3 },
    { i: "lists",     x: 0, y: 15, w: 12, h: 4 },
    { i: "resources", x: 0, y: 19, w: 12, h: 4 },
    { i: "workload",  x: 0, y: 23, w: 12, h: 4 },
  ],
};

export const OVERVIEW_CARD_CATALOG: Array<{ key: string; label: string; description: string }> = [
  { key: "recent",    label: "Recent",    description: "Items you opened recently in this Space" },
  { key: "docs",      label: "Docs",      description: "Docs anchored to this Space" },
  { key: "bookmarks", label: "Bookmarks", description: "Pinned URLs for fast access" },
  { key: "folders",   label: "Folders",   description: "Folders inside this Space" },
  { key: "lists",     label: "Lists",     description: "Lists across folders and root" },
  { key: "resources", label: "Resources", description: "Files dropped on this Space" },
  { key: "workload",  label: "Workload",  description: "Pie of items by status" },
];

interface Props {
  initialLayouts?: LayoutShape | null;
  initialHidden?: string[] | null;
  cards: Record<string, ReactNode>;
}

export function SpaceOverviewGrid({
  initialLayouts,
  initialHidden,
  cards,
}: Props) {
  const [layouts, setLayouts] = useState<LayoutShape>(
    initialLayouts && Object.keys(initialLayouts).length > 0
      ? { ...DEFAULT_LAYOUTS, ...initialLayouts }
      : DEFAULT_LAYOUTS,
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set(initialHidden ?? []));
  const [hydrated, setHydrated] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setHydrated(true); }, []);

  // Listen for the OverviewToolbar's + Card button.
  useEffect(() => {
    const open = () => setManageOpen(true);
    window.addEventListener("workwrk:overview-add-card", open);
    return () => window.removeEventListener("workwrk:overview-add-card", open);
  }, []);

  const saveLayouts = useCallback((next: LayoutShape) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ home: { overviewCardLayout: next } }),
      });
    }, 600);
  }, []);

  const onLayoutChange = useCallback((_current: Layout[], all: LayoutShape) => {
    if (!hydrated) return;
    setLayouts(all);
    saveLayouts(all);
  }, [hydrated, saveLayouts]);

  const toggleCard = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      void fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ home: { overviewCardsHidden: Array.from(next) } }),
      });
      return next;
    });
  }, []);

  const visibleLayouts: LayoutShape = {};
  for (const [bp, items] of Object.entries(layouts)) {
    visibleLayouts[bp] = items.filter((it) => !hidden.has(it.i));
  }

  return (
    <>
      <ResponsiveGridLayout
        className="layout"
        layouts={visibleLayouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 12, xs: 6, xxs: 4 }}
        rowHeight={56}
        margin={[16, 16]}
        draggableHandle=".dash-card-handle"
        isDraggable
        isResizable
        onLayoutChange={onLayoutChange}
      >
        {OVERVIEW_CARD_CATALOG
          .filter((c) => !hidden.has(c.key))
          .map((c) => (
            <div key={c.key}>{cards[c.key]}</div>
          ))}
      </ResponsiveGridLayout>

      <ManageCardsModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        hidden={hidden}
        onToggle={toggleCard}
      />
    </>
  );
}

function ManageCardsModal({
  open,
  onClose,
  hidden,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div className="relative z-10 bg-white rounded-xl shadow-lg w-[480px] max-w-[90vw] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100">
          <h2 className="text-sm font-semibold text-zinc-900">Add cards</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-zinc-100 text-zinc-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="px-5 pt-3 text-[12px] text-zinc-500">
          Toggle which cards appear on the Overview. Hidden cards keep their saved layout.
        </p>
        <ul className="flex-1 overflow-y-auto p-3 space-y-1">
          {OVERVIEW_CARD_CATALOG.map((c) => {
            const isHidden = hidden.has(c.key);
            return (
              <li key={c.key}>
                <label className="flex items-start gap-3 px-3 py-2 rounded-md hover:bg-zinc-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={() => onToggle(c.key)}
                    className="mt-1 w-4 h-4 accent-zinc-900 cursor-pointer"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium text-zinc-900">{c.label}</span>
                    <span className="block text-[12px] text-zinc-500">{c.description}</span>
                  </span>
                  {isHidden ? (
                    <Plus className="w-3.5 h-3.5 text-zinc-400 mt-1" />
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-[12.5px] px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
