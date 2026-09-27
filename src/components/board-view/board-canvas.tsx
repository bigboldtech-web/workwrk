"use client";

// BoardCanvas — the client wrapper that picks a view renderer, mounts
// the task drawer (now the @drawer route, not a mounted component), and
// owns the FieldShelf state. Sits
// inside the server-rendered /boards/[slug] page so the page can stay
// SSR while all interactivity (drawer state, field shelf, row clicks)
// lives here.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  FilterMenu,
  applyFilters,
  parseFilters,
  parseSavedFilters,
  serializeFilters,
  type BoardFilters,
  type SavedFilter,
} from "./board-filter-bar";
import { FieldShelf } from "./field-shelf";
import { BoardStatusEditor } from "./board-status-editor";
import { SprintHeaderStrip } from "./sprint-header-strip";
import type { SprintMeta } from "@/lib/sprint";
import { useOsToast } from "@/components/layout/os/toast";
import { openTask, armTaskDrawer } from "@/lib/nav/open-task";
import { WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";
import {
  applyRowPatchReport,
  boardStatusFor,
  computedFieldsKey,
  itemEventAction,
  itemsUrl,
  linkedRowKind,
  mergeRefetchedRow,
  reconcilePoll,
  refetchedFromRow,
  type RefetchedTask,
  type RowPatchReport,
} from "@/lib/list-link-rows";
import { viewConfigQueue } from "@/lib/view-config-queue";
import { PersonalListSurface } from "./item-context-menu";
import { LIST_SETTINGS_CHANGED } from "@/lib/table-comfort";
import type { RowColorRule } from "@/lib/list-comfort";
import type { LoadedListSettings } from "@/lib/list-defaults-client";
import { LinkedRowIndicator } from "./linked-row-indicator";

// View types that render the (filterable) item list — only these get the
// toolbar FilterMenu; content views (FORM / DOC / WHITEBOARD / …) don't.
const FILTERABLE_VIEWS = new Set<ViewType>([
  "TABLE", "KANBAN", "CALENDAR", "GANTT", "CHART", "DASHBOARD",
  "WORKLOAD", "TIMELINE", "MAP", "HIERARCHY", "PIVOT", "CARDS",
]);

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
  /**
   * May this viewer write CONTENT here: create a task, edit a cell, drag a
   * card, open the inline editors on a row?
   *
   * This is the CONTRIBUTE ladder (`canContributeBoard`: any non-guest Space
   * or Board member), which is what every write endpoint behind this canvas
   * actually gates on. It was called `canEdit` and the List page filled it
   * from `canEditSpace`, the MANAGEMENT ladder, so a Space member whose
   * writes the server accepts was shown a read-only List. The name is
   * `canContribute` now so it can never again be confused with `canManage`.
   */
  canContribute: boolean;
  /**
   * Does this viewer hold FULL access on the List?
   *
   * Only used to decide whether the row menu offers Delete. Delete is not an
   * edit: `DELETE /api/items/[id]?hard=1` wants full access on the List OR the
   * task's own creator, so a Member with Can edit saw the row and got a 403
   * every time. `undefined` means the host did not work it out and the row is
   * left alone.
   */
  canDeleteTasks?: boolean;
  /**
   * Does this viewer MANAGE the List (statuses, fields, views)?
   *
   * Separate from `canContribute`, which is content write. The Statuses and
   * Fields toolbar buttons were rendered for everyone, and both `PATCH
   * /api/boards/[id]` and the field routes answer 403 below Full access, so a
   * Can view member was handed two controls that could not work. Absent =
   * fall back to `canContribute`, the old behaviour.
   */
  canManage?: boolean;
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
  /** Sprint identity (settings.sprint) — non-null renders the sprint header
   *  strip (dates + countdown + points) above every view. */
  sprint?: SprintMeta | null;
  /**
   * Phase 5b, List comfort: the List's Conditional colors rules, for the first
   * paint. The canvas re-reads them (with the List's defaults) from
   * GET /api/boards/[id]/settings, and again whenever they are saved.
   */
  initialRowColorRules?: RowColorRule[];
  /**
   * May this viewer SAVE this view (the gate PATCH /views/[viewId] applies,
   * computed on the page)? Only then are Pin column and Row height offered;
   * everyone else sees the view as it was saved.
   */
  canSaveView?: boolean;
  /**
   * Is this the viewer's Personal List? Its tasks are private to one person,
   * so the row menu never offers Add to another List for them.
   */
  personalList?: boolean;
}

