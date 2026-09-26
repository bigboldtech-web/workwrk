"use client";

// The /dashboards/[id] canvas grid: react-grid-layout's single-breakpoint
// GridLayout (12 columns, 56px rows, 16px gutters), its width measured with
// a ResizeObserver. Never the Responsive grid: one set of positions is the
// dashboard's, and a breakpoint of its own would be a second layout nobody
// placed.
//
// SAVING A MOVE. A layout is saved only from onDragStop and onResizeStop,
// only for an editor, and only when a card actually moved (diffLayouts).
// onLayoutChange is never wired to a save: it fires on mount, on
// compaction and on every width change, and a save from it would write
// layouts nobody changed.
//
// Below 768px the cards are a stacked list in reading order (stackOrder),
// each as tall as its grid height or 160px, and nothing is saved: a phone is
// for reading a dashboard, not rearranging it.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { diffLayouts, layoutsFromGrid, stackOrder, widgetGridItems } from "@/lib/dashboards/dashboard-editor";
import type { EditorWidget, WidgetLayout } from "@/lib/dashboards/widgets";

const ROW_HEIGHT = 56;
const GAP = 16;
const WIDE = 768;

// The library's drop placeholder is a red wash and its resize corner is
// always drawn; on the canvas the placeholder is the selection tint on the
// card radius and the corner shows only on the card under the pointer.
const GRID_CSS = `
.dash-grid .react-grid-item.react-grid-placeholder {
  background: var(--os-selected); opacity: 1; border-radius: var(--os-r-lg);
  outline: 1px solid var(--os-focus-halo); outline-offset: -1px;
}
.dash-grid .react-grid-item > .react-resizable-handle { opacity: 0; transition: opacity 0.15s ease; }
.dash-grid .react-grid-item:hover > .react-resizable-handle { opacity: 0.45; }
`;

export function DashboardGrid({
  widgets,
  canEdit,
  renderCard,
  onLayouts,
  scrollToId,
}: {
  widgets: EditorWidget[];
  canEdit: boolean;
  renderCard: (w: EditorWidget, o: { movable: boolean }) => ReactNode;
  onLayouts: (layouts: Record<string, WidgetLayout>) => void;
  /** A card just added: scrolled into view once it renders. */
  scrollToId?: string | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!scrollToId) return;
    const t = setTimeout(() => {
      const el = hostRef.current?.querySelector(`[data-widget-id="${CSS.escape(scrollToId)}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
    return () => clearTimeout(t);
  }, [scrollToId, widgets.length]);

  const wide = width >= WIDE;
  // compact: every person gets the same compacted arrangement, whether or
  // not they may edit it (see widgetGridItems).
  const items = useMemo(() => widgetGridItems(widgets, { canEdit: canEdit && wide, cols: 12, compact: true }), [widgets, canEdit, wide]);
  const staticById = useMemo(() => new Map(items.map((i) => [i.i, i.static] as const)), [items]);

  // A card moved when the grid differs from what was ON SCREEN (the
  // compacted items), not from the stored rows: a drag that ends where it
  // began saves nothing even when the stored rows still hold a deleted
  // card's gap. A real move saves every card where it now shows, so the
  // stored rows lose the gap too.
  const save = (layout: Layout[]) => {
    if (!canEdit || !wide) return;
    const next = layoutsFromGrid(layout);
    if (diffLayouts(layoutsFromGrid(items), next).length === 0) return;
    onLayouts(next);
  };

  return (
    <div ref={hostRef} className="w-full">
      <style href="dash-grid-chrome" precedence="default">{GRID_CSS}</style>
      {width === 0 ? null : wide ? (
        <GridLayout
          className="dash-grid"
          layout={items}
          cols={12}
          rowHeight={ROW_HEIGHT}
          margin={[GAP, GAP]}
          containerPadding={[0, 0]}
          width={width}
          compactType="vertical"
          isDraggable={canEdit}
          isResizable={canEdit}
          resizeHandles={["se"]}
          draggableHandle=".widget-drag-handle"
          draggableCancel=".widget-no-drag"
          onDragStop={(layout) => save(layout)}
          onResizeStop={(layout) => save(layout)}
        >
          {widgets.map((w) => (
            <div key={w.id} className="dash-grid__item">
              {renderCard(w, { movable: canEdit && staticById.get(w.id) === false })}
            </div>
          ))}
        </GridLayout>
      ) : (
        <div className="flex flex-col gap-3">
          {stackOrder(widgets).map((w) => (
            <div key={w.id} style={{ height: Math.max((w.layout?.h ?? 4) * ROW_HEIGHT, 160) }}>
              {renderCard(w, { movable: false })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
