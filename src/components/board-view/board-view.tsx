"use client";

// Reusable BoardView — Phase C2. Drop into any board-like page and get
// Table / Kanban / Calendar / Gallery views with a switcher tab bar.
//
// Each consuming page passes:
//   - items: any[] (whatever shape)
//   - fields: BoardField[] describing the columns
//   - boardKey: string (used for localStorage view-pref + as a cache key)
//   - getId / getTitle (functions for row identity + title display)
//   - onRowClick? (optional row-click handler)
//   - extraToolbar? (optional React node — "+ New" button slot)
//
// View choice persists per-board in localStorage.
//
// Kanban: groups by the first SELECT field. Click "Move to X" from the
// row menu to change the group (consumer handles via onChangeField).
// Calendar: groups by the first DATE field, week-view-ish list.
// Gallery: card grid for visual scanning.

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  LayoutGrid,
  List,
  CalendarDays,
  LayoutPanelLeft,
  MoreVertical,
  ChevronDown,
  ChevronUp,
  Clock,
  Search,
  X,
  Filter,
  ArrowUpDown,
  Plus,
} from "lucide-react";

export type BoardFieldType =
  | "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "CHECKBOX"
  | "SELECT" | "MULTI_SELECT" | "URL" | "EMAIL";

export interface BoardField {
  key: string;
  label: string;
  fieldType: BoardFieldType;
  options?: { choices?: { value: string; label?: string; color?: string }[] };
}

export type BoardViewType = "table" | "kanban" | "calendar" | "gallery";

interface Props<T> {
  boardKey: string;
  items: T[];
  fields: BoardField[];
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  getValue: (item: T, fieldKey: string) => unknown;
  /** Called when a row's value is changed inline (Kanban drag-to-stage style). */
  onChangeField?: (id: string, fieldKey: string, value: unknown) => void;
  /** Called when a row is clicked (open detail). */
  onRowClick?: (item: T) => void;
  /** Optional toolbar slot rendered to the right of the view switcher. */
  extraToolbar?: React.ReactNode;
  /** Default view if no localStorage pref exists. */
  defaultView?: BoardViewType;
  /** Hide the search input (some surfaces have their own). Default: false. */
  hideSearch?: boolean;
  /** Placeholder for the search box. */
  searchPlaceholder?: string;
  /** Field keys that can be edited inline in the Table view. If omitted,
   *  all fields are editable when onChangeField is provided. Pass an
   *  empty array to disable inline editing entirely. */
  editableFields?: string[];
  /** When true, render a checkbox column + enable bulk actions. */
  selectable?: boolean;
  /** Batch update — called for each selected row when the user picks
   *  a value from the bulk "Update <field>" menu. */
  onBulkChange?: (ids: string[], fieldKey: string, value: unknown) => Promise<void> | void;
  /** Batch delete — called once with all selected ids. */
  onBulkDelete?: (ids: string[]) => Promise<void> | void;
}

const VIEW_OPTIONS: { id: BoardViewType; label: string; Icon: typeof List }[] = [
  { id: "table", label: "Table", Icon: List },
  { id: "kanban", label: "Kanban", Icon: LayoutGrid },
  { id: "calendar", label: "Calendar", Icon: CalendarDays },
  { id: "gallery", label: "Gallery", Icon: LayoutPanelLeft },
];

// ── Multi-tab boards ──────────────────────────────────────
// A "tab" is a saved snapshot of (view, query, filters, sort). Lets
// users carve up the same data into named views — "Open tickets",
// "My queue", "This week's deals". Tabs persist per board in
// localStorage; there's always a default first tab called "Main".
// Switching tabs replaces the current state; edits after switching
// are ephemeral until the user saves them back to the tab.
type SavedTab = {
  id: string;
  label: string;
  viewType: BoardViewType;
  query?: string;
  filters?: Record<string, string[]>;
  sortField?: string | null;
  sortDir?: "asc" | "desc";
};

