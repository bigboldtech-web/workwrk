"use client";

// BoardCanvas — the client wrapper that picks a view renderer, mounts
// the shared BoardItemDrawer, and owns the FieldShelf state. Sits
// inside the server-rendered /boards/[slug] page so the page can stay
// SSR while all interactivity (drawer state, field shelf, row clicks)
// lives here.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { CircleDot, Settings2 } from "lucide-react";
import type { ViewType } from "@/generated/prisma";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import { BUILTIN_COLUMN_BY_KEY, type FieldDef } from "@/lib/field-catalog";
import { BoardTableView } from "./board-table-view";
import { BoardKanbanView } from "./board-kanban-view";
import { BoardCalendarView } from "./board-calendar-view";
import { BoardGanttView } from "./board-gantt-view";
import { BoardChartView } from "./board-chart-view";
import { BoardDashboardView } from "./board-dashboard-view";
import { BoardFormView } from "./board-form-view";
import { BoardDocView } from "./board-doc-view";
import { BoardFileGalleryView } from "./board-file-gallery-view";
import { BoardWorkloadView } from "./board-workload-view";
import { BoardTimelineView } from "./board-timeline-view";
import { BoardMapView } from "./board-map-view";
import { BoardWhiteboardView } from "./board-whiteboard-view";
import { BoardHierarchyView } from "./board-hierarchy-view";
import { BoardPivotView } from "./board-pivot-view";
import { BoardCardsView } from "./board-cards-view";
import { BoardActivityView } from "./board-activity-view";
import { BoardItemDrawer } from "./board-item-drawer";
import { applyFilters, parseFilters } from "./board-filter-bar";
import { FieldShelf } from "./field-shelf";
import { BoardStatusEditor } from "./board-status-editor";

interface BoardCanvasProps {
  boardId: string;
  /** Phase 74 — active view's id (for PATCH /api/boards/[id]/views/[id])
   *  + initial config blob. Null until a view exists (first board load). */
  viewId: string | null;
  viewType: ViewType;
  viewConfig: Record<string, unknown>;
  initialItems: BoardItemRow[];
  initialFields: FieldDef[];
  /** Per-List statuses (backbone #1) — the board's own set, resolved
   *  server-side via getBoardStatuses(board). Every renderer + the
   *  drawer + the filter bar read THIS set, never the global default. */
  statuses: StatusOption[];
  canEdit: boolean;
  /** Threaded through to the drawer so the comments thread can gate
   *  "delete my own comment" without an extra session fetch. */
  currentUserId: string | null;
  /** The "+ Task" affordance, rendered on the right of the single toolbar row
   *  (ClickUp keeps create + filters + Statuses/Fields on one line). */
  addTaskSlot?: ReactNode;
  /** Module ("ClickApp") gating from the board's Space. Each false hides that
   *  capability across the board's surfaces (columns, kanban card, drawer,
   *  timer). Absent = ungated (legacy Space → all on). */
  moduleGating?: { priority: boolean; tags: boolean; timeTracking: boolean; customFields: boolean };
}