export function BoardCanvas({ boardId, viewId, viewType, viewConfig, initialItems, initialFields, statuses, canContribute, canManage, canDeleteTasks, currentUserId, addTaskSlot, moduleGating, sprint, initialRowColorRules, canSaveView = false, personalList = false }: BoardCanvasProps) {
  // Below this line the renderers each take a `canEdit` prop, and at THAT
  // level the word is unambiguous: it is content write on a row, which is
  // exactly what `canContribute` answers. The board-level confusion the
  // rename closes was between content write and managing the List itself,
  // and `canManage` is the only thing that travels for the latter.
  const canEdit = canContribute;
  const mayManage = canManage ?? canContribute;
  const router = useRouter();
  const { toast } = useOsToast();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [trackedItemParam, setTrackedItemParam] = useState<string | null>(null);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [statusEditorOpen, setStatusEditorOpen] = useState(false);

  // The held rows, readable from the event and click handlers below without
  // re-subscribing them on every change.
  const itemsRef = useRef<BoardItemRow[]>(initialItems);

  // A task now opens at its OWN url: `router.push("/item/<id>")`, which the
  // (dashboard)/@drawer/(.)item/[id] intercept renders as a drawer over this
  // list, so Copy link works and a refresh gives the full page
  // (spec-task-detail section 4 step 4). A row shown here THROUGH A LINK opens
  // in this List's context (`?list=`), so the drawer shows this List's own
  // fields and its link menu; every other row opens exactly as before.
  const openItem = useCallback((id: string) => {
    const row = itemsRef.current.find((r) => r.id === id);
    if (row && linkedRowKind(row, boardId) !== "home") openTask(router, id, { listId: boardId });
    else openTask(router, id);
  }, [router, boardId]);

  // `?item=<id>` is the OLD mechanism. It is kept for ONE release as a
  // redirect, so a bookmark, a pasted link or a server payload written before
  // this change still lands on the task instead of on a list with nothing
  // open. Every producer inside the app has moved; the one-release window
  // covers the ones outside it.
  const itemParam = searchParams?.get("item") ?? null;
  if (itemParam !== trackedItemParam) setTrackedItemParam(itemParam);
  useEffect(() => {
    if (!itemParam) return;
    // Arm the Close fallback so ✕ comes back to THIS list rather than to the
    // generic /everything. (What renders is the intercept's decision; the
    // intent is only the breadcrumb Close follows.)
    armTaskDrawer(itemParam, `${window.location.pathname}`);
    router.replace(`/item/${itemParam}`, { scroll: false });
  }, [itemParam, router]);

  // ?panel=fields|statuses — deep link from the sidebar List "…" menu
  // (Custom Fields / Task statuses) opens the matching editor on arrival.
  const [trackedPanel, setTrackedPanel] = useState<string | null>(null);
  const panelParam = searchParams?.get("panel") ?? null;
  if (panelParam !== trackedPanel) {
    setTrackedPanel(panelParam);
    // The menu row that writes this param is itself Full-access-only, so the
    // deep link honours the same gate rather than opening an editor whose
    // every save answers 403.
    if (mayManage && panelParam === "fields") setShelfOpen(true);
    if (mayManage && panelParam === "statuses") setStatusEditorOpen(true);
  }

  const stripPanel = useCallback(() => {
    if (!searchParams?.get("panel")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("panel");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  // A refusal has to be readable (the founder's "I cannot add custom
  // fields"): a Can view member who follows a ?panel=fields|statuses link
  // used to land on a page where nothing opened. Say what it needs, then
  // drop the param so the sentence does not repeat on every render.
  const refusedPanelRef = useRef<string | null>(null);
  useEffect(() => {
    if (mayManage || (panelParam !== "fields" && panelParam !== "statuses")) return;
    // Once per param value: dev StrictMode runs effects twice and the
    // router.replace below re-renders before the param clears.
    if (refusedPanelRef.current === panelParam) return;
    refusedPanelRef.current = panelParam;
    toast(`${panelParam === "fields" ? "Custom fields" : "Task statuses"} need Can edit on this List. Ask a List or Space admin to change your access.`);
    stripPanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelParam, mayManage]);

  // Local mirrors so drawer/shelf edits sync into the active renderer
  // without a full router.refresh().
  const [items, setItems] = useState<BoardItemRow[]>(initialItems);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const [fields, setFields] = useState<FieldDef[]>(initialFields);

  // ── List comfort (Phase 5b, gap 14) ────────────────────────────────
  // The List's default values and Conditional colors, read once on mount and
  // again when a List settings panel saves them. `loadedSettings` is keyed by
  // the List it was read for: until it answers (or if it fails) a create sends
  // today's body, and the server's own defaults still apply to what is absent.
  const [rowColorRules, setRowColorRules] = useState<RowColorRule[]>(initialRowColorRules ?? []);
  const [loadedSettings, setLoadedSettings] = useState<LoadedListSettings | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/boards/${boardId}/settings`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive || !d) return;
          setLoadedSettings({
            boardId,
            defaults: d.defaults && typeof d.defaults === "object" ? d.defaults : {},
            statuses: Array.isArray(d.statuses) ? d.statuses : [],
          });
          setRowColorRules(Array.isArray(d.rowColorRules) ? d.rowColorRules : []);
        })
        .catch(() => { /* colours stay as first painted; creates send today's body */ });
    void load();
    const onChanged = (e: Event) => {
      if ((e as CustomEvent<{ boardId?: string }>).detail?.boardId === boardId) void load();
    };
    window.addEventListener(LIST_SETTINGS_CHANGED, onChanged);
    return () => { alive = false; window.removeEventListener(LIST_SETTINGS_CHANGED, onChanged); };
  }, [boardId]);

  // The status a row has IN THIS LIST: a row shown through a link stores its
  // home status, remapped here for filters, grouping and colour rules.
  const statusOf = useCallback((row: BoardItemRow) => boardStatusFor(row, boardId, statuses), [boardId, statuses]);

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
  // Persist a partial config patch through the view's ONE save queue
  // (src/lib/view-config-queue.ts): patches merge, one request is in flight
  // at a time, and a failed key stays dirty until it lands, so two quick
  // changes can no longer race and a failure can no longer lose one. The
  // local Object.assign mirror stays: renderers that still write the WHOLE
  // config (calendar, gantt, chart) spread this object, so they carry every
  // key saved here.
  const viewQueue = useMemo(() => (viewId ? viewConfigQueue(boardId, viewId) : null), [boardId, viewId]);
  const persistViewConfig = useCallback((patch: Record<string, unknown>, _label: string) => {
    if (!viewQueue) return;
    Object.assign(viewConfig, patch);
    viewQueue.enqueue(patch);
  }, [viewQueue, viewConfig]);
  // One place says a view save failed, with a real Try again: the table's
  // saves go through the same queue, so they surface here too.
  // A refusal is said without a Try again, which could only be refused again.
  useEffect(() => {
    if (!viewQueue) return;
    return viewQueue.subscribe((st) => {
      if (st.status !== "error") return;
      toast(st.message ?? "Couldn't save the view settings.", {
        tone: "danger",
        key: `view-config:${viewId}`,
        ...(st.retryable ? { action: { label: "Try again", onClick: () => void viewQueue.flush() } } : {}),
      });
    });
  }, [viewQueue, viewId, toast]);
  // This page painted the view's config as the server has it now, so a key an
  // earlier visit failed to save (and this screen does not show) is let go
  // rather than sent with the next, unrelated save.
  useEffect(() => {
    viewQueue?.discardFailed();
  }, [viewQueue]);
  const persistCols = useCallback((hiddenNext: string[], extraNext: string[]) => {
    persistViewConfig({ hiddenFields: hiddenNext, extraColumns: extraNext }, "column layout");
  }, [persistViewConfig]);
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
  // columns + no Fields shelf; Priority/Tags/Time tracking → their built-in column
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

  // Per-view filters (View.config.filters), applied to every item-driven
  // renderer. Live state seeded from the saved config; every change
  // persists back through the shared config PATCH. Saved filter sets
  // (View.config.savedFilters) ride the same path.
  const [filters, setFiltersState] = useState<BoardFilters>(() => parseFilters(viewConfig?.filters));
  const [savedFilters, setSavedFiltersState] = useState<SavedFilter[]>(() => parseSavedFilters(viewConfig?.savedFilters));

  // A view tab is a client navigation: this canvas (the page renders it with
  // no key) stays mounted and only its props change, so every state seeded
  // from a view's config above kept the PREVIOUS view's values, and the next
  // save wrote them into the new view (the walk: view A's pins, row height,
  // grouping, hidden columns and filters appearing on view B, then saved into
  // B's shared config by an unrelated pin). The canvas's own view state is
  // re-read here when the view changes, and each renderer is keyed by the
  // view (`viewKey`) so its own seeded state (pins, row height, group, sort,
  // widths) is read afresh from the new config too.
  const viewKey = viewId ?? `default:${viewType}`;
  const [seededViewKey, setSeededViewKey] = useState(viewKey);
  if (seededViewKey !== viewKey) {
    setSeededViewKey(viewKey);
    const hidden = viewConfig?.hiddenFields;
    setHiddenFields(Array.isArray(hidden) ? hidden.filter((x): x is string => typeof x === "string") : []);
    const extra = viewConfig?.extraColumns;
    setExtraColumns(Array.isArray(extra) ? extra.filter((x): x is string => typeof x === "string") : []);
    setFiltersState(parseFilters(viewConfig?.filters));
    setSavedFiltersState(parseSavedFilters(viewConfig?.savedFilters));
  }
  const setFilters = useCallback((next: BoardFilters) => {
    setFiltersState(next);
    persistViewConfig({ filters: serializeFilters(next) }, "filters");
  }, [persistViewConfig]);
  const setSavedFilters = useCallback((next: SavedFilter[]) => {
    setSavedFiltersState(next);
    persistViewConfig({ savedFilters: next }, "saved filters");
  }, [persistViewConfig]);

  const filteredItems = useMemo(() => applyFilters(items, filters, statuses, { statusOf }), [items, filters, statuses, statusOf]);

  const filterMenu = FILTERABLE_VIEWS.has(viewType) ? (
    <FilterMenu
      filters={filters}
      onChange={setFilters}
      statuses={statuses}
      items={items}
      customFields={customFieldsOn ? fields : []}
      boardId={boardId}
      savedFilters={savedFilters}
      onSavedFiltersChange={viewId ? setSavedFilters : undefined}
    />
  ) : null;

  // A row a renderer or the drawer just wrote. A row held here THROUGH A LINK
  // is merged by the linked-row rule (it keeps this List's boardId, link and
  // position), and dropped when the answer is no longer this List's: a
  // Calendar drag or a Gantt resize can never swap the home projection in.
  const handleItemChanged = useCallback((updated: BoardItemRow) => {
    setItems((prev) => {
      const at = prev.findIndex((r) => r.id === updated.id);
      if (at === -1) return prev;
      const held = prev[at];
      if (linkedRowKind(held, boardId) === "home") return prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
      if (updated.listLink?.boardId !== boardId) return prev.filter((r) => r.id !== updated.id);
      const out = mergeRefetchedRow(held, refetchedFromRow(updated), boardId);
      if (out.action === "drop") return prev.filter((r) => r.id !== updated.id);
      if (out.action !== "merge") return prev;
      const next = [...prev];
      next[at] = out.row;
      return next;
    });
  }, [boardId]);

  // Item-state ownership (2026-08-12): the table/kanban renderers keep their
  // own optimistic copy of the list and re-seed it from `filteredItems`
  // whenever the canvas re-renders (drawer edit, filter change, …). These
  // four callbacks mirror every renderer-side mutation into the canvas list
  // FIRST, so that re-seed can never clobber a row the canvas hasn't heard
  // about (the "created task disappears after a drawer edit" bug).
  const handleItemCreated = useCallback((item: BoardItemRow) => {
    setItems((prev) => (prev.some((r) => r.id === item.id) ? prev : [...prev, item]));
  }, []);
  // `applyRowPatchReport`, not a spread: a custom-field edit arrives as
  // `metadataPatch` and merges into THIS copy's metadata. The renderer used
  // to report only row fields, so the copy here kept the old blob and the
  // next resync snapped the edited cell back until a full reload.
  const handleItemPatched = useCallback((id: string, patch: RowPatchReport) => {
    setItems((prev) => {
      const next = prev.map((r) => (r.id === id ? applyRowPatchReport(r, patch) : r));
      // A `position` patch is a drag-reorder. The ledger must stay in the same
      // position order listBoardItems hands back, otherwise the renderer
      // re-syncs from a snapshot that still holds the pre-drag order and the
      // dropped row visibly snaps back (the server keeps the new order).
      if (patch.position === undefined) return next;
      return [...next].sort((a, b) => a.position - b.position);
    });
  }, []);
  const handleItemRemoved = useCallback((id: string) => {
    setItems((prev) => prev.filter((r) => r.id !== id));
  }, []);
  const handleItemsRefreshed = useCallback((fresh: BoardItemRow[]) => {
    setItems(fresh);
  }, []);

  // Live updates (light polling): every ~12s while the tab is visible, pull the
  // board's items and fold in what teammates changed — new tasks they added and
  // rows they edited (only when the server copy is strictly NEWER, so a row
  // you're mid-editing is never clobbered). It never removes a row here, so an
  // optimistic add that hasn't reached the server yet can't be dropped. Also
  // fires immediately when you switch back to the tab. (SSE can replace this
  // later for instant push.)
  //
  // Phase 5b: the poll asks for the List's linked rows too (itemsUrl), and
  // folds the answer in by reconcilePoll: today's rule for home rows, plus a
  // held LINKED row that the answer no longer names has left this List and
  // goes, and one whose link position or home status moved is replaced even
  // at an equal updatedAt (a link change does not touch the task).
  const reloadList = useCallback(async () => {
    try {
      const res = await fetch(itemsUrl(boardId), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const fresh: BoardItemRow[] = Array.isArray(data?.items) ? data.items : [];
      setItems((prev) => reconcilePoll(prev, fresh) ?? prev);
    } catch { /* transient: the next tick retries */ }
  }, [boardId]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (cancelled) return;
      await reloadList();
    };
    const id = setInterval(() => void poll(), 12000);
    const onVis = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [reloadList]);

  // A Connect or Mirror column added or reconfigured (the field shelf, a
  // column header's edit) leaves every held row's computed cells read for the
  // OLD schema: a new Mirror column stayed blank until a full reload. The List
  // is re-read at once, and reconcilePoll lays the fresh chips and values in.
  const computedKey = useMemo(() => computedFieldsKey(fields), [fields]);
  const seenComputedKeyRef = useRef(computedKey);
  useEffect(() => {
    if (seenComputedKeyRef.current === computedKey) return;
    seenComputedKeyRef.current = computedKey;
    void reloadList();
  }, [computedKey, reloadList]);

  const dropItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // The drawer is rendered by the @drawer slot, so its edits cannot arrive as
  // props. They arrive as the one `item` window event instead, which is also
  // what the SSE stream fans out, so a colleague's change and this tab's own
  // land through the same door and the row under the drawer is never stale for
  // the twelve seconds the poll would otherwise take.
  //
  // Phase 5b: what the event means for THIS List is itemEventAction's
  // (list-link-rows.ts), which reads `listIds` (every List the task appears
  // in) and `leftListIds` (the Lists it just left) as well as `boardId`, its
  // home. A row shown here through a link is never dropped because the event
  // names its home, and the re-read asks for the task IN this List
  // (`?list=`), so the answer is projected for this List and merged by the
  // linked-row rule, or dropped when it is no longer this List's.
  useEffect(() => {
    const onEvent = (e: Event) => {
      const ev = (e as CustomEvent<RealtimeEvent & { gone?: boolean; listIds?: string[]; leftListIds?: string[] }>).detail;
      if (!ev || ev.type !== "item") return;
      const held = itemsRef.current.find((r) => r.id === ev.itemId);
      const action = itemEventAction(
        { gone: ev.gone, boardId: ev.boardId, listIds: ev.listIds, leftListIds: ev.leftListIds },
        boardId,
        held,
      );
      if (action === "ignore") return;
      if (action === "drop") { dropItem(ev.itemId); return; }
      if (action === "reload") { void reloadList(); return; }
      void fetch(`/api/items/${ev.itemId}?list=${encodeURIComponent(boardId)}`, { cache: "no-store" })
        .then(async (r) => {
          // Only a 404 means "it is gone from here"; any other failure keeps
          // the row and lets the poll catch up.
          if (r.status === 404) return { gone: true as const };
          if (!r.ok) return null;
          return { body: (await r.json()) as Partial<RefetchedTask> & { item?: BoardItemRow } };
        })
        .then((got) => {
          if (!got) return;
          if ("gone" in got) { dropItem(ev.itemId); return; }
          const d = got.body;
          if (!d?.item) return;
          const fresh: RefetchedTask = {
            item: d.item,
            context: d.context ?? { boardId: d.item.boardId ?? boardId, kind: "home" },
            decision: d.decision ?? null,
          };
          let reload = false;
          setItems((prev) => {
            const at = prev.findIndex((r) => r.id === ev.itemId);
            if (at === -1) return prev;
            const out = mergeRefetchedRow(prev[at], fresh, boardId);
            if (out.action === "drop") return prev.filter((r) => r.id !== ev.itemId);
            if (out.action === "reload") { reload = true; return prev; }
            const next = [...prev];
            next[at] = out.row;
            return next;
          });
          if (reload) void reloadList();
        })
        .catch(() => { /* the 12s poll is the backstop */ });
    };
    window.addEventListener(WINDOW_EVENTS.realtime, onEvent as EventListener);
    return () => window.removeEventListener(WINDOW_EVENTS.realtime, onEvent as EventListener);
  }, [boardId, dropItem, reloadList]);

  // Right-side toolbar actions. For the TABLE view these ride on the same row as
  // the group/subtask/columns icons (just below the tabs); other views keep the
  // dedicated action row above the canvas.
  // Statuses and Fields BOTH need Full access on the List, so neither renders
  // below it: the read-only rule is an absent control, never a 403.
  const toolbarActions = (
    <>
      {mayManage ? (
        <>
          <button
            type="button"
            onClick={() => setStatusEditorOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-base border border-line hover:bg-hover"
            title="Edit this List's task statuses"
          >
            <CircleDot className="w-3.5 h-3.5" />
            Statuses <span className="text-xs text-ink-2">({statuses.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setShelfOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-base border border-line hover:bg-hover"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Fields {fields.length > 0 ? <span className="text-xs text-ink-2">({fields.length})</span> : null}
          </button>
        </>
      ) : null}
      {addTaskSlot}
    </>
  );

  return (
    <PersonalListSurface.Provider value={personalList}>
      {sprint ? (
        <SprintHeaderStrip
          boardId={boardId}
          canEdit={canEdit}
          sprint={sprint}
          items={items}
          statuses={statuses}
        />
      ) : null}
      {viewType !== "TABLE" ? (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <div className="flex-1" />
          {filterMenu}
          {toolbarActions}
        </div>
      ) : null}

      {viewType === "TABLE" ? (
        <BoardTableView
          key={viewKey}
          boardId={boardId}
          viewId={viewId}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={gatedFields}
          statuses={statuses}
          canEdit={canEdit}
          canManage={mayManage}
          canDeleteTasks={canDeleteTasks}
          onOpenItem={openItem}
          // Statuses are the List's own, written by the management ladder
          // only (PATCH /api/boards/[id]); a contributor is never handed the
          // group header's Rename / New status rows that could only 403.
          onEditStatuses={mayManage ? () => setStatusEditorOpen(true) : undefined}
          // The Columns button stays for every viewer: it opens the shelf's
          // show and hide, which is a view setting. The shelf itself offers
          // field creation and editing only to `mayManage` (below).
          onOpenFields={() => setShelfOpen(true)}
          currentUserId={currentUserId}
          toolbarActions={toolbarActions}
          filterSlot={filterMenu}
          hiddenBuiltins={tableHiddenBuiltins}
          extraColumns={extraColumns}
          onHideField={viewId ? toggleColumn : undefined}
          onFieldsChanged={refetchFields}
          onItemCreated={handleItemCreated}
          onItemPatched={handleItemPatched}
          onItemRemoved={handleItemRemoved}
          onItemsRefreshed={handleItemsRefreshed}
          timeTrackingEnabled={timeTrackingOn}
          gridStyle={viewConfig?.grid === "monday" ? "table" : "list"}
          renderTitleSuffix={(row) => <LinkedRowIndicator row={row} boardId={boardId} />}
          rowColorRules={rowColorRules}
          loadedSettings={loadedSettings}
          canSaveView={canSaveView && !!viewId}
          statusOf={statusOf}
          personalList={personalList}
        />
      ) : viewType === "KANBAN" ? (
        <BoardKanbanView
          key={viewKey}
          boardId={boardId}
          initialItems={filteredItems}
          initialFields={gatedFields}
          statuses={statuses}
          canEdit={canEdit}
          canDeleteTasks={canDeleteTasks}
          currentUserId={currentUserId}
          onOpenItem={openItem}
          onItemCreated={handleItemCreated}
          onItemPatched={handleItemPatched}
          onItemRemoved={handleItemRemoved}
          onItemsRefreshed={handleItemsRefreshed}
          priorityEnabled={priorityOn}
          tagsEnabled={tagsOn}
          timeTrackingEnabled={timeTrackingOn}
          loadedSettings={loadedSettings}
          statusOf={statusOf}
          personalList={personalList}
        />
      ) : viewType === "CALENDAR" ? (
        <BoardCalendarView
          key={viewKey}
          boardId={boardId}
          viewId={viewId}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={fields}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={openItem}
          onItemCreated={handleItemCreated}
          onItemChanged={handleItemChanged}
          onItemRemoved={handleItemRemoved}
          timeTrackingEnabled={timeTrackingOn}
          loadedSettings={loadedSettings}
        />
      ) : viewType === "GANTT" ? (
        <BoardGanttView
          key={viewKey}
          boardId={boardId}
          viewId={viewId}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={fields}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={openItem}
          onItemChanged={handleItemChanged}
          onItemCreated={handleItemCreated}
          onItemRemoved={handleItemRemoved}
          timeTrackingEnabled={timeTrackingOn}
          loadedSettings={loadedSettings}
        />
      ) : viewType === "CHART" ? (
        <BoardChartView
          key={viewKey}
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
        <BoardFileGalleryView boardId={boardId} onOpenItem={openItem} />
      ) : viewType === "WORKLOAD" ? (
        <BoardWorkloadView
          key={viewKey}
          boardId={boardId}
          viewId={viewId}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          statuses={statuses}
          canEdit={canEdit}
          variant={viewConfig?.variant === "team" ? "team" : "workload"}
          onOpenItem={openItem}
        />
      ) : viewType === "TIMELINE" ? (
        <BoardTimelineView
          boardId={boardId}
          initialItems={filteredItems}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={openItem}
          onItemCreated={handleItemCreated}
          onItemRemoved={handleItemRemoved}
          timeTrackingEnabled={timeTrackingOn}
        />
      ) : viewType === "MAP" ? (
        <BoardMapView
          key={viewKey}
          viewConfig={viewConfig}
          initialItems={filteredItems}
          initialFields={fields}
          statuses={statuses}
          onOpenItem={openItem}
        />
      ) : viewType === "WHITEBOARD" ? (
        <BoardWhiteboardView boardId={boardId} viewId={viewId} viewConfig={viewConfig} canEdit={canEdit} />
      ) : viewType === "HIERARCHY" ? (
        <BoardHierarchyView
          boardId={boardId}
          initialItems={filteredItems}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={openItem}
          onItemCreated={handleItemCreated}
          onItemRemoved={handleItemRemoved}
          timeTrackingEnabled={timeTrackingOn}
        />
      ) : viewType === "PIVOT" ? (
        <BoardPivotView
          key={viewKey}
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
          boardId={boardId}
          initialItems={filteredItems}
          statuses={statuses}
          canEdit={canEdit}
          onOpenItem={openItem}
          onItemCreated={handleItemCreated}
          onItemRemoved={handleItemRemoved}
          timeTrackingEnabled={timeTrackingOn}
        />
      ) : viewType === "ACTIVITY" ? (
        <BoardActivityView
          boardId={boardId}
          statuses={statuses}
          onOpenItem={openItem}
        />
      ) : (
        // Safety net for any future ViewType the client predates.
        <div className="border border-zinc-200 rounded-xl px-8 py-16 text-center bg-white">
          <div className="text-base font-medium mb-1">{viewType} view</div>
          <p className="text-xs text-zinc-500 max-w-[460px] mx-auto">
            This view type isn&apos;t supported by this build yet — refresh, or pick another view tab.
          </p>
        </div>
      )}

      <BoardStatusEditor
        boardId={boardId}
        open={statusEditorOpen}
        canEdit={mayManage}
        statuses={statuses}
        onClose={() => { setStatusEditorOpen(false); stripPanel(); }}
      />

      {/* The shelf is the COLUMN manager (built-ins + custom): always
          available. The Custom Fields module gates only custom-field
          creation inside it. Creating, renaming, reordering and configuring
          a field (a Connect or Mirror form included) all write the List's
          schema, which every fields route gates on Full access, so those
          follow `mayManage`, not content write: a contributor filled in a
          whole Mirror form and was then refused with a Retry that could
          only be refused again. Show and hide stay theirs. */}
      <FieldShelf
        boardId={boardId}
        open={shelfOpen}
        canEdit={mayManage}
        customFieldsEnabled={customFieldsOn}
        fields={fields}
        hiddenFields={hiddenFields}
        extraColumns={extraColumns}
        onToggleColumn={viewId ? toggleColumn : undefined}
        onClose={() => { setShelfOpen(false); stripPanel(); }}
        onFieldsChanged={setFields}
      />
    </PersonalListSurface.Provider>
  );
}
