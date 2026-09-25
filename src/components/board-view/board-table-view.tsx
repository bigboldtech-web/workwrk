"use client";

// BoardTableView — Phase 3b TABLE renderer for studio-item Boards.
//
// Renders a clean flat-table layout matching the ClickUp/Monday
// aesthetic the user committed to on 2026-06-02:
//   - One whitespace-driven row per item, no decorative borders.
//   - Title is inline-editable on click (input blur saves).
//   - Status is a pill picker with the default palette.
//   - "+ Add row" inline at the bottom (and one slim "+ New row"
//     button at the top of the action bar).
//
// Column set this phase: Name (title) · Status · Owner · Created.
// Phase 3c will replace the hardcoded set with the field shelf that
// reads Board.schema.fields.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash2, X, ChevronDown, Layers, MessageSquare, Paperclip, GripVertical, MoreHorizontal, CalendarPlus, Pencil, Network, Columns3, Search, ArrowUpDown, UserCheck, Download, ArrowUp, ArrowDown, EyeOff, ChevronsLeft, ChevronsRight, Settings2, FileText, Link2, BookOpen, Clock, Repeat, Pin, PinOff } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { buildRecurrenceSummary } from "@/lib/recurrence";
import {
  PRIORITY_OPTIONS,
  buildSubtaskBody,
  isDoneStatus,
  splitBulkResults,
  bulkFailureMessage,
  type BoardItemRow,
  type StatusOption,
  type ItemTag,
} from "@/lib/board-items-shared";
import { isBuiltinShown, catalogEntryForField, BUILTIN_COLUMN_BY_KEY, type FieldDef } from "@/lib/field-catalog";
import { isConnectField } from "@/lib/list-connect";
import {
  boardStatusFor,
  itemsUrl,
  linkedMenuFlags,
  linkedRowEditable,
  linkedRowKind,
  mergeRefetchedRow,
  optimisticLinkedStatus,
  planBulkStatus,
  refetchedFromRow,
  statusPickerFor,
  writeContext,
} from "@/lib/list-link-rows";
import { MAX_PINNED_COLUMNS, ROW_HEIGHTS, type RowColorRule, type RowHeight } from "@/lib/list-comfort";
import { applyDefaultsToCreateBody, type LoadedListSettings } from "@/lib/list-defaults-client";
import { ROW_COLOR_TINT, orderColumnsForPinning, rowHeightStyle, stickyOffsets } from "@/lib/table-comfort";
import { viewConfigQueue } from "@/lib/view-config-queue";
import { rowColorFor } from "@/lib/work/filter-rules";
import { RowHeightMenu } from "./row-height-menu";
import { fieldConfigMessage } from "./connect-field-config";
import type { LucideIcon } from "lucide-react";
import { AssigneePicker, MultiAssigneePicker, PersonAvatar, type PersonRef } from "./assignee-picker";
import { rowAssigneeIds } from "./board-filter-bar";
import { FieldValue } from "./field-value";
import { PriorityPicker } from "./priority-picker";
import { TagPicker } from "./tag-picker";
import { useItemTypes, type ItemTypeLite } from "./use-item-types";
import { useAnchorPos } from "./use-anchor-pos";
import { StatusGlyph } from "./status-glyph";
import { itemTypeIcon } from "@/lib/item-type-icons";
import type { FieldChoice } from "@/lib/field-catalog";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ItemMoreMenu, type ItemMenuListContext } from "./item-more-menu";
import type { ItemRole } from "@/lib/item-role";
import { accessMessage } from "@/lib/access-message";
import { DatePlanner } from "./date-planner";
import { BulkActionBar } from "./bulk-action-bar";
import { localDayIso } from "@/lib/item-date";
import { MorePortal, type ContextMenuHandle } from "@/components/layout/os/more-portal";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { ComingSoonRow, UpcomingOnly } from "@/components/ui/coming-soon-row";

interface BoardTableViewProps {
  boardId: string;
  /** Phase 74 — view this table is rendering inside. Used for config
   *  persistence (groupBy etc.). Null when no view exists yet. */
  viewId?: string | null;
  viewConfig?: Record<string, unknown>;
  initialItems: BoardItemRow[];
  /** Custom fields from Board.schema.fields. Each becomes a column. */
  initialFields?: FieldDef[];
  /** Per-List statuses (backbone #1) — the board's own set. */
  statuses: StatusOption[];
  canEdit: boolean;
  /** Full access on the List. Only gates the row menu's Delete row, which is
   *  not an edit: it wants full access OR the task's own creator, so rendering
   *  it on `canEdit` gave every Member a control that always 403'd. */
  canDeleteTasks?: boolean;
  /** When set, clicking a row's title opens the row drawer. The
   *  parent owns drawer state; we just emit the id. */
  onOpenItem?: (itemId: string) => void;
  /** Opens the right-hand Fields panel (the toolbar "columns" icon). */
  onOpenFields?: () => void;
  /** Viewer id — powers the toolbar "Me" (assigned to me) quick filter. */
  currentUserId?: string | null;
  /** Right-aligned toolbar actions (Statuses / Fields / + Task) rendered on the
   *  same row as the group/subtask/columns icons, just below the view tabs. */
  toolbarActions?: React.ReactNode;
  /** The shared FilterMenu (owned by BoardCanvas, which applies the rules
   *  and persists them per-view) — rendered in the toolbar's filter spot. */
  filterSlot?: React.ReactNode;
  /** Opens the board's status editor — wired to the group-header "…"
   *  menu (Rename / New status / Edit statuses / Hide status). */
  onEditStatuses?: () => void;
  /** Per-view hidden keys incl. __builtin_* — hides default-on built-in
   *  columns (Assignee/Due/Priority) + custom fields. */
  hiddenBuiltins?: string[];
  /** Per-view turned-on optional built-in columns (Task Type/Tags/Created/
   *  Start date/Date updated/Task ID) — the "Properties" you opt into. */
  extraColumns?: string[];
  /** Column-header "Hide column" — toggles a key (custom field key or
   *  __builtin_*) in the view's hiddenFields list. Same setter the shelf uses. */
  onHideField?: (key: string) => void;
  /** Called after a header-menu field mutation (delete / move) so the parent
   *  re-fetches Board.schema.fields into its field state. */
  onFieldsChanged?: () => void;
  /** Item-state ownership contract (2026-08-12): the table keeps an optimistic
   *  local copy of `initialItems`, and re-syncs from the parent whenever that
   *  prop's identity changes. Any parent that re-renders items (BoardCanvas
   *  does on every drawer edit) MUST wire these four callbacks so its copy
   *  learns about every table-side mutation — otherwise its next re-render
   *  would clobber the local copy (created rows vanish, archived rows
   *  resurrect, edits revert). */
  onItemCreated?: (item: BoardItemRow) => void;
  onItemPatched?: (id: string, patch: Partial<BoardItemRow>) => void;
  onItemRemoved?: (id: string) => void;
  /** Failure-path refetches hand the fresh server list to the parent instead
   *  of trapping it locally (where the next parent resync would regress it). */
  onItemsRefreshed?: (items: BoardItemRow[]) => void;
  /** Time Tracking module — hides the row menu's "Start timer" when false. */
  timeTrackingEnabled?: boolean;
  /** "list" = ClickUp pills (default). "table" = Monday-style grid with
   *  full-cell colored status fills + always-on group summary. */
  gridStyle?: "list" | "table";
  /** Everything view — renders after the title inside the Name cell
   *  (e.g. the source-List chip on cross-board surfaces). */
  renderTitleSuffix?: (row: BoardItemRow) => React.ReactNode;
  /** Phase 5b, List comfort: the List's Conditional colors rules. */
  rowColorRules?: RowColorRule[];
  /** The List's defaults, keyed by the List they were read for (null until read). */
  loadedSettings?: LoadedListSettings | null;
  /** May this viewer save the view (Pin column, Row height)? */
  canSaveView?: boolean;
  /** The status a row has in THIS List (a linked row's home status, remapped). */
  statusOf?: (row: BoardItemRow) => string | null;
  /** The owner's Personal List: its tasks are never added to other Lists. */
  personalList?: boolean;
}

/** Patch shape rows can emit. `owner`/`tags` only update the local
 *  optimistic row — the API's zod schema strips unknown keys; `tagIds`
 *  is what the server persists. */
type RowPatch = Partial<Pick<BoardItemRow, "title" | "status" | "ownerId" | "owner" | "assigneeIds" | "assignees" | "priority" | "tags" | "startAt" | "dueAt" | "itemTypeId" | "recurRule">> & {
  tagIds?: string[];
  metadata?: Record<string, unknown>;
  /**
   * One key of `metadata`, changed without touching the rest of it.
   *
   * `metadata` is a WHOLESALE replace (src/app/api/items/[id]/route.ts:243).
   * A cell that spreads this page's cached copy of the blob and sends the
   * whole thing reverts `metadata.description`, the task body, plus
   * `metadata.legacyTask` and `metadata.legacyTaskId`, the migration's own
   * markers, to whatever they were when this page loaded. `metadataPatch` is
   * merged over the STORED blob inside the request, so a stale page can only
   * change the key it means to. An empty value means "remove this key", which
   * the server reads as `null`.
   */
  metadataPatch?: Record<string, unknown>;
};

/** The optimistic twin of the server-side metadataPatch merge. */
function mergeMetadata(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}

// Toolbar sort (ported from the Personal List).
type SortKey = "none" | "title" | "due" | "created" | "priority";
function compareRows(a: BoardItemRow, b: BoardItemRow, key: SortKey): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title);
    case "due": {
      const av = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bv = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      return av - bv;
    }
    case "created": {
      const av = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bv = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return av - bv;
    }
    case "priority": {
      const rank = (p: string | null | undefined) => {
        const i = PRIORITY_OPTIONS.findIndex((o) => o.value === p);
        return i < 0 ? PRIORITY_OPTIONS.length : i;
      };
      return rank(a.priority) - rank(b.priority);
    }
    default:
      return 0;
  }
}