export function BoardCanvas({ boardId, viewId, viewType, viewConfig, initialItems, initialFields, statuses, canEdit, currentUserId, addTaskSlot, moduleGating }: BoardCanvasProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [trackedItemParam, setTrackedItemParam] = useState<string | null>(null);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [statusEditorOpen, setStatusEditorOpen] = useState(false);

  // Cross-board deep link: any Space view (List/Recent/Team/etc.) can
  // route to /boards/[slug]?item=<id> to land here with the drawer open.
  // Derived-state-during-render pattern (React 19 friendly): we mirror
  // the URL param into a tracked sentinel; when it changes, we update
  // openItemId in the same render pass. The closeDrawer handler strips
  // the param so a refresh doesn't reopen.
  const itemParam = searchParams?.get("item") ?? null;
  if (itemParam !== trackedItemParam) {
    setTrackedItemParam(itemParam);
    if (itemParam) setOpenItemId(itemParam);
  }

  // ?panel=fields|statuses — deep link from the sidebar List "…" menu
  // (Custom Fields / Task statuses) opens the matching editor on arrival.
  const [trackedPanel, setTrackedPanel] = useState<string | null>(null);
  const panelParam = searchParams?.get("panel") ?? null;
  if (panelParam !== trackedPanel) {
    setTrackedPanel(panelParam);
    if (panelParam === "fields") setShelfOpen(true);
    if (panelParam === "statuses") setStatusEditorOpen(true);
  }

  const stripPanel = useCallback(() => {
    if (!searchParams?.get("panel")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("panel");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const closeDrawer = useCallback(() => {
    setOpenItemId(null);
    if (searchParams?.get("item")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("item");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [router, pathname, searchParams]);
  // Local mirrors so drawer/shelf edits sync into the active renderer
  // without a full router.refresh().
  const [items, setItems] = useState<BoardItemRow[]>(initialItems);
  const [fields, setFields] = useState<FieldDef[]>(initialFields);

  // Per-view column visibility (View.config.hiddenFields). The table
  // gets only visible fields; the drawer always shows all (ClickUp
  // behavior). Persisted with the same PATCH the table uses for
  // groupBy — merging into the view's config blob.
  const [hiddenFields, setHiddenFields] = useState<string[]>(() => {
    const raw = viewConfig?.hiddenFields;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  });
  // Optional built-in columns turned ON for this view (View.config.extraColumns) —
  // the default-off "Properties" like Task Type / Start date / Task ID.
  const [extraColumns, setExtraColumns] = useState<string[]>(() => {
    const raw = viewConfig?.extraColumns;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  });
  const persistCols = useCallback((hiddenNext: string[], extraNext: string[]) => {
    if (!viewId) return;
    void fetch(`/api/boards/${boardId}/views/${viewId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { ...(viewConfig ?? {}), hiddenFields: hiddenNext, extraColumns: extraNext } }),
    }).catch(() => {});
  }, [boardId, viewId, viewConfig]);
  const toggleHiddenField = useCallback((key: string) => {
    setHiddenFields((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      persistCols(next, extraColumns);
      return next;
    });
  }, [persistCols, extraColumns]);
  const toggleExtraColumn = useCallback((key: string) => {
    setExtraColumns((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      persistCols(hiddenFields, next);
      return next;
    });
  }, [persistCols, hiddenFields]);
  // Single entry point for the Fields panel + column-header menu: default-off
  // built-ins toggle via extraColumns; everything else (default-on built-ins +
  // custom fields) toggles via hiddenFields.
  const toggleColumn = useCallback((key: string) => {
    const col = BUILTIN_COLUMN_BY_KEY[key];
    if (col && !col.locked && !col.defaultShown) toggleExtraColumn(key);
    else toggleHiddenField(key);
  }, [toggleExtraColumn, toggleHiddenField]);
  const visibleFields = useMemo(
    () => fields.filter((f) => !hiddenFields.includes(f.key)),
    [fields, hiddenFields],
  );

  // Module ("ClickApp") gating from the Space. Custom Fields off → no custom
  // columns + no Fields shelf; Priority/Tags/Time off → their built-in column
  // is force-hidden AND the same capability is hidden on cards / drawer / menu.
  const customFieldsOn = moduleGating?.customFields !== false;
  const priorityOn = moduleGating?.priority !== false;
  const tagsOn = moduleGating?.tags !== false;
  const timeTrackingOn = moduleGating?.timeTracking !== false;
  const gatedFields = customFieldsOn ? visibleFields : [];
  const tableHiddenBuiltins = useMemo(
    () => [
      ...hiddenFields,
      ...(priorityOn ? [] : ["__builtin_priority"]),
      ...(tagsOn ? [] : ["__builtin_tags"]),
      ...(timeTrackingOn ? [] : ["__builtin_time"]),
    ],
    [hiddenFields, priorityOn, tagsOn, timeTrackingOn],
  );

  // Re-pull Board.schema.fields after a column-header field mutation (delete /
  // move to start-end) so the table reflects it. Mirrors FieldShelf's refetch.
  const refetchFields = useCallback(async () => {
    try {
      const res = await fetch(`/api/boards/${boardId}/fields`, { cache: "no-store" });
      if (res.ok) { const d = await res.json(); setFields((d.fields ?? []) as FieldDef[]); }
    } catch { /* best-effort */ }
  }, [boardId]);

  // Per-view filters (View.config.filters), applied to every renderer. The
  // search + filter UI was pulled out (it's moving to a new spot), so there's no
  // live setter right now — the config-level filters still apply.
  const filters = useMemo(() => parseFilters(viewConfig?.filters), [viewConfig]);

  const filteredItems = useMemo(() => applyFilters(items, filters, statuses), [items, filters, statuses]);

  const handleItemChanged = useCallback((updated: BoardItemRow) => {
    setItems((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }, []);

  const handleItemArchived = useCallback((id: string) => {
    setItems((prev) => prev.filter((r) => r.id !== id));
    setOpenItemId(null);
    router.refresh();
  }, [router]);

  // Right-side toolbar actions. For the TABLE view these ride on the same row as
  // the group/subtask/columns icons (just below the tabs); other views keep the
  // dedicated action row above the canvas.
  const toolbarActions = (
    <>
      <button
        type="button"
        onClick={() => setStatusEditorOpen(true)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12.5px] border border-zinc-200 hover:bg-zinc-50"
        title="Edit this List's task statuses"
      >
        <CircleDot className="w-3.5 h-3.5" />
        Statuses <span className="text-xs text-zinc-500">({statuses.length})</span>
      </button>
      {customFieldsOn ? (
        <button
          type="button"
          onClick={() => setShelfOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12.5px] border border-zinc-200 hover:bg-zinc-50"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Fields {fields.length > 0 ? <span className="text-xs text-zinc-500">({fields.length})</span> : null}
        </button>
      ) : null}
      {addTaskSlot}
    </>
  );

  return (
    <>
      {viewType !== "TABLE" ? (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <div className="flex-1" />
          {toolbarActions}
        </div>
      ) : null}

      {viewType === "TABLE" ? (
        <BoardTableView
          boardId={boardId}
          viewId={viewId}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={gatedFields}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={(id) => setOpenItemId(id)}
          onEditStatuses={() => setStatusEditorOpen(true)}
          onOpenFields={customFieldsOn ? () => setShelfOpen(true) : undefined}
          currentUserId={currentUserId}
          toolbarActions={toolbarActions}
          hiddenBuiltins={tableHiddenBuiltins}
          extraColumns={extraColumns}
          onHideField={viewId ? toggleColumn : undefined}
          onFieldsChanged={refetchFields}
          timeTrackingEnabled={timeTrackingOn}
          gridStyle={viewConfig?.grid === "monday" ? "table" : "list"}
        />
      ) : viewType === "KANBAN" ? (
        <BoardKanbanView
          boardId={boardId}
          initialItems={filteredItems}
          initialFields={gatedFields}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={(id) => setOpenItemId(id)}
          priorityEnabled={priorityOn}
          tagsEnabled={tagsOn}
          timeTrackingEnabled={timeTrackingOn}
        />
      ) : viewType === "CALENDAR" ? (
        <BoardCalendarView
          boardId={boardId}
          viewId={viewId}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={fields}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={(id) => setOpenItemId(id)}
          onItemCreated={(item) => setItems((prev) => [...prev, item])}
          onItemChanged={handleItemChanged}
        />
      ) : viewType === "GANTT" ? (
        <BoardGanttView
          boardId={boardId}
          viewId={viewId}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={fields}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={(id) => setOpenItemId(id)}
          onItemChanged={handleItemChanged}
          onItemCreated={(item) => setItems((prev) => [...prev, item])}
        />
      ) : viewType === "CHART" ? (
        <BoardChartView
          boardId={boardId}
          viewId={viewId}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={fields}
          statuses={statuses}
          canEdit={canEdit}
        />
      ) : viewType === "DASHBOARD" ? (
        <BoardDashboardView initialItems={filteredItems} statuses={statuses} />
      ) : viewType === "FORM" ? (
        <BoardFormView boardId={boardId} viewId={viewId} viewConfig={viewConfig} canEdit={canEdit} />
      ) : viewType === "DOC" ? (
        <BoardDocView boardId={boardId} viewId={viewId} viewConfig={viewConfig} canEdit={canEdit} />
      ) : viewType === "FILE_GALLERY" ? (
        <BoardFileGalleryView boardId={boardId} onOpenItem={(id) => setOpenItemId(id)} />
      ) : viewType === "WORKLOAD" ? (
        <BoardWorkloadView
          initialItems={filteredItems}
          statuses={statuses}
          variant={viewConfig?.variant === "team" ? "team" : "workload"}
          onOpenItem={(id) => setOpenItemId(id)}
        />
      ) : viewType === "TIMELINE" ? (
        <BoardTimelineView
          initialItems={filteredItems}
          statuses={statuses}
          onOpenItem={(id) => setOpenItemId(id)}
        />
      ) : viewType === "MAP" ? (
        <BoardMapView
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={fields}
          statuses={statuses}
          onOpenItem={(id) => setOpenItemId(id)}
        />
      ) : viewType === "WHITEBOARD" ? (
        <BoardWhiteboardView boardId={boardId} viewId={viewId} viewConfig={viewConfig} canEdit={canEdit} />
      ) : viewType === "HIERARCHY" ? (
        <BoardHierarchyView
          initialItems={filteredItems}
          statuses={statuses}
          onOpenItem={(id) => setOpenItemId(id)}
        />
      ) : viewType === "PIVOT" ? (
        <BoardPivotView
          boardId={boardId}
          viewId={viewId}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={fields}
          statuses={statuses}
          canEdit={canEdit}
        />
      ) : viewType === "CARDS" ? (
        <BoardCardsView
          initialItems={filteredItems}
          statuses={statuses}
          onOpenItem={(id) => setOpenItemId(id)}
        />
      ) : viewType === "ACTIVITY" ? (
        <BoardActivityView
          boardId={boardId}
          statuses={statuses}
          onOpenItem={(id) => setOpenItemId(id)}
        />
      ) : (
        // Safety net for any future ViewType the client predates.
        <div className="border border-zinc-200 rounded-xl px-8 py-16 text-center bg-white">
          <div className="text-base font-medium mb-1">{viewType} view</div>
          <p className="text-sm text-zinc-500 max-w-[460px] mx-auto">
            This view type isn&apos;t supported by this build yet — refresh, or pick another view tab.
          </p>
        </div>
      )}

      <BoardItemDrawer
        itemId={openItemId}
        canEdit={canEdit}
        currentUserId={currentUserId}
        fields={fields}
        statuses={statuses}
        moduleGating={{ priority: priorityOn, tags: tagsOn, timeTracking: timeTrackingOn, customFields: customFieldsOn }}
        onClose={closeDrawer}
        onItemChanged={handleItemChanged}
        onItemArchived={handleItemArchived}
        onOpenItem={(id) => setOpenItemId(id)}
      />

      <BoardStatusEditor
        boardId={boardId}
        open={statusEditorOpen}
        canEdit={canEdit}
        statuses={statuses}
        onClose={() => { setStatusEditorOpen(false); stripPanel(); }}
      />

      {customFieldsOn ? (
        <FieldShelf
          boardId={boardId}
          open={shelfOpen}
          canEdit={canEdit}
          fields={fields}
          hiddenFields={hiddenFields}
          extraColumns={extraColumns}
          onToggleColumn={viewId ? toggleColumn : undefined}
          onClose={() => { setShelfOpen(false); stripPanel(); }}
          onFieldsChanged={setFields}
        />
      ) : null}
    </>
  );
}
