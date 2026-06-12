"use client";

// BoardCanvas — the client wrapper that picks a view renderer, mounts
// the shared BoardItemDrawer, and owns the FieldShelf state. Sits
// inside the server-rendered /boards/[slug] page so the page can stay
// SSR while all interactivity (drawer state, field shelf, row clicks)
// lives here.

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { CircleDot, Settings2 } from "lucide-react";
import type { ViewType } from "@/generated/prisma";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { BoardTableView } from "./board-table-view";
import { BoardKanbanView } from "./board-kanban-view";
import { BoardCalendarView } from "./board-calendar-view";
import { BoardGanttView } from "./board-gantt-view";
import { BoardItemDrawer } from "./board-item-drawer";
import { BoardFilterBar, applyFilters, filtersActive, parseFilters, type BoardFilters } from "./board-filter-bar";
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
}

export function BoardCanvas({ boardId, viewId, viewType, viewConfig, initialItems, initialFields, statuses, canEdit, currentUserId }: BoardCanvasProps) {
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
  const toggleHiddenField = useCallback((key: string) => {
    setHiddenFields((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      if (viewId) {
        void fetch(`/api/boards/${boardId}/views/${viewId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ config: { ...(viewConfig ?? {}), hiddenFields: next } }),
        }).catch(() => {});
      }
      return next;
    });
  }, [boardId, viewId, viewConfig]);
  const visibleFields = useMemo(
    () => fields.filter((f) => !hiddenFields.includes(f.key)),
    [fields, hiddenFields],
  );

  // Per-view filters (View.config.filters). Applied to every renderer;
  // search persistence is debounced so typing doesn't spam PATCHes.
  const [filters, setFilters] = useState<BoardFilters>(() => parseFilters(viewConfig?.filters));
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleFiltersChange = useCallback((next: BoardFilters) => {
    setFilters((prev) => {
      if (viewId) {
        const searchOnly =
          prev.search !== next.search &&
          prev.statuses === next.statuses && prev.owners === next.owners &&
          prev.priorities === next.priorities && prev.tagIds === next.tagIds &&
          prev.hideDone === next.hideDone;
        const persist = () => {
          void fetch(`/api/boards/${boardId}/views/${viewId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ config: { ...(viewConfig ?? {}), hiddenFields, filters: next } }),
          }).catch(() => {});
        };
        if (persistTimer.current) clearTimeout(persistTimer.current);
        if (searchOnly) persistTimer.current = setTimeout(persist, 800);
        else persist();
      }
      return next;
    });
  }, [boardId, viewId, viewConfig, hiddenFields]);

  const filteredItems = useMemo(() => applyFilters(items, filters, statuses), [items, filters, statuses]);

  const handleItemChanged = useCallback((updated: BoardItemRow) => {
    setItems((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }, []);

  const handleItemArchived = useCallback((id: string) => {
    setItems((prev) => prev.filter((r) => r.id !== id));
    setOpenItemId(null);
    router.refresh();
  }, [router]);

  return (
    <>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <BoardFilterBar items={items} filters={filters} statuses={statuses} onChange={handleFiltersChange} />
        {filtersActive(filters) ? (
          <span className="text-[11px] text-zinc-400 tabular-nums">
            {filteredItems.length} of {items.length}
          </span>
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setStatusEditorOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border border-zinc-200 hover:bg-zinc-50"
          title="Edit this List's task statuses"
        >
          <CircleDot className="w-3.5 h-3.5" />
          Statuses <span className="text-xs text-zinc-500">({statuses.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setShelfOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border border-zinc-200 hover:bg-zinc-50"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Fields {fields.length > 0 ? <span className="text-xs text-zinc-500">({fields.length})</span> : null}
        </button>
      </div>

      {viewType === "TABLE" ? (
        <BoardTableView
          boardId={boardId}
          viewId={viewId}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={visibleFields}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={(id) => setOpenItemId(id)}
          gridStyle={viewConfig?.grid === "monday" ? "table" : "list"}
        />
      ) : viewType === "KANBAN" ? (
        <BoardKanbanView
          boardId={boardId}
          initialItems={filteredItems}
          initialFields={visibleFields}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={(id) => setOpenItemId(id)}
        />
      ) : viewType === "CALENDAR" ? (
        <BoardCalendarView
          boardId={boardId}
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
          initialItems={filteredItems}
          initialFields={fields}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={(id) => setOpenItemId(id)}
          onItemChanged={handleItemChanged}
        />
      ) : (
        <div className="border border-zinc-200 rounded-xl px-8 py-16 text-center bg-white">
          <div className="text-base font-medium mb-1">
            {viewType} renderer coming next
          </div>
          <p className="text-sm text-zinc-500 max-w-[460px] mx-auto">
            TABLE, KANBAN, CALENDAR, and GANTT are live; FORM / TIMELINE / WORKLOAD / MAP / DOC / DASHBOARD follow.
            Add a List, Board, Calendar, or Gantt view via the "+ View" tab to use a rendered surface today.
          </p>
        </div>
      )}

      <BoardItemDrawer
        itemId={openItemId}
        canEdit={canEdit}
        currentUserId={currentUserId}
        fields={fields}
        statuses={statuses}
        onClose={closeDrawer}
        onItemChanged={handleItemChanged}
        onItemArchived={handleItemArchived}
      />

      <BoardStatusEditor
        boardId={boardId}
        open={statusEditorOpen}
        canEdit={canEdit}
        statuses={statuses}
        onClose={() => setStatusEditorOpen(false)}
      />

      <FieldShelf
        boardId={boardId}
        open={shelfOpen}
        canEdit={canEdit}
        fields={fields}
        hiddenFields={hiddenFields}
        onToggleHidden={viewId ? toggleHiddenField : undefined}
        onClose={() => setShelfOpen(false)}
        onFieldsChanged={setFields}
      />
    </>
  );
}