export function BoardView<T>(props: Props<T>) {
  const storageKey = `boardview:${props.boardKey}`;
  const tabsKey = `boardtabs:${props.boardKey}`;
  const [view, setView] = useState<BoardViewType>(props.defaultView ?? "table");

  // Hydrate view choice from localStorage post-mount (avoid SSR mismatch).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "table" || stored === "kanban" || stored === "calendar" || stored === "gallery") {
      setView(stored);
    }
    setHydrated(true);
  }, [storageKey]);

  const persistView = useCallback((v: BoardViewType) => {
    setView(v);
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, v);
  }, [storageKey]);

  // Pick the first SELECT field for Kanban grouping, first DATE for Calendar.
  const kanbanField = useMemo(() => props.fields.find((f) => f.fieldType === "SELECT"), [props.fields]);
  const calendarField = useMemo(() => props.fields.find((f) => f.fieldType === "DATE"), [props.fields]);

  // ── Search + filter state ──────────────────────────────
  // Search runs against title + every TEXT/TEXTAREA/EMAIL/URL field
  // value, case-insensitive. Filter chips toggle SELECT field values
  // — clicking "Status: Open" hides anything not Open. Multiple chips
  // on the same field OR together; different fields AND together.
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [showFilters, setShowFilters] = useState(false);

  const selectFields = useMemo(() => props.fields.filter((f) => f.fieldType === "SELECT"), [props.fields]);
  const searchableFields = useMemo(
    () => props.fields.filter((f) => f.fieldType === "TEXT" || f.fieldType === "TEXTAREA" || f.fieldType === "EMAIL" || f.fieldType === "URL"),
    [props.fields],
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.items.filter((item) => {
      // Query match: title OR any searchable field
      if (q) {
        const titleHit = props.getTitle(item).toLowerCase().includes(q);
        const fieldHit = !titleHit && searchableFields.some((f) => {
          const v = props.getValue(item, f.key);
          return typeof v === "string" && v.toLowerCase().includes(q);
        });
        if (!titleHit && !fieldHit) return false;
      }
      // Filter pills: each field's set must include the row's value
      for (const [fieldKey, allowed] of Object.entries(filters)) {
        if (allowed.size === 0) continue;
        const v = props.getValue(item, fieldKey);
        if (typeof v !== "string" || !allowed.has(v)) return false;
      }
      return true;
    });
  }, [props, query, filters, searchableFields]);

  // ── Sort state ─────────────────────────────────────────
  // Persisted per-board in localStorage like view choice. Tri-state per
  // column: click → asc, click again → desc, click again → clear.
  const sortStorageKey = `boardview-sort:${props.boardKey}`;
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(sortStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { field?: string; dir?: "asc" | "desc" };
        if (parsed.field) setSortField(parsed.field);
        if (parsed.dir) setSortDir(parsed.dir);
      }
    } catch {
      // Bad JSON / quota / private mode — fall back to no sort.
    }
  }, [sortStorageKey]);

  // ── Tabs state ─────────────────────────────────────────
  const [tabs, setTabs] = useState<SavedTab[]>([
    { id: "main", label: "Main table", viewType: "table" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("main");
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(tabsKey);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedTab[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Ensure a "main" tab always exists.
          if (!parsed.some((t) => t.id === "main")) {
            parsed.unshift({ id: "main", label: "Main table", viewType: "table" });
          }
          setTabs(parsed);
        }
      }
    } catch {}
  }, [tabsKey]);

  const persistTabs = useCallback((next: SavedTab[]) => {
    setTabs(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(tabsKey, JSON.stringify(next));
    }
  }, [tabsKey]);

  const applyTab = useCallback((tab: SavedTab) => {
    setActiveTabId(tab.id);
    setView(tab.viewType);
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, tab.viewType);
    setQuery(tab.query ?? "");
    if (tab.filters) {
      setFilters(Object.fromEntries(Object.entries(tab.filters).map(([k, vals]) => [k, new Set(vals)])));
    } else {
      setFilters({});
    }
    setSortField(tab.sortField ?? null);
    setSortDir(tab.sortDir ?? "asc");
  }, [storageKey]);

  const addTab = useCallback(() => {
    const label = window.prompt("Tab name?", `View ${tabs.length}`);
    if (!label) return;
    const tab: SavedTab = {
      id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      label,
      viewType: view,
      query: query || undefined,
      filters: Object.keys(filters).length
        ? Object.fromEntries(Object.entries(filters).map(([k, s]) => [k, Array.from(s)]))
        : undefined,
      sortField,
      sortDir,
    };
    persistTabs([...tabs, tab]);
    setActiveTabId(tab.id);
  }, [tabs, view, query, filters, sortField, sortDir, persistTabs]);

  const saveTabFromCurrent = useCallback((tabId: string) => {
    const next = tabs.map((t) => t.id === tabId ? {
      ...t,
      viewType: view,
      query: query || undefined,
      filters: Object.keys(filters).length
        ? Object.fromEntries(Object.entries(filters).map(([k, s]) => [k, Array.from(s)]))
        : undefined,
      sortField,
      sortDir,
    } : t);
    persistTabs(next);
  }, [tabs, view, query, filters, sortField, sortDir, persistTabs]);

  const renameTab = useCallback((tabId: string, label: string) => {
    const cleaned = label.trim();
    if (!cleaned) return;
    persistTabs(tabs.map((t) => t.id === tabId ? { ...t, label: cleaned } : t));
    setRenamingTabId(null);
  }, [tabs, persistTabs]);

  const deleteTab = useCallback((tabId: string) => {
    if (tabId === "main") return;
    if (!window.confirm("Delete this tab? Saved view will be lost.")) return;
    const next = tabs.filter((t) => t.id !== tabId);
    persistTabs(next);
    if (activeTabId === tabId) {
      setActiveTabId("main");
      const main = next.find((t) => t.id === "main");
      if (main) applyTab(main);
    }
  }, [tabs, activeTabId, applyTab, persistTabs]);

  const cycleSort = useCallback((fieldKey: string) => {
    setSortField((prevField) => {
      let nextField: string | null;
      let nextDir: "asc" | "desc" = "asc";
      if (prevField !== fieldKey) {
        nextField = fieldKey;
        nextDir = "asc";
      } else if (sortDir === "asc") {
        nextField = fieldKey;
        nextDir = "desc";
      } else {
        nextField = null;
      }
      setSortDir(nextDir);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(sortStorageKey, JSON.stringify({ field: nextField, dir: nextDir }));
      }
      return nextField;
    });
  }, [sortDir, sortStorageKey]);

  const sortedItems = useMemo(() => {
    if (!sortField) return filteredItems;
    const field = props.fields.find((f) => f.key === sortField);
    if (!field) return filteredItems;
    const arr = [...filteredItems];
    arr.sort((a, b) => {
      const av = props.getValue(a, sortField);
      const bv = props.getValue(b, sortField);
      return compareValues(av, bv, field);
    });
    if (sortDir === "desc") arr.reverse();
    return arr;
  }, [filteredItems, sortField, sortDir, props]);

  // ── Selection state (for bulk actions) ──────────────────
  // Tracks selected row IDs. Clears when items array reference changes
  // (refetch invalidates stale selections).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulking, setBulking] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [showBulkUpdate, setShowBulkUpdate] = useState<string | null>(null); // fieldKey

  // Reset selection whenever the underlying items list changes by
  // identity (a refetch produces a new array even when contents match).
  useEffect(() => { setSelectedIds(new Set()); }, [props.items]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === sortedItems.length) return new Set();
      return new Set(sortedItems.map(props.getId));
    });
  }, [sortedItems, props.getId]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  async function runBulkChange(fieldKey: string, value: unknown) {
    if (!props.onBulkChange || selectedIds.size === 0) return;
    setBulking(true);
    setBulkError(null);
    try {
      await props.onBulkChange(Array.from(selectedIds), fieldKey, value);
      setSelectedIds(new Set());
      setShowBulkUpdate(null);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "Bulk update failed");
    } finally {
      setBulking(false);
    }
  }

  async function runBulkDelete() {
    if (!props.onBulkDelete || selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Delete ${count} row${count === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBulking(true);
    setBulkError(null);
    try {
      await props.onBulkDelete(Array.from(selectedIds));
      setSelectedIds(new Set());
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "Bulk delete failed");
    } finally {
      setBulking(false);
    }
  }

  const filteredProps = {
    ...props,
    items: sortedItems,
    sortField,
    sortDir,
    onSortClick: cycleSort,
    selectedIds,
    toggleSelected,
    toggleSelectAll,
  };

  function toggleFilter(fieldKey: string, value: string) {
    setFilters((prev) => {
      const next = { ...prev };
      const set = new Set(next[fieldKey] ?? []);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      next[fieldKey] = set;
      return next;
    });
  }
  function clearAllFilters() {
    setFilters({});
    setQuery("");
  }
  const activeFilterCount = Object.values(filters).reduce((n, s) => n + s.size, 0);

  return (
    <div>
      {/* Tab strip — saved views per board. "Main" is permanent.
          Right-click or use the X to delete (except Main). + to add. */}
      <div className="flex items-end gap-0.5 mb-3 border-b border-border">
        {tabs.map((t) => {
          const active = t.id === activeTabId;
          const isMain = t.id === "main";
          if (renamingTabId === t.id) {
            return (
              <input
                key={t.id}
                autoFocus
                defaultValue={t.label}
                onBlur={(e) => renameTab(t.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") renameTab(t.id, (e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setRenamingTabId(null);
                }}
                className="px-2.5 py-1.5 text-xs font-medium border border-violet-300 bg-surface rounded-t-md outline-none"
              />
            );
          }
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => applyTab(t)}
              onDoubleClick={() => setRenamingTabId(t.id)}
              className={
                "group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors border-b-2 -mb-px " +
                (active
                  ? "border-violet-500 text-violet-700 dark:text-violet-300 bg-surface-2"
                  : "border-transparent text-muted hover:text-foreground hover:bg-surface-2")
              }
              title={isMain ? "Main table — always present" : "Double-click to rename"}
            >
              <span>{t.label}</span>
              {!isMain && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); deleteTab(t.id); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-rose-100 hover:text-rose-600"
                  aria-label="Delete tab"
                  tabIndex={-1}
                >
                  <X size={10} />
                </button>
              )}
              {active && !isMain && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); saveTabFromCurrent(t.id); }}
                  className="opacity-0 group-hover:opacity-100 text-[9px] uppercase tracking-wider text-muted-2 hover:text-violet-600"
                  tabIndex={-1}
                  title="Save current view to this tab"
                >
                  save
                </button>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={addTab}
          className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-muted hover:text-violet-600 -mb-px"
          title="Save current view as a new tab"
        >
          <Plus size={11} /> Tab
        </button>
      </div>

      {/* Toolbar: view switcher · search · filter · extraToolbar */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
            {VIEW_OPTIONS.map(({ id, label, Icon }) => {
              const disabled = (id === "kanban" && !kanbanField) || (id === "calendar" && !calendarField);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => persistView(id)}
                  disabled={disabled}
                  title={disabled ? `${label} view needs a ${id === "kanban" ? "SELECT" : "DATE"} field` : label}
                  className={
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors " +
                    (view === id
                      ? "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300"
                      : "text-muted hover:text-foreground hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed")
                  }
                >
                  <Icon size={12} /> {label}
                </button>
              );
            })}
          </div>

          {!props.hideSearch && (
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2 pointer-events-none" aria-hidden />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={props.searchPlaceholder ?? `Search ${props.items.length} row${props.items.length === 1 ? "" : "s"}…`}
                className="pl-7 pr-7 py-1.5 rounded-md border border-border bg-surface text-xs w-56 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-2 hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )}

          {selectFields.length > 0 && (
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors " +
                (activeFilterCount > 0 || showFilters
                  ? "bg-violet-100 dark:bg-violet-950/40 border-violet-300 text-violet-700 dark:text-violet-300"
                  : "border-border text-muted hover:text-foreground hover:bg-surface-2")
              }
            >
              <Filter size={11} /> Filter
              {activeFilterCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-violet-200 dark:bg-violet-800 text-[10px] font-bold">{activeFilterCount}</span>
              )}
            </button>
          )}

          {(activeFilterCount > 0 || query) && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-[11px] text-muted hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {props.extraToolbar}
      </div>

      {/* Filter chip panel — expanded when "Filter" toggled */}
      {showFilters && selectFields.length > 0 && (
        <div className="mb-3 rounded-lg border border-border bg-surface-2 p-3 space-y-2">
          {selectFields.map((field) => {
            const choices = field.options?.choices ?? [];
            const selected = filters[field.key] ?? new Set<string>();
            return (
              <div key={field.key} className="flex items-start gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-muted-2 font-semibold pt-1.5 min-w-[80px]">{field.label}</span>
                <div className="flex flex-wrap gap-1">
                  {choices.map((c) => {
                    const isOn = selected.has(c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => toggleFilter(field.key, c.value)}
                        className={
                          "text-[11px] px-2 py-0.5 rounded-md border transition-colors " +
                          (isOn
                            ? "bg-violet-600 border-violet-600 text-white"
                            : "bg-surface border-border text-muted hover:border-violet-300")
                        }
                      >
                        {c.label ?? c.value}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Result count when filtered */}
      {(query || activeFilterCount > 0) && (
        <div className="text-[11px] text-muted-2 mb-2">
          Showing {filteredItems.length} of {props.items.length}
        </div>
      )}

      {/* Bulk action bar — appears when ≥1 row selected */}
      {props.selectable && selectedIds.size > 0 && (
        <div className="mb-3 rounded-lg border border-violet-300 bg-violet-50 dark:bg-violet-950/40 px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
            {selectedIds.size} selected
          </span>
          {bulkError && (
            <span className="text-[11px] text-rose-700">· {bulkError}</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {props.onBulkChange && selectFields.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowBulkUpdate((v) => v ? null : selectFields[0]?.key ?? null)}
                  disabled={bulking}
                  className="text-xs px-3 py-1.5 rounded-md border border-violet-300 bg-surface text-violet-700 hover:bg-violet-100 dark:hover:bg-violet-950/60 disabled:opacity-50"
                >
                  Update {selectFields.find((f) => f.key === showBulkUpdate)?.label ?? selectFields[0]?.label} ▾
                </button>
                {showBulkUpdate && (
                  <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-lg bg-surface border border-border shadow-lg py-1 max-h-72 overflow-y-auto">
                    <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-2">
                      Set <span className="font-mono normal-case">{selectFields.find((f) => f.key === showBulkUpdate)?.label}</span> for {selectedIds.size}
                    </div>
                    {selectFields.length > 1 && (
                      <div className="px-2 py-1 border-b border-border">
                        <select
                          value={showBulkUpdate}
                          onChange={(e) => setShowBulkUpdate(e.target.value)}
                          className="w-full text-xs px-2 py-1 rounded border border-border bg-surface"
                        >
                          {selectFields.map((f) => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {(selectFields.find((f) => f.key === showBulkUpdate)?.options?.choices ?? []).map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => runBulkChange(showBulkUpdate!, c.value)}
                        disabled={bulking}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-40 inline-flex items-center gap-2"
                      >
                        <span className="w-2 h-2 rounded-full" style={{ background: c.color ?? "#94a3b8" }} aria-hidden />
                        {c.label ?? c.value}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {props.onBulkDelete && (
              <button
                type="button"
                onClick={runBulkDelete}
                disabled={bulking}
                className="text-xs px-3 py-1.5 rounded-md border border-rose-300 bg-surface text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
              >
                Delete {selectedIds.size}
              </button>
            )}
            <button
              type="button"
              onClick={clearSelection}
              disabled={bulking}
              className="text-xs px-3 py-1.5 rounded-md text-muted hover:bg-surface-2"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Force a stable wrapper before hydration so layout doesn't jump */}
      {!hydrated ? (
        <TableView {...filteredProps} />
      ) : view === "table" ? (
        <TableView {...filteredProps} />
      ) : view === "kanban" && kanbanField ? (
        <KanbanView {...filteredProps} groupBy={kanbanField} />
      ) : view === "calendar" && calendarField ? (
        <CalendarView {...filteredProps} dateField={calendarField} />
      ) : view === "gallery" ? (
        <GalleryView {...filteredProps} />
      ) : (
        <TableView {...filteredProps} />
      )}
    </div>
  );
}

// Typed comparison for sort. Returns negative if a < b, 0 if equal,
// positive if a > b. nulls sort last on asc (the typical expectation).
function compareValues(a: unknown, b: unknown, field: BoardField): number {
  const aNull = a == null || a === "";
  const bNull = b == null || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1;   // null sorts after
  if (bNull) return -1;

  switch (field.fieldType) {
    case "NUMBER":
      return Number(a) - Number(b);
    case "DATE": {
      const ad = typeof a === "string" ? new Date(a).getTime() : NaN;
      const bd = typeof b === "string" ? new Date(b).getTime() : NaN;
      if (Number.isNaN(ad) && Number.isNaN(bd)) return 0;
      if (Number.isNaN(ad)) return 1;
      if (Number.isNaN(bd)) return -1;
      return ad - bd;
    }
    case "CHECKBOX":
      return (a ? 1 : 0) - (b ? 1 : 0);
    case "SELECT": {
      // Sort by choice position (declared order in options.choices)
      const choices = field.options?.choices ?? [];
      const ai = choices.findIndex((c) => c.value === a);
      const bi = choices.findIndex((c) => c.value === b);
      if (ai < 0 && bi < 0) return String(a).localeCompare(String(b));
      if (ai < 0) return 1;
      if (bi < 0) return -1;
      return ai - bi;
    }
    case "MULTI_SELECT":
      return (Array.isArray(a) ? a.length : 0) - (Array.isArray(b) ? b.length : 0);
    default:
      return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
  }
}

// ─────────────────────────────────────────────────────────
// Table view (with inline cell editing + sortable headers)
// ─────────────────────────────────────────────────────────

interface TableProps<T> extends Props<T> {
  sortField?: string | null;
  sortDir?: "asc" | "desc";
  onSortClick?: (fieldKey: string) => void;
  selectedIds?: Set<string>;
  toggleSelected?: (id: string) => void;
  toggleSelectAll?: () => void;
}

function TableView<T>({ items, fields, getId, getTitle, getValue, onRowClick, onChangeField, editableFields, sortField, sortDir, onSortClick, selectable, selectedIds, toggleSelected, toggleSelectAll }: TableProps<T>) {
  // Edit state: which (rowId, fieldKey) is currently being edited.
  const [editing, setEditing] = useState<{ id: string; field: string } | null>(null);

  if (items.length === 0) {
    return <EmptyView label="No rows" />;
  }

  // Resolve editability per field. Default = all fields editable when
  // onChangeField is provided. Empty array = nothing is editable.
  const canEdit = (field: BoardField) => {
    if (!onChangeField) return false;
    if (editableFields === undefined) return true;
    return editableFields.includes(field.key);
  };

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-2">
            <tr>
              {selectable && (
                <th className="w-8 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIds && selectedIds.size > 0 && selectedIds.size === items.length}
                    ref={(el) => {
                      // Indeterminate state when some-but-not-all are selected
                      if (el && selectedIds) {
                        el.indeterminate = selectedIds.size > 0 && selectedIds.size < items.length;
                      }
                    }}
                    onChange={() => toggleSelectAll?.()}
                    className="cursor-pointer"
                    aria-label="Select all"
                  />
                </th>
              )}
              {fields.map((f) => {
                const isSorted = sortField === f.key;
                const canSort = !!onSortClick;
                return (
                  <th key={f.key} className="text-left px-4 py-2.5 font-medium">
                    {canSort ? (
                      <button
                        type="button"
                        onClick={() => onSortClick!(f.key)}
                        className={
                          "inline-flex items-center gap-1 -ml-1 px-1 py-0.5 rounded transition-colors " +
                          (isSorted ? "text-violet-700 dark:text-violet-300" : "hover:bg-surface")
                        }
                        title={isSorted ? `Sorted ${sortDir} · click to ${sortDir === "asc" ? "reverse" : "clear"}` : "Click to sort"}
                      >
                        <span>{f.label}</span>
                        {isSorted ? (
                          sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                        ) : (
                          <ArrowUpDown size={10} className="opacity-30 group-hover:opacity-60" />
                        )}
                      </button>
                    ) : (
                      f.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const id = getId(item);
              const isSelected = selectedIds?.has(id) ?? false;
              return (
                <tr
                  key={id}
                  className={
                    "border-t border-border group " +
                    (isSelected ? "bg-violet-50 dark:bg-violet-950/30" : "hover:bg-surface-2")
                  }
                >
                  {selectable && (
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected?.(id)}
                        onClick={(e) => e.stopPropagation()}
                        className="cursor-pointer"
                        aria-label="Select row"
                      />
                    </td>
                  )}
                  {fields.map((f) => {
                    const editable = canEdit(f);
                    const isEditing = editing?.id === id && editing?.field === f.key;
                    const value = getValue(item, f.key);
                    return (
                      <td
                        key={f.key}
                        className={"px-4 py-2.5 text-sm " + (editable && !isEditing ? "cursor-text" : "")}
                        onClick={(e) => {
                          if (isEditing) return;
                          if (editable) {
                            e.stopPropagation();
                            setEditing({ id, field: f.key });
                            return;
                          }
                          if (onRowClick) onRowClick(item);
                        }}
                      >
                        {isEditing ? (
                          <InlineEditor
                            field={f}
                            value={value}
                            onCommit={(next) => {
                              setEditing(null);
                              if (next !== value && onChangeField) onChangeField(id, f.key, next);
                            }}
                            onCancel={() => setEditing(null)}
                          />
                        ) : (
                          <CellValue field={f} value={value} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Per-fieldType inline editor. Auto-focus the right control, commit on
// blur/Enter, cancel on Escape. Click anywhere outside the cell to
// commit (handled via blur).
function InlineEditor({
  field, value, onCommit, onCancel,
}: {
  field: BoardField;
  value: unknown;
  onCommit: (next: unknown) => void;
  onCancel: () => void;
}) {
  const [local, setLocal] = useState<unknown>(value);

  const baseInputClass = "w-full px-2 py-1 rounded border border-violet-400 bg-surface text-sm focus:outline-none focus:ring-1 focus:ring-violet-500";

  // Stop click bubbling so clicks inside the editor don't trigger the
  // td onClick (which would re-enter edit mode).
  const stop = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation();

  switch (field.fieldType) {
    case "TEXTAREA":
      return (
        <textarea
          autoFocus
          rows={3}
          defaultValue={(value as string) ?? ""}
          onClick={stop}
          onBlur={(e) => onCommit(e.target.value || null)}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
          }}
          className={baseInputClass + " resize-none"}
        />
      );
    case "NUMBER":
      return (
        <input
          autoFocus
          type="number"
          defaultValue={value != null ? String(value) : ""}
          onClick={stop}
          onBlur={(e) => onCommit(e.target.value === "" ? null : Number(e.target.value))}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={baseInputClass}
        />
      );
    case "DATE":
      return (
        <input
          autoFocus
          type="date"
          defaultValue={value ? String(value).slice(0, 10) : ""}
          onClick={stop}
          onBlur={(e) => onCommit(e.target.value || null)}
          onKeyDown={(e) => { stop(e); if (e.key === "Escape") onCancel(); }}
          className={baseInputClass}
        />
      );
    case "CHECKBOX":
      // Checkbox: toggle on click, commit immediately
      return (
        <input
          autoFocus
          type="checkbox"
          defaultChecked={!!value}
          onClick={stop}
          onChange={(e) => onCommit(e.target.checked)}
          onBlur={onCancel}
          className="w-4 h-4"
        />
      );
    case "SELECT": {
      const choices = field.options?.choices ?? [];
      return (
        <select
          autoFocus
          defaultValue={(value as string) ?? ""}
          onClick={stop}
          onChange={(e) => onCommit(e.target.value || null)}
          onBlur={onCancel}
          onKeyDown={(e) => { stop(e); if (e.key === "Escape") onCancel(); }}
          className={baseInputClass}
        >
          <option value="">— None —</option>
          {choices.map((c) => <option key={c.value} value={c.value}>{c.label ?? c.value}</option>)}
        </select>
      );
    }
    case "MULTI_SELECT": {
      const choices = field.options?.choices ?? [];
      const current = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (v: string) => {
        const next = local && Array.isArray(local) ? [...(local as string[])] : [...current];
        const i = next.indexOf(v);
        if (i >= 0) next.splice(i, 1); else next.push(v);
        setLocal(next);
      };
      return (
        <div className="flex flex-wrap gap-1 max-w-xs" onClick={stop}>
          {choices.map((c) => {
            const arr = Array.isArray(local) ? (local as string[]) : current;
            const on = arr.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => toggle(c.value)}
                className={"text-[10px] px-1.5 py-0.5 rounded border " + (on ? "bg-violet-600 text-white border-violet-600" : "bg-surface border-border text-muted")}
              >
                {c.label ?? c.value}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onCommit(Array.isArray(local) ? local : current)}
            className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 text-white"
          >
            ✓
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted"
          >
            ×
          </button>
        </div>
      );
    }
    case "URL":
    case "EMAIL":
    case "TEXT":
    default:
      return (
        <input
          autoFocus
          type={field.fieldType === "EMAIL" ? "email" : field.fieldType === "URL" ? "url" : "text"}
          defaultValue={(value as string) ?? ""}
          onClick={stop}
          onBlur={(e) => onCommit(e.target.value || null)}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={baseInputClass}
        />
      );
  }
}

// ─────────────────────────────────────────────────────────
// Kanban view
// ─────────────────────────────────────────────────────────

function KanbanView<T>({
  items, fields, getId, getTitle, getValue, onChangeField, onRowClick,
  groupBy,
}: Props<T> & { groupBy: BoardField }) {
  const choices = groupBy.options?.choices ?? [];
  const noneBucket = "__none__";
  const columns = [
    ...choices.map((c) => ({ value: c.value, label: c.label ?? c.value, color: c.color })),
    { value: noneBucket, label: "Unassigned", color: undefined },
  ];

  const byCol = useMemo(() => {
    const m = new Map<string, T[]>();
    for (const col of columns) m.set(col.value, []);
    for (const item of items) {
      const v = getValue(item, groupBy.key);
      const k = typeof v === "string" && v ? v : noneBucket;
      const arr = m.get(k) ?? m.get(noneBucket)!;
      arr.push(item);
    }
    return m;
  }, [items, getValue, groupBy.key, columns]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2" style={{ minHeight: 420 }}>
      {columns.map((col) => {
        const colItems = byCol.get(col.value) ?? [];
        return (
          <div key={col.value} className="flex-shrink-0 w-[260px] rounded-xl bg-surface-2 p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: col.color ?? "#94a3b8" }} aria-hidden />
                <span className="text-sm font-semibold">{col.label}</span>
              </div>
              <span className="text-xs text-muted-2">{colItems.length}</span>
            </div>
            <div className="space-y-2">
              {colItems.length === 0 ? (
                <div className="text-xs text-muted-2 italic py-3 text-center border border-dashed border-border rounded-lg">Empty</div>
              ) : (
                colItems.map((item) => (
                  <KanbanCard
                    key={getId(item)}
                    item={item}
                    fields={fields}
                    groupBy={groupBy}
                    columns={columns}
                    getId={getId}
                    getTitle={getTitle}
                    getValue={getValue}
                    onMove={onChangeField ? (toValue) => onChangeField(getId(item), groupBy.key, toValue === noneBucket ? null : toValue) : undefined}
                    onClick={onRowClick ? () => onRowClick(item) : undefined}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard<T>({
  item, fields, groupBy, columns, getId, getTitle, getValue, onMove, onClick,
}: {
  item: T;
  fields: BoardField[];
  groupBy: BoardField;
  columns: { value: string; label: string }[];
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  getValue: (item: T, fieldKey: string) => unknown;
  onMove?: (toValue: string) => void;
  onClick?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Render the title + up to 2 non-grouping non-title fields
  const detailFields = fields.filter((f) => f.key !== groupBy.key).slice(0, 3);
  const currentValue = getValue(item, groupBy.key);

  return (
    <div className="rounded-lg bg-surface border border-border p-3 relative">
      <div className="flex items-start justify-between mb-1.5">
        <div
          className={"font-medium text-sm leading-tight pr-6 " + (onClick ? "cursor-pointer hover:text-violet-600" : "")}
          onClick={onClick}
        >
          {getTitle(item)}
        </div>
        {onMove && (
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="absolute top-2 right-2 p-1 rounded hover:bg-surface-2 text-muted-2"
            aria-label="Move"
          >
            <MoreVertical size={11} />
          </button>
        )}
        {menuOpen && onMove && (
          <div className="absolute top-7 right-2 z-10 w-40 rounded-lg bg-surface border border-border shadow-lg py-1">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-2">Move to</div>
            {columns.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => { setMenuOpen(false); onMove(c.value); }}
                disabled={c.value === currentValue || (currentValue == null && c.value === "__none__")}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-40"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {detailFields.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-2 mt-1">
          {detailFields.map((f) => {
            const v = getValue(item, f.key);
            if (v == null || v === "") return null;
            return (
              <span key={f.key} className="inline-flex items-center gap-1">
                <span className="text-muted-2 opacity-60">{f.label}:</span>
                <CellValue field={f} value={v} compact />
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Calendar view (list grouped by week, ordered by date)
// ─────────────────────────────────────────────────────────

function CalendarView<T>({ items, getId, getTitle, getValue, dateField, onRowClick }: Props<T> & { dateField: BoardField }) {
  // Group by year-week. We sort by date asc, group by ISO week label.
  const buckets = useMemo(() => {
    const map = new Map<string, T[]>();
    const dated = items
      .map((item) => {
        const v = getValue(item, dateField.key);
        const d = typeof v === "string" ? new Date(v) : null;
        return { item, date: d && !Number.isNaN(d.getTime()) ? d : null };
      })
      .filter((x) => x.date !== null) as { item: T; date: Date }[];

    dated.sort((a, b) => a.date.getTime() - b.date.getTime());

    for (const { item, date } of dated) {
      const monday = startOfWeek(date);
      const label = monday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const arr = map.get(label) ?? [];
      arr.push(item);
      map.set(label, arr);
    }
    return Array.from(map.entries());
  }, [items, getValue, dateField.key]);

  const undated = items.filter((i) => {
    const v = getValue(i, dateField.key);
    if (!v || typeof v !== "string") return true;
    const d = new Date(v);
    return Number.isNaN(d.getTime());
  });

  if (buckets.length === 0 && undated.length === 0) {
    return <EmptyView label="No rows" />;
  }

  return (
    <div className="rounded-xl border border-border bg-surface divide-y divide-border">
      {buckets.map(([label, rows]) => (
        <div key={label} className="px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-2 font-semibold mb-2 inline-flex items-center gap-1.5">
            <Clock size={11} /> Week of {label}
          </div>
          <div className="space-y-1.5">
            {rows.map((item) => (
              <div
                key={getId(item)}
                onClick={() => onRowClick?.(item)}
                className={"rounded-md border border-border bg-surface-2 px-3 py-2 text-sm " + (onRowClick ? "cursor-pointer hover:border-violet-300" : "")}
              >
                <div className="font-medium">{getTitle(item)}</div>
                <div className="text-[11px] text-muted-2 mt-0.5">
                  {(() => {
                    const v = getValue(item, dateField.key);
                    return typeof v === "string" ? new Date(v).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—";
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {undated.length > 0 && (
        <div className="px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-2 font-semibold mb-2">No date</div>
          <div className="space-y-1.5">
            {undated.map((item) => (
              <div
                key={getId(item)}
                onClick={() => onRowClick?.(item)}
                className={"rounded-md border border-border bg-surface-2 px-3 py-2 text-sm " + (onRowClick ? "cursor-pointer hover:border-violet-300" : "")}
              >
                <div className="font-medium">{getTitle(item)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function startOfWeek(d: Date) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;       // Monday-anchored
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// ─────────────────────────────────────────────────────────
// Gallery view (card grid)
// ─────────────────────────────────────────────────────────

function GalleryView<T>({ items, fields, getId, getTitle, getValue, onRowClick }: Props<T>) {
  if (items.length === 0) {
    return <EmptyView label="No rows" />;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {items.map((item) => {
        const detailFields = fields.slice(0, 4);
        return (
          <article
            key={getId(item)}
            onClick={() => onRowClick?.(item)}
            className={"rounded-xl border border-border bg-surface p-4 transition-colors " + (onRowClick ? "cursor-pointer hover:border-violet-300" : "")}
          >
            <div className="font-semibold text-sm mb-2 line-clamp-2">{getTitle(item)}</div>
            <div className="space-y-1 text-xs">
              {detailFields.map((f) => {
                const v = getValue(item, f.key);
                if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                return (
                  <div key={f.key} className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-2 text-[10px] uppercase tracking-wider flex-shrink-0">{f.label}</span>
                    <span className="text-muted truncate">
                      <CellValue field={f} value={v} compact />
                    </span>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Shared cell renderer + empty state
// ─────────────────────────────────────────────────────────

function CellValue({ field, value, compact = false }: { field: BoardField; value: unknown; compact?: boolean }) {
  if (value == null || value === "") return <span className="text-muted-2">—</span>;
  switch (field.fieldType) {
    case "CHECKBOX":
      return <span className={value ? "text-emerald-600" : "text-muted-2"}>{value ? "✓" : "—"}</span>;
    case "DATE":
      return <span>{typeof value === "string" ? new Date(value).toLocaleDateString() : String(value)}</span>;
    case "MULTI_SELECT": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="inline-flex flex-wrap gap-1">
          {arr.slice(0, compact ? 2 : 6).map((v) => (
            <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-950/40 text-violet-700">{v}</span>
          ))}
          {arr.length > (compact ? 2 : 6) && <span className="text-[10px] text-muted-2">+{arr.length - (compact ? 2 : 6)}</span>}
        </div>
      );
    }
    case "SELECT": {
      const label = field.options?.choices?.find((c) => c.value === value)?.label ?? String(value);
      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">{label}</span>;
    }
    case "URL":
      return <a href={String(value)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-violet-600 hover:underline truncate inline-block max-w-[160px]">{String(value)}</a>;
    case "EMAIL":
      return <a href={`mailto:${String(value)}`} onClick={(e) => e.stopPropagation()} className="text-xs text-violet-600 hover:underline">{String(value)}</a>;
    case "TEXTAREA":
      return <span className="line-clamp-2 text-xs text-muted">{String(value)}</span>;
    default:
      return <span className="truncate inline-block max-w-[280px]">{String(value)}</span>;
  }
}

function EmptyView({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface text-center py-16">
      <ChevronDown size={28} className="mx-auto mb-2 text-muted-2 rotate-180" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}
