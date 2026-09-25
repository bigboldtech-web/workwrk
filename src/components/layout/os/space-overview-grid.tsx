"use client";

// SpaceOverviewGrid — client wrapper that turns the Space Overview tab
// into a react-grid-layout. Cards are passed in as React nodes (rendered
// server-side); the grid handles drag, resize, hide/show, and persistence.
// Layout persists to UserPreference.home.overviewCardLayout.
//
// With `overview` (Phase 5b, decision 1) the Space's shared WIDGETS join the
// SAME grid, behind the same "+ Card" (ClickUp's Space Overview: one grid,
// one Add cards panel). The two kinds of card persist differently, and the
// Add cards panel says so rather than hiding it:
//
//   built-in cards  arranged per person, as before: onLayoutChange saves
//                   UserPreference home.overviewCardLayout, with every widget
//                   item taken out first (withoutWidgetItems), so no widget id
//                   ever enters a person's preference
//   widgets         placed for everyone: the Space Overview row (a Dashboard
//                   whose id is spaceOverviewId), saved through the dashboard
//                   save queue, only from onDragStop and onResizeStop, only by
//                   a Space manager, only on the 12-column breakpoints; on xs
//                   and xxs they are a derived, static stack that is never
//                   saved
//
// Without `overview`, or with no widgets, the grid, its saves and the panel
// are exactly what they were (a manager's panel adds the Widgets section, so
// the first widget can be added).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X, Plus } from "lucide-react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ConflictStrip } from "@/components/ui/conflict-strip";
import { DraftRestoreStrip } from "@/components/ui/draft-restore-strip";
import { WidgetCard } from "@/components/dashboards/widget-card";
import { WidgetEditor } from "@/components/dashboards/widget-editor";
import { AddWidgetRow } from "@/components/dashboards/add-widget-menu";
import { useSpaceOverview } from "@/components/dashboards/use-space-overview";
import type { PreviewSeed } from "@/components/dashboards/use-dashboard";
import {
  diffLayouts,
  layoutsFromGrid,
  layoutsOf,
  placeNewWidget,
  toWidgetInputs,
  widgetGridItems,
  withoutWidgetItems,
} from "@/lib/dashboards/dashboard-editor";
import { kindMeta, kindsFor, newWidgetId, newWidgetInput, type WidgetKind } from "@/lib/dashboards/widget-kinds";
import type { EditorWidget, WidgetInput } from "@/lib/dashboards/widgets";

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
  { key: "resources", label: "Resources", description: "Files on this Space. Drag and drop to add, also in Library → Files" },
  { key: "workload",  label: "Workload",  description: "Pie of items by status" },
];

interface Props {
  initialLayouts?: LayoutShape | null;
  initialHidden?: string[] | null;
  cards: Record<string, ReactNode>;
  /** The Space's shared widgets join the grid (Phase 5b). Absent: exactly the built-in cards. */
  overview?: { spaceId: string; spaceName: string; canManage: boolean };
}

/**
 * Columns and widths per breakpoint, as the grid below declares them. The
 * grid keeps its own inline literals on purpose: react-grid-layout compares
 * them by reference on every width change, and the grid without widgets must
 * behave exactly as it always has.
 */
const COLS: Record<string, number> = { lg: 12, md: 12, sm: 12, xs: 6, xxs: 4 };
const BREAKPOINTS: Record<string, number> = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const WIDGET_PREFIX = "w:";

// react-grid-layout's own helper for a breakpoint nobody arranged: the next
// wider layout, fitted to the columns and compacted (Responsive.utils; the
// @types package does not declare it). Absent, a narrow breakpoint simply
// gets no explicit layout and the grid derives it itself, as it always did.
type DeriveLayout = (
  layouts: LayoutShape,
  breakpoints: Record<string, number>,
  breakpoint: string,
  lastBreakpoint: string,
  cols: number,
  compactType: "vertical" | "horizontal" | null,
) => Layout[];
const deriveResponsiveLayout: DeriveLayout | undefined = (Responsive as unknown as { utils?: { findOrGenerateResponsiveLayout?: DeriveLayout } }).utils
  ?.findOrGenerateResponsiveLayout;

/**
 * The narrow breakpoints the grid derives for this person when widgets are
 * on it: xs and xxs (fewer than 12 columns) that the person never arranged.
 * Their own cards there are a derivation, not a choice, so they are never
 * written to the preference unless the person is on that breakpoint now.
 */