// Header-menu sort — compares any column (built-in or custom field). Returns a
// signed number; the caller flips it for descending. Missing values sort last
// for ascending (Infinity / "" handled per type).
function compareByColumn(a: BoardItemRow, b: BoardItemRow, key: string, statuses: StatusOption[]): number {
  const val = (row: BoardItemRow): string | number => {
    switch (key) {
      case "name": return row.title.toLowerCase();
      case "status": {
        const i = statuses.findIndex((s) => s.value === row.status);
        return i < 0 ? statuses.length : i;
      }
      case "owner": {
        const o = row.owner;
        return o ? `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim().toLowerCase() : "￿";
      }
      case "due": return row.dueAt ? new Date(row.dueAt).getTime() : Infinity;
      case "created": return row.createdAt ? new Date(row.createdAt).getTime() : Infinity;
      case "start": return row.startAt ? new Date(row.startAt).getTime() : Infinity;
      case "updated": return row.updatedAt ? new Date(row.updatedAt).getTime() : Infinity;
      case "taskid": return row.id;
      case "comments": return row.commentCount ?? 0;
      case "timeline": return row.startAt ? new Date(row.startAt).getTime() : (row.dueAt ? new Date(row.dueAt).getTime() : Infinity);
      case "time": return row.timeTrackedMs ?? 0;
      case "createdby": { const c = row.createdBy; return c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim().toLowerCase() : "￿"; }
      case "docs": return row.linkedDocCount ?? 0;
      case "linked": return row.linkedTaskCount ?? 0;
      case "sops": return row.linkedSopCount ?? 0;
      case "priority": {
        const i = PRIORITY_OPTIONS.findIndex((o) => o.value === row.priority);
        return i < 0 ? PRIORITY_OPTIONS.length : i;
      }
      case "type": return row.itemTypeId ?? "￿";
      case "tags": return (row.tags ?? []).map((t) => t.name).join(",").toLowerCase() || "￿";
      default: {
        const v = row.metadata?.[key];
        if (v == null || v === "") return "￿";
        return typeof v === "number" ? v : String(v).toLowerCase();
      }
    }
  };
  const av = val(a);
  const bv = val(b);
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

// Built-in column key → the `hiddenFields` key used to hide it (shared with the
// Fields shelf "Built-in fields" toggles). Name + Status aren't hideable here.
const BUILTIN_HIDE_KEY: Record<string, string> = {
  owner: "__builtin_owner", due: "__builtin_due", priority: "__builtin_priority",
  type: "__builtin_type", tags: "__builtin_tags", created: "__builtin_created",
  start: "__builtin_start", updated: "__builtin_updated", taskid: "__builtin_taskid",
  comments: "__builtin_comments", timeline: "__builtin_timeline",
  time: "__builtin_time", createdby: "__builtin_createdby",
  docs: "__builtin_docs", linked: "__builtin_linked", sops: "__builtin_sops",
};

// What a column-header menu can do for one column. Undefined callbacks hide
// their menu item, so each column shows only the actions that apply to it.
type ColMenuCtx = {
  sortDir: "asc" | "desc" | null;
  grouped: boolean;
  onSort: (dir: "asc" | "desc" | null) => void;
  onGroup?: () => void;
  onHide?: () => void;
  onMoveStart?: () => void;
  onMoveEnd?: () => void;
  onEditStatuses?: () => void;
  onEditField?: () => void;
  onDeleteField?: () => void;
  onAddColumn?: () => void;
  /** Phase 5b: Pin / Unpin (only for a viewer who may save the view). */
  pinned?: boolean;
  onTogglePin?: () => void;
};

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Column widths: leading checkbox column, and the actions column's floor.
const LEADING_W = 34;
const ACTIONS_MIN_W = 44;

// Phase 5b: what a bulk refusal of a row shown here THROUGH A LINK means.
const LINKED_ARCHIVE_REFUSED = "Tasks shown here from other Lists can't be archived or deleted from this List. Remove them from this List instead, or open their home List.";

/** The two Phase 5b per-row bulk refusals, as sentences for the banner. */
function bulkReasonSentences(reasons: string[]): string {
  const out: string[] = [];
  if (reasons.includes("invalid_status")) out.push("Some tasks from other Lists weren't changed because that status isn't one of their home List's statuses.");
  if (reasons.includes("use_list_link")) out.push(LINKED_ARCHIVE_REFUSED);
  return out.length ? ` ${out.join(" ")}` : "";
}

export function BoardTableView({ boardId, viewId, viewConfig, initialItems, initialFields, statuses, canEdit, canDeleteTasks, onOpenItem, onEditStatuses, onOpenFields, currentUserId, toolbarActions, filterSlot, hiddenBuiltins, extraColumns, onHideField, onFieldsChanged, onItemCreated, onItemPatched, onItemRemoved, onItemsRefreshed, timeTrackingEnabled = true, gridStyle = "list", renderTitleSuffix, rowColorRules = [], loadedSettings = null, canSaveView = false, statusOf: statusOfProp, personalList = false }: BoardTableViewProps) {
  const confirm = useConfirm();
  const monday = gridStyle === "table";
  // The status a row has IN THIS LIST. A row shown here through a link keeps
  // its HOME status, remapped into this List's set for grouping and colour.
  const statusOf = useCallback(
    (row: BoardItemRow) => (statusOfProp ? statusOfProp(row) : boardStatusFor(row, boardId, statuses)),
    [statusOfProp, boardId, statuses],
  );
  // Custom-field columns, ordered by their saved `position` (matches the Fields
  // shelf) so the header "Move to start / end" reorders visibly. Memoized so it
  // doesn't churn the many downstream useMemo deps on every render.
  const customFields: FieldDef[] = useMemo(
    () => [...(initialFields ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [initialFields],
  );
  const { byId: itemTypeMap, list: itemTypeList, default: defaultItemType } = useItemTypes();
  // Built-in column visibility — one model shared with the Fields panel
  // (isBuiltinShown): Assignee/Due/Priority default-on (hide via hiddenFields);
  // Task Type/Tags/Created/Start/Updated/Task ID default-off (turn on via the
  // Fields → Properties toggles, tracked in extraColumns). The List stays lean
  // by default; users opt into the spreadsheet columns.
  const hideBuiltin = useMemo(() => new Set(hiddenBuiltins ?? []), [hiddenBuiltins]);
  const extraSet = useMemo(() => new Set(extraColumns ?? []), [extraColumns]);
  const showOwner = isBuiltinShown("__builtin_owner", hideBuiltin, extraSet);
  const showDue = isBuiltinShown("__builtin_due", hideBuiltin, extraSet);
  const showPriority = isBuiltinShown("__builtin_priority", hideBuiltin, extraSet);
  const showType = isBuiltinShown("__builtin_type", hideBuiltin, extraSet);
  const showTags = isBuiltinShown("__builtin_tags", hideBuiltin, extraSet);
  const showCreated = isBuiltinShown("__builtin_created", hideBuiltin, extraSet);
  const showStart = isBuiltinShown("__builtin_start", hideBuiltin, extraSet);
  const showUpdated = isBuiltinShown("__builtin_updated", hideBuiltin, extraSet);
  const showTaskId = isBuiltinShown("__builtin_taskid", hideBuiltin, extraSet);
  const showComments = isBuiltinShown("__builtin_comments", hideBuiltin, extraSet);
  const showTimeline = isBuiltinShown("__builtin_timeline", hideBuiltin, extraSet);
  const showTime = isBuiltinShown("__builtin_time", hideBuiltin, extraSet);
  const showCreatedBy = isBuiltinShown("__builtin_createdby", hideBuiltin, extraSet);
  const showDocs = isBuiltinShown("__builtin_docs", hideBuiltin, extraSet);
  const showLinked = isBuiltinShown("__builtin_linked", hideBuiltin, extraSet);
  const showSops = isBuiltinShown("__builtin_sops", hideBuiltin, extraSet);
  // New rows default to the board's first status (its "not started").
  const firstStatus = statuses[0]?.value ?? "TO_DO";
  // The List's default status and task type, once its settings have loaded
  // for THIS List, so the add row shows what a new task will get.
  const listDefaults = loadedSettings && loadedSettings.boardId === boardId ? loadedSettings.defaults : null;
  const listDefaultStatus = listDefaults?.status && loadedSettings?.statuses.some((st) => st.value === listDefaults.status)
    ? listDefaults.status
    : null;
  const listDefaultTypeId = listDefaults?.itemTypeId && itemTypeList.some((t) => t.id === listDefaults.itemTypeId)
    ? listDefaults.itemTypeId
    : null;
  const [items, setItems] = useState<BoardItemRow[]>(initialItems);
  // The rows as they are NOW, for the write handlers below: a row's kind (home
  // or shown through a link) decides what its write carries.
  const itemsRef = useRef<BoardItemRow[]>(initialItems);
  useEffect(() => { itemsRef.current = items; }, [items]);
  // Set while a create request is in flight (the inline add rows show their own
  // busy state, so we only need the setter here).
  const [, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Item-state ownership (2026-08-12) ────────────────────────────────────
  // Rows created/removed locally while the parent has NOT wired the matching
  // callback are tracked here so the initialItems resync effect can re-apply
  // them over a stale parent snapshot instead of silently dropping created
  // rows / resurrecting removed ones. Entries settle (stop being tracked)
  // once an incoming snapshot reflects them.
  const unreportedAddsRef = useRef<Map<string, BoardItemRow>>(new Map());
  const unreportedRemovesRef = useRef<Set<string>>(new Set());
  /** Report a server-confirmed create to the parent (or track it if unwired). */
  const reportCreated = useCallback((item: BoardItemRow) => {
    if (onItemCreated) onItemCreated(item);
    else unreportedAddsRef.current.set(item.id, item);
  }, [onItemCreated]);
  /** Report an archive/hard-delete to the parent (or track it if unwired). */
  const reportRemoved = useCallback((id: string) => {
    unreportedAddsRef.current.delete(id);
    if (onItemRemoved) onItemRemoved(id);
    else unreportedRemovesRef.current.add(id);
  }, [onItemRemoved]);
  /** Failure-path refetch landed fresh server truth: give it to the parent
   *  (its resync flows back down); only keep it locally when unwired. */
  const reportRefreshed = useCallback((fresh: BoardItemRow[]) => {
    unreportedAddsRef.current.clear();
    unreportedRemovesRef.current.clear();
    if (onItemsRefreshed) onItemsRefreshed(fresh);
    else setItems(fresh);
  }, [onItemsRefreshed]);

  // Instant cross-surface insert: the top-right "+ task" modal (and any other
  // creator) fires `workwrk:item-created` after a create. If it landed on THIS
  // board, drop the row in immediately instead of waiting on router.refresh()'s
  // server round-trip. reportCreated tracks it so the resync can't drop it
  // before the next server snapshot includes it.
  useEffect(() => {
    const onCreated = (e: Event) => {
      const detail = (e as CustomEvent).detail as { boardId?: string; item?: BoardItemRow } | undefined;
      const item = detail?.item;
      if (!item || detail?.boardId !== boardId) return;
      setItems((prev) => (prev.some((r) => r.id === item.id) ? prev : [...prev, item]));
      reportCreated(item);
    };
    window.addEventListener("workwrk:item-created", onCreated);
    return () => window.removeEventListener("workwrk:item-created", onCreated);
  }, [boardId, reportCreated]);

  // Column widths (resizable) — one fixed px per column keyed by column id
  // ("name", "status", "owner", "due", …). The Name column is the flexible
  // one: by default it fills whatever the meta columns leave, and dragging any
  // border resizes that column while the trailing actions column absorbs the
  // difference (so every column to the right shifts as a block, never collapses).
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const raw = (viewConfig as { colWidths?: unknown } | null)?.colWidths;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    // Sanitize: the earlier (broken) resize could persist collapsed widths.
    // Drop anything implausible so a previously-stuck view heals to defaults.
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const floor = k === "name" ? 160 : 70;
      if (v >= floor && v <= 1600) out[k] = Math.round(v);
    }
    return out;
  });
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);
  // Which widths a PERSON actually dragged. The Name column's width is also
  // written into this map automatically (it is the fill column, and freezing it
  // is what stops a meta-column resize from silently stealing from it), and
  // that auto value used to be persisted alongside the dragged one: a first
  // paint measured while the container was still narrow froze Name at its 220
  // floor, and the next drag of ANY column wrote that 220 into the saved view
  // for everybody, for good. Only a dragged width is saved now.
  const userSizedRef = useRef<Set<string>>(new Set(Object.keys(
    ((viewConfig as { colWidths?: Record<string, number> } | null)?.colWidths) ?? {},
  )));
  // Measured width of the scroll container — used to give Name a sensible
  // "fill" default and to clamp drags so the columns always fit (the actions
  // column keeps at least ACTIONS_MIN, so nothing can be squeezed to zero).
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Group-by axis seeded from the saved view config (Phase 74). Null
  // means "no grouping" — strings can be "status" / "owner" / a field key.
  const initialGroupBy = (() => {
    const raw = viewConfig?.groupBy;
    if (raw === null || raw === undefined) return null;
    return typeof raw === "string" ? raw : null;
  })();
  const [groupBy, setGroupByState] = useState<string | null>(initialGroupBy);

  // The List always shows the status as an inline circle before the task name
  // (click it to change status / task type) — never a separate Status column.
  // Only the Monday-style Table keeps a Status column.
  const showStatus = monday;

  // Direction for the grouped buckets. Default ascending. Persists per-view.
  const initialGroupDir: "asc" | "desc" = (() => {
    const raw = viewConfig?.groupDirection;
    return raw === "desc" ? "desc" : "asc";
  })();
  const [groupDirection, setGroupDirectionState] = useState<"asc" | "desc">(initialGroupDir);

  // Every view setting this table saves (group by and its direction, sort,
  // widths, pins, row height) goes through the view's ONE save queue, the same
  // one BoardCanvas saves filters and columns through: patches merge, one is
  // in flight at a time, and a failed key stays dirty until it lands (the
  // canvas shows the failure with a Try again). The local Object.assign
  // mirror stays, so a renderer that writes the whole config still carries
  // every key saved here.
  const viewQueue = useMemo(() => (viewId ? viewConfigQueue(boardId, viewId) : null), [boardId, viewId]);
  const persistView = useCallback((patch: Record<string, unknown>) => {
    if (!viewQueue) return;
    const cfg = viewConfig ?? {};
    Object.assign(cfg, patch);
    viewQueue.enqueue(patch);
  }, [viewQueue, viewConfig]);

  // ── View comfort (Phase 5b, gap 14): pinned columns and row height ────
  // Read from the view for everyone; written only by someone who may save the
  // view. Nothing pinned and the default height is exactly today's table.
  const [pinnedColumns, setPinnedColumns] = useState<string[]>(() => {
    const raw = (viewConfig as { pinnedColumns?: unknown } | undefined)?.pinnedColumns;
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string").slice(0, MAX_PINNED_COLUMNS) : [];
  });
  const [rowHeight, setRowHeight] = useState<RowHeight>(() => {
    const raw = (viewConfig as { rowHeight?: unknown } | undefined)?.rowHeight;
    return typeof raw === "string" && (ROW_HEIGHTS as readonly string[]).includes(raw) ? (raw as RowHeight) : "default";
  });
  // The save runs OUTSIDE the state updater: React may call an updater twice
  // (it does in development), and a save inside one was sent twice.
  const togglePin = useCallback((key: string) => {
    const next = pinnedColumns.includes(key)
      ? pinnedColumns.filter((k) => k !== key)
      : [...pinnedColumns, key].slice(0, MAX_PINNED_COLUMNS);
    setPinnedColumns(next);
    persistView({ pinnedColumns: next.length ? next : null });
  }, [persistView, pinnedColumns]);
  const changeRowHeight = useCallback((next: RowHeight) => {
    setRowHeight(next);
    persistView({ rowHeight: next === "default" ? null : next });
  }, [persistView]);

  const setGroupBy = useCallback((next: string | null) => {
    setGroupByState(next);
    persistView({ groupBy: next });
  }, [persistView]);

  const setGroupDirection = useCallback((next: "asc" | "desc") => {
    setGroupDirectionState(next);
    persistView({ groupDirection: next });
  }, [persistView]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Multi-select state for bulk actions (Phase 70).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Drag-to-reorder state (Phase 71). Disabled while grouped — cross-
  // group drag is ambiguous (would change the row's group value too).
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Phase 73 — expanded subtask sets per parent. Closed by default.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  // Quick search (toolbar magnifier) — filters rows by title.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Sort (toolbar) — ported from the Personal List: none/title/due/created/priority.
  const [sortKey, setSortKey] = useState<SortKey>("none");
  // Column-header sort — any column, asc/desc. Takes precedence over the toolbar
  // sort when set. Persisted per-view alongside groupBy / colWidths.
  const initialSortCol = (() => {
    const raw = viewConfig?.sortCol as { key?: unknown; dir?: unknown } | null | undefined;
    if (raw && typeof raw.key === "string" && (raw.dir === "asc" || raw.dir === "desc")) {
      return { key: raw.key, dir: raw.dir as "asc" | "desc" };
    }
    return null;
  })();
  const [sortCol, setSortColState] = useState<{ key: string; dir: "asc" | "desc" } | null>(initialSortCol);
  const setSortCol = useCallback((next: { key: string; dir: "asc" | "desc" } | null) => {
    setSortColState(next);
    persistView({ sortCol: next });
  }, [persistView]);

  // Column-header "Delete field" — drops the field def (values stay in metadata,
  // per the existing DELETE semantics) and asks the parent to refetch fields.
  const deleteField = useCallback(async (key: string) => {
    const ok = await confirm({
      title: "Delete column",
      description: "Delete this field? Existing values stay in the item data but won't be shown.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/fields/${encodeURIComponent(key)}`, { method: "DELETE" });
      if (res.ok) {
        onFieldsChanged?.();
        return;
      }
      // A refusal is a sentence: a Connect column that a Mirror reads
      // through names the Mirrors to remove first.
      const data = await res.json().catch(() => null);
      setError(fieldConfigMessage(data, "Couldn't delete that field.", customFields));
    } catch {
      setError("Couldn't reach the server. The field was not deleted.");
    }
  }, [boardId, confirm, onFieldsChanged, customFields]);

  // Column-header "Move to start / end" — set the field's position just past the
  // current extreme so the position-sorted column order reflects it after refetch.
  const moveField = useCallback(async (key: string, toStart: boolean) => {
    const positions = customFields.map((f) => f.position ?? 0);
    const target = toStart ? Math.min(0, ...positions) - 1 : Math.max(0, ...positions) + 1;
    try {
      const res = await fetch(`/api/boards/${boardId}/fields/${encodeURIComponent(key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: target }),
      });
      if (res.ok) onFieldsChanged?.();
    } catch { /* ignore */ }
  }, [boardId, customFields, onFieldsChanged]);
  // "Me" quick filter — only rows assigned to the viewer. (Rule-based
  // filters moved up to BoardCanvas — see the shared FilterMenu.)
  const [mineOnly, setMineOnly] = useState(false);

  // Split top-level items from subtasks for the render. Subtasks are
  // rendered indented below their parent when expanded.
  const { topLevel, childrenByParent } = useMemo(() => {
    const top: BoardItemRow[] = [];
    const byParent = new Map<string, BoardItemRow[]>();
    // A subtask whose parent isn't in this set (e.g. the parent was archived)
    // would otherwise land in byParent under a key with no top-level row and
    // vanish from the board entirely. Re-root such orphans to top-level so a
    // live subtask is never silently hidden — same rule the hierarchy view uses.
    const presentIds = new Set(items.map((it) => it.id));
    for (const it of items) {
      if (it.parentItemId && presentIds.has(it.parentItemId)) {
        const arr = byParent.get(it.parentItemId) ?? [];
        arr.push(it);
        byParent.set(it.parentItemId, arr);
      } else {
        top.push(it);
      }
    }
    // Sort children by position so reorder within a parent works.
    for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position);
    // Quick search — keep a top-level row if its title matches or any of its
    // subtasks match.
    const q = query.trim().toLowerCase();
    let topFiltered = q
      ? top.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            (byParent.get(r.id) ?? []).some((c) => c.title.toLowerCase().includes(q)),
        )
      : top;
    if (mineOnly && currentUserId) {
      // "Me" means "I am ON this task", not "I am the primary". Matching
      // ownerId alone hid every task where somebody else was primary and the
      // viewer was a secondary assignee.
      topFiltered = topFiltered.filter((r) => rowAssigneeIds(r).includes(currentUserId));
    }
    const topSorted = sortCol
      ? [...topFiltered].sort((a, b) => {
          const r = compareByColumn(a, b, sortCol.key, statuses);
          return sortCol.dir === "desc" ? -r : r;
        })
      : sortKey === "none"
        // "No sorting" means board order, which is position order — the same
        // rule childrenByParent already follows. Relying on raw array order
        // here made a drag-reorder snap back whenever the parent re-synced.
        ? [...topFiltered].sort((a, b) => a.position - b.position)
        : [...topFiltered].sort((a, b) => compareRows(a, b, sortKey));
    return { topLevel: topSorted, childrenByParent: byParent };
  }, [items, query, sortKey, sortCol, statuses, mineOnly, currentUserId]);

  // CSV export of the currently visible (filtered/sorted) rows.
  function exportCsv() {
    const header = ["Name", "Status", "Assignee", "Priority", "Due date", "Date created"];
    const lines = [header.join(",")];
    for (const r of topLevel) {
      const status = statuses.find((s) => s.value === r.status)?.label ?? "";
      const owner = r.owner ? `${r.owner.firstName ?? ""} ${r.owner.lastName ?? ""}`.trim() : "";
      const due = r.dueAt ? new Date(r.dueAt).toLocaleDateString() : "";
      const created = r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "";
      lines.push([r.title, status, owner, r.priority ?? "", due, created].map(csvCell).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tasks.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const toggleExpand = useCallback((id: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // One endpoint owns what a copy carries (POST /api/items/[id]/duplicate).
  // The hand-rolled body this used to send dropped assigneeIds, tagIds, the
  // dates and the priority, so a duplicated task lost its people and its tags.
  // Failure-path and after-write re-read of this List, with its linked rows.
  const refetchList = useCallback(async () => {
    const fresh = await fetch(itemsUrl(boardId), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (fresh?.items) reportRefreshed(fresh.items);
  }, [boardId, reportRefreshed]);

  const handleDuplicate = useCallback(async (row: BoardItemRow) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/items/${row.id}/duplicate`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(accessMessage(data, "Couldn't duplicate this task."));
        return;
      }
      // A copy of a task shown here through a link lives in the original's
      // HOME, and appears here only if the copy was linked here too, so the
      // List is re-read rather than guessing.
      if (linkedRowKind(row, boardId) !== "home") {
        await refetchList();
        return;
      }
      if (data?.item) {
        setItems((prev) => [...prev, data.item]);
        reportCreated(data.item as BoardItemRow);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't duplicate this task.");
    }
  }, [canEdit, reportCreated, boardId, refetchList]);

  // Type-first: the inline subtask row passes the title the user typed — no
  // "New subtask" placeholder to rename afterward. Returns {ok,error} so the
  // inline row can surface failures and keep the cursor for the next one.
  const addSubtask = useCallback(async (
    parentId: string,
    parentStatus: string | null,
    title: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!canEdit) return { ok: false, error: "You don't have edit access to this list" };
    // Shared with the Kanban card's inline composer, so neither surface can
    // drift back to POSTing a placeholder title.
    const built = buildSubtaskBody({ title, parentId, parentStatus, fallbackStatus: firstStatus });
    if (!built) return { ok: false };
    // A subtask under a parent shown here through a link is created in the
    // PARENT's home (the server does that, and applies the home's defaults),
    // so this List's defaults never touch it. A subtask at home here inherits
    // its parent's status, which counts as chosen.
    const parent = itemsRef.current.find((r) => r.id === parentId);
    const parentLinked = parent ? linkedRowKind(parent, boardId) !== "home" : false;
    const body = parentLinked
      ? built
      : applyDefaultsToCreateBody(built as unknown as Record<string, unknown>, loadedSettings, new Set(parentStatus ? ["status"] : []), boardId);
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // accessMessage, not data.error: the item routes answer refusals as
        // machine codes ("Forbidden", "no_access" + a reason) on purpose, and
        // printing one is how a user came to read the literal word "Forbidden".
        const msg = accessMessage(data, `Save failed (HTTP ${res.status})`);
        setError(msg);
        return { ok: false, error: msg };
      }
      if (data?.item) {
        setItems((prev) => [...prev, data.item]);
        reportCreated(data.item as BoardItemRow);
        setExpandedParents((prev) => new Set(prev).add(parentId));
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add subtask";
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setAdding(false);
    }
  }, [boardId, canEdit, firstStatus, reportCreated, loadedSettings]);

  // Which parent's inline subtask input should grab focus next (set by the
  // hover "Add subtask" button, which also expands the parent).
  const [autoFocusSubtaskFor, setAutoFocusSubtaskFor] = useState<string | null>(null);

  // Re-sync if the parent ever passes a refreshed initial set — but
  // NON-destructively: the parent snapshot wins, then any local creates /
  // removals it has not heard about (unwired callbacks) are re-applied on
  // top. A row the parent knowingly filtered out stays filtered out; a row
  // it merely never learned of can no longer be dropped from the screen.
  useEffect(() => {
    setItems(() => {
      const adds = unreportedAddsRef.current;
      const removes = unreportedRemovesRef.current;
      if (adds.size === 0 && removes.size === 0) return initialItems;
      const incoming = new Set(initialItems.map((r) => r.id));
      for (const id of Array.from(adds.keys())) if (incoming.has(id)) adds.delete(id);
      for (const id of Array.from(removes)) if (!incoming.has(id)) removes.delete(id);
      let next = initialItems;
      if (removes.size > 0) next = next.filter((r) => !removes.has(r.id));
      if (adds.size > 0) next = [...next, ...adds.values()];
      return next;
    });
  }, [initialItems]);

  // Group axes the user can pick: built-in Status/Owner + any SELECT custom field.
  const groupOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [
      { key: "__none__", label: "No grouping" },
      { key: "status", label: "Status" },
      { key: "owner", label: "Assignee" },
      { key: "priority", label: "Priority" },
      { key: "type", label: "Type" },
    ];
    // Every column in the list is a valid grouping — select fields bucket by
    // their option, everything else buckets by its raw value.
    for (const f of customFields) {
      opts.push({ key: f.key, label: f.label });
    }
    return opts;
  }, [customFields]);

  // Bucket items by group-by key. Returns an ordered Array<[key, rows]>.
  // Subtasks are NOT bucketed independently — they render under their
  // parent's bucket regardless of their own field values.
  type Bucket = { key: string; label: string; color: string | null; rows: BoardItemRow[] };
  const buckets = useMemo<Bucket[] | null>(() => {
    if (!groupBy) return null;
    const groupKeyFor = (it: BoardItemRow): string => {
      if (groupBy === "status") return statusOf(it) ?? "__unset__";
      if (groupBy === "owner") return it.ownerId ?? "__unset__";
      if (groupBy === "priority") return it.priority ?? "__unset__";
      if (groupBy === "type") return it.itemTypeId ?? "__unset__";
      const raw = it.metadata?.[groupBy];
      return raw == null || raw === "" ? "__unset__" : String(raw);
    };
    const map = new Map<string, BoardItemRow[]>();
    for (const it of topLevel) {
      const k = groupKeyFor(it);
      const arr = map.get(k) ?? [];
      arr.push(it);
      map.set(k, arr);
    }
    const resolved: Bucket[] = [];
    if (groupBy === "status") {
      // Honor the board's own status order; rows whose status no longer
      // exists in the set (e.g. after an edit) keep a gray bucket of
      // their raw value instead of silently disappearing; Unset last.
      for (const opt of statuses) {
        const rows = map.get(opt.value) ?? [];
        if (rows.length > 0) {
          resolved.push({ key: opt.value, label: opt.label, color: opt.color, rows });
          map.delete(opt.value);
        }
      }
      const orphaned = Array.from(map.entries())
        .filter(([k]) => k !== "__unset__")
        .map(([k, rows]) => ({ key: k, label: k, color: "#A1A1AA" as string | null, rows }));
      orphaned.sort((a, b) => a.label.localeCompare(b.label));
      resolved.push(...orphaned);
      for (const o of orphaned) map.delete(o.key);
    } else if (groupBy === "priority") {
      // Honor URGENT→LOW severity order; Unset (no priority) appends last.
      for (const opt of PRIORITY_OPTIONS) {
        const rows = map.get(opt.value) ?? [];
        if (rows.length > 0) {
          resolved.push({ key: opt.value, label: opt.label, color: opt.color, rows });
          map.delete(opt.value);
        }
      }
    } else if (groupBy === "owner") {
      // Order by owner name (best-effort using row.owner from the first
      // item in each bucket).
      const tuples = Array.from(map.entries()).map(([k, rows]) => {
        const owner = rows[0]?.owner ?? null;
        const label = owner
          ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || "Unknown"
          : k === "__unset__" ? "Unassigned" : "Unknown";
        return { key: k, label, color: null as string | null, rows };
      });
      tuples.sort((a, b) => a.label.localeCompare(b.label));
      resolved.push(...tuples);
      map.clear();
    } else if (groupBy === "type") {
      // Group by item type — label via the type map; untyped rows last.
      const tuples = Array.from(map.entries()).map(([k, rows]) => {
        const t = k !== "__unset__" ? itemTypeMap.get(k) : null;
        const label = t ? t.singular : k === "__unset__" ? "No type" : "Unknown";
        return { key: k, label, color: null as string | null, rows };
      });
      tuples.sort((a, b) => a.label.localeCompare(b.label));
      resolved.push(...tuples);
      map.clear();
    } else {
      // Custom SELECT field — use field.options to resolve label + color.
      const field = customFields.find((f) => f.key === groupBy);
      const optionByValue = new Map<string, { label: string; color?: string }>();
      // Grouping is allowed on any field now, so options may be absent or a
      // non-array shape — guard so a for..of never throws ("not iterable").
      const rawFieldOpts = field && "options" in field ? (field as { options?: unknown }).options : undefined;
      const fieldOpts: Array<{ value: string; label: string; color?: string }> = Array.isArray(rawFieldOpts) ? rawFieldOpts : [];
      for (const o of fieldOpts) optionByValue.set(o.value, o);
      for (const opt of fieldOpts) {
        const rows = map.get(opt.value) ?? [];
        if (rows.length > 0) {
          resolved.push({ key: opt.value, label: opt.label, color: opt.color ?? null, rows });
          map.delete(opt.value);
        }
      }
      // Any leftover unmatched values (custom user input) append alphabetically.
      const leftover = Array.from(map.entries())
        .filter(([k]) => k !== "__unset__")
        .map(([k, rows]) => ({ key: k, label: k, color: null as string | null, rows }));
      leftover.sort((a, b) => a.label.localeCompare(b.label));
      resolved.push(...leftover);
      map.delete("__unset__"); // handled below
    }
    const unsetRows = (groupBy === "status" ? null : map.get("__unset__")) ?? [];
    // status branch may have left __unset__ in the map; pick it up here
    const statusUnset = groupBy === "status" ? map.get("__unset__") ?? [] : [];
    const finalUnset = unsetRows.length > 0 ? unsetRows : statusUnset;
    if (finalUnset.length > 0) {
      resolved.push({ key: "__unset__", label: "Unset", color: "#A1A1AA", rows: finalUnset });
    }
    if (groupDirection === "desc") resolved.reverse();
    return resolved;
  }, [groupBy, topLevel, customFields, groupDirection, statuses, itemTypeMap, statusOf]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Shift-click range anchor — the last row toggled without shift.
  const lastSelectedRef = useRef<string | null>(null);
  const toggleRow = useCallback((id: string, shiftKey?: boolean) => {
    // Shift-click: select every visible row between the anchor and this one.
    // Range runs over the filtered/sorted top-level order (grouping caveat: the
    // range follows list order, not the on-screen group order).
    if (shiftKey && lastSelectedRef.current && lastSelectedRef.current !== id) {
      const order = topLevel.map((r) => r.id);
      const a = order.indexOf(lastSelectedRef.current);
      const b = order.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = order.slice(lo, hi + 1);
        setSelected((prev) => { const next = new Set(prev); range.forEach((rid) => next.add(rid)); return next; });
        lastSelectedRef.current = id;
        return;
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    lastSelectedRef.current = id;
  }, [topLevel]);
  const clearSelection = useCallback(() => { setSelected(new Set()); lastSelectedRef.current = null; }, []);
  const selectAllVisible = useCallback(() => {
    // A row shown here through a link the viewer may only read carries no
    // checkbox, so select-all leaves it out too.
    setSelected(new Set(items.filter((i) => linkedRowEditable(i, canEdit)).map((i) => i.id)));
  }, [items, canEdit]);

  // Bulk actions — each runs one request per id over /api/items/[id] since no
  // server-side bulk endpoint exists yet. The local (and parent-reported)
  // mutation applies ONLY to ids whose request genuinely succeeded (fulfilled
  // AND res.ok — an HTTP error resolves fulfilled, so rejections alone lie).
  // Failed ids stay visible, unmutated and selected, and get named in the
  // error banner so the user can retry.
  // A row shown here THROUGH A LINK is archived or trashed with `?list=` set
  // to this List, so the server refuses it (use_list_link) rather than
  // archiving the task everywhere from a List that only shows it; the banner
  // then says why and what to do instead.
  const linkedIdsOf = useCallback((ids: string[]) => {
    const byId = new Map(itemsRef.current.map((r) => [r.id, r] as const));
    return new Set(ids.filter((id) => { const r = byId.get(id); return r ? linkedRowKind(r, boardId) !== "home" : false; }));
  }, [boardId]);

  const bulkArchive = useCallback(async () => {
    if (selected.size === 0) return;
    if (!(await confirm({ title: "Archive tasks", description: `Archive ${selected.size} task${selected.size === 1 ? "" : "s"}? You can restore them from Trash.`, destructive: true, confirmLabel: "Archive" }))) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const linked = linkedIdsOf(ids);
    const { succeeded, failed } = await splitBulkResults(ids, (id) =>
      fetch(`/api/items/${id}${linked.has(id) ? `?list=${encodeURIComponent(boardId)}` : ""}`, { method: "DELETE" }),
    );
    const linkedFailed = failed.some((id) => linked.has(id));
    setError(failed.length > 0 ? `${bulkFailureMessage("archive", failed, ids.length, items)}${linkedFailed ? ` ${LINKED_ARCHIVE_REFUSED}` : ""}` : null);
    const ok = new Set(succeeded);
    setItems((prev) => prev.filter((r) => !ok.has(r.id)));
    for (const id of succeeded) reportRemoved(id);
    setSelected(new Set(failed));
    setBulkBusy(false);
  }, [selected, confirm, reportRemoved, items, linkedIdsOf, boardId]);

  // Drag-to-reorder. Computes fractional midpoint position so we never
  // renumber the whole list — Linear/Folder pattern. Optimistic local
  // update + PATCH.
  const reorder = useCallback(async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const dragged = items.find((r) => r.id === draggedId);
    const kind = dragged ? linkedRowKind(dragged, boardId) : "home";
    // A subtask shown through its linked parent has no place of its own here.
    if (kind === "linked-subtask") return;
    const sorted = [...items].sort((a, b) => a.position - b.position);
    const draggedIdx = sorted.findIndex((r) => r.id === draggedId);
    const targetIdx = sorted.findIndex((r) => r.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;
    // Insert dragged BEFORE target. If dragging downward we land in the
    // slot vacated by the source so the midpoint math stays the same.
    const insertBefore = sorted[targetIdx];
    const insertBeforeIdx = targetIdx;
    let newPos: number;
    if (insertBeforeIdx === 0) {
      newPos = insertBefore.position - 1;
    } else {
      // The row physically before the target (in the current sort) — skip
      // the dragged row itself if it's adjacent.
      const candidates = sorted.slice(0, insertBeforeIdx).filter((r) => r.id !== draggedId);
      const before = candidates[candidates.length - 1];
      newPos = before ? (before.position + insertBefore.position) / 2 : insertBefore.position - 1;
    }
    // A task shown here through a link moves its LINK's place in this List
    // (PATCH /api/boards/[id]/links/[itemId]); the task's own position is its
    // home List's order and is never touched from here.
    const linkPatch = kind === "linked-root" && dragged?.listLink ? { listLink: { ...dragged.listLink, position: newPos } } : {};
    setItems((prev) =>
      [...prev.map((r) => (r.id === draggedId ? { ...r, position: newPos, ...linkPatch } : r))]
        .sort((a, b) => a.position - b.position),
    );
    onItemPatched?.(draggedId, { position: newPos, ...linkPatch });
    // Revert (refetch the board) on ANY failure — a network throw OR a
    // non-OK response (403/400). Without the res.ok check a server-rejected
    // reorder stayed applied locally while the server kept the old order.
    const revert = async () => {
      const fresh = await fetch(itemsUrl(boardId)).then((r) => r.json()).catch(() => null);
      if (fresh?.items) reportRefreshed(fresh.items);
    };
    try {
      const res = await fetch(kind === "linked-root" ? `/api/boards/${boardId}/links/${draggedId}` : `/api/items/${draggedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: newPos }),
      });
      if (!res.ok) await revert();
    } catch {
      await revert();
    }
  }, [items, boardId, onItemPatched, reportRefreshed]);

  // Shared bulk-PATCH runner: `body` goes to the API, `local` is the display
  // patch merged into rows whose request succeeded.
  //
  // ONE REQUEST, not one per row (spec-spaces-lists section 2, the bulk bar).
  // This used to fan out one `PATCH /api/items/[id]` per selected id, so forty
  // tasks meant forty requests and forty gates, and a selection that spanned a
  // List the viewer can only read looked like it had worked. `/api/items/bulk`
  // gates each row on its own and returns a per-id report, which is what lets
  // the failed ids stay selected with an honest message.
  //
  // Phase 5b: every bulk request names this List (`contextBoardId`), so a row
  // shown here through a link is written in this List's context and the
  // server can refuse what only its home may do; a row whose home is here
  // reads the same id as its home and behaves exactly as before.
  const runBulk = useCallback(async (ids: string[], patch: Record<string, unknown>): Promise<{ succeeded: string[]; failed: string[]; reasons: string[] }> => {
    try {
      const res = await fetch("/api/items/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, patch, contextBoardId: boardId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { results?: Array<{ id: string; ok: boolean; reason?: string }> }
        | null;
      if (res.ok && Array.isArray(data?.results)) {
        return {
          succeeded: data.results.filter((r) => r.ok).map((r) => r.id),
          failed: data.results.filter((r) => !r.ok).map((r) => r.id),
          reasons: data.results.filter((r) => !r.ok && r.reason).map((r) => r.reason as string),
        };
      }
    } catch {
      // Network failure: nothing applied, everything stays selected.
    }
    return { succeeded: [], failed: ids, reasons: [] };
  }, [boardId]);

  const bulkPatch = useCallback(async (body: Record<string, unknown>, local: Partial<BoardItemRow>) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const touchesLinked = linkedIdsOf(ids).size > 0;
    const { succeeded, failed, reasons } = await runBulk(ids, body);
    setError(failed.length > 0 ? `${bulkFailureMessage("update", failed, ids.length, items)}${bulkReasonSentences(reasons)}` : null);
    const ok = new Set(succeeded);
    setItems((prev) => prev.map((r) => (ok.has(r.id) ? { ...r, ...local } : r)));
    for (const id of succeeded) onItemPatched?.(id, local);
    setSelected(new Set(failed));
    setBulkBusy(false);
    // A linked row's fields in this List live in this List's namespace, which
    // the local patch cannot know: the List is re-read.
    if (touchesLinked && succeeded.length > 0) await refetchList();
  }, [selected, onItemPatched, items, runBulk, linkedIdsOf, refetchList]);

  // A status across a selection that mixes both kinds of row: home rows get
  // this List's value, as today; each task shown here through a link gets the
  // HOME value it maps to, one request per distinct value; a linked task whose
  // home statuses are not shared with the viewer cannot be mapped, so it is
  // left as it is and the banner says so.
  const bulkStatus = useCallback(async (status: string) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const byId = new Map(itemsRef.current.map((r) => [r.id, r] as const));
    const rows = Array.from(selected).map((id) => byId.get(id)).filter((r): r is BoardItemRow => !!r);
    const plan = planBulkStatus(rows, status, boardId, statuses);
    const groups: Array<{ ids: string[]; status: string }> = [
      ...(plan.home.length ? [{ ids: plan.home, status }] : []),
      ...plan.linked,
    ];
    const succeeded: string[] = [];
    const failed: string[] = [];
    const reasons: string[] = [];
    for (const g of groups) {
      const r = await runBulk(g.ids, { status: g.status });
      succeeded.push(...r.succeeded);
      failed.push(...r.failed);
      reasons.push(...r.reasons);
    }
    const valueFor = new Map<string, string>();
    for (const g of groups) for (const id of g.ids) valueFor.set(id, g.status);
    const ok = new Set(succeeded);
    setItems((prev) => prev.map((r) => {
      if (!ok.has(r.id)) return r;
      const v = valueFor.get(r.id) ?? status;
      return linkedRowKind(r, boardId) === "home" ? { ...r, status: v } : optimisticLinkedStatus(r, v);
    }));
    for (const id of succeeded) {
      const row = byId.get(id);
      const v = valueFor.get(id) ?? status;
      onItemPatched?.(id, row && linkedRowKind(row, boardId) !== "home" ? optimisticLinkedStatus(row, v) : { status: v });
    }
    const messages: string[] = [];
    if (failed.length > 0) messages.push(`${bulkFailureMessage("update", failed, rows.length, items)}${bulkReasonSentences(reasons)}`);
    if (plan.skipped.length > 0) {
      messages.push(`${plan.skipped.length} task${plan.skipped.length === 1 ? "" : "s"} from other Lists weren't changed because their home List's statuses aren't shared with you.`);
    }
    setError(messages.length ? messages.join(" ") : null);
    setSelected(new Set([...failed, ...plan.skipped]));
    setBulkBusy(false);
    if (plan.linked.length > 0 && succeeded.length > 0) await refetchList();
  }, [selected, boardId, statuses, runBulk, onItemPatched, items, refetchList]);
  // "Set owner" and "Clear assignees" are two different writes, because an
  // ownerId-only patch MERGES on the server: it moves the named person to the
  // front of whoever is already on the task, and a null merely drops the
  // outgoing owner and promotes the next assignee. That is right for "set the
  // owner" and wrong for "nobody is assigned", which is why clearing sends an
  // explicit empty set instead. And because the merged result cannot be
  // computed here, an owner change re-reads the board rather than painting a
  // local row that disagrees with what was just written (the assignee filter
  // reads that row).
  const bulkOwner = useCallback(
    async (ownerId: string | null) => {
      if (ownerId === null) {
        await bulkPatch(
          { assigneeIds: [] },
          { ownerId: null, owner: null, assigneeIds: [], assignees: [] },
        );
        return;
      }
      await bulkPatch({ ownerId }, { ownerId });
      await refetchList();
    },
    [bulkPatch, refetchList],
  );
  const bulkDueAt = useCallback((iso: string | null) => bulkPatch({ dueAt: iso }, { dueAt: iso }), [bulkPatch]);
  const bulkPriority = useCallback((priority: string | null) => bulkPatch({ priority }, { priority }), [bulkPatch]);

  const bulkTrash = useCallback(async () => {
    if (selected.size === 0) return;
    if (!(await confirm({ title: "Delete tasks", description: `Delete ${selected.size} task${selected.size === 1 ? "" : "s"}? They move to Trash and can be restored for 60 days.`, destructive: true, confirmLabel: "Delete" }))) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const linked = linkedIdsOf(ids);
    const { succeeded, failed } = await splitBulkResults(ids, (id) =>
      fetch(`/api/items/${id}?hard=1${linked.has(id) ? `&list=${encodeURIComponent(boardId)}` : ""}`, { method: "DELETE" }),
    );
    const linkedFailed = failed.some((id) => linked.has(id));
    setError(failed.length > 0 ? `${bulkFailureMessage("delete", failed, ids.length, items)}${linkedFailed ? ` ${LINKED_ARCHIVE_REFUSED}` : ""}` : null);
    const ok = new Set(succeeded);
    setItems((prev) => prev.filter((r) => !ok.has(r.id)));
    for (const id of succeeded) reportRemoved(id);
    setSelected(new Set(failed));
    setBulkBusy(false);
  }, [selected, confirm, reportRemoved, items, linkedIdsOf, boardId]);

  // ClickUp-style rich add: create a task WITH the quick-set fields (assignee /
  // due / priority / tags) chosen inline before saving.
  const handleAddRich = useCallback(async (payload: {
    title: string; status: string; ownerId: string | null; dueAt: string | null; priority: string | null; tagIds: string[]; itemTypeId: string | null;
    /** Keys the person chose (a status group counts as choosing the status). */
    touched?: ReadonlySet<string>;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!canEdit) return { ok: false, error: "You don't have edit access to this list" };
    setAdding(true);
    setError(null);
    try {
      // The List's default values fill what the person did not choose: an
      // untouched defaulted key is left out and the server applies the
      // default. Until the List's settings have loaded, today's body goes.
      const body = applyDefaultsToCreateBody(
        {
          title: payload.title.trim() || "New item",
          status: payload.status ?? firstStatus,
          ownerId: payload.ownerId ?? undefined,
          dueAt: payload.dueAt ?? undefined,
          priority: payload.priority ?? undefined,
          tagIds: payload.tagIds.length ? payload.tagIds : undefined,
          itemTypeId: payload.itemTypeId ?? undefined,
        },
        loadedSettings,
        payload.touched ?? new Set(["status", "itemTypeId"]),
        boardId,
      );
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // accessMessage, not data.error: the item routes answer refusals as
        // machine codes ("Forbidden", "no_access" + a reason) on purpose, and
        // printing one is how a user came to read the literal word "Forbidden".
        const msg = accessMessage(data, `Save failed (HTTP ${res.status})`);
        setError(msg);
        return { ok: false, error: msg };
      }
      const row = data.item as BoardItemRow;
      setItems((prev) => [...prev, row]);
      reportCreated(row);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add item";
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setAdding(false);
    }
  }, [boardId, canEdit, firstStatus, reportCreated, loadedSettings]);

  const handleUpdate = useCallback(async (id: string, patch: RowPatch) => {
    const row = itemsRef.current.find((r) => r.id === id);
    // A row shown here through a link is edited here only as far as the
    // viewer's role on the TASK goes (list-link-rows.ts linkedRowEditable).
    if (!canEdit || (row && !linkedRowEditable(row, canEdit))) return;
    const linked = row ? linkedRowKind(row, boardId) !== "home" : false;
    // Optimistic (zod on the API strips unknown keys like `owner`,
    // which only exists for the local optimistic row).
    //
    // `metadataPatch` is a SERVER-side merge instruction, not a row field, so
    // spreading it onto the row would park a `metadataPatch` key on the local
    // copy and leave `metadata` showing the old value until the next refetch.
    // It is applied to `metadata` here instead, by the same rule the server
    // uses, and dropped from what goes into local state.
    const { metadataPatch: mdPatch, ...rowFields } = patch;
    // A linked row's status is a HOME value (its picker offers the home set),
    // and its pill is the home status: both move together, at once.
    const optimisticFor = (r: BoardItemRow): BoardItemRow => {
      const next: BoardItemRow = { ...r, ...rowFields, ...(mdPatch ? { metadata: mergeMetadata(r.metadata, mdPatch) } : {}) };
      return linked && typeof patch.status === "string" ? optimisticLinkedStatus(next, patch.status) : next;
    };
    setItems((prev) => prev.map((r) => (r.id === id ? optimisticFor(r) : r)));
    // The host list is told only about the row FIELDS. It holds its own copy
    // of `metadata` and merging a patch into somebody else's copy from here
    // would be the stale-blob bug again, one level up.
    onItemPatched?.(id, linked && row && typeof patch.status === "string"
      ? { ...rowFields, listLink: optimisticLinkedStatus(row, patch.status).listLink }
      : rowFields);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // Every write from a row shown here through a link names this List,
        // so its values land in this List's namespace and nothing it does can
        // re-home the task or reorder its home.
        body: JSON.stringify({ ...patch, ...writeContext(row, boardId) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(accessMessage(data, "Couldn't save that change."));
        // Refetch on failure to revert optimistic state.
        await refetchList();
        return;
      }
      const data = await res.json().catch(() => null);
      const fresh = data?.item as BoardItemRow | undefined;
      if (linked && fresh && row) {
        // The answer is the row as THIS List shows it (the request named the
        // List): its link, place, home status pill and namespaced values.
        const out = mergeRefetchedRow(optimisticFor(row), refetchedFromRow(fresh), boardId);
        if (out.action === "merge") {
          setItems((prev) => prev.map((r) => (r.id === id ? out.row : r)));
          onItemPatched?.(id, out.row);
        } else {
          await refetchList();
        }
        return;
      }
      // Recurring task completed → apply the server's rolled-forward row.
      if (data?.recurred && fresh) {
        setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...fresh } : r)));
        onItemPatched?.(id, fresh as Partial<BoardItemRow>);
        return;
      }
      // A List with connect or mirror columns: their computed values move with
      // the write. A List without them gets no such keys and nothing changes.
      if (fresh && (fresh.connections || fresh.mirrors)) {
        const computed: Partial<BoardItemRow> = {
          ...(fresh.connections ? { connections: fresh.connections } : {}),
          ...(fresh.mirrors ? { mirrors: fresh.mirrors } : {}),
        };
        setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...computed } : r)));
        onItemPatched?.(id, computed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save change");
    }
  }, [boardId, canEdit, onItemPatched, refetchList]);

  // A Connect cell's commit (connect-field-value.tsx). Unlike every other
  // cell it answers its own caller: the cell keeps its selection and offers
  // Retry, so a failure here restores ONLY this row's previous value and
  // chips for that column, never re-reads the whole List over the person's
  // other in-flight edits.
  const commitConnect = useCallback(async (id: string, key: string, next: unknown): Promise<{ ok: true } | { ok: false; message: string }> => {
    const row = itemsRef.current.find((r) => r.id === id);
    if (!row) return { ok: false, message: "That task is no longer in this List." };
    if (!linkedRowEditable(row, canEdit)) return { ok: false, message: "You can't change this task here." };
    const hadValue = !!row.metadata && key in row.metadata;
    const prevValue = row.metadata?.[key];
    const hadConn = !!row.connections && key in row.connections;
    const prevConn = row.connections?.[key];
    const value = next === undefined ? null : next;
    const restore = () => setItems((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const metadata = { ...(r.metadata ?? {}) };
      if (hadValue) metadata[key] = prevValue; else delete metadata[key];
      const connections = r.connections ? { ...r.connections } : undefined;
      if (connections) {
        if (hadConn && prevConn) connections[key] = prevConn; else delete connections[key];
      }
      return { ...r, metadata, ...(connections ? { connections } : {}) };
    }));
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, metadata: mergeMetadata(r.metadata, { [key]: value }) } : r)));
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metadataPatch: { [key]: value }, ...writeContext(row, boardId) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        restore();
        return { ok: false, message: accessMessage(data, "Couldn't save those connected tasks.") };
      }
      const fresh = data?.item as BoardItemRow | undefined;
      if (fresh) {
        const computed: Partial<BoardItemRow> = {
          metadata: fresh.metadata,
          ...(fresh.connections ? { connections: fresh.connections } : {}),
          ...(fresh.mirrors ? { mirrors: fresh.mirrors } : {}),
        };
        setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...computed } : r)));
        onItemPatched?.(id, computed);
      }
      return { ok: true };
    } catch {
      restore();
      return { ok: false, message: "Couldn't reach the server. Your selection is kept; try again." };
    }
  }, [boardId, canEdit, onItemPatched]);

  const handleArchive = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!(await confirm({ title: "Archive task", description: "Archive this task? You can restore it later from Trash.", destructive: true, confirmLabel: "Archive" }))) return;
    setItems((prev) => prev.filter((r) => r.id !== id));
    reportRemoved(id);
    try {
      const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't archive. Refreshing");
        await refetchList();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive");
    }
  }, [canEdit, confirm, reportRemoved, refetchList]);

  // select + name + actions (3 fixed) + optional status/owner/priority/type/
  // tags/created + custom fields.
  const colCount = 3 + (showStatus ? 1 : 0) + (showOwner ? 1 : 0) + (showDue ? 1 : 0) + (showPriority ? 1 : 0) + (showType ? 1 : 0) + (showTags ? 1 : 0) + (showCreated ? 1 : 0) + (showStart ? 1 : 0) + (showUpdated ? 1 : 0) + (showTaskId ? 1 : 0) + (showComments ? 1 : 0) + (showTimeline ? 1 : 0) + (showTime ? 1 : 0) + (showCreatedBy ? 1 : 0) + (showDocs ? 1 : 0) + (showLinked ? 1 : 0) + (showSops ? 1 : 0) + customFields.length;

  // ── Column sizing ──────────────────────────────────────────────────────
  // Spreadsheet model. Dragging a column's right border grows/shrinks THAT
  // column with no upper clamp, so the border tracks the cursor AND every column
  // to its right shifts as a block. When the row grows past the viewport the
  // table scrolls; when it's narrower the trailing actions column stretches so
  // the row still spans full width. (The cell popovers are portalled to <body>,
  // so the horizontal scroll container never clips them.)
  const colW = useCallback((key: string, def: number) => Math.max(60, colWidths[key] ?? def), [colWidths]);
  const metaColumns = useMemo(() => {
    const cols: Array<{ key: string; label: string; def: number }> = [];
    if (showStatus) cols.push({ key: "status", label: "Status", def: 128 });
    if (showOwner) cols.push({ key: "owner", label: "Assignee", def: 112 });
    if (showDue) cols.push({ key: "due", label: "Due date", def: 112 });
    if (showPriority) cols.push({ key: "priority", label: "Priority", def: 104 });
    if (showType) cols.push({ key: "type", label: "Type", def: 120 });
    if (showTags) cols.push({ key: "tags", label: "Tags", def: 150 });
    for (const f of customFields) cols.push({ key: f.key, label: f.label, def: 150 });
    if (showCreated) cols.push({ key: "created", label: "Created", def: 110 });
    if (showStart) cols.push({ key: "start", label: "Start date", def: 100 });
    if (showUpdated) cols.push({ key: "updated", label: "Updated", def: 110 });
    if (showTaskId) cols.push({ key: "taskid", label: "Task ID", def: 92 });
    if (showComments) cols.push({ key: "comments", label: "Comments", def: 96 });
    if (showTimeline) cols.push({ key: "timeline", label: "Timeline", def: 140 });
    if (showTime) cols.push({ key: "time", label: "Time tracked", def: 100 });
    if (showCreatedBy) cols.push({ key: "createdby", label: "Created by", def: 120 });
    if (showDocs) cols.push({ key: "docs", label: "Linked Docs", def: 96 });
    if (showLinked) cols.push({ key: "linked", label: "Linked tasks", def: 100 });
    if (showSops) cols.push({ key: "sops", label: "Linked SOPs", def: 96 });
    return cols;
  }, [showStatus, showOwner, showDue, showPriority, showType, showTags, showCreated, showStart, showUpdated, showTaskId, showComments, showTimeline, showTime, showCreatedBy, showDocs, showLinked, showSops, customFields]);
  const metaSumW = metaColumns.reduce((s, c) => s + colW(c.key, c.def), 0);
  // Name default = whatever the meta columns leave, so the row fills the
  // viewport on first paint. Once the user drags a border, the saved widths win.
  const nameW = colWidths.name != null
    ? Math.max(120, colWidths.name)
    : Math.max(220, (containerW || 900) - LEADING_W - metaSumW - ACTIONS_MIN_W);
  const fixedSansActions = LEADING_W + nameW + metaSumW;
  // Table spans at least the viewport; if the columns total more it grows and
  // the wrapper scrolls. The actions column soaks up any slack when narrower.
  const tableW = Math.max(containerW || fixedSansActions + ACTIONS_MIN_W, fixedSansActions + ACTIONS_MIN_W);
  const actionsW = tableW - fixedSansActions;
  const overflowing = tableW > (containerW || tableW) + 1;

  // Once the container is measured, freeze Name at its fill width so it becomes
  // a real fixed column (otherwise it's the "remainder" and growing a meta
  // column silently steals from Name instead of widening + scrolling the row).
  // Re-derived whenever the container or the meta columns change, UNLESS the
  // person has dragged Name themselves. It used to run once and never again, so
  // a width frozen from a transient narrow measurement (or restored from a
  // stale saved view) left a third of every row empty and every title cut to
  // three words at 1440.
  useEffect(() => {
    if (containerW <= 0) return;
    if (userSizedRef.current.has("name")) return;
    setColWidths((prev) => {
      const fill = Math.max(220, containerW - LEADING_W - metaSumW - ACTIONS_MIN_W);
      if (prev.name === fill) return prev;
      return { ...prev, name: fill };
    });
  }, [containerW, metaSumW]);

  // Drag a column's right border. newWidth = startWidth + dx (min 60), no upper
  // clamp — the column grows freely and the table scrolls if it runs past the
  // viewport, so the border always tracks the cursor and everything to its right
  // shifts with it. Persist on release.
  const startColResize = useCallback((e: React.PointerEvent, key: string, startW: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(60, Math.round(startW + (ev.clientX - startX)));
      userSizedRef.current.add(key);
      setColWidths((prev) => ({ ...prev, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const saved: Record<string, number> = {};
      for (const k of userSizedRef.current) {
        const w = colWidthsRef.current[k];
        if (typeof w === "number") saved[k] = w;
      }
      persistView({ colWidths: saved });
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [persistView]);

  // Build the header-menu context for one column. Options are column-kind aware:
  // custom fields get move/edit/delete; status gets Edit statuses; owner/status/
  // fields can group; owner/due/priority/type/tags/created + fields can hide.
  const fieldKeys = new Set(customFields.map((f) => f.key));
  const buildColMenu = (key: string): ColMenuCtx | undefined => {
    // A view's owner who cannot write the List's tasks may still arrange
    // their own view: they get the view rows (sort, group, pin), never the
    // field rows, which change the List for everybody.
    if (!canEdit && !canSaveView) return undefined;
    const isField = canEdit && fieldKeys.has(key);
    const hideKey = BUILTIN_HIDE_KEY[key] ?? (fieldKeys.has(key) ? key : undefined);
    const canGroup = key === "status" || key === "owner" || fieldKeys.has(key);
    return {
      sortDir: sortCol?.key === key ? sortCol.dir : null,
      grouped: groupBy === key,
      onSort: (dir) => setSortCol(dir ? { key, dir } : null),
      onGroup: canGroup ? () => setGroupBy(groupBy === key ? null : key) : undefined,
      onHide: hideKey && onHideField ? () => onHideField(hideKey) : undefined,
      onMoveStart: isField ? () => moveField(key, true) : undefined,
      onMoveEnd: isField ? () => moveField(key, false) : undefined,
      onEditStatuses: canEdit && key === "status" ? onEditStatuses : undefined,
      onEditField: isField && onOpenFields ? onOpenFields : undefined,
      onDeleteField: isField ? () => deleteField(key) : undefined,
      onAddColumn: canEdit ? onOpenFields : undefined,
      // Name is always the first frozen column once anything is pinned, so it
      // has no pin of its own.
      ...(canSaveView && key !== "name" ? { pinned: pinnedColumns.includes(key), onTogglePin: () => togglePin(key) } : {}),
    };
  };

  // Resolve a column's colored type icon for the header (ClickUp shows the
  // field-type icon before each label). Custom fields use their field type;
  // built-ins (incl. Name/Status) map to their BUILTIN_COLUMNS icon.
  const fieldByKey = new Map(customFields.map((f) => [f.key, f] as const));
  const COL_BUILTIN: Record<string, string> = { name: "__name", status: "__builtin_status", ...BUILTIN_HIDE_KEY };
  const colIcon = (key: string): { Icon: LucideIcon; color: string } | null => {
    const cf = fieldByKey.get(key);
    // catalogEntryForField, not the type alone: a Connect column is stored as
    // a RELATIONSHIP and must not wear the doc-link Relationship icon.
    if (cf) { const e = catalogEntryForField(cf); return e ? { Icon: e.Icon, color: e.color } : null; }
    const bc = COL_BUILTIN[key] ? BUILTIN_COLUMN_BY_KEY[COL_BUILTIN[key]] : undefined;
    return bc ? { Icon: bc.Icon, color: bc.color } : null;
  };

  // Ordered resizable columns (Name + meta), with pinned columns brought
  // forward to sit frozen after Name (table-comfort.ts). Nothing pinned:
  // exactly the order, and no sticky cell, of the table before pinning.
  const unpinnedCols = [
    { key: "name", label: "Name", width: nameW, pad: "px-4", icon: colIcon("name") },
    ...metaColumns.map((c) => ({
      key: c.key,
      label: c.label,
      width: colW(c.key, c.def),
      pad: c.key === "status" ? "px-4" : "px-3",
      icon: colIcon(c.key),
    })),
  ];
  const pinning = orderColumnsForPinning(unpinnedCols.map((c) => c.key), pinnedColumns);
  const colByKey = new Map(unpinnedCols.map((c) => [c.key, c] as const));
  const resizeCols = pinning.ordered.map((k) => colByKey.get(k)!).filter(Boolean);
  const metaKeys = pinning.ordered.filter((k) => k !== "name");
  // Where each frozen cell sits: the leading checkbox cell at 0, Name after
  // it, then each pinned column after the one before it.
  const stickyLeft: Map<string, number> | null = (() => {
    if (pinning.stickyCount === 0) return null;
    const frozen = resizeCols.slice(0, pinning.stickyCount);
    const offsets = stickyOffsets([LEADING_W, ...frozen.map((c) => c.width)]);
    const m = new Map<string, number>([["__leading", offsets[0]]]);
    frozen.forEach((c, i) => m.set(c.key, offsets[i + 1]));
    return m;
  })();
  const stickyHeadStyle = (key: string): React.CSSProperties | undefined =>
    stickyLeft?.has(key) ? { position: "sticky", left: stickyLeft.get(key), zIndex: 4, background: "var(--os-surface)" } : undefined;

  const allSelected = items.length > 0 && items.every((r) => selected.has(r.id));
  const someSelected = !allSelected && items.some((r) => selected.has(r.id));

  // Column-label cells (resizable + menued). Shared between the global
  // <thead> and the per-group label rows the clean List repeats under each
  // status pill, ClickUp-style. Resizing anywhere adjusts the whole table.
  const headerCells = (
    <>
      {resizeCols.map((c) => (
        <ResizableTh
          key={c.key}
          label={c.label}
          width={c.width}
          className={c.pad}
          canEdit={canEdit}
          onResize={(e) => startColResize(e, c.key, c.width)}
          menu={buildColMenu(c.key)}
          icon={c.icon}
          stickyStyle={stickyHeadStyle(c.key)}
          pinned={pinnedColumns.includes(c.key)}
        />
      ))}
      {/* Pinned to the visible right edge: with many columns the table
          scrolls horizontally and a non-sticky "+" (add field) drifts
          off-screen — users read it as the button being gone. */}
      <th className="sticky right-0 z-[5] bg-white px-1 py-2 text-right align-middle" style={{ width: actionsW }}>
        {canEdit && onOpenFields ? (
          <button
            type="button"
            onClick={onOpenFields}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
            title="Add field / column"
            aria-label="Add field"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </th>
    </>
  );

  // Renders a row and (if expanded) its subtask subtree as a flat
  // sequence of <tr>s. Depth-first; subtasks of subtasks supported.
  const renderRowAndSubtasks = (row: BoardItemRow, indent: number): React.ReactNode[] => {
    const children = childrenByParent.get(row.id) ?? [];
    const expanded = expandedParents.has(row.id);
    // A row shown here THROUGH A LINK (list-link-rows.ts): edited only as far
    // as the viewer's role on the task goes, its status from its home set,
    // its menu from the link's own flags.
    const kind = linkedRowKind(row, boardId);
    const rowCanEdit = linkedRowEditable(row, canEdit);
    const flags = linkedMenuFlags(row, boardId, canEdit, currentUserId ?? null, { personalList });
    const picker = statusPickerFor(row, boardId, statuses);
    const colour = rowColorRules.length > 0 ? rowColorFor(row, rowColorRules, statusOf) : null;
    const listContext: ItemMenuListContext | undefined = kind === "home"
      ? (flags.canAddToList ? { boardId, kind: "home", canAddToList: true } : undefined)
      : {
          boardId,
          kind: "linked",
          homeBoardId: row.listLink?.homeList?.id ?? null,
          homeStatuses: row.listLink?.homeStatuses,
          canRemoveFromList: flags.canRemoveFromList,
          canLinkMove: flags.canLinkMove,
          canAddToList: flags.canAddToList,
          linkedSubtask: flags.linkedSubtask,
        };
    const nodes: React.ReactNode[] = [
      <Row
        key={row.id}
        row={row}
        boardId={boardId}
        customFields={customFields}
        statuses={statuses}
        itemTypeMap={itemTypeMap}
        showStatus={showStatus}
        canEdit={rowCanEdit}
        currentUserId={currentUserId ?? null}
        canDelete={
          kind !== "home" || canDeleteTasks === undefined
            ? undefined
            : canDeleteTasks || (!!currentUserId && row.createdBy?.id === currentUserId)
        }
        monday={monday}
        selected={selected.has(row.id)}
        onToggleSelect={toggleRow}
        onUpdate={handleUpdate}
        onArchive={handleArchive}
        onDeleted={(id) => { setItems((prev) => prev.filter((r) => r.id !== id)); reportRemoved(id); }}
        timeTrackingEnabled={timeTrackingEnabled}
        titleSuffix={renderTitleSuffix?.(row)}
        onOpen={onOpenItem ? () => onOpenItem(row.id) : undefined}
        onDuplicate={handleDuplicate}
        onAddSubtask={() => {
          // Expand the parent and focus its inline subtask input so the user
          // types the name directly (instead of getting a "New subtask" row).
          setExpandedParents((prev) => new Set(prev).add(row.id));
          setAutoFocusSubtaskFor(row.id);
        }}
        // A linked subtask has no place of its own in this List to drag to.
        dragEnabled={rowCanEdit && !buckets && indent === 0 && kind !== "linked-subtask"}
        isDragging={dragId === row.id}
        isDragOver={dragOverId === row.id && dragId !== null && dragId !== row.id}
        onDragStart={(id) => setDragId(id)}
        onDragOver={(id) => setDragOverId(id)}
        onDrop={(targetId) => {
          if (dragId) reorder(dragId, targetId);
          setDragId(null);
          setDragOverId(null);
        }}
        onDragEnd={() => { setDragId(null); setDragOverId(null); }}
        indent={indent}
        hasSubtasks={children.length > 0}
        expanded={expanded}
        onToggleExpand={() => toggleExpand(row.id)}
        columnKeys={metaKeys}
        stickyLeft={stickyLeft}
        tint={colour ? ROW_COLOR_TINT[colour] : null}
        rowHeight={rowHeight}
        // The menu stays for someone who may take a shared task out of this
        // List even when they cannot edit the task itself.
        showMenu={canEdit || (kind !== "home" && !!row.listLink?.canRemove)}
        menuRole={kind === "home" ? undefined : flags.role}
        menuIsCreator={kind === "home" ? undefined : flags.isCreator}
        listContext={listContext}
        statusOptions={picker.options}
        statusEditable={rowCanEdit && picker.editable}
        statusCurrent={kind === "linked-root" ? row.listLink?.homeStatus ?? null : undefined}
        onCommitConnect={commitConnect}
      />,
    ];
    if (expanded) {
      for (const child of children) {
        nodes.push(...renderRowAndSubtasks(child, indent + 1));
      }
      if (rowCanEdit) {
        nodes.push(
          <AddSubtaskRow
            key={`${row.id}-add-sub`}
            parentId={row.id}
            indent={indent + 1}
            colCount={colCount}
            autoFocus={autoFocusSubtaskFor === row.id}
            onAutoFocusHandled={() => setAutoFocusSubtaskFor(null)}
            // A linked parent's status is its HOME value, which is exactly
            // what the subtask (created in that home) inherits.
            onCreate={(title) => addSubtask(row.id, row.status, title)}
          />,
        );
      }
    }
    return nodes;
  };

  return (
    <div className={monday ? "rounded-lg border border-zinc-200 bg-white overflow-hidden" : ""}>
      {error ? (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/10 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900"><X className="w-3 h-3" /></button>
        </div>
      ) : null}

      {/* Group-by selector — ClickUp parity (2026-06-07). Toolbar pill
          shows the active field; click → "Group by" popover with field +
          direction dropdowns + trash to clear. */}
      <div className={`${monday ? "px-3 border-b border-zinc-100" : "px-1"} py-1 flex items-center gap-0.5`}>
        {/* 1 — Group by */}
        <GroupByPill
          groupBy={groupBy}
          groupDirection={groupDirection}
          groupOptions={groupOptions}
          onGroupBy={setGroupBy}
          onDirection={setGroupDirection}
        />
        {/* 2 — Subtasks display mode */}
        <SubtaskModeMenu
          onCollapseAll={() => setExpandedParents(new Set())}
          onExpandAll={() => setExpandedParents(new Set(Array.from(childrenByParent.keys())))}
        />
        {/* 3 — Columns / Fields */}
        {onOpenFields ? (
          <button
            type="button"
            onClick={onOpenFields}
            title="Columns"
            aria-label="Columns / Fields"
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
          >
            <Columns3 className="w-3.5 h-3.5" />
            <span className="font-medium">Columns</span>
          </button>
        ) : null}
        {/* 4. Row height (Phase 5b): only for someone who may save the view. */}
        {canSaveView ? <RowHeightMenu value={rowHeight} onChange={changeRowHeight} /> : null}
        <span className="ml-1 whitespace-nowrap text-xs text-zinc-400">
          {topLevel.length} item{topLevel.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        {/* Filters — the shared FilterMenu, owned + applied by BoardCanvas */}
        {filterSlot}
        {/* Me — only rows assigned to the viewer */}
        {currentUserId ? (
          <button
            type="button"
            onClick={() => setMineOnly((v) => !v)}
            title={mineOnly ? "Showing your tasks" : "Show only my tasks"}
            aria-pressed={mineOnly}
            className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${mineOnly ? "text-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_12%,transparent)] dark:text-zinc-100 dark:bg-[color-mix(in_srgb,var(--os-brand)_28%,#1B1F26)]" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"}`}
          >
            <UserCheck className="w-4 h-4" />
          </button>
        ) : null}
        {/* Sort */}
        <SortMenu sortKey={sortKey} onChange={setSortKey} />
        {/* CSV export */}
        <button
          type="button"
          onClick={exportCsv}
          title="Export to CSV"
          aria-label="Export to CSV"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
        >
          <Download className="w-4 h-4" />
        </button>
        {/* Quick search (magnifier expands to an input) */}
        {searchOpen ? (
          <div className="flex items-center gap-1 h-7 px-2 rounded-md border border-zinc-200 bg-white">
            <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); setSearchOpen(false); } }}
              placeholder="Search tasks…"
              className="w-[150px] bg-transparent outline-none text-base text-zinc-900 placeholder:text-zinc-400"
            />
            <button type="button" onClick={() => { setQuery(""); setSearchOpen(false); }} className="text-zinc-400 hover:text-zinc-700 shrink-0" aria-label="Close search">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title="Search"
            aria-label="Search"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
          >
            <Search className="w-4 h-4" />
          </button>
        )}
        {toolbarActions ? <div className="flex items-center gap-2">{toolbarActions}</div> : null}
      </div>

      {/* Monday's wide grid scrolls horizontally; the lean List doesn't clip so
          inline cell editors (assignee/date/dropdown popovers) aren't cut off. */}
      <div ref={tableWrapRef} className={monday || overflowing ? "overflow-x-auto" : "overflow-visible"}>
        <table className="text-base" style={{ tableLayout: "fixed", width: tableW }}>
          {/* Fixed layout reads column widths from the first row; with the
              global thead gone on grouped Lists, pin them via colgroup. */}
          <colgroup>
            <col style={{ width: LEADING_W }} />
            {resizeCols.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
            <col style={{ width: actionsW }} />
          </colgroup>
          {/* Global header — Monday grid always; clean List only when ungrouped.
              Grouped Lists repeat the labels inside each group (ClickUp). */}
          {monday || !buckets ? (
            <thead>
              <tr className={`text-left text-xs font-medium text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 ${monday ? "uppercase tracking-wide" : ""}`}>
                <th className="pl-1 pr-0 py-1.5" style={{ width: LEADING_W, ...(stickyHeadStyle("__leading") ?? {}) }}>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <span className="w-3 shrink-0" aria-hidden />
                      <CheckBox
                        checked={allSelected}
                        indeterminate={someSelected && !allSelected}
                        onChange={() => (allSelected || someSelected ? clearSelection() : selectAllVisible())}
                      />
                    </div>
                  ) : null}
                </th>
                {headerCells}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {buckets ? (
              buckets.map((b) => {
                const collapsed = collapsedGroups.has(b.key);
                return (
                  <React.Fragment key={b.key}>
                    <tr className={`group/ghdr ${monday ? "bg-zinc-50/80 border-y border-zinc-100" : ""}`}>
                      <td colSpan={colCount} className={monday ? "px-3 py-1.5" : "px-3 pt-4 pb-0.5"} style={monday && b.color ? { boxShadow: `inset 3px 0 0 ${b.color}` } : undefined}>
                        {/* While columns are pinned the group's name stays in
                            view with them as the table scrolls sideways. */}
                        <div className={`inline-flex items-center gap-2 ${stickyLeft ? "sticky left-3" : ""}`}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(b.key)}
                            className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-800 hover:text-zinc-900"
                          >
                            <svg viewBox="0 0 8 8" className={`w-2 h-2 fill-current text-zinc-500 transition-transform ${collapsed ? "" : "rotate-90"}`} aria-hidden>
                              <path d="M2 1 L6 4 L2 7 Z" />
                            </svg>
                            {b.color ? (
                              monday ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: b.color }}>
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color }} aria-hidden />
                                  <span className={groupBy === "status" ? "uppercase tracking-wide text-xs" : ""}>{b.label}</span>
                                </span>
                              ) : (
                                // ClickUp-style solid status pill: label on its color.
                                <span
                                  className="inline-flex items-center h-5 rounded-[5px] px-2 text-micro font-semibold uppercase tracking-wider text-white"
                                  style={{ backgroundColor: b.color }}
                                >
                                  {b.label}
                                </span>
                              )
                            ) : (
                              <span className="text-sm font-semibold text-zinc-700">{b.label}</span>
                            )}
                            <span className="text-xs font-medium text-zinc-400 tabular-nums">{b.rows.length}</span>
                          </button>
                          <GroupStatusBreakdown rows={b.rows} statuses={statuses} />
                          {canEdit ? (
                            <GroupHeaderMenu
                              canEditStatuses={!!onEditStatuses}
                              onEditStatuses={onEditStatuses}
                              onCollapseGroup={() => toggleGroup(b.key)}
                              onCollapseAll={() => setCollapsedGroups(new Set(buckets.map((x) => x.key)))}
                              onSelectAll={() => setSelected((prev) => { const n = new Set(prev); for (const r of b.rows) n.add(r.id); return n; })}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {!collapsed ? (
                      <>
                        {/* ClickUp repeats the column labels inside every status
                            group; the clean List follows suit (Monday keeps the
                            single global header). */}
                        {!monday ? (
                          <tr className="text-left text-xs font-medium text-zinc-400 border-b border-zinc-50 dark:border-zinc-800">
                            <th className="pl-1 pr-0 py-1" style={{ width: LEADING_W, ...(stickyHeadStyle("__leading") ?? {}) }} aria-hidden />
                            {headerCells}
                          </tr>
                        ) : null}
                        {b.rows.flatMap((row) => renderRowAndSubtasks(row, 0))}
                        {canEdit ? (
                          <tr className="hover:bg-zinc-50">
                            <td colSpan={colCount} className="py-1.5 pr-4">
                              <AddTaskInline
                                statuses={statuses}
                                // Create into this group's value when grouped by status.
                                defaultStatus={groupBy === "status" ? b.key : firstStatus}
                                statusChosen={groupBy === "status"}
                                listDefaultStatus={listDefaultStatus}
                                itemTypes={itemTypeList}
                                defaultTypeId={defaultItemType?.id ?? null}
                                listDefaultTypeId={listDefaultTypeId}
                                boardId={boardId}
                                onCreate={handleAddRich}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </>
                    ) : null}
                    {/* Monday-style per-group summary footer — aggregates
                        every column (stacked bars, people, sums…). Table view only;
                        a clean List has no spreadsheet summary. */}
                    {monday ? <GroupSummaryRow rows={b.rows} customFields={customFields} statuses={statuses} railColor={b.color} columnKeys={stickyLeft ? metaKeys : undefined} stickyLeft={stickyLeft} showOwner={showOwner} showPriority={showPriority} showType={showType} showTags={showTags} showCreated={showCreated} showStart={showStart} showUpdated={showUpdated} showTaskId={showTaskId} showComments={showComments} showTimeline={showTimeline} showTime={showTime} showCreatedBy={showCreatedBy} showDocs={showDocs} showLinked={showLinked} showSops={showSops} /> : null}
                  </React.Fragment>
                );
              })
            ) : (
              <>
                {topLevel.flatMap((row) => renderRowAndSubtasks(row, 0))}
                {monday && items.length > 0 ? <GroupSummaryRow rows={items} customFields={customFields} statuses={statuses} railColor={null} columnKeys={stickyLeft ? metaKeys : undefined} stickyLeft={stickyLeft} showOwner={showOwner} showPriority={showPriority} showType={showType} showTags={showTags} showCreated={showCreated} showStart={showStart} showUpdated={showUpdated} showTaskId={showTaskId} showComments={showComments} showTimeline={showTimeline} showTime={showTime} showCreatedBy={showCreatedBy} showDocs={showDocs} showLinked={showLinked} showSops={showSops} /> : null}
              </>
            )}
            {/* Bottom "+ Add Task" — shown when ungrouped, OR when grouped but
                there are no groups yet (a brand-new/empty List). Otherwise each
                group renders its own inline add. */}
            {canEdit && (!buckets || buckets.length === 0) ? (
              <tr className="hover:bg-zinc-50">
                <td colSpan={colCount} className="py-1.5 pr-4">
                  <AddTaskInline
                    statuses={statuses}
                    defaultStatus={firstStatus}
                    listDefaultStatus={listDefaultStatus}
                    itemTypes={itemTypeList}
                    defaultTypeId={defaultItemType?.id ?? null}
                    listDefaultTypeId={listDefaultTypeId}
                    boardId={boardId}
                    onCreate={handleAddRich}
                  />
                </td>
              </tr>
            ) : null}
            {items.length === 0 && !canEdit ? (
              <tr><td colSpan={colCount} className="px-4 py-8 text-center text-xs text-zinc-500">No items yet.</td></tr>
            ) : null}
            {/* A FILTER THAT EMPTIES THE BOARD SAYS SO, and offers the way
                back. Without this the whole canvas went blank: no group
                header, no sentence, and the only sign a filter was on was a
                tinted 28px toolbar icon. The filter PANEL already writes a
                sentence when it has nothing ("No filters. Add one to narrow
                the list."); the filtered RESULT did not. */}
            {items.length > 0 && topLevel.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center">
                  <p className="text-sm text-ink-2">
                    {mineOnly && query.trim()
                      ? "No tasks assigned to you match that search."
                      : mineOnly
                        ? "No tasks here are assigned to you."
                        : "No tasks match this search."}
                  </p>
                  <button
                    type="button"
                    onClick={() => { setMineOnly(false); setQuery(""); }}
                    className="mt-1 text-base font-medium text-brand-deep hover:underline"
                  >
                    Clear filters
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <BulkActionBar
        selectedCount={selected.size}
        busy={bulkBusy}
        statuses={statuses}
        priorities={PRIORITY_OPTIONS}
        onClear={clearSelection}
        onArchive={bulkArchive}
        onStatus={bulkStatus}
        onDueAt={bulkDueAt}
        onOwner={(ownerId) => void bulkOwner(ownerId)}
        onPriority={bulkPriority}
        onTrash={bulkTrash}
        boardId={boardId}
      />
    </div>
  );
}

// ── Inline row editor ──────────────────────────────────────────────

/** The stored watcher list on a row, so Watch reads "Unwatch" when it should. */
function rowWatcherIds(row: BoardItemRow): string[] {
  const md = (row.metadata as Record<string, unknown> | undefined) ?? {};
  return Array.isArray(md.watchers) ? (md.watchers as unknown[]).filter((v): v is string => typeof v === "string") : [];
}

function Row({
  row,
  boardId: rowBoardId,
  customFields,
  statuses,
  itemTypeMap,
  showStatus = true,
  canEdit,
  currentUserId,
  canDelete,
  monday = false,
  selected,
  onToggleSelect,
  onUpdate,
  onArchive,
  onDeleted,
  timeTrackingEnabled = true,
  titleSuffix,
  onOpen,
  onDuplicate,
  onAddSubtask,
  dragEnabled,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  indent = 0,
  hasSubtasks = false,
  expanded = false,
  onToggleExpand,
  columnKeys,
  stickyLeft = null,
  tint = null,
  rowHeight = "default",
  showMenu,
  menuRole,
  menuIsCreator,
  listContext,
  statusOptions,
  statusEditable,
  statusCurrent,
  onCommitConnect,
}: {
  row: BoardItemRow;
  /** The list this table is showing, so the assignee picker can ask who is
   *  on it. Rows fetched from a board endpoint may not carry their own. */
  boardId?: string | null;
  customFields: FieldDef[];
  statuses: StatusOption[];
  itemTypeMap: Map<string, ItemTypeLite>;
  showStatus?: boolean;
  /** May this viewer edit THIS row here (a linked row: its task role too). */
  canEdit: boolean;
  /** The viewer, for the row menu's "Assign to me" and "Watch". */
  currentUserId: string | null;
  /** undefined = the host could not work it out; the menu leaves Delete alone. */
  canDelete?: boolean;
  monday?: boolean;
  selected: boolean;
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onUpdate: (id: string, patch: RowPatch) => void;
  onArchive: (id: string) => void;
  timeTrackingEnabled?: boolean;
  /** Rendered after the title inside the Name cell (source-List chip). */
  titleSuffix?: React.ReactNode;
  /** Local removal after a hard delete (→ Trash) succeeds. */
  onDeleted: (id: string) => void;
  onOpen?: () => void;
  onDuplicate?: (row: BoardItemRow) => void;
  onAddSubtask?: () => void;
  dragEnabled: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: (targetId: string) => void;
  onDragEnd: () => void;
  indent?: number;
  hasSubtasks?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** The meta columns after Name, in display order (pinned ones first). */
  columnKeys: string[];
  /** Frozen cells' left offsets while any column is pinned; null otherwise. */
  stickyLeft?: Map<string, number> | null;
  /** The row's Conditional colors tint (a token mix), or null. */
  tint?: string | null;
  rowHeight?: RowHeight;
  /** Render the row menu even for a row the viewer cannot edit (Remove from this List). */
  showMenu: boolean;
  /** The TASK role for a row shown here through a link; undefined keeps the List's. */
  menuRole?: ItemRole | null;
  menuIsCreator?: boolean;
  listContext?: ItemMenuListContext;
  /** The statuses this row's picker offers (a linked row: its home set). */
  statusOptions?: StatusOption[];
  statusEditable?: boolean;
  /** A linked row's home status pill, whatever this List's set holds. */
  statusCurrent?: StatusOption | null;
  onCommitConnect?: (id: string, key: string, next: unknown) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  // Bumped by the hover "rename" pencil to put the title cell into edit mode.
  const [editToken, setEditToken] = useState(0);
  const moreRef = useRef<ContextMenuHandle>(null);
  const fieldByKey = useMemo(() => new Map(customFields.map((f) => [f.key, f] as const)), [customFields]);
  const pickerStatuses = statusOptions ?? statuses;
  const statusCanEdit = statusEditable ?? canEdit;
  // A row that carries a colour, or sits in a table with frozen columns, has
  // its background drawn from ONE variable, so the frozen cells, the row and
  // its hover and selection states always match. Every other row keeps
  // exactly the classes it had before List comfort existed.
  const comfort = !!tint || !!stickyLeft;
  const stick = (key: string): React.CSSProperties | undefined =>
    stickyLeft?.has(key) ? { position: "sticky", left: stickyLeft.get(key), zIndex: 2, background: "var(--row-bg)" } : undefined;
  const tall = rowHeight === "tall";

  const metaCell = (key: string): React.ReactNode => {
    switch (key) {
      case "status":
        return showStatus ? (
          <td key={key} className={monday ? "p-0 align-middle border-l border-zinc-100" : "px-4 py-1.5"} style={stick(key)}>
            <StatusCell row={row} statuses={pickerStatuses} current={statusCurrent} canEdit={statusCanEdit} onUpdate={onUpdate} monday={monday} />
          </td>
        ) : null;
      case "owner":
        return (
          <MetaCell key={key} style={stick(key)}>
            <OwnerCell row={row} boardId={row.boardId ?? rowBoardId ?? null} canEdit={canEdit} onUpdate={onUpdate} />
          </MetaCell>
        );
      case "due":
        return (
          <MetaCell key={key} style={stick(key)}>
            <DueDateCell row={row} canEdit={canEdit} statuses={statuses} onUpdate={onUpdate} />
          </MetaCell>
        );
      case "priority":
        return (
          <MetaCell key={key} style={stick(key)}>
            <PriorityPicker value={row.priority ?? null} canEdit={canEdit} compact onChange={(priority) => onUpdate(row.id, { priority })} />
          </MetaCell>
        );
      case "type":
        return (
          <MetaCell key={key} style={stick(key)}>
            <TypeCell itemTypeId={row.itemTypeId ?? null} itemTypeMap={itemTypeMap} />
          </MetaCell>
        );
      case "tags":
        return (
          <MetaCell key={key} style={stick(key)}>
            <TagPicker value={row.tags ?? []} canEdit={canEdit} compact onChange={(tags) => onUpdate(row.id, { tags, tagIds: tags.map((t) => t.id) })} />
          </MetaCell>
        );
      case "created":
        return (
          <td key={key} className="px-3 py-1.5 text-xs text-zinc-500" style={stick(key)}>
            {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"}
          </td>
        );
      case "start":
        return (
          <td key={key} className="px-3 py-1.5 text-xs text-zinc-500" style={stick(key)}>
            {row.startAt ? new Date(row.startAt).toLocaleDateString() : "—"}
          </td>
        );
      case "updated":
        return (
          <td key={key} className="px-3 py-1.5 text-xs text-zinc-500" style={stick(key)}>
            {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : "—"}
          </td>
        );
      case "taskid":
        return (
          <td key={key} className="px-3 py-1.5 text-xs font-mono text-zinc-400" style={stick(key)}>
            {row.id.slice(-6)}
          </td>
        );
      case "comments":
        return (
          <td key={key} className="px-3 py-1.5 text-xs text-zinc-500" style={stick(key)}>
            {row.commentCount ? (
              <span className="inline-flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5 text-zinc-400" />{row.commentCount}</span>
            ) : "—"}
          </td>
        );
      case "timeline":
        return <td key={key} className="px-3 py-1.5" style={stick(key)}><TimelineCell startAt={row.startAt} dueAt={row.dueAt} /></td>;
      case "time":
        return (
          <td key={key} className="px-3 py-1.5 text-xs text-zinc-500" style={stick(key)}>
            {row.timeTrackedMs ? <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-zinc-400" />{formatDuration(row.timeTrackedMs)}</span> : "—"}
          </td>
        );
      case "createdby":
        return (
          <td key={key} className="px-3 py-1.5" style={stick(key)}>
            {row.createdBy ? (
              <span className="inline-flex items-center gap-1.5">
                <PersonAvatar person={{ ...row.createdBy, email: null }} size={18} />
                <span className="text-xs text-zinc-600 truncate max-w-[90px]">{`${row.createdBy.firstName ?? ""} ${row.createdBy.lastName ?? ""}`.trim() || "—"}</span>
              </span>
            ) : <span className="text-xs text-zinc-400">—</span>}
          </td>
        );
      case "docs":
        return <td key={key} className="px-3 py-1.5 text-xs text-zinc-500" style={stick(key)}>{row.linkedDocCount ? <span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-zinc-400" />{row.linkedDocCount}</span> : "—"}</td>;
      case "linked":
        return <td key={key} className="px-3 py-1.5 text-xs text-zinc-500" style={stick(key)}>{row.linkedTaskCount ? <span className="inline-flex items-center gap-1"><Link2 className="w-3.5 h-3.5 text-zinc-400" />{row.linkedTaskCount}</span> : "—"}</td>;
      case "sops":
        return <td key={key} className="px-3 py-1.5 text-xs text-zinc-500" style={stick(key)}>{row.linkedSopCount ? <span className="inline-flex items-center gap-1"><BookOpen className="w-3.5 h-3.5 text-zinc-400" />{row.linkedSopCount}</span> : "—"}</td>;
      default: {
        const f = fieldByKey.get(key);
        if (!f) return null;
        return (
          <MetaCell key={key} style={stick(key)}>
            <EditableFieldCell
              field={f}
              value={row.metadata?.[f.key]}
              canEdit={canEdit}
              // The List whose schema defines the field: this table's. It
              // scopes a USER / PEOPLE cell and a Connect cell's candidates.
              boardId={rowBoardId ?? row.boardId ?? null}
              itemId={row.id}
              connections={row.connections?.[f.key]}
              mirror={row.mirrors?.[f.key]}
              onCommit={onCommitConnect ? (next) => onCommitConnect(row.id, f.key, next) : undefined}
              // metadataPatch, never metadata: see the RowPatch comment. This
              // cell used to spread the row's cached blob, which destroyed the
              // task's description on any page that had been open while somebody
              // else edited it.
              onChange={(next) =>
                onUpdate(row.id, { metadataPatch: { [f.key]: next === undefined || next === "" ? null : next } })
              }
            />
          </MetaCell>
        );
      }
    }
  };

  return (
    <tr
      draggable={dragEnabled}
      onContextMenu={(e) => {
        // Let inputs / editable cells keep their native menu (e.g. while
        // renaming a title inline); everywhere else opens the row menu.
        if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
        if (!showMenu) return;
        e.preventDefault();
        moreRef.current?.openAtPoint(e.clientX, e.clientY);
      }}
      onDragStart={(e) => {
        if (!dragEnabled) return;
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", row.id); } catch {}
        onDragStart(row.id);
      }}
      onDragOver={(e) => {
        if (!dragEnabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver(row.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(row.id);
      }}
      onDragEnd={onDragEnd}
      // THE VIEWER'S DENSITY, NOT A HARDCODED 40. Rows measured 40px whatever
      // the preference said, because the height came only from cell padding and
      // nothing here read the setting. `--os-row-h` is the token
      // html[data-density] rebinds (comfortable 44 / cozy 36 / compact 32,
      // design-system 3.2), so one variable makes the preference real. A
      // view's Row height steps off the same token (table-comfort.ts).
      style={{
        height: rowHeightStyle(rowHeight),
        ...(comfort ? { ["--row-base" as string]: tint ?? "var(--os-surface)" } : {}),
      }}
      className={`border-b border-zinc-100 last:border-b-0 group ${
        comfort
          ? `bg-[var(--row-bg)] ${selected
              ? "[--row-bg:color-mix(in_srgb,var(--os-brand)_8%,var(--row-base))]"
              : "[--row-bg:var(--row-base)] hover:[--row-bg:color-mix(in_srgb,var(--os-ink)_5%,var(--row-base))]"}`
          : `hover:bg-zinc-50 ${selected ? "bg-[color-mix(in_srgb,var(--os-brand)_6%,transparent)]" : ""}`
      } ${isDragging ? "opacity-40" : ""} ${
        isDragOver ? "outline outline-2 outline-[var(--os-brand)] outline-offset-[-2px]" : ""
      }`}
    >
      <td className="pl-1 pr-0 py-1.5 w-[34px]" style={stick("__leading")}>
        <div className="flex items-center gap-1">
          {canEdit ? (
            <span
              className={`w-3 shrink-0 inline-flex justify-center opacity-0 group-hover:opacity-100 transition-opacity ${dragEnabled ? "text-zinc-400 cursor-grab" : "text-zinc-300"}`}
              title={dragEnabled ? "Drag to reorder" : "Drag disabled while grouped"}
              aria-hidden
            >
              <GripVertical className="w-3 h-3" />
            </span>
          ) : null}
          {canEdit ? (
            <CheckBox
              checked={selected}
              onChange={(shift) => onToggleSelect(row.id, shift)}
              className={selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
            />
          ) : null}
        </div>
      </td>
      <td className="pl-1 pr-4 py-1.5" style={stick("name")}>
        <div className="flex items-center gap-1.5" style={{ paddingLeft: indent * 20 }}>
          {/* Expand caret. Top-level tasks always reserve the slot (visible when
              they have subtasks / are open, else on hover → add the first
              subtask). Subtasks don't get the add-subtask arrow — only a spacer,
              unless they already have nested children to expand. */}
          {indent === 0 || hasSubtasks ? (
            <button
              type="button"
              onClick={onToggleExpand}
              className={`inline-flex items-center justify-center w-4 h-4 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 shrink-0 transition-opacity ${hasSubtasks || expanded ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
              aria-label={expanded ? "Collapse subtasks" : hasSubtasks ? "Expand subtasks" : "Add subtask"}
              title={expanded ? "Collapse" : hasSubtasks ? "Expand subtasks" : "Add subtask"}
            >
              {/* Filled caret — points right when collapsed, down when open. */}
              <svg viewBox="0 0 8 8" className={`w-[11px] h-[11px] fill-current transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden>
                <path d="M2 1 L6 4 L2 7 Z" />
              </svg>
            </button>
          ) : (
            <span className="w-4 h-4 shrink-0" aria-hidden />
          )}
          {!showStatus ? (
            <StatusCell row={row} statuses={pickerStatuses} current={statusCurrent} canEdit={statusCanEdit} onUpdate={onUpdate} dot />
          ) : null}
          <div className="flex-1 min-w-0">
            <TitleCell row={row} canEdit={canEdit} onUpdate={onUpdate} onOpen={onOpen} editToken={editToken} wrap={tall} />
          </div>
          {titleSuffix}
          <RowHoverActions
            canEdit={canEdit}
            tags={row.tags ?? []}
            isSubtask={indent > 0}
            onAddSubtask={() => onAddSubtask?.()}
            onTagsChange={(tags) => onUpdate(row.id, { tags, tagIds: tags.map((t) => t.id) })}
            onRename={() => setEditToken((t) => t + 1)}
          />
        </div>
      </td>
      {columnKeys.map((key) => metaCell(key))}
      <td
        className={`sticky right-0 px-2 py-1.5 text-right ${comfort ? "" : "bg-white group-hover:bg-zinc-50"}`}
        style={comfort ? { background: "var(--row-bg)" } : undefined}
      >
        {/* The canon menu, shared with the task drawer and the task page
            (src/lib/item-menu.ts). The row knows only the LIST-level flags, so
            the role is the honest translation of those; the task's own
            decision arrives from GET /api/items/[id] when it opens. A row
            shown here through a link carries its TASK role instead
            (listLink.role), never this List's flag. */}
        {showMenu ? (
          <ItemMoreMenu
            ref={moreRef}
            host="row"
            role={menuRole ?? (canDelete ? "FULL" : canEdit ? "EDIT" : "VIEW")}
            item={{ id: row.id, boardId: row.boardId ?? null, title: row.title, status: row.status, assigneeIds: row.assigneeIds, itemTypeId: row.itemTypeId ?? null, parentItemId: row.parentItemId ?? null }}
            // Not null: ItemMoreMenu guards "Assign to me" and "Watch" on
            // this, so a null here renders both rows and makes both inert.
            currentUserId={currentUserId}
            watcherIds={rowWatcherIds(row)}
            statuses={statuses}
            timeTrackingOn={timeTrackingEnabled}
            isCreator={menuIsCreator}
            listContext={listContext}
            onPatch={(body) => onUpdate(row.id, body as Partial<BoardItemRow>)}
            onOpen={onOpen}
            onRenameRequested={() => setEditToken((t) => t + 1)}
            onDuplicated={onDuplicate ? () => onDuplicate(row) : undefined}
            onArchived={() => onArchive(row.id)}
            onDeleted={() => onDeleted(row.id)}
            // Same rule as the Kanban card: a moved task leaves this List, so
            // the row goes with it rather than lingering until a reload.
            onMoved={() => onDeleted(row.id)}
            onRemovedFromList={() => onDeleted(row.id)}
          />
        ) : null}
      </td>
    </tr>
  );
}

// A custom-field cell that is editable in place, per type. Read-only viewers
// (or no edit rights) see the compact display; editors get the field's own
// inline editor — a dropdown for select fields, a text input for text, a date
// picker for dates, etc. — so each column behaves like its own kind of cell.
function EditableFieldCell({ field, value, canEdit, onChange, boardId, itemId, connections, mirror, onCommit }: {
  field: FieldDef;
  value: unknown;
  canEdit: boolean;
  onChange: (next: unknown) => void;
  /** Scopes a USER / PEOPLE cell's candidates AND the people it can draw. */
  boardId: string | null;
  /** Phase 5b: a Connect cell excludes its own task from the picker. */
  itemId?: string;
  /** Phase 5b: the connected tasks THIS viewer can read, for a Connect cell. */
  connections?: NonNullable<BoardItemRow["connections"]>[string];
  /** Phase 5b: a Mirror cell's computed value. */
  mirror?: NonNullable<BoardItemRow["mirrors"]>[string];
  /** Phase 5b: a Connect cell commits and hears the answer (it keeps its selection on a failure). */
  onCommit?: (next: unknown) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  // Only a Connect cell uses onCommit; every other type keeps onChange, so a
  // List without connect columns renders and saves exactly as before.
  const connect = isConnectField(field);
  const extra = {
    fieldListId: boardId,
    itemId: itemId ?? null,
    ...(connections ? { connections } : {}),
    ...(mirror ? { mirror } : {}),
    ...(connect && onCommit ? { onCommit } : {}),
  };
  if (!canEdit) return <FieldValue field={field} value={value} mode="display" boardId={boardId} {...extra} />;
  return <FieldValue field={field} value={value} mode="edit" onChange={onChange} boardId={boardId} {...extra} />;
}

// Inline due-date cell — the full ClickUp DatePlanner (Date / Reminder / Repeat)
// reachable straight from the row's date affordance, so recurrence + reminders
// are one click away without opening the task.
function DueDateCell({ row, canEdit, statuses, onUpdate }: { row: BoardItemRow; canEdit: boolean; statuses: StatusOption[]; onUpdate: (id: string, patch: RowPatch) => void }) {
  const done = isDoneStatus(statuses, row.status);
  return (
    <DatePlanner
      item={row}
      canEdit={canEdit}
      statuses={statuses}
      done={done}
      compact
      onPatch={(body) => onUpdate(row.id, body as unknown as RowPatch)}
    />
  );
}

// Subtasks display-mode menu (ClickUp's "Show subtasks"): Collapsed / Expanded /
// Separate. Collapsed/Expanded drive the per-row expand state in one shot.
function SubtaskModeMenu({ onCollapseAll, onExpandAll }: { onCollapseAll: () => void; onExpandAll: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"collapsed" | "expanded" | "separate">("collapsed");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const opts: { k: "collapsed" | "expanded" | "separate"; label: string; note?: string; hint?: string }[] = [
    { k: "collapsed", label: "Collapsed", note: "(default)" },
    { k: "expanded", label: "Expanded" },
    { k: "separate", label: "Separate", hint: "Use this to filter subtasks" },
  ];

  function pick(k: "collapsed" | "expanded" | "separate") {
    setMode(k);
    setOpen(false);
    if (k === "collapsed") onCollapseAll();
    else if (k === "expanded") onExpandAll();
    // "separate" — show subtasks as their own rows; lands in a later pass.
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Subtasks"
        aria-label="Subtasks display"
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
      >
        <Network className="w-3.5 h-3.5" />
        <span className="font-medium">Subtasks</span>
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 left-0 w-[220px] rounded-lg border border-zinc-200 bg-white shadow-xl py-1.5">
          <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Show subtasks</div>
          {opts.map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => pick(o.k)}
              className="flex items-start gap-2 w-full px-3 py-1.5 text-left hover:bg-zinc-50"
            >
              <span className="flex-1 min-w-0">
                <span className={mode === o.k ? "text-base font-semibold text-zinc-900" : "text-base text-zinc-700"}>{o.label}</span>
                {o.note ? <span className="ml-1 text-xs text-zinc-400">{o.note}</span> : null}
                {o.hint ? <span className="block text-xs text-zinc-400">{o.hint}</span> : null}
              </span>
              {mode === o.k ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)] shrink-0 mt-0.5" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Filter popover (ported from the Personal List's funnel) — field/op/value
// rules combined with an AND/OR connector.
// Sort menu (ported from the Personal List's toolbar).
function SortMenu({ sortKey, onChange }: { sortKey: SortKey; onChange: (k: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const opts: { k: SortKey; label: string }[] = [
    { k: "none", label: "Default" },
    { k: "title", label: "Name" },
    { k: "due", label: "Due date" },
    { k: "created", label: "Date created" },
    { k: "priority", label: "Priority" },
  ];
  const active = sortKey !== "none";
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Sort"
        aria-label="Sort"
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${active ? "text-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_12%,transparent)]" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"}`}
      >
        <ArrowUpDown className="w-4 h-4" />
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 right-0 w-[180px] rounded-lg border border-zinc-200 bg-white shadow-xl py-1.5">
          <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Sort by</div>
          {opts.map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => { onChange(o.k); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-zinc-50"
            >
              <span className={sortKey === o.k ? "flex-1 text-base font-semibold text-zinc-900" : "flex-1 text-base text-zinc-700"}>{o.label}</span>
              {sortKey === o.k ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Custom checkbox — the OS shell's global `button { background:none;border:none }`
// reset (and native checkbox rendering) makes class-based boxes look black, so
// the fill + border are set via inline styles, like the Switch primitive.
function CheckBox({ checked, indeterminate, onChange, className = "" }: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (shiftKey?: boolean) => void;
  className?: string;
}) {
  const on = checked || !!indeterminate;
  return (
    <span
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onChange(e.shiftKey); }}
      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onChange(false); } }}
      style={{ backgroundColor: on ? "var(--os-brand)" : "#fff", border: on ? "1px solid var(--os-brand)" : "1px solid #d4d4d8" }}
      className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded cursor-pointer shrink-0 transition-colors ${className}`}
    >
      {checked ? <Check className="w-2.5 h-2.5 text-white" /> : indeterminate ? <span className="block w-1.5 h-[2px] rounded-full bg-white" /> : null}
    </span>
  );
}

// A row's meta cell (Assignee / Due / Priority / …) — its content sits in a
// rounded area that highlights on hover, so each cell reads as its own aligned
// "section" like ClickUp. Content left-aligns at ~16px to match the header.
// ms → "Xh Ym" (or "—" when nothing tracked). Mirrors the topbar timer format.
function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "—";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// Timeline cell — a compact start→due span cue (bar + short date range). Reads
// the same startAt/dueAt the Gantt view uses, so a List can preview scheduling.
function TimelineCell({ startAt, dueAt }: { startAt?: Date | string | null; dueAt?: Date | string | null }) {
  const valid = (d: Date | string | null | undefined): Date | null => {
    if (!d) return null;
    const x = new Date(d);
    return Number.isNaN(x.getTime()) ? null : x;
  };
  const s = valid(startAt);
  const e = valid(dueAt);
  if (!s && !e) return <span className="text-xs text-zinc-400">—</span>;
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const label = s && e ? `${fmt(s)} – ${fmt(e)}` : fmt((s ?? e)!);
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className="h-1.5 w-8 rounded-full bg-[#00C875]/70 shrink-0" />
      <span className="text-xs text-zinc-500 truncate">{label}</span>
    </span>
  );
}

function MetaCell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  // Clicking anywhere in the cell (not just the icon) opens the cell's picker:
  // forward the click to the inner trigger button unless the icon/menu was hit.
  const forwardClick = (e: React.MouseEvent) => {
    const btn = ref.current?.querySelector("button");
    const t = e.target as Node;
    if (btn && t !== btn && !btn.contains(t)) btn.click();
  };
  return (
    <td className="px-1 py-1 align-middle overflow-hidden" style={style}>
      <div
        ref={ref}
        onClick={forwardClick}
        className="flex items-center min-w-0 min-h-[28px] rounded-md px-2 border border-transparent cursor-pointer hover:bg-zinc-100/70 hover:border-zinc-200 transition-colors [&>*]:min-w-0"
      >
        {children}
      </div>
    </td>
  );
}

// Column header with a right-edge drag handle. A 2px brand line appears on
// hover (ClickUp style). Dragging resizes THIS column; every column to its
// right shifts as a block (the trailing actions column absorbs the delta), so
// it can never collapse the layout.
function ResizableTh({ label, width, className, canEdit, onResize, menu, icon, stickyStyle, pinned = false }: {
  label: string;
  width: number;
  className?: string;
  canEdit: boolean;
  onResize: (e: React.PointerEvent) => void;
  /** Column-header menu (sort / group / hide / move / edit-delete field). When
   *  present, a caret appears on hover and right-clicking the header opens it. */
  menu?: ColMenuCtx;
  /** Colored field-type icon shown before the label (ClickUp parity). */
  icon?: { Icon: LucideIcon; color: string } | null;
  /** Phase 5b: a frozen header cell's position while any column is pinned. */
  stickyStyle?: React.CSSProperties;
  /** Phase 5b: the column is pinned (a small pin before the label says so). */
  pinned?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <th
      className={`relative group/th py-2 font-medium ${className ?? "px-3"}`}
      style={{ width, ...(stickyStyle ?? {}) }}
      onContextMenu={menu ? (e) => { e.preventDefault(); setPoint({ x: e.clientX, y: e.clientY }); setOpen(true); } : undefined}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {pinned ? <Pin className="w-3 h-3 shrink-0 text-ink-3" strokeWidth={1.5} aria-label="Pinned column" /> : null}
        {icon ? <icon.Icon className="w-3.5 h-3.5 shrink-0" style={{ color: icon.color }} aria-hidden /> : null}
        <span className="block truncate">{label}</span>
        {menu ? (
          <button
            ref={btnRef}
            type="button"
            onClick={(e) => { e.stopPropagation(); setPoint(null); setOpen((v) => !v); }}
            className={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200 transition-opacity ${open ? "opacity-100" : "opacity-0 group-hover/th:opacity-100"}`}
            title="Column options"
            aria-label="Column options"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        ) : null}
      </div>
      {canEdit ? (
        <span
          onPointerDown={onResize}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute top-0 right-0 h-full w-2 flex justify-end cursor-col-resize select-none touch-none z-10"
          title="Drag to resize"
          aria-hidden
        >
          <span className="w-[2px] h-full bg-transparent group-hover/th:bg-[var(--os-brand)] transition-colors" />
        </span>
      ) : null}
      {menu ? (
        <MorePortal anchorRef={btnRef} panelRef={panelRef} width={212} open={open} placement="below" point={point}>
          <ColumnMenu ctx={menu} close={() => setOpen(false)} />
        </MorePortal>
      ) : null}
    </th>
  );
}

// The column-header dropdown. Renders only the actions its ctx enables.
function ColumnMenu({ ctx, close }: { ctx: ColMenuCtx; close: () => void }) {
  const run = (fn?: () => void) => { fn?.(); close(); };
  const hasFieldOps = !!(ctx.onEditField || ctx.onMoveStart || ctx.onHide || ctx.onDeleteField);
  return (
    <MenuList className="min-w-[212px]" onClick={(e) => e.stopPropagation()}>
      <MenuItem icon={ArrowUp} label="Sort ascending" onClick={() => run(() => ctx.onSort("asc"))} />
      <MenuItem icon={ArrowDown} label="Sort descending" onClick={() => run(() => ctx.onSort("desc"))} />
      {ctx.sortDir ? <MenuItem icon={X} label="Clear sort" onClick={() => run(() => ctx.onSort(null))} /> : null}
      {ctx.onTogglePin ? (
        <>
          <MenuSeparator />
          <MenuItem icon={ctx.pinned ? PinOff : Pin} label={ctx.pinned ? "Unpin column" : "Pin column"} onClick={() => run(ctx.onTogglePin)} />
        </>
      ) : null}
      {ctx.onGroup ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Layers} label={ctx.grouped ? "Ungroup" : "Group by this column"} onClick={() => run(ctx.onGroup)} />
        </>
      ) : null}
      {ctx.onEditStatuses ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Settings2} label="Edit statuses" onClick={() => run(ctx.onEditStatuses)} />
        </>
      ) : null}
      {hasFieldOps ? <MenuSeparator /> : null}
      {ctx.onEditField ? <MenuItem icon={Pencil} label="Edit field" onClick={() => run(ctx.onEditField)} /> : null}
      {ctx.onMoveStart ? <MenuItem icon={ChevronsLeft} label="Move to start" onClick={() => run(ctx.onMoveStart)} /> : null}
      {ctx.onMoveEnd ? <MenuItem icon={ChevronsRight} label="Move to end" onClick={() => run(ctx.onMoveEnd)} /> : null}
      {ctx.onHide ? <MenuItem icon={EyeOff} label="Hide column" onClick={() => run(ctx.onHide)} /> : null}
      {ctx.onDeleteField ? <MenuItem icon={Trash2} label="Delete field" destructive onClick={() => run(ctx.onDeleteField)} /> : null}
      {ctx.onAddColumn ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Plus} label="Add column" onClick={() => run(ctx.onAddColumn)} />
        </>
      ) : null}
    </MenuList>
  );
}

// Inline, type-first subtask add. Collapsed = a "+ Add subtask" affordance;
// click (or the row's hover "Add subtask" button, via autoFocus) opens an
// input where you type the name and press Enter. Stays open after each save
// for rapid-fire entry — no "New subtask" placeholder to rename.
function AddSubtaskRow({
  parentId,
  indent,
  colCount,
  autoFocus = false,
  onAutoFocusHandled,
  onCreate,
}: {
  parentId: string;
  indent: number;
  colCount: number;
  autoFocus?: boolean;
  onAutoFocusHandled?: () => void;
  onCreate: (title: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  // `open` is DERIVED from the parent's focus request (autoFocus) instead of
  // state-synced in an effect (react-hooks/set-state-in-effect). The hover
  // "Add subtask" button opens the row purely via the prop; once the input
  // actually receives focus, its onFocus (an event, not an effect) latches
  // openSelf so the row stays open, and releases the parent's request so a
  // later request re-fires cleanly.
  const [openSelf, setOpenSelf] = useState(false);
  const open = openSelf || autoFocus;
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pad = 60 + indent * 20;

  // Closing also releases the parent's focus request (normally a no-op — the
  // input's onFocus already did) so `open` can't stick true if focus never
  // landed while autoFocus still points at this row.
  const closeRow = () => { setOpenSelf(false); onAutoFocusHandled?.(); };

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  // A repeat request on an already-open row (e.g. it holds typed-but-
  // unsubmitted text, so `open` never toggles and the effect above won't
  // re-fire) still needs the cursor to land in the input.
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const save = async () => {
    const t = title.trim();
    if (!t || busy) { if (!t) { closeRow(); setFailed(null); } return; }
    setBusy(true);
    setFailed(null);
    const res = await onCreate(t);
    setBusy(false);
    if (res.ok) { setTitle(""); inputRef.current?.focus(); }
    else setFailed(res.error ?? "Couldn't add subtask");
  };

  return (
    <tr className="hover:bg-zinc-50" data-parent-id={parentId}>
      <td colSpan={colCount} className="py-1.5 pr-4">
        {open ? (
          <div className="flex items-center gap-2" style={{ paddingLeft: pad }}>
            <Plus className="w-3 h-3 text-zinc-400 shrink-0" />
            <input
              ref={inputRef}
              value={title}
              onFocus={() => { setOpenSelf(true); onAutoFocusHandled?.(); }}
              onChange={(e) => { setTitle(e.target.value); if (failed) setFailed(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void save(); }
                if (e.key === "Escape") { setTitle(""); setFailed(null); closeRow(); }
              }}
              onBlur={() => { if (!title.trim() && !busy) closeRow(); }}
              placeholder="Type a subtask and press Enter…"
              className="flex-1 text-base bg-transparent outline-none placeholder:text-zinc-400"
            />
            {busy ? <Dots variant="pending" /> : null}
            {failed ? <span className="text-xs text-red-500 shrink-0">{failed}</span> : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpenSelf(true)}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-700"
            style={{ paddingLeft: pad }}
          >
            <Plus className="w-3 h-3" />
            Add subtask
          </button>
        )}
      </td>
    </tr>
  );
}

// AddTaskInline — the ClickUp-style inline add row. Collapsed = a "+ Add Task"
// affordance; open = a status circle + name input plus quick-set icons
// (Assignee / Due / Priority / Tags) and a Save button, so a task is created
// WITH those fields already set. Stays open after saving to add the next one.
function AddTaskInline({
  statuses,
  defaultStatus,
  statusChosen = false,
  listDefaultStatus = null,
  itemTypes,
  defaultTypeId,
  listDefaultTypeId = null,
  boardId,
  onCreate,
}: {
  statuses: StatusOption[];
  defaultStatus: string;
  /**
   * Is `defaultStatus` the person's choice? It is inside a status group (the
   * group is where they clicked), so the List's default status never
   * replaces it there.
   */
  statusChosen?: boolean;
  /** The List's default status (loaded and still declared), shown and applied when the status is not chosen. */
  listDefaultStatus?: string | null;
  itemTypes: ItemTypeLite[];
  defaultTypeId: string | null;
  /** The List's default task type, shown and applied until the person picks a type. */
  listDefaultTypeId?: string | null;
  /** Scopes the quick-set assignee picker to this list's people. */
  boardId?: string | null;
  onCreate: (p: { title: string; status: string; ownerId: string | null; dueAt: string | null; priority: string | null; tagIds: string[]; itemTypeId: string | null; touched: ReadonlySet<string> }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [owner, setOwner] = useState<PersonRef | null>(null);
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [dueEditing, setDueEditing] = useState(false);
  const [priority, setPriority] = useState<string | null>(null);
  const [tags, setTags] = useState<ItemTag[]>([]);
  const [typeId, setTypeId] = useState<string | null>(defaultTypeId);
  // Did the person pick the type? Until they do, the List's default type (if
  // it has one) is what the new task gets, so that is what the row shows.
  const [typePicked, setTypePicked] = useState(false);
  const [typeMenu, setTypeMenu] = useState(false);
  const typeRef = useRef<HTMLSpanElement>(null);
  const [busy, setBusy] = useState(false);
  const shownStatus = statusChosen ? defaultStatus : (listDefaultStatus ?? defaultStatus);
  const current = statuses.find((s) => s.value === shownStatus) ?? null;
  const shownTypeId = typePicked ? typeId : (listDefaultTypeId ?? typeId);
  const activeType = itemTypes.find((t) => t.id === shownTypeId) ?? itemTypes.find((t) => t.id === defaultTypeId) ?? null;
  const typeLabel = activeType?.singular ?? "Task";

  useEffect(() => {
    if (!typeMenu) return;
    const onDoc = (e: MouseEvent) => { if (typeRef.current && !typeRef.current.contains(e.target as Node)) setTypeMenu(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [typeMenu]);

  // Keep the chosen type across saves (ClickUp keeps the type sticky).
  const clearFields = () => { setTitle(""); setOwner(null); setDueAt(null); setDueEditing(false); setPriority(null); setTags([]); };
  const close = () => { setOpen(false); setTypeMenu(false); clearFields(); };
  const save = async () => {
    const t = title.trim();
    if (!t) { close(); return; }
    setBusy(true);
    setFailed(null);
    // What the person chose, so the List's defaults fill only the rest
    // (list-defaults-client.ts). Due date is not a defaulted key.
    const touched = new Set<string>();
    if (statusChosen) touched.add("status");
    if (owner) touched.add("ownerId");
    if (priority) touched.add("priority");
    if (tags.length > 0) touched.add("tagIds");
    if (typePicked) touched.add("itemTypeId");
    const res = await onCreate({ title: t, status: defaultStatus, ownerId: owner?.id ?? null, dueAt, priority, tagIds: tags.map((x) => x.id), itemTypeId: typeId, touched });
    setBusy(false);
    if (res.ok) {
      clearFields(); // success — keep the row open (and the type) for the next task
    } else {
      // Keep the typed text so nothing is lost, and show why it failed.
      setFailed(res.error ?? "Couldn't save this task");
    }
  };

  const openWithType = (id: string | null) => { setTypeId(id); setTypePicked(true); setOpen(true); };

  if (!open) {
    return (
      <span className="relative inline-flex items-center" ref={typeRef} style={{ paddingLeft: 60 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-base text-zinc-400 hover:text-zinc-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Task
        </button>
        {itemTypes.length > 0 ? (
          <button
            type="button"
            onClick={() => setTypeMenu((v) => !v)}
            className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
            title="Add a different type"
            aria-label="Choose task type"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        ) : null}
        {typeMenu ? (
          <div className="absolute left-14 top-7 z-30 w-[200px] rounded-lg border border-zinc-200 bg-white shadow-xl py-1">
            <div className="px-3 pt-1 pb-0.5 text-micro font-semibold uppercase tracking-wide text-zinc-400">Create</div>
            {itemTypes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTypeMenu(false); openWithType(t.id); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-base text-zinc-700 hover:bg-zinc-50"
              >
                {React.createElement(itemTypeIcon(t.icon), { className: "w-3.5 h-3.5 text-zinc-400" })}
                {t.singular}
              </button>
            ))}
          </div>
        ) : null}
      </span>
    );
  }

  const dueDate = dueAt ? new Date(dueAt) : null;
  const dueInput = dueDate
    ? `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(dueDate.getDate()).padStart(2, "0")}`
    : "";

  // Each quick-set control sits in an identical bordered box (ClickUp parity).
  const box = "inline-flex items-center justify-center h-7 min-w-[28px] px-1 rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-colors";
  return (
    <div>
    <div className={`flex items-center gap-2 py-0.5 ${failed ? "rounded-md ring-1 ring-red-300 bg-red-50/40" : ""}`} style={{ paddingLeft: 36 }}>
      <StatusGlyph current={current} statuses={statuses} />
      <input
        autoFocus
        value={title}
        onChange={(e) => { setTitle(e.target.value); if (failed) setFailed(null); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void save(); }
          else if (e.key === "Escape") { close(); }
        }}
        placeholder="Task name, or type to search…"
        className="flex-1 min-w-0 bg-transparent outline-none text-xs text-zinc-900 placeholder:text-zinc-400"
      />
      <span className="inline-flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        {itemTypes.length > 0 ? (
          <span className="relative inline-flex" ref={typeRef}>
            <button
              type="button"
              onClick={() => setTypeMenu((v) => !v)}
              className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 text-sm text-zinc-700"
              title="Task type"
            >
              {React.createElement(itemTypeIcon(activeType?.icon), { className: "w-3.5 h-3.5 text-zinc-500" })}
              {typeLabel}
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>
            {typeMenu ? (
              <div className="absolute right-0 top-8 z-30 w-[190px] rounded-lg border border-zinc-200 bg-white shadow-xl py-1">
                {itemTypes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTypeId(t.id); setTypePicked(true); setTypeMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-base text-zinc-700 hover:bg-zinc-50"
                  >
                    {React.createElement(itemTypeIcon(t.icon), { className: "w-3.5 h-3.5 text-zinc-400" })}
                    <span className="flex-1 truncate">{t.singular}</span>
                    {t.id === shownTypeId ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </span>
        ) : null}
        {itemTypes.length > 0 ? <span aria-hidden className="w-px h-5 bg-zinc-200 mx-0.5" /> : null}
        <span className={box} title="Assignee"><AssigneePicker value={owner} canEdit compact boardId={boardId} onChange={setOwner} /></span>
        <span className={`relative ${box} ${dueDate ? "text-zinc-700" : "text-zinc-400"}`} title="Due date">
          <button
            type="button"
            onClick={() => setDueEditing((v) => !v)}
            className="inline-flex items-center justify-center gap-1 w-full h-full text-sm"
          >
            {dueDate ? <span className="px-0.5">{dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span> : <CalendarPlus className="w-[17px] h-[17px]" />}
          </button>
          {dueEditing ? (
            <input
              type="date"
              autoFocus
              value={dueInput}
              // Local midnight, not UTC: the same rule the bulk bar and the
              // calendar drag follow (audit Medium #24, critic #13).
              onChange={(e) => { setDueAt(e.target.value ? localDayIso(e.target.value) : null); setDueEditing(false); }}
              onBlur={() => setDueEditing(false)}
              className="absolute left-0 top-8 z-20 h-7 px-1 text-sm border border-zinc-200 rounded bg-white shadow-md focus:outline-none focus:border-[var(--os-brand)]"
            />
          ) : null}
        </span>
        <span className={box} title="Priority"><PriorityPicker value={priority} canEdit compact onChange={setPriority} /></span>
        <span className={`${box} ${tags.length ? "w-auto" : ""}`} title="Tags"><TagPicker value={tags} canEdit compact onChange={setTags} /></span>
        <span aria-hidden className="w-px h-5 bg-zinc-200 mx-0.5" />
        <button type="button" onClick={close} className="h-7 px-2.5 rounded-md text-sm text-zinc-600 hover:bg-zinc-100">Cancel</button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !title.trim()}
          className="h-7 px-3 rounded-md text-sm font-medium text-white inline-flex items-center gap-1 disabled:opacity-50"
          style={{ background: "var(--os-brand)" }}
        >
          {busy ? <Dots variant="pending" /> : null}
          Save <span className="opacity-80 text-base leading-none">↵</span>
        </button>
      </span>
    </div>
    {failed ? (
      <div className="pl-9 pt-0.5 pb-1 text-xs text-red-500">
        {failed} — your text was kept; fix it or try again.
      </div>
    ) : null}
    </div>
  );
}

// ── Monday-style summary footer ────────────────────────────────────
//
// One <tr> aligned to the column set, each cell aggregating its column:
//   Name      → "N items"
//   Status    → proportional stacked color bar
//   Owner     → overlapping avatar stack of distinct people
//   Priority  → proportional stacked color bar
//   Tags      → distinct tag chips (+overflow)
//   custom    → sum (number/money) · average (percent/rating) ·
//               checked-count (checkbox) · choice-distribution bar
//               (dropdown/labels) · range (date)
//   Created   → blank
// Mirrors Monday.com's group summary row.

interface BarSeg { color: string; count: number; label: string }

function StackedBar({ segments }: { segments: BarSeg[] }) {
  const total = segments.reduce((n, s) => n + s.count, 0);
  if (total === 0) return <span className="text-xs text-zinc-300">—</span>;
  return (
    <div
      className="flex h-3.5 w-full max-w-[160px] rounded-sm overflow-hidden ring-1 ring-black/5"
      title={segments.map((s) => `${s.label}: ${s.count}`).join("  ·  ")}
    >
      {segments.map((s, i) => (
        <span key={i} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} aria-hidden />
      ))}
    </div>
  );
}

// Count rows by a key, resolve color/label, return ordered segments.
function choiceSegments(
  rows: BoardItemRow[],
  key: string,
  choices: FieldChoice[],
  multi: boolean,
): BarSeg[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = r.metadata?.[key];
    if (multi) {
      const arr = Array.isArray(raw) ? (raw as string[]) : [];
      for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
    } else if (raw != null && raw !== "") {
      const v = String(raw);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const byValue = new Map(choices.map((c) => [c.value, c] as const));
  // Choice order first, then any unmatched values.
  const segs: BarSeg[] = [];
  for (const c of choices) {
    const n = counts.get(c.value);
    if (n) { segs.push({ color: c.color ?? "#d4d4d8", count: n, label: c.label }); counts.delete(c.value); }
  }
  for (const [v, n] of counts) {
    const c = byValue.get(v);
    segs.push({ color: c?.color ?? "#d4d4d8", count: n, label: c?.label ?? v });
  }
  return segs;
}

function fmtNumber(field: FieldDef, value: number): string {
  const decimals = field.options?.decimals ?? (field.type === "MONEY" ? 2 : 0);
  if (field.type === "MONEY") {
    const cur = field.options?.currency ?? "USD";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
    } catch {
      return `${cur} ${value.toFixed(decimals)}`;
    }
  }
  if (field.type === "PERCENT") return `${value.toFixed(decimals)}%`;
  return value.toFixed(decimals);
}

function CustomFieldSummary({ field, rows }: { field: FieldDef; rows: BoardItemRow[] }) {
  const dash = <span className="text-xs text-zinc-300">—</span>;
  const nums = rows.map((r) => r.metadata?.[field.key]).filter((v): v is number => typeof v === "number");
  switch (field.type) {
    case "NUMBER":
    case "MONEY": {
      if (!nums.length) return dash;
      const sum = nums.reduce((a, b) => a + b, 0);
      return <span className="text-sm font-medium tabular-nums text-zinc-700" title="Sum">{fmtNumber(field, sum)}</span>;
    }
    case "PERCENT": {
      if (!nums.length) return dash;
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return <span className="text-sm font-medium tabular-nums text-zinc-700" title="Average">{fmtNumber(field, avg)}</span>;
    }
    case "RATING": {
      if (!nums.length) return dash;
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return <span className="text-sm font-medium tabular-nums text-zinc-700" title="Average">{avg.toFixed(1)}★</span>;
    }
    case "CHECKBOX": {
      const checked = rows.filter((r) => !!r.metadata?.[field.key]).length;
      return <span className="text-sm tabular-nums text-zinc-700" title="Checked">{checked}/{rows.length}</span>;
    }
    case "DROPDOWN":
    case "TSHIRT_SIZE":
      return <StackedBar segments={choiceSegments(rows, field.key, field.options?.choices ?? [], false)} />;
    case "MULTI_SELECT":
    case "LABELS":
      return <StackedBar segments={choiceSegments(rows, field.key, field.options?.choices ?? [], true)} />;
    default:
      return dash;
  }
}

function GroupSummaryRow({
  rows,
  customFields,
  statuses,
  railColor,
  columnKeys,
  stickyLeft = null,
  showOwner = true,
  showPriority = true,
  showType = true,
  showTags = true,
  showCreated = false,
  showStart = false,
  showUpdated = false,
  showTaskId = false,
  showComments = false,
  showTimeline = false,
  showTime = false,
  showCreatedBy = false,
  showDocs = false,
  showLinked = false,
  showSops = false,
}: {
  rows: BoardItemRow[];
  customFields: FieldDef[];
  statuses: StatusOption[];
  railColor: string | null;
  /**
   * Phase 5b: the meta columns in display order, passed while columns are
   * pinned so the summary lines up with the reordered columns. Absent: the
   * summary renders exactly as it always has.
   */
  columnKeys?: string[];
  stickyLeft?: Map<string, number> | null;
  showOwner?: boolean;
  showPriority?: boolean;
  showType?: boolean;
  showTags?: boolean;
  showCreated?: boolean;
  showStart?: boolean;
  showUpdated?: boolean;
  showTaskId?: boolean;
  showComments?: boolean;
  showTimeline?: boolean;
  showTime?: boolean;
  showCreatedBy?: boolean;
  showDocs?: boolean;
  showLinked?: boolean;
  showSops?: boolean;
}) {
  // Status + priority stacked bars.
  const statusSegs = useMemo<BarSeg[]>(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status ?? "__none__", (counts.get(r.status ?? "__none__") ?? 0) + 1);
    const segs: BarSeg[] = [];
    for (const o of statuses) {
      const n = counts.get(o.value);
      if (n) { segs.push({ color: o.color, count: n, label: o.label }); counts.delete(o.value); }
    }
    for (const [v, n] of counts) segs.push({ color: "#d4d4d8", count: n, label: v === "__none__" ? "No status" : v });
    return segs;
  }, [rows, statuses]);

  const prioritySegs = useMemo<BarSeg[]>(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.priority) counts.set(r.priority, (counts.get(r.priority) ?? 0) + 1);
    const segs: BarSeg[] = [];
    for (const p of PRIORITY_OPTIONS) {
      const n = counts.get(p.value);
      if (n) segs.push({ color: p.color, count: n, label: p.label });
    }
    return segs;
  }, [rows]);

  // Distinct owners (avatar stack) + distinct tags.
  const owners = useMemo(() => {
    const map = new Map<string, NonNullable<BoardItemRow["owner"]>>();
    for (const r of rows) if (r.owner) map.set(r.owner.id, r.owner);
    return Array.from(map.values());
  }, [rows]);
  const tags = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string | null }>();
    for (const r of rows) for (const t of r.tags ?? []) map.set(t.id, t);
    return Array.from(map.values());
  }, [rows]);

  if (columnKeys) {
    const fieldByKey = new Map(customFields.map((f) => [f.key, f] as const));
    const stick = (key: string): React.CSSProperties | undefined =>
      stickyLeft?.has(key) ? { position: "sticky", left: stickyLeft.get(key), zIndex: 2, background: "var(--os-surface-1, var(--os-surface))" } : undefined;
    const cell = (key: string): React.ReactNode => {
      const f = fieldByKey.get(key);
      if (f) return <td key={key} className="px-4 py-1.5" style={stick(key)}><CustomFieldSummary field={f} rows={rows} /></td>;
      switch (key) {
        case "status":
          return <td key={key} className="px-4 py-1.5" style={stick(key)}><StackedBar segments={statusSegs} /></td>;
        case "owner":
          return (
            <td key={key} className="px-4 py-1.5" style={stick(key)}>
              {owners.length === 0 ? (
                <span className="text-xs text-zinc-300">—</span>
              ) : (
                <span className="inline-flex items-center -space-x-1.5" title={owners.map((o) => `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim()).join(", ")}>
                  {owners.slice(0, 5).map((o) => (
                    <span key={o.id} className="rounded-full ring-2 ring-white">
                      <PersonAvatar person={{ ...o, email: null }} size={20} />
                    </span>
                  ))}
                  {owners.length > 5 ? <span className="pl-2.5 text-xs text-zinc-500">+{owners.length - 5}</span> : null}
                </span>
              )}
            </td>
          );
        case "priority":
          return (
            <td key={key} className="px-4 py-1.5" style={stick(key)}>
              {prioritySegs.length ? <StackedBar segments={prioritySegs} /> : <span className="text-xs text-zinc-300">—</span>}
            </td>
          );
        case "tags":
          return (
            <td key={key} className="px-4 py-1.5" style={stick(key)}>
              {tags.length === 0 ? (
                <span className="text-xs text-zinc-300">—</span>
              ) : (
                <span className="inline-flex items-center gap-1 flex-wrap">
                  {tags.slice(0, 3).map((t) => {
                    const c = t.color || "#71717A";
                    return (
                      <span key={t.id} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: `${c}22`, color: c }}>
                        {t.name}
                      </span>
                    );
                  })}
                  {tags.length > 3 ? <span className="text-xs text-zinc-500">+{tags.length - 3}</span> : null}
                </span>
              )}
            </td>
          );
        default:
          return <td key={key} className="px-4 py-1.5" style={stick(key)} />;
      }
    };
    return (
      <tr className="bg-zinc-50/60 border-b border-zinc-200 text-xs">
        <td className="px-2 py-1.5" style={{ ...(railColor ? { boxShadow: `inset 3px 0 0 ${railColor}` } : {}), ...(stick("__leading") ?? {}) }} />
        <td className="px-4 py-1.5 text-zinc-400" style={stick("name")}>{rows.length} item{rows.length === 1 ? "" : "s"}</td>
        {columnKeys.map(cell)}
        <td className="px-2 py-1.5" />
      </tr>
    );
  }

  return (
    <tr className="bg-zinc-50/60 border-b border-zinc-200 text-xs">
      {/* checkbox spacer — carries the group color rail */}
      <td className="px-2 py-1.5" style={railColor ? { boxShadow: `inset 3px 0 0 ${railColor}` } : undefined} />
      {/* Name → count */}
      <td className="px-4 py-1.5 text-zinc-400">{rows.length} item{rows.length === 1 ? "" : "s"}</td>
      {/* Status */}
      <td className="px-4 py-1.5"><StackedBar segments={statusSegs} /></td>
      {/* Owner */}
      {showOwner ? (
        <td className="px-4 py-1.5">
          {owners.length === 0 ? (
            <span className="text-xs text-zinc-300">—</span>
          ) : (
            <span className="inline-flex items-center -space-x-1.5" title={owners.map((o) => `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim()).join(", ")}>
              {owners.slice(0, 5).map((o) => (
                <span key={o.id} className="rounded-full ring-2 ring-white">
                  <PersonAvatar person={{ ...o, email: null }} size={20} />
                </span>
              ))}
              {owners.length > 5 ? <span className="pl-2.5 text-xs text-zinc-500">+{owners.length - 5}</span> : null}
            </span>
          )}
        </td>
      ) : null}
      {/* Priority */}
      {showPriority ? (
        <td className="px-4 py-1.5">
          {prioritySegs.length ? <StackedBar segments={prioritySegs} /> : <span className="text-xs text-zinc-300">—</span>}
        </td>
      ) : null}
      {/* Type spacer */}
      {showType ? <td className="px-4 py-1.5" /> : null}
      {/* Tags */}
      {showTags ? (
        <td className="px-4 py-1.5">
          {tags.length === 0 ? (
            <span className="text-xs text-zinc-300">—</span>
          ) : (
            <span className="inline-flex items-center gap-1 flex-wrap">
              {tags.slice(0, 3).map((t) => {
                const c = t.color || "#71717A";
                return (
                  <span key={t.id} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: `${c}22`, color: c }}>
                    {t.name}
                  </span>
                );
              })}
              {tags.length > 3 ? <span className="text-xs text-zinc-500">+{tags.length - 3}</span> : null}
            </span>
          )}
        </td>
      ) : null}
      {/* Custom fields */}
      {customFields.map((f) => (
        <td key={f.key} className="px-4 py-1.5"><CustomFieldSummary field={f} rows={rows} /></td>
      ))}
      {/* Optional built-in column spacers (match the data-row columns) + actions */}
      {showCreated ? <td className="px-4 py-1.5" /> : null}
      {showStart ? <td className="px-4 py-1.5" /> : null}
      {showUpdated ? <td className="px-4 py-1.5" /> : null}
      {showTaskId ? <td className="px-4 py-1.5" /> : null}
      {showComments ? <td className="px-4 py-1.5" /> : null}
      {showTimeline ? <td className="px-4 py-1.5" /> : null}
      {showTime ? <td className="px-4 py-1.5" /> : null}
      {showCreatedBy ? <td className="px-4 py-1.5" /> : null}
      {showDocs ? <td className="px-4 py-1.5" /> : null}
      {showLinked ? <td className="px-4 py-1.5" /> : null}
      {showSops ? <td className="px-4 py-1.5" /> : null}
      <td className="px-2 py-1.5" />
    </tr>
  );
}

function GroupStatusBreakdown({ rows, statuses }: { rows: BoardItemRow[]; statuses: StatusOption[] }) {
  // Bucket rows by their status's real group (per-List statuses carry
  // ACTIVE|DONE|CLOSED) — replaces the old hardcoded-value heuristic.
  // Unknown/unset statuses count as OPEN. Matches the ClickUp
  // "5 OPEN / 3 DONE / 1 CLOSED" popover.
  const groupByValue = new Map(statuses.map((o) => [o.value, o.group] as const));
  const counts = { ACTIVE: 0, DONE: 0, CLOSED: 0 } as Record<string, number>;
  for (const r of rows) {
    const group = (r.status ? groupByValue.get(r.status) : null) ?? "ACTIVE";
    counts[group] += 1;
  }
  return (
    <details className="relative inline-block">
      <summary
        className="list-none cursor-pointer inline-flex items-center text-xs text-zinc-400 hover:text-zinc-700 w-4 h-4 rounded hover:bg-zinc-200/70 justify-center select-none opacity-0 group-hover/ghdr:opacity-100 focus-within:opacity-100 transition-opacity"
        title="Status breakdown"
      >
        …
      </summary>
      <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-zinc-200 bg-white shadow-lg py-1.5">
        {(["ACTIVE", "DONE", "CLOSED"] as const).map((bucket) => {
          const dotColor = bucket === "ACTIVE" ? "#71717A" : bucket === "DONE" ? "#00C875" : "#71717A";
          const label = bucket === "ACTIVE" ? "OPEN" : bucket;
          return (
            <div key={bucket} className="flex items-center gap-2 px-3 py-1 text-xs">
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} aria-hidden />
              <span className="tabular-nums text-zinc-700 w-4">{counts[bucket]}</span>
              <span className="text-zinc-500">{label}</span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

// Row hover options — each icon in its OWN bordered box (like ClickUp), not one
// container. A top-level task shows Add-subtask + Tags + Rename (3); a subtask
// shows only Tags + Rename (2, no add-subtask). No copy-link.
function RowHoverActions({ canEdit, tags, isSubtask, onAddSubtask, onTagsChange, onRename }: {
  canEdit: boolean;
  tags: ItemTag[];
  isSubtask: boolean;
  onAddSubtask: () => void;
  onTagsChange: (tags: ItemTag[]) => void;
  onRename: () => void;
}) {
  if (!canEdit) return null;
  const box = "inline-flex items-center justify-center w-7 h-7 rounded-md border border-zinc-200 bg-white shadow-sm text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 transition-colors dark:bg-[#262B33] dark:border-[#2A2F38] dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-[#2A2F38]";
  return (
    <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 shrink-0 ml-2">
      {!isSubtask ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onAddSubtask(); }} className={box} title="Add subtask" aria-label="Add subtask">
          <Plus className="w-3.5 h-3.5" />
        </button>
      ) : null}
      <span onClick={(e) => e.stopPropagation()} className={box} title="Tags">
        <TagPicker value={tags} canEdit compact onChange={onTagsChange} />
      </span>
      <button type="button" onClick={(e) => { e.stopPropagation(); onRename(); }} className={box} title="Rename" aria-label="Rename task">
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}

function TitleCell({
  row,
  canEdit,
  onUpdate,
  onOpen,
  editToken = 0,
  wrap = false,
}: {
  row: BoardItemRow;
  canEdit: boolean;
  onUpdate: (id: string, patch: Partial<Pick<BoardItemRow, "title">>) => void;
  onOpen?: () => void;
  /** Bumped externally (the hover "rename" pencil) to enter edit mode. */
  editToken?: number;
  /** Phase 5b: a Tall row lets the title wrap to two lines. */
  wrap?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // When the external rename token changes, open the editor.
  const [seenToken, setSeenToken] = useState(editToken);
  if (editToken !== seenToken) {
    setSeenToken(editToken);
    if (canEdit) setEditing(true);
  }

  // Derived-state-during-render (guarded setState) — avoids the
  // cascading-renders lint that fires on useEffect(setDraft).
  const [syncedTitle, setSyncedTitle] = useState(row.title);
  if (syncedTitle !== row.title) {
    setSyncedTitle(row.title);
    setDraft(row.title);
  }
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(row.title);
      setEditing(false);
      return;
    }
    if (trimmed !== row.title) onUpdate(row.id, { title: trimmed });
    setEditing(false);
  };

  if (!canEdit || !editing) {
    // Cmd/Ctrl-click → inline edit; plain click → open drawer (if
    // available). When read-only or no drawer wired, plain click does
    // nothing.
    return (
      <button
        type="button"
        onClick={(e) => {
          if (canEdit && (e.metaKey || e.ctrlKey)) {
            setEditing(true);
          } else if (onOpen) {
            onOpen();
          } else if (canEdit) {
            setEditing(true);
          }
        }}
        className={`w-full text-left text-zinc-800 hover:text-[var(--os-brand)] transition-colors inline-flex items-center gap-2 ${wrap ? "" : "truncate"}`}
        title={row.title}
      >
        <span className={`flex-1 min-w-0 font-medium ${wrap ? "line-clamp-2 whitespace-normal break-words" : "truncate"}`}>{row.title}</span>
        {row.recurRule ? (
          <span
            className="inline-flex items-center text-[var(--os-brand)] shrink-0"
            title={`${buildRecurrenceSummary(row.recurRule)} — this is the repeating task; each occurrence appears as its own row`}
            aria-label="Repeating task"
          >
            <Repeat className="w-3 h-3" />
          </span>
        ) : (row.metadata as { recurrenceSourceId?: string } | undefined)?.recurrenceSourceId ? (
          // A spawned occurrence carries no rule of its own — without this it
          // looked like an unrelated one-off task appearing from nowhere.
          <span
            className="inline-flex items-center text-zinc-300 shrink-0"
            title="Created automatically by a repeating task"
            aria-label="From a repeating task"
          >
            <Repeat className="w-3 h-3" />
          </span>
        ) : null}
        {(row.commentCount ?? 0) > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-xs text-zinc-400 tabular-nums shrink-0"
            title={`${row.commentCount} comment${row.commentCount === 1 ? "" : "s"}`}
          >
            <MessageSquare className="w-3 h-3" />
            {row.commentCount}
          </span>
        ) : null}
        {(row.attachmentCount ?? 0) > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-xs text-zinc-400 tabular-nums shrink-0"
            title={`${row.attachmentCount} attachment${row.attachmentCount === 1 ? "" : "s"}`}
          >
            <Paperclip className="w-3 h-3" />
            {row.attachmentCount}
          </span>
        ) : null}
      </button>
    );
  }
  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setDraft(row.title); setEditing(false); }
      }}
      className="w-full bg-transparent outline-none border-b border-[var(--os-brand)]"
    />
  );
}

// Per-group "…" menu in a List view group header. Status-editing rows
// (Rename / New status / Edit statuses / Hide status) open the board's
// status editor; collapse/select are local. Automate is deferred.
function GroupHeaderMenu({
  canEditStatuses,
  onEditStatuses,
  onCollapseGroup,
  onCollapseAll,
  onSelectAll,
}: {
  canEditStatuses: boolean;
  onEditStatuses?: () => void;
  onCollapseGroup: () => void;
  onCollapseAll: () => void;
  onSelectAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuPos = useAnchorPos(ref, open, 190);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);
  const act = (fn?: () => void) => () => { fn?.(); setOpen(false); };
  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center justify-center w-5 h-5 rounded text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700 opacity-0 group-hover/ghdr:opacity-100 focus-within:opacity-100 transition-opacity" aria-label="Group options">
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && menuPos ? (
        <div style={{ position: "fixed", left: menuPos.left, minWidth: 190, ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }), maxHeight: menuPos.maxHeight, overflowY: "auto" as const }} className="z-[200] rounded-lg border border-zinc-200 bg-white shadow-lg py-1 text-base">
          <GHItem label="Rename" onClick={act(onEditStatuses)} disabled={!canEditStatuses} />
          <GHItem label="New status" onClick={act(onEditStatuses)} disabled={!canEditStatuses} />
          <GHItem label="Edit statuses" onClick={act(onEditStatuses)} disabled={!canEditStatuses} />
          <div className="h-px bg-zinc-100 my-1" />
          <GHItem label="Collapse group" onClick={act(onCollapseGroup)} />
          <GHItem label="Collapse all groups" onClick={act(onCollapseAll)} />
          <GHItem label="Select all" onClick={act(onSelectAll)} />
          <GHItem label="Hide status" onClick={act(onEditStatuses)} disabled={!canEditStatuses} />
          <div className="h-px bg-zinc-100 my-1" />
          <UpcomingOnly><ComingSoonRow label="Automate status" className="h-8" /></UpcomingOnly>
        </div>
      ) : null}
    </div>
  );
}