function derivedBreakpoints(layouts: LayoutShape): ReadonlySet<string> {
  const out = new Set<string>();
  if (!deriveResponsiveLayout) return out;
  for (const [bp, cols] of Object.entries(COLS)) if (cols < 12 && !layouts[bp]) out.add(bp);
  return out;
}

/** The same place for every one of this person's own cards, ignoring grid bookkeeping. */
function sameCardLayouts(a: LayoutShape, b: LayoutShape): boolean {
  const norm = (s: LayoutShape) =>
    JSON.stringify(
      Object.keys(s)
        .sort()
        .map((bp) => [bp, (s[bp] ?? []).map((it) => [it.i, it.x, it.y, it.w, it.h]).sort((p, q) => String(p[0]).localeCompare(String(q[0])))]),
    );
  return norm(a) === norm(b);
}

type WidgetEditorState = { mode: "add" | "edit"; widgetId: string; input: WidgetInput; partial: boolean } | null;

export function SpaceOverviewGrid({
  initialLayouts,
  initialHidden,
  cards,
  overview,
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

  // ── the Space's widgets (only with `overview`) ──
  const ov = useSpaceOverview(overview);
  const widgets: EditorWidget[] = useMemo(() => (overview && ov.exists ? ov.widgets : []), [overview, ov.exists, ov.widgets]);
  const hasWidgets = widgets.length > 0;
  const manager = !!overview && ov.canManage;
  // The grid's column count now. State, so a card's grip and cursor follow a
  // breakpoint change; the ref is what the drag callbacks read.
  const [gridCols, setGridCols] = useState(12);
  const colsRef = useRef(12);
  const [widgetEditor, setWidgetEditor] = useState<WidgetEditorState>(null);
  const { toast } = useOsToast();
  const confirm = useConfirm();

  const onLayoutChange = useCallback((current: Layout[], all: LayoutShape) => {
    // onBreakpointChange fires only on a CHANGE, so a page opened on a phone
    // would believe it had 12 columns until the window was resized; the
    // layout pass says which breakpoint is live (its layout is `current`).
    if (overview) {
      const liveBp = Object.keys(all).find((bp) => all[bp] === current);
      const liveCols = liveBp ? COLS[liveBp] : undefined;
      if (liveCols && liveCols !== colsRef.current) {
        colsRef.current = liveCols;
        setGridCols(liveCols);
      }
    }
    if (!hydrated) return;
    // No widget on the grid: exactly the grid's save as it always was.
    if (!hasWidgets) {
      setLayouts(all);
      saveLayouts(all);
      return;
    }
    // The built-in cards are this person's; a widget item is the Space's and
    // is saved (or not) by the drag and resize stops below, never here. A
    // breakpoint derived for the widgets is left out unless the person is on
    // it now, exactly as the grid would have saved it before widgets. Both
    // are read from this render's `layouts` (the grid calls the handler it
    // was rendered with), never from a ref a later effect would update.
    const currentBp = Object.keys(all).find((bp) => all[bp] === current);
    const derived = derivedBreakpoints(layouts);
    const own: LayoutShape = {};
    for (const [bp, items] of Object.entries(withoutWidgetItems(all, WIDGET_PREFIX))) {
      if (derived.has(bp) && bp !== currentBp) continue;
      own[bp] = items;
    }
    // Widgets loading, or a manager moving one, re-lays the grid; when none
    // of this person's own cards moved there is nothing of theirs to write.
    if (sameCardLayouts(own, layouts)) return;
    setLayouts(own);
    saveLayouts(own);
  }, [hydrated, saveLayouts, hasWidgets, overview, layouts]);

  const onWidgetStop = useCallback((layout: Layout[], _old: Layout, item: Layout) => {
    if (!manager || !item || !String(item.i).startsWith(WIDGET_PREFIX) || colsRef.current < 12) return;
    const mine = layout
      .filter((l) => String(l.i).startsWith(WIDGET_PREFIX))
      .map((l) => ({ i: String(l.i).slice(WIDGET_PREFIX.length), x: l.x, y: l.y, w: l.w, h: l.h }));
    const next = layoutsFromGrid(mine);
    if (diffLayouts(layoutsOf(widgets), next).length === 0) return;
    ov.actions.moveLayouts(next);
  }, [manager, widgets, ov.actions]);

  const openWidgetAdd = (kind: WidgetKind) => {
    if (!overview) return;
    const meta = kindMeta(kind);
    const builtIn = (layouts.lg ?? []).filter((it) => !hidden.has(it.i)).map((it) => ({ x: it.x, y: it.y, w: it.w, h: it.h }));
    const layout = placeNewWidget([...Object.values(layoutsOf(widgets)), ...builtIn], meta?.defaultSize ?? { w: 4, h: 4 });
    const widgetId = newWidgetId();
    setManageOpen(false);
    setWidgetEditor({ mode: "add", widgetId, input: newWidgetInput(kind, { id: widgetId, spaceId: overview.spaceId, layout }), partial: false });
  };

  const openWidgetSettings = (w: EditorWidget) => {
    if (w.kind === "hidden" || w.kind === "passthrough") return;
    const [input] = toWidgetInputs([w]);
    setWidgetEditor({ mode: "edit", widgetId: w.id, input, partial: "partial" in w && w.partial === true });
  };

  const saveWidget = async (input: WidgetInput, preview: PreviewSeed | null) => {
    if (!widgetEditor) return { ok: false as const, message: "Nothing to save." };
    const builtIn = (layouts.lg ?? []).map((it) => ({ x: it.x, y: it.y, w: it.w, h: it.h }));
    return ov.saveCard(widgetEditor.mode, input, preview, builtIn);
  };

  const deleteWidget = async (w: EditorWidget) => {
    const ok = await confirm({
      title: "Delete this widget?",
      description: "Everyone in this Space loses it from the Overview.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const removed = ov.actions.removeWidget(w.id);
    if (!removed) return;
    toast("Widget deleted", { onUndo: () => ov.actions.undoRemove(removed.card, removed.index) });
  };

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
  if (hasWidgets) {
    // Every breakpoint gets its widget items explicitly. On 12 columns they
    // sit where the Overview row places them. On xs and xxs they are a
    // static stack under the person's own cards, never saved; a breakpoint
    // the person never arranged is first derived for their own cards exactly
    // as the grid itself would derive it (from the next wider one), so their
    // cards land where they always did.
    const own: LayoutShape = { ...visibleLayouts };
    for (const [bp, cols] of Object.entries(COLS)) {
      let mine = own[bp];
      if (!mine) {
        // derivedBreakpoints names exactly these, for onLayoutChange.
        if (cols >= 12 || !deriveResponsiveLayout) continue;
        mine = deriveResponsiveLayout(own, BREAKPOINTS, bp, bp, cols, "vertical");
      }
      // Not static for someone who cannot move them (widgetGridItems locks
      // them per item instead), so the grid compacts them for a member
      // exactly as it does for the manager who placed them.
      let items = widgetGridItems(widgets, { canEdit: manager && cols >= 12, cols, prefix: WIDGET_PREFIX });
      // The derived stack on a narrow breakpoint starts under the built-in
      // cards, so a shared widget never lands on top of someone's own card.
      if (cols < 12) {
        const bottom = mine.reduce((m, it) => Math.max(m, it.y + it.h), 0);
        items = items.map((it) => ({ ...it, y: it.y + bottom }));
      }
      visibleLayouts[bp] = [...mine, ...items];
    }
  }

  const s = ov.save;
  const problem = overview && ov.exists && (s.status === "stopped" || s.status === "error") && s.message ? s.message : null;
  // Sending again cannot help once the Space's managers no longer include
  // this person, or the widgets are gone; the sentence says so instead.
  const problemRetryable = s.status === "error" || (s.stopReason !== "forbidden" && s.stopReason !== "gone");

  return (
    <>
      {overview && ov.exists && s.status === "conflict" ? (
        <ConflictStrip noun="Overview" className="mb-2 rounded-md border" onReload={() => void ov.actions.reloadLive()} onDismiss={() => void ov.actions.keepMine()} />
      ) : null}
      {/* A manager's own unsaved widget changes, offered back to a manager
          only: Restore would only fail for anyone else. */}
      {overview && ov.exists && manager ? <DraftRestoreStrip draft={ov.draft} onRestore={ov.actions.restoreDraft} className="mb-2 rounded-md border" /> : null}
      {overview && ov.failed ? (
        <div role="alert" className="os-chrome mb-2 flex min-h-11 items-center gap-3 rounded-md border border-line bg-subtle px-4 text-base text-ink">
          <span className="min-w-0 flex-1">Couldn&apos;t load this Space&apos;s widgets.</span>
          <button type="button" onClick={() => void ov.actions.reload()} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">
            Try again
          </button>
        </div>
      ) : null}
      {problem ? (
        <div role="alert" className="os-chrome mb-2 flex min-h-11 items-center gap-3 rounded-md border border-line bg-danger-bg px-4 text-base text-ink">
          <span className="min-w-0 flex-1">{problem}</span>
          {problemRetryable ? (
            <button type="button" onClick={ov.actions.retry} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <ResponsiveGridLayout
        className="layout os-overview-grid"
        layouts={visibleLayouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 12, xs: 6, xxs: 4 }}
        rowHeight={56}
        margin={[16, 16]}
        draggableHandle=".dash-card-handle"
        isDraggable
        isResizable
        onLayoutChange={onLayoutChange}
        {...(overview
          ? {
              draggableCancel: ".widget-no-drag",
              onBreakpointChange: (_bp: string, cols: number) => {
                colsRef.current = cols;
                setGridCols(cols);
              },
              onDragStop: onWidgetStop,
              onResizeStop: onWidgetStop,
            }
          : {})}
      >
        {OVERVIEW_CARD_CATALOG
          .filter((c) => !hidden.has(c.key))
          .map((c) => (
            <div key={c.key}>{cards[c.key]}</div>
          ))}
        {widgets.map((w) => {
          const locked = w.kind === "hidden" || w.kind === "passthrough";
          return (
            <div key={`${WIDGET_PREFIX}${w.id}`}>
              <WidgetCard
                widget={w}
                data={ov.data[w.id]}
                chrome="overview"
                canEdit={manager}
                movable={manager && !locked && gridCols >= 12}
                saved={ov.queue.isCardSaved(w.id)}
                onSettings={manager ? () => openWidgetSettings(w) : undefined}
                onRename={manager ? (t) => ov.actions.renameWidget(w.id, t) : undefined}
                onDelete={manager ? () => void deleteWidget(w) : undefined}
                onRetryData={() => ov.actions.refetchCard(w.id)}
                onTextChange={manager ? (t) => ov.actions.setNotesText(w.id, t) : undefined}
              />
            </div>
          );
        })}
      </ResponsiveGridLayout>

      <ManageCardsModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        hidden={hidden}
        onToggle={toggleCard}
        widgets={manager ? { onAdd: openWidgetAdd } : undefined}
      />

      {overview && widgetEditor ? (
        <WidgetEditor
          key={`${widgetEditor.mode}:${widgetEditor.widgetId}`}
          open
          onOpenChange={(o) => {
            if (!o) setWidgetEditor(null);
          }}
          surface="space-overview"
          spaceId={overview.spaceId}
          mode={widgetEditor.mode}
          initial={widgetEditor.input}
          partial={widgetEditor.partial}
          onSave={saveWidget}
        />
      ) : null}
    </>
  );
}

function ManageCardsModal({
  open,
  onClose,
  hidden,
  onToggle,
  widgets,
}: {
  open: boolean;
  onClose: () => void;
  hidden: Set<string>;
  onToggle: (key: string) => void;
  /** A Space manager's Widgets section (Phase 5b); absent for everyone else. */
  widgets?: { onAdd: (kind: WidgetKind) => void };
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div className="relative z-10 bg-white rounded-xl shadow-lg w-[480px] max-w-[90vw] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100">
          <h2 className="text-xs font-semibold text-zinc-900">Add cards</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-zinc-100 text-zinc-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="px-5 pt-3 text-sm text-zinc-500">
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
                    <span className="block text-base font-medium text-zinc-900">{c.label}</span>
                    <span className="block text-sm text-zinc-500">{c.description}</span>
                  </span>
                  {isHidden ? (
                    <Plus className="w-3.5 h-3.5 text-zinc-400 mt-1" />
                  ) : null}
                </label>
              </li>
            );
          })}
          {widgets ? (
            <li className="pt-2">
              <div className="border-t border-line px-3 pb-1 pt-3 text-micro uppercase tracking-[0.06em] text-ink-2">Widgets</div>
              <div role="menu" aria-label="Add a widget" className="flex flex-col gap-0.5">
                {kindsFor("space-overview").map((m) => (
                  <AddWidgetRow
                    key={m.kind}
                    kind={m.kind}
                    label={m.label}
                    description={m.description}
                    onPick={() => widgets.onAdd(m.kind)}
                    className="px-3"
                    trailing={<span className="shrink-0 text-sm font-medium text-brand-deep">Add</span>}
                  />
                ))}
              </div>
              <p className="m-0 px-3 pt-2 text-xs text-ink-2">
                Widgets are shared: everyone in this Space sees them where you place them. Your other cards stay arranged for you.
              </p>
            </li>
          ) : null}
        </ul>
        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-base px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