function GHItem({ label, onClick, disabled }: { label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="w-full text-left px-3 py-1.5 hover:bg-zinc-50 text-zinc-700 disabled:opacity-40 disabled:hover:bg-transparent">
      {label}
    </button>
  );
}

// Type cell — read-only chip showing the row's ItemType (icon + name).
// Editing the type happens in the create modal + item drawer.
function TypeCell({ itemTypeId, itemTypeMap }: { itemTypeId: string | null; itemTypeMap: Map<string, ItemTypeLite> }) {
  const t = itemTypeId ? itemTypeMap.get(itemTypeId) : null;
  if (!t) return <span className="text-xs text-zinc-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-base text-zinc-600">
      {React.createElement(itemTypeIcon(t.icon), { className: "w-3.5 h-3.5 text-zinc-400" })}
      <span className="truncate">{t.singular}</span>
    </span>
  );
}

function StatusCell({
  row,
  statuses,
  canEdit,
  onUpdate,
  monday = false,
  dot = false,
  current: currentOverride,
}: {
  row: BoardItemRow;
  statuses: StatusOption[];
  canEdit: boolean;
  onUpdate: (id: string, patch: RowPatch) => void;
  /**
   * Phase 5b: a row shown here through a link shows its HOME status pill,
   * whatever this List's own set holds. Absent: resolved from `statuses`.
   */
  current?: StatusOption | null;
  /** Monday-style Table variant: status fills the whole cell with the
   *  status color + white label, instead of a soft pill. */
  monday?: boolean;
  /** Dot variant — renders just the ClickUp status circle (ring when
   *  not-started, filled check when done), used inline before the title
   *  when the List is grouped by status so the Status column is hidden. */
  dot?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"status" | "type">("status");
  const itemTypes = useItemTypes();
  const ref = useRef<HTMLDivElement>(null);
  const menuPos = useAnchorPos(ref, open, 224);
  const current = useMemo(
    () => (currentOverride !== undefined
      ? currentOverride ?? (row.status ? statuses.find((o) => o.value === row.status) ?? null : null)
      : row.status ? statuses.find((o) => o.value === row.status) ?? null : null),
    [row.status, statuses, currentOverride],
  );

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Dot variant — the ClickUp status circle shown before the title when
  // the Status column is hidden (grouped by status). Ring for not-started
  // (ACTIVE), filled with a check for DONE/CLOSED.
  if (dot) {
    const circle = <StatusGlyph current={current} statuses={statuses} />;
    if (!canEdit) return circle;
    const activeTypeId = row.itemTypeId ?? itemTypes.default?.id ?? null;
    return (
      <div className="relative shrink-0 leading-none" ref={ref}>
        <button type="button" onClick={() => setOpen((v) => !v)} title={current?.label ?? "Set status"} className="block">
          {circle}
        </button>
        {open && menuPos ? (
          <div style={{ position: "fixed", left: menuPos.left, width: 224, ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }), maxHeight: menuPos.maxHeight, overflowY: "auto" as const }} className="z-[200] rounded-lg border border-zinc-200 bg-white shadow-xl p-1.5">
            {/* Status / Task Type tab switch (ClickUp). */}
            <div className="flex items-center gap-1 p-0.5 mb-1.5 bg-zinc-100 rounded-md">
              <button type="button" onClick={() => setTab("status")} className={`flex-1 h-7 rounded-[5px] text-base font-medium transition-colors ${tab === "status" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}>Status</button>
              <button type="button" onClick={() => setTab("type")} className={`flex-1 h-7 rounded-[5px] text-base font-medium transition-colors ${tab === "type" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}>Task Type</button>
            </div>
            {tab === "status" ? (
              <div className="max-h-[240px] overflow-y-auto">
                {statuses.map((opt) => {
                  const active = opt.value === row.status;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { onUpdate(row.id, { status: opt.value }); setOpen(false); }}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-xs hover:bg-zinc-50"
                    >
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium" style={{ background: `${opt.color}22`, color: opt.color }}>
                        {opt.label}
                      </span>
                      {active ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="max-h-[240px] overflow-y-auto">
                {itemTypes.list.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-zinc-400">No task types yet.</div>
                ) : (
                  itemTypes.list.map((t) => {
                    const active = activeTypeId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { onUpdate(row.id, { itemTypeId: t.id }); setOpen(false); }}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-base hover:bg-zinc-50"
                      >
                        {React.createElement(itemTypeIcon(t.icon), { className: "w-4 h-4 text-zinc-500 shrink-0" })}
                        <span className="flex-1 min-w-0 truncate text-zinc-800">
                          {t.singular}{t.isDefault ? <span className="text-zinc-400"> (default)</span> : null}
                        </span>
                        {active ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)] shrink-0" /> : null}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // Monday Table fill — the trigger is a full-cell colored block.
  if (monday) {
    const fill = current ? (
      <span
        className="flex items-center justify-center w-full h-full px-2 text-sm font-medium text-white"
        style={{ background: current.color }}
      >
        {current.label}
      </span>
    ) : (
      <span className="flex items-center justify-center w-full h-full bg-zinc-100 text-xs text-zinc-400">—</span>
    );
    if (!canEdit) return fill;
    return (
      <div className="relative w-full h-full" ref={ref}>
        <button type="button" onClick={() => setOpen((v) => !v)} className="block w-full h-full min-h-[34px]">
          {fill}
        </button>
        {open && menuPos ? (
          <div style={{ position: "fixed", left: menuPos.left, minWidth: 160, ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }), maxHeight: menuPos.maxHeight, overflowY: "auto" as const }} className="z-[200] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
            {statuses.map((opt) => {
              const active = opt.value === row.status;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onUpdate(row.id, { status: opt.value }); setOpen(false); }}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-xs hover:bg-zinc-50"
                >
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white" style={{ background: opt.color }}>
                    {opt.label}
                  </span>
                  {active ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  const pill = current ? (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: `${current.color}22`, color: current.color }}
    >
      {current.label}
    </span>
  ) : (
    <span className="text-xs text-zinc-500">—</span>
  );

  if (!canEdit) return pill;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5"
      >
        {pill}
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>
      {open && menuPos ? (
        <div style={{ position: "fixed", left: menuPos.left, minWidth: 160, ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }), maxHeight: menuPos.maxHeight, overflowY: "auto" as const }} className="z-[200] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
          {statuses.map((opt) => {
            const active = opt.value === row.status;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onUpdate(row.id, { status: opt.value }); setOpen(false); }}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-xs hover:bg-zinc-50"
              >
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
                  style={{ background: `${opt.color}22`, color: opt.color }}
                >
                  {opt.label}
                </span>
                {active ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The Assignee cell. It writes the SAME field the opened task writes.
 *
 *  It used to be the single-owner picker, so the row and the detail disagreed
 *  about what "assignee" meant: the row could hold one person and the detail
 *  many. Now both send `assigneeIds` and both keep ownerId = assigneeIds[0],
 *  and the row's candidates come from the list rather than the report tree. */
function OwnerCell({
  row,
  boardId,
  canEdit,
  onUpdate,
}: {
  row: BoardItemRow;
  boardId: string | null;
  canEdit: boolean;
  onUpdate: (id: string, patch: RowPatch) => void;
}) {
  const value: PersonRef[] = row.assignees?.length
    ? row.assignees.map((p) => ({ ...p, email: p.email ?? null }))
    : row.owner
      ? [{ ...row.owner, email: null }]
      : [];
  return (
    <MultiAssigneePicker
      value={value}
      canEdit={canEdit}
      compact
      boardId={boardId}
      onChange={(people) =>
        onUpdate(row.id, {
          assigneeIds: people.map((p) => p.id),
          // Optimistic twin of the server rule: the primary is [0].
          ownerId: people[0]?.id ?? null,
          assignees: people.map((p) => ({
            id: p.id,
            firstName: p.firstName ?? "",
            lastName: p.lastName ?? "",
            avatar: p.avatar,
            email: p.email ?? null,
          })),
          owner: people[0]
            ? {
                id: people[0].id,
                firstName: people[0].firstName ?? "",
                lastName: people[0].lastName ?? "",
                avatar: people[0].avatar,
              }
            : null,
        })
      }
    />
  );
}

function GroupByPill({
  groupBy,
  groupDirection,
  groupOptions,
  onGroupBy,
  onDirection,
}: {
  groupBy: string | null;
  groupDirection: "asc" | "desc";
  groupOptions: Array<{ key: string; label: string }>;
  onGroupBy: (next: string | null) => void;
  onDirection: (next: "asc" | "desc") => void;
}) {
  const [open, setOpen] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [dirOpen, setDirOpen] = useState(false);

  const activeField = groupBy ? groupOptions.find((o) => o.key === groupBy) : null;
  const activeLabel = activeField?.label ?? "None";
  const fieldOptions = groupOptions.filter((o) => o.key !== "__none__");

  if (!groupBy) {
    // Not grouped — icon only (ClickUp). Click opens the field picker.
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Group by"
          aria-label="Group by"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
        >
          <Layers className="w-4 h-4" />
        </button>
        {open ? (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute left-0 top-full mt-1 z-40 w-[200px] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
              {fieldOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => { onGroupBy(o.key); setOpen(false); }}
                  className="flex items-center w-full text-left px-3 py-1.5 text-base text-zinc-700 hover:bg-zinc-50"
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-zinc-100 text-xs text-zinc-800 hover:bg-zinc-200"
      >
        <Layers className="w-3 h-3" />
        <span className="font-medium">
          <span className="text-zinc-500 font-normal">Group: </span>
          {activeLabel}
        </span>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full mt-1 z-40 w-[340px] rounded-lg border border-zinc-200 bg-white shadow-lg p-3">
            <p className="text-xs text-zinc-500 mb-2">Group by</p>
            <div className="flex items-center gap-2">
              {/* Field picker */}
              <div className="relative flex-1">
                <button
                  type="button"
                  onClick={() => { setFieldOpen((v) => !v); setDirOpen(false); }}
                  className="w-full inline-flex items-center justify-between gap-1.5 h-8 px-2.5 rounded-md border border-zinc-200 bg-white text-sm text-zinc-800 hover:bg-zinc-50"
                >
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <Layers className="w-3 h-3 text-zinc-500 shrink-0" />
                    <span className="truncate">{activeLabel}</span>
                  </span>
                  <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
                </button>
                {fieldOpen ? (
                  <div className="absolute left-0 top-full mt-1 z-50 w-full rounded-md border border-zinc-200 bg-white shadow-lg py-1">
                    {fieldOptions.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => { onGroupBy(o.key); setFieldOpen(false); }}
                        className={`flex items-center w-full text-left px-3 py-1.5 text-base ${
                          o.key === groupBy ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {/* Direction picker */}
              <div className="relative w-[120px]">
                <button
                  type="button"
                  onClick={() => { setDirOpen((v) => !v); setFieldOpen(false); }}
                  className="w-full inline-flex items-center justify-between gap-1.5 h-8 px-2.5 rounded-md border border-zinc-200 bg-white text-sm text-zinc-800 hover:bg-zinc-50"
                >
                  <span className="truncate">{groupDirection === "asc" ? "Ascending" : "Descending"}</span>
                  <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
                </button>
                {dirOpen ? (
                  <div className="absolute left-0 top-full mt-1 z-50 w-full rounded-md border border-zinc-200 bg-white shadow-lg py-1">
                    <button
                      type="button"
                      onClick={() => { onDirection("asc"); setDirOpen(false); }}
                      className={`flex items-center w-full text-left px-3 py-1.5 text-base ${
                        groupDirection === "asc" ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      Ascending
                    </button>
                    <button
                      type="button"
                      onClick={() => { onDirection("desc"); setDirOpen(false); }}
                      className={`flex items-center w-full text-left px-3 py-1.5 text-base ${
                        groupDirection === "desc" ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      Descending
                    </button>
                  </div>
                ) : null}
              </div>
              {/* Clear grouping */}
              <button
                type="button"
                onClick={() => { onGroupBy(null); setOpen(false); }}
                aria-label="Remove grouping"
                title="Remove grouping"
                className="p-1.5 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
