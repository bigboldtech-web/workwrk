"use client";

// My work: list, board, calendar, Gantt, timeline and sprint, over one
// cursor-paginated call to `GET /api/me/work`.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/my-work).
//
// THE URL IS THE STATE. `?view=`, `?group=`, `?sort=`, `?done=`, `?scope=`
// and `?filter=` are the whole of it, which is what makes a view sendable and what makes Back
// work. The page it replaces kept all of this in component state and lost it
// on every navigation.
//
// THE ROWS ARE ITEMS, and every one of them is assigned to the viewer, so
// access rule 9 gives them Can edit on every row: the inline status, due date
// and priority edits always render. The List chip is a LINK only when the
// viewer can open the List (the server answers that per row), and a plain
// label otherwise: a chip that 404s is worse than no chip.
//
// THE BULK BAR IS ONE REQUEST. `POST /api/items/bulk` gates each row on its
// own and reports what it could not do, so "38 updated · 2 you can't edit" is
// a thing the toast can actually say, which the old per-row fan-out could not.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Calendar as CalendarIcon, CalendarRange, Flag, GanttChart, GripVertical, IterationCw, Kanban, List as ListIcon,
  SlidersHorizontal, X,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { Switch } from "@/components/ui/switch";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { useShortcut } from "@/lib/shortcuts";
import { openTask } from "@/lib/nav/open-task";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import type { SavedWorkFilter } from "@/lib/home-prefs";
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  WORK_GROUPS,
  WORK_SORTS,
  WORK_VIEWS,
  boardColumns,
  listGroups,
  parseWorkScope,
  parseWorkView,
  type MyWorkFacets,
  type MyWorkResponse,
  type MyWorkRow,
  type WorkGroupKey,
  type WorkSortKey,
  type WorkViewKey,
} from "@/lib/my-work";
import { dueChipLabel, type LocaleContext } from "@/lib/work-buckets";
import { relativeTime } from "@/lib/item-date";
import { MyWorkCalendar } from "./my-work-calendar";
import { MyWorkGantt, MyWorkTimeline } from "./my-work-gantt";
import { MyWorkSprint } from "./my-work-sprint";
import { SaveViewModal } from "./save-view-modal";

const ITEM_CREATED = "workwrk:item-created";
const PAGE_SIZE = 50;

/** The optional columns, in the order Display lists them, with their default widths. */
const FIELDS: ReadonlyArray<{ key: string; label: string; fixed?: boolean; width: number }> = [
  { key: "title", label: "Title", fixed: true, width: 0 },
  { key: "status", label: "Status", width: 112 },
  { key: "assignees", label: "Assignees", width: 80 },
  { key: "due", label: "Due date", width: 96 },
  { key: "priority", label: "Priority", width: 72 },
  { key: "list", label: "List", width: 160 },
  { key: "space", label: "Space", width: 140 },
  { key: "updated", label: "Updated", width: 110 },
];
/** The spec's four defaults: Status, Assignees, Due date, Priority. */
const DEFAULT_FIELDS = ["title", "status", "assignees", "due", "priority", "list"];
const MIN_COL_W = 48;

/**
 * The stored `fields` list IS the column order, so a reorder is a write of
 * the same key the show / hide switches write; a stored list from before
 * reordering existed reads back in its own order, which was Display's order.
 */
function orderedColumns(fields: readonly string[], widths: Readonly<Record<string, number>>) {
  return fields
    .filter((k) => k !== "title")
    .map((k) => FIELDS.find((f) => f.key === k))
    .filter((f): f is (typeof FIELDS)[number] => Boolean(f))
    .map((f) => ({ key: f.key, label: f.label, width: Math.max(MIN_COL_W, widths[f.key] ?? f.width) }));
}

/** The bulk bar's "Set due date" presets, resolved in the viewer's own clock. */
const DUE_PRESETS: ReadonlyArray<{ value: string; label: string; at: () => string }> = [
  { value: "today", label: "Today", at: () => endOfDay(0) },
  { value: "tomorrow", label: "Tomorrow", at: () => endOfDay(1) },
  { value: "next-week", label: "Next week", at: () => endOfDay(7) },
];
function endOfDay(addDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
}

/** The Filter panel's Due date rows, in bucket order. */
const DUE_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "next", label: "Next week" },
  { value: "none", label: "No date" },
];

/** Everything the Filter panel can narrow by. One key per spec row. */
interface WorkFilters {
  priority: string[];
  status: string[];
  list: string[];
  space: string[];
  due: string[];
  type: string[];
  tags: string[];
  /** Spec default: on. Off means top-level tasks only. */
  subtasks: boolean;
}

const NO_FILTERS: WorkFilters = { priority: [], status: [], list: [], space: [], due: [], type: [], tags: [], subtasks: true };

/**
 * `?bucket=` seeds the Due date filter on first paint, and exists for exactly
 * one reason: the retired /tasks/* pages have to keep their SET, not just
 * their neighbourhood. "Backlog" WAS the undated tasks, so
 * /tasks/backlog 308s to /my-work?group=due&bucket=nodate and the bookmark
 * lands on that set rather than on all of My work with the set somewhere in
 * the scroll. It seeds a normal filter, so the chip shows, the count shows
 * and one click clears it.
 */
const BUCKET_PARAM: Readonly<Record<string, string>> = {
  nodate: "none",
  none: "none",
  overdue: "overdue",
  today: "today",
  week: "week",
  next: "next",
};

function countActive(f: WorkFilters): number {
  return (
    f.priority.length + f.status.length + f.list.length + f.space.length +
    f.due.length + f.type.length + f.tags.length + (f.subtasks ? 0 : 1)
  );
}

/** A saved view's stored `filters` blob, read back defensively. */
function filtersFrom(stored: Record<string, unknown> | undefined): WorkFilters {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  if (!stored) return NO_FILTERS;
  return {
    priority: list(stored.priority),
    status: list(stored.status),
    list: list(stored.list),
    space: list(stored.space),
    due: list(stored.due),
    type: list(stored.type),
    tags: list(stored.tags),
    subtasks: stored.subtasks !== false,
  };
}

export function MyWorkClient({
  savedFilters,
  initialFields,
  initialColWidths,
  initialShowDone,
}: {
  savedFilters: SavedWorkFilter[];
  initialFields: string[] | null;
  /** Per-column widths in px, keyed by field (`viewOptions.colWidths`). */
  initialColWidths: Record<string, number> | null;
  initialShowDone: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { openCreateTask, patchPrefs, layerCount } = useOsShell();
  const { toast } = useOsToast();
  const prompt = usePrompt();
  const confirm = useConfirm();

  const view: WorkViewKey = parseWorkView(params.get("view"));
  // `?scope=delegated`: the tasks the viewer handed to other people, the
  // retired Today / Overdue page's Delegated tab. Same rows, same views.
  const scope = parseWorkScope(params.get("scope"));
  const group = (WORK_GROUPS.find((g) => g.key === params.get("group"))?.key ?? "due") as WorkGroupKey;
  const sort = (WORK_SORTS.find((s) => s.key === params.get("sort"))?.key ?? "due") as WorkSortKey;
  const activeFilterId = params.get("filter");
  const showDone = params.get("done") === "1" || (params.get("done") === null && initialShowDone);

  const [rows, setRows] = useState<MyWorkRow[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; hasMore: boolean; nextCursor: string | null } | null>(null);
  // Rows this viewer owns in the legacy `Task` table that have no forwarding
  // address yet. See the notice below the toolbar for what it is for.
  const [legacyTaskCount, setLegacyTaskCount] = useState(0);
  const [locale, setLocale] = useState<LocaleContext>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [bulkPicker, setBulkPicker] = useState<null | "status" | "priority" | "due">(null);
  const [fields, setFields] = useState<string[]>(initialFields ?? DEFAULT_FIELDS);
  const [colWidths, setColWidths] = useState<Record<string, number>>(initialColWidths ?? {});
  const [filters, setFilters] = useState<WorkFilters>(() => {
    const seeded = BUCKET_PARAM[params.get("bucket") ?? ""];
    return seeded ? { ...NO_FILTERS, due: [seeded] } : NO_FILTERS;
  });
  const [facets, setFacets] = useState<MyWorkFacets | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [views, setViews] = useState<SavedWorkFilter[]>(savedFilters);
  const [calMode, setCalMode] = useState<"month" | "week">("month");
  // The Filter panel's field search (design-system 5.2: an input once there
  // are six or more rows). Nine rows is over that line.
  const [fieldQuery, setFieldQuery] = useState("");

  const cursor = cursors.length ? cursors[cursors.length - 1] : null;

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      setCursors([]);
      router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        group,
        sort,
        limit: String(PAGE_SIZE),
        done: showDone ? "1" : "0",
      });
      if (scope === "delegated") qs.set("scope", "delegated");
      if (cursor) qs.set("cursor", cursor);
      // Every row the Filter panel draws is a real query parameter. It used to
      // send `priority` and nothing else, because that was the only filter the
      // panel had.
      if (filters.priority.length) qs.set("priority", filters.priority.join(","));
      if (filters.status.length) qs.set("status", filters.status.join(","));
      if (filters.list.length) qs.set("list", filters.list.join(","));
      if (filters.space.length) qs.set("space", filters.space.join(","));
      if (filters.due.length) qs.set("due", filters.due.join(","));
      if (filters.type.length) qs.set("type", filters.type.join(","));
      if (filters.tags.length) qs.set("tags", filters.tags.join(","));
      if (!filters.subtasks) qs.set("subtasks", "0");
      const res = await apiFetch<MyWorkResponse>(`/api/me/work?${qs}`, { cache: "no-store" });
      if (!res.ok) {
        setFailed(res.error);
        return;
      }
      setRows(res.data.rows);
      setMeta({ total: res.data.total, hasMore: res.data.hasMore, nextCursor: res.data.nextCursor });
      setLegacyTaskCount(res.data.legacyTaskCount ?? 0);
      setFacets(res.data.facets ?? null);
      setLocale({ timeZone: res.data.locale.timeZone, weekStart: res.data.locale.weekStart });
      setFailed(null);
      setNow(new Date());
    } catch {
      setFailed("Couldn't load your tasks");
    }
  }, [group, sort, showDone, scope, cursor, filters]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(ITEM_CREATED, refresh);
    window.addEventListener(WINDOW_EVENTS.itemChanged, refresh);
    // 30s while visible, the spec's poll. It is a fallback, not the mechanism:
    // the item-changed event above is what makes an edit show up at once.
    const tick = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(ITEM_CREATED, refresh);
      window.removeEventListener(WINDOW_EVENTS.itemChanged, refresh);
      window.clearInterval(tick);
    };
  }, [load]);

  const persistFields = useCallback(
    async (next: string[], widths: Record<string, number> = colWidths) => {
      setFields(next);
      const ok = await patchPrefs({
        home: { work: { surface: { "my-work": { viewOptions: { fields: next, done: showDone, colWidths: widths } } } } },
      });
      if (!ok) toast("Couldn't save which columns show");
    },
    [patchPrefs, showDone, toast, colWidths],
  );

  /** A resized column: the width lands in the same viewOptions key. */
  const persistWidth = useCallback(
    (key: string, width: number) => {
      const next = { ...colWidths, [key]: Math.max(MIN_COL_W, Math.round(width)) };
      setColWidths(next);
      void patchPrefs({
        home: { work: { surface: { "my-work": { viewOptions: { fields, done: showDone, colWidths: next } } } } },
      }).then((ok) => { if (!ok) toast("Couldn't save the column width"); });
    },
    [colWidths, fields, showDone, patchPrefs, toast],
  );

  /** A dragged header: the column moves within the stored order. */
  const reorderColumn = useCallback(
    (from: string, to: string) => {
      if (from === to) return;
      const next = fields.filter((k) => k !== from);
      const at = next.indexOf(to);
      if (at < 0) return;
      next.splice(at, 0, from);
      void persistFields(next);
    },
    [fields, persistFields],
  );

  const columns = useMemo(() => orderedColumns(fields, colWidths), [fields, colWidths]);

  // ── saved views ──────────────────────────────────────────────────
  //
  // The page already read `home.work.savedFilters` and already rendered a pill
  // per saved view, and "+ View" already opened the Filter panel. What was
  // missing was the one control that can CREATE one: `onSaveView` was never
  // passed, so the panel's "Save as view" footer never rendered and nothing
  // anywhere in src wrote the key. The pills could not exist.
  const activeView = useMemo(
    () => views.find((v) => v.id === activeFilterId) ?? null,
    [views, activeFilterId],
  );

  /** One write for the whole array: the key stores a list, not a patch. */
  const persistViews = useCallback(
    async (next: SavedWorkFilter[]) => {
      const previous = views;
      setViews(next);
      const ok = await patchPrefs({ home: { work: { savedFilters: next } } });
      if (!ok) {
        setViews(previous);
        toast("Couldn't save your views");
        return false;
      }
      return true;
    },
    [views, patchPrefs, toast],
  );

  const saveView = useCallback(
    async (name: string, isDefault: boolean) => {
      const id = `v_${Date.now().toString(36)}`;
      const next: SavedWorkFilter[] = [
        ...views.map((v) => (isDefault ? { ...v, isDefault: false } : v)),
        {
          id,
          name,
          filters: { ...filters },
          sort,
          group,
          view,
          isDefault,
        },
      ];
      const ok = await persistViews(next);
      setSaveOpen(false);
      if (ok) {
        toast(`View "${name}" saved`);
        setParam({ filter: id });
      }
    },
    [views, filters, sort, group, view, persistViews, toast, setParam],
  );

  // Selecting a saved pill restores everything it remembered: its filters into
  // state, its sort, group and view into the URL, so the address bar still
  // describes what is on screen.
  const applyView = useCallback(
    (v: SavedWorkFilter | null) => {
      if (!v) {
        setFilters(NO_FILTERS);
        setParam({ filter: null });
        return;
      }
      setFilters(filtersFrom(v.filters));
      setParam({
        filter: v.id,
        sort: v.sort && v.sort !== "due" ? v.sort : null,
        group: v.group && v.group !== "due" ? v.group : null,
        view: v.view && v.view !== "list" ? v.view : null,
      });
    },
    [setParam],
  );

  const renameView = useCallback(
    async (v: SavedWorkFilter) => {
      const name = await prompt({ title: "Rename view", defaultValue: v.name, submitLabel: "Rename", required: true });
      const trimmed = (name ?? "").trim();
      if (!trimmed || trimmed === v.name) return;
      await persistViews(views.map((row) => (row.id === v.id ? { ...row, name: trimmed } : row)));
    },
    [prompt, persistViews, views],
  );

  const toggleDefaultView = useCallback(
    async (v: SavedWorkFilter) => {
      const on = !v.isDefault;
      await persistViews(views.map((row) => ({ ...row, isDefault: on && row.id === v.id })));
    },
    [persistViews, views],
  );

  const deleteView = useCallback(
    async (v: SavedWorkFilter) => {
      const yes = await confirm({
        title: `Delete "${v.name}"?`,
        description: "The view goes; the tasks it showed do not.",
        confirmLabel: "Delete view",
        destructive: true,
      });
      if (!yes) return;
      const ok = await persistViews(views.filter((row) => row.id !== v.id));
      if (ok) {
        applyView(null);
        toast(`View "${v.name}" deleted`);
      }
    },
    [confirm, persistViews, views, applyView, toast],
  );

  // Editing a filter row while a saved view is selected means the rows on
  // screen are no longer that view, so the pill stops claiming they are.
  const editFilters = useCallback(
    (patch: Partial<WorkFilters>) => {
      setFilters((prev) => ({ ...prev, ...patch }));
      if (activeFilterId) setParam({ filter: null });
    },
    [activeFilterId, setParam],
  );

  const matchesField = useCallback(
    (label: string) => {
      const q = fieldQuery.trim().toLowerCase();
      return !q || label.toLowerCase().includes(q);
    },
    [fieldQuery],
  );

  const toggleIn = useCallback(
    (key: "priority" | "status" | "list" | "space" | "due" | "type" | "tags", value: string, on: boolean) => {
      setFilters((prev) => ({
        ...prev,
        [key]: on ? [...prev[key], value] : prev[key].filter((v) => v !== value),
      }));
      if (activeFilterId) setParam({ filter: null });
    },
    [activeFilterId, setParam],
  );

  // ── bulk ─────────────────────────────────────────────────────────

  const runBulk = useCallback(
    async (patch: Record<string, unknown>, describe: string) => {
      const ids = [...selected];
      if (ids.length === 0) return;
      setBusy(true);
      const res = await apiFetch<{ updated: number; skipped: number }>("/api/items/bulk", {
        method: "POST",
        json: { ids, patch },
      });
      setBusy(false);
      if (!res.ok) {
        toast("Couldn't update those tasks", { tone: "danger", description: res.error });
        return;
      }
      const { updated, skipped } = res.data;
      toast(
        skipped > 0
          ? `${updated} ${describe} · ${skipped} you can't edit`
          : `${updated} ${describe}`,
      );
      setSelected(new Set());
      void load();
    },
    [selected, toast, load],
  );

  const statusOptions = useMemo(() => {
    // The statuses actually present across the viewer's Lists. There is no
    // org-wide status vocabulary, so offering anything else would offer a word
    // some of the selected tasks' Lists have never heard of.
    const seen = new Map<string, string>();
    for (const r of rows ?? []) if (r.status) seen.set(r.status, r.statusLabel ?? r.status);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [rows]);

  // Grouped by due date the LIST shows the same six buckets the board does,
  // empty ones collapsed to one line (design-system 5.1). They used to
  // disagree: the board drew "Tomorrow 0 / Nothing here" and the list simply
  // left the bucket out.
  /** One done status across the whole selection, or null when they differ. */
  const doneStatusForSelection = useMemo(() => {
    const picked = (rows ?? []).filter((r) => selected.has(r.id));
    const values = new Set(picked.map((r) => r.doneStatus).filter((v): v is string => !!v));
    if (picked.length === 0 || values.size !== 1) return null;
    return [...values][0];
  }, [rows, selected]);

  // The page's chords, registered so the "?" overlay and /account/shortcuts
  // list them. spec-work-home section 2 (/my-work, Keyboard) is explicit that
  // advertised equals working here.
  useShortcut({ id: "my-work-filter", keys: "f", label: "Filter", scope: "page", run: () => setFilterOpen((v) => !v) });
  useShortcut({ id: "my-work-list", keys: "1", label: "List view", scope: "page", run: () => setParam({ view: null }) });
  useShortcut({ id: "my-work-board", keys: "2", label: "Board view", scope: "page", run: () => setParam({ view: "board" }) });
  useShortcut({ id: "my-work-calendar", keys: "3", label: "Calendar view", scope: "page", run: () => setParam({ view: "calendar" }) });
  useShortcut({ id: "my-work-gantt", keys: "4", label: "Gantt view", scope: "page", run: () => setParam({ view: "gantt" }) });
  useShortcut({ id: "my-work-timeline", keys: "5", label: "Timeline view", scope: "page", run: () => setParam({ view: "timeline" }) });
  useShortcut({ id: "my-work-sprint", keys: "6", label: "Sprint view", scope: "page", run: () => setParam({ view: "sprint" }) });
  useShortcut({
    id: "my-work-clear-selection",
    keys: "escape",
    label: "Clear the selection",
    scope: "page",
    when: () => selected.size > 0 && layerCount === 0,
    run: () => setSelected(new Set()),
  }, selected.size > 0 && layerCount === 0);

  const grouped = useMemo(() => listGroups(rows ?? [], group), [rows, group]);
  const boardCols = useMemo(() => boardColumns(rows ?? [], group), [rows, group]);
  const loading = rows === null && failed === null;
  const page = cursors.length + 1;
  const firstRow = (page - 1) * PAGE_SIZE + 1;
  const lastRow = (page - 1) * PAGE_SIZE + (rows?.length ?? 0);

  return (
    <>
      <OsPageHeader
        title={scope === "delegated" ? "My work · Assigned by me" : "My work"}
        askAi
        views={
          <>
            <ViewTab label="All" active={!activeFilterId} onClick={() => applyView(null)} />
            {views.map((f) => (
              <ViewTab key={f.id} label={f.name} active={activeFilterId === f.id} onClick={() => applyView(f)} />
            ))}
            {/* Immediately after the pills, not pinned to the far right edge:
                it belongs to the run of views it adds to. */}
            <button
              type="button"
              onClick={() => { setFilterOpen(true); setSaveOpen(true); }}
              className="os-chrome inline-flex h-8 shrink-0 items-center rounded-md px-2 text-row font-medium text-ink-2 hover:bg-hover hover:text-ink"
            >
              + View
            </button>
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: countActive(filters) + (scope === "delegated" ? 1 : 0) },
          // The control's own NAME at the default, the value once it differs.
          // Two chips side by side both reading "Due date" tells you nothing
          // about which one you are looking at.
          sort: {
            onClick: () => setSortOpen((v) => !v),
            label: sort === "due" ? "Sort" : WORK_SORTS.find((s) => s.key === sort)?.label,
            active: sort !== "due",
          },
          group: {
            onClick: () => setGroupOpen((v) => !v),
            label: group === "due" ? "Group" : WORK_GROUPS.find((g) => g.key === group)?.label,
            active: group !== "due",
          },
          left:
            view === "calendar" ? (
              <div role="radiogroup" aria-label="Calendar range" className="inline-flex items-center rounded-md border border-line">
                {(["month", "week"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={calMode === m}
                    onClick={() => setCalMode(m)}
                    className={`inline-flex h-8 items-center px-2.5 text-base first:rounded-s-md last:rounded-e-md ${
                      calMode === m ? "bg-brand-soft font-medium text-brand-deep" : "text-ink-2 hover:bg-hover hover:text-ink"
                    }`}
                  >
                    {m === "month" ? "Month" : "Week"}
                  </button>
                ))}
              </div>
            ) : null,
          switcher: {
            value: view,
            options: [
              { key: "list", label: "List", icon: ListIcon },
              { key: "board", label: "Board", icon: Kanban },
              { key: "calendar", label: "Calendar", icon: CalendarIcon },
              { key: "gantt", label: "Gantt", icon: GanttChart },
              { key: "timeline", label: "Timeline", icon: CalendarRange },
              { key: "sprint", label: "Sprint", icon: IterationCw },
            ],
            onChange: (key) => setParam({ view: key === "list" ? null : key }),
          },
          primary: { label: "Create task", onClick: () => openCreateTask() },
          menu: [
            { label: "Display", onClick: () => setDisplayOpen(true) },
            // The saved view's own actions (spec: Rename, Set as default,
            // Delete), rendered only while one is selected, because renaming
            // "All" is not a thing.
            ...(activeView
              ? [
                  { separator: true as const },
                  { label: `Rename "${activeView.name}"`, onClick: () => void renameView(activeView) },
                  {
                    label: activeView.isDefault ? "Remove as default" : "Set as default",
                    onClick: () => void toggleDefaultView(activeView),
                  },
                  { label: "Delete view", destructive: true, onClick: () => void deleteView(activeView) },
                ]
              : []),
            // The "Legacy tasks" MENU ROW is gone, and so is the UI it opened.
            //
            // Phase 2 W4 (docs/plans/ui-refresh/spec-work-home.md section 4).
            // It pointed at /tasks/assigned-to-me, one of seven pages over the
            // legacy `Task` table; those pages are deleted in this release and
            // every legacy row is an Item, reachable here like any other task.
            //
            // THE ORDERING THIS DEPENDS ON, stated where somebody would look
            // for it: scripts/migrate-legacy-tasks.ts must have run in
            // production before or with this release. It is the founder's step
            // (scripts/MIGRATIONS.md) and the runbook says so in bold. Until it
            // has run for a workspace, that workspace's legacy rows are still
            // in the database, undeleted, and reachable by running the script;
            // they are not reachable in the UI, because the pages that showed
            // them are gone. The notice UNDER this toolbar says so in the
            // product rather than leaving it to a curl of the API: see
            // `legacyTaskCount` below.
          ],
        }}
      />

      {/* The three toolbar popovers. Each is anchored under its own chip. */}
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker
              open
              onClose={() => setSortOpen(false)}
              ariaLabel="Sort tasks by"
              selected={sort}
              sections={[{ options: WORK_SORTS.map((s) => ({ value: s.key, label: s.label })) }]}
              onSelect={(value) => { setSortOpen(false); setParam({ sort: value === "due" ? null : value }); }}
            />
          </div>
        ) : null}
        {groupOpen ? (
          <div className="absolute start-[220px] top-0 z-40">
            <Picker
              open
              onClose={() => setGroupOpen(false)}
              ariaLabel="Group tasks by"
              selected={group}
              sections={[{ options: WORK_GROUPS.map((g) => ({ value: g.key, label: g.label })) }]}
              onSelect={(value) => { setGroupOpen(false); setParam({ group: value === "due" ? null : value }); }}
            />
          </div>
        ) : null}
        {displayOpen ? (
          <div className="absolute end-6 top-0 z-40">
            <Picker
              open
              onClose={() => setDisplayOpen(false)}
              ariaLabel="Display options"
              align="end"
              width={280}
              multi
              selected={[...fields, ...(showDone ? ["__done"] : [])]}
              sections={[
                { label: "Fields shown", options: FIELDS.map((f) => ({ value: f.key, label: f.label, disabled: f.fixed })) },
                { label: "Rows", options: [{ value: "__done", label: "Show done tasks" }] },
              ]}
              onSelect={(value) => {
                if (value === "__done") { setParam({ done: showDone ? null : "1" }); return; }
                const next = fields.includes(value) ? fields.filter((f) => f !== value) : [...fields, value];
                void persistFields(next);
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        {filterOpen ? (
          <FilterPanel
            open
            onClose={() => setFilterOpen(false)}
            objects="tasks"
            activeCount={countActive(filters)}
            onClearAll={() => { editFilters(NO_FILTERS); if (scope === "delegated") setParam({ scope: null }); }}
            onSaveView={() => setSaveOpen(true)}
            search={{ value: fieldQuery, onChange: setFieldQuery, placeholder: "Search fields" }}
          >
            {/* Whose tasks. "Assigned by me" is the Delegated tab the old
                Today / Overdue page had: the tasks you created or assigned
                that sit with somebody else. */}
            {matchesField("Assigned by me") ? (
              <li className="flex h-9 items-center gap-3 rounded-md px-2">
                <span className="min-w-0 flex-1 truncate text-row text-ink">Assigned by me</span>
                <Switch
                  checked={scope === "delegated"}
                  onChange={(on) => setParam({ scope: on ? "delegated" : null })}
                  aria-label="Assigned by me"
                />
              </li>
            ) : null}
            {/* Every row offers exactly the values the viewer's OWN tasks
                carry, counted over the whole assigned set rather than the page
                on screen, so a row can never promise a narrowing that returns
                nothing. `facets` comes back with the rows. */}
            <FilterGroupRow
              label="Status"
              hidden={!matchesField("Status")}
              options={(facets?.statuses ?? []).map((o) => ({ value: o.value, label: o.label, count: o.count }))}
              selected={filters.status}
              onToggle={(v, on) => toggleIn("status", v, on)}
              emptyNote="Your tasks carry no status yet"
            />
            <FilterGroupRow
              label="List"
              hidden={!matchesField("List")}
              options={(facets?.lists ?? []).map((o) => ({ value: o.id, label: o.name, count: o.count }))}
              selected={filters.list}
              onToggle={(v, on) => toggleIn("list", v, on)}
            />
            <FilterGroupRow
              label="Space"
              hidden={!matchesField("Space")}
              options={(facets?.spaces ?? []).map((o) => ({ value: o.id, label: o.name, count: o.count }))}
              selected={filters.space}
              onToggle={(v, on) => toggleIn("space", v, on)}
              emptyNote="Nothing assigned to you sits in a Space"
            />
            <FilterGroupRow
              label="Priority"
              hidden={!matchesField("Priority")}
              options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
              selected={filters.priority}
              onToggle={(v, on) => toggleIn("priority", v, on)}
            />
            <FilterGroupRow
              label="Due date"
              hidden={!matchesField("Due date")}
              options={DUE_FILTERS.map((d) => ({ value: d.value, label: d.label }))}
              selected={filters.due}
              onToggle={(v, on) => toggleIn("due", v, on)}
            />
            <FilterGroupRow
              label="Tags"
              hidden={!matchesField("Tags")}
              options={(facets?.tags ?? []).map((o) => ({ value: o.id, label: o.name, count: o.count }))}
              selected={filters.tags}
              onToggle={(v, on) => toggleIn("tags", v, on)}
              emptyNote="None of your tasks is tagged"
            />
            <FilterGroupRow
              label="Type"
              hidden={!matchesField("Type")}
              options={(facets?.types ?? []).map((o) => ({ value: o.id, label: o.name, count: o.count }))}
              selected={filters.type}
              onToggle={(v, on) => toggleIn("type", v, on)}
            />
            {matchesField("Includes subtasks") ? (
              <li className="flex h-9 items-center gap-3 rounded-md px-2">
                <span className="min-w-0 flex-1 truncate text-row text-ink">Includes subtasks</span>
                <Switch
                  checked={filters.subtasks}
                  onChange={(on) => editFilters({ subtasks: on })}
                  aria-label="Includes subtasks"
                />
              </li>
            ) : null}
            {matchesField("Show done tasks") ? (
              <li className="flex h-9 items-center gap-3 rounded-md px-2">
                <span className="min-w-0 flex-1 truncate text-row text-ink">Show done tasks</span>
                <Switch
                  checked={showDone}
                  onChange={(on) => setParam({ done: on ? "1" : null })}
                  aria-label="Show done tasks"
                />
              </li>
            ) : null}
          </FilterPanel>
        ) : null}

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {/*
            The migration window, said out loud.

            Phase 2 W4 deleted the seven /tasks/* pages that were the only UI
            over the legacy `Task` table. scripts/migrate-legacy-tasks.ts moves
            those rows onto Items, and it is a script the founder runs, so
            between this deploy and that run a workspace has work of its own
            that this page cannot show. A product that knows the number and
            prints nothing is the silent removal the whole release is trying
            not to be, so the number is on the page.

            It is a NOTICE, not a door: there is no page left to link to, and a
            control with nowhere to go is worse than a sentence. It draws only
            while the count is above zero, and it counts rows with NO
            forwarding address, so it disappears by itself the moment the
            migration has run for this workspace.
          */}
          {legacyTaskCount > 0 ? (
            <div
              role="status"
              className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-base text-ink-2"
            >
              <span className="min-w-0">
                <span className="font-medium text-ink">
                  {legacyTaskCount} {legacyTaskCount === 1 ? "task is" : "tasks are"} still on the old task list
                </span>{" "}
                and cannot be shown here yet. Your workspace admin finishes the move; nothing has been
                deleted.
              </span>
            </div>
          ) : null}
          {failed ? (
            <OsEmptyView
              variant="error"
              title="Couldn't load your tasks"
              hint={failed}
              action={{ label: "Retry", onClick: () => void load() }}
            />
          ) : loading ? (
            <TableSkeleton />
          ) : (rows?.length ?? 0) === 0 ? (
            countActive(filters) > 0 ? (
              <div className="flex h-11 items-center gap-3 rounded-lg border border-line bg-raised px-4 text-base text-ink-2">
                No results
                <button type="button" onClick={() => editFilters(NO_FILTERS)} className="font-medium text-brand-deep hover:underline">
                  Clear filters
                </button>
              </div>
            ) : (
              // One sentence and one text link (design-system 5.8). The second
              // sentence explaining which Spaces it covers was a caption the
              // empty state is not allowed to carry.
              <OsEmptyView
                context="list"
                title={scope === "delegated" ? "You haven't assigned anything to anyone yet" : "Nothing assigned to you yet"}
                action={{ label: "Create a task", onClick: () => openCreateTask() }}
              />
            )
          ) : view === "board" ? (
            <BoardView columns={boardCols} now={now} locale={locale} onAdd={() => openCreateTask()} />
          ) : view === "calendar" ? (
            <MyWorkCalendar rows={rows ?? []} locale={locale} onCreate={() => openCreateTask()} mode={calMode} />
          ) : view === "gantt" ? (
            <MyWorkGantt rows={rows ?? []} onChanged={() => void load()} />
          ) : view === "timeline" ? (
            <MyWorkTimeline rows={rows ?? []} onChanged={() => void load()} />
          ) : view === "sprint" ? (
            <MyWorkSprint rows={rows ?? []} now={now} locale={locale} onChanged={() => void load()} />
          ) : (
            <ListView
              groups={grouped}
              columns={columns}
              onResize={persistWidth}
              onReorder={reorderColumn}
              now={now}
              locale={locale}
              selected={selected}
              onToggle={(id) =>
                setSelected((s) => {
                  const next = new Set(s);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onAdd={() => openCreateTask()}
              onColumns={() => setDisplayOpen(true)}
            />
          )}

          {rows && rows.length > 0 && view === "list" ? (
            <div className="mt-2 flex h-11 items-center gap-4 px-1 text-sm text-ink-2">
              <span>Total records {meta?.total ?? rows.length}</span>
              <span className="flex-1" />
              <span>{firstRow} to {lastRow}</span>
              <button
                type="button"
                disabled={cursors.length === 0}
                onClick={() => setCursors((c) => c.slice(0, -1))}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40"
                aria-label="Previous page"
              >
                ‹
              </button>
              <button
                type="button"
                disabled={!meta?.hasMore || !meta?.nextCursor}
                onClick={() => meta?.nextCursor && setCursors((c) => [...c, meta.nextCursor!])}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40"
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
          <div
            className="pointer-events-auto flex items-center gap-1 rounded-lg border border-line bg-raised px-3 py-2"
            style={{ boxShadow: "var(--os-shadow-pop)" }}
          >
            <span className="px-2 text-base font-medium text-ink">{selected.size} selected</span>
            <div className="relative">
              <button
                type="button"
                disabled={busy || statusOptions.length === 0}
                onClick={() => setBulkPicker((v) => (v === "status" ? null : "status"))}
                className="inline-flex h-8 items-center rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                Set status
              </button>
              {bulkPicker === "status" ? (
                <div className="absolute bottom-10 start-0 z-50">
                  <Picker
                    open
                    onClose={() => setBulkPicker(null)}
                    side="top"
                    ariaLabel="Set status"
                    sections={[{ options: statusOptions }]}
                    onSelect={(value) => { setBulkPicker(null); void runBulk({ status: value }, "updated"); }}
                  />
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                disabled={busy}
                onClick={() => setBulkPicker((v) => (v === "due" ? null : "due"))}
                className="inline-flex h-8 items-center rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                Set due date
              </button>
              {bulkPicker === "due" ? (
                <div className="absolute bottom-10 start-0 z-50">
                  <Picker
                    open
                    onClose={() => setBulkPicker(null)}
                    side="top"
                    ariaLabel="Set due date"
                    sections={[{ options: DUE_PRESETS.map((d) => ({ value: d.value, label: d.label })) }]}
                    onSelect={(value) => {
                      setBulkPicker(null);
                      const preset = DUE_PRESETS.find((d) => d.value === value);
                      if (preset) void runBulk({ dueAt: preset.at() }, "rescheduled");
                    }}
                  />
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                disabled={busy}
                onClick={() => setBulkPicker((v) => (v === "priority" ? null : "priority"))}
                className="inline-flex h-8 items-center rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                Set priority
              </button>
              {bulkPicker === "priority" ? (
                <div className="absolute bottom-10 start-0 z-50">
                  <Picker
                    open
                    onClose={() => setBulkPicker(null)}
                    side="top"
                    ariaLabel="Set priority"
                    sections={[{ options: PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })) }]}
                    onSelect={(value) => { setBulkPicker(null); void runBulk({ priority: value }, "updated"); }}
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy || doneStatusForSelection === null}
              onClick={() => doneStatusForSelection && void runBulk({ status: doneStatusForSelection }, "marked done")}
              // Every selected task must agree on which word means done: the
              // status lives in each row's OWN List, so "Shipped" and "Closed"
              // cannot be written in one request. When they disagree, the
              // control is disabled and says why rather than writing a status
              // some List has never heard of.
              title={
                doneStatusForSelection === null
                  ? "These tasks are in Lists with different done statuses"
                  : undefined
              }
              className="inline-flex h-8 items-center rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
            >
              Mark done
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {/* Keyed on `saveOpen` so each open is a fresh component with an empty
          name, rather than an effect resetting state after the fact. */}
      <SaveViewModal
        key={saveOpen ? "save-open" : "save-closed"}
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={(name, isDefault) => void saveView(name, isDefault)}
        activeCount={countActive(filters)}
      />
    </>
  );
}

/* ─────────────────────────── filter rows ─────────────────────────── */

/**
 * One filter field: a checkbox row that expands into its value list.
 *
 * `count` is the number of the viewer's own tasks that carry the value, so a
 * row never offers a narrowing that returns nothing, and a field with no
 * values at all says so in one line instead of expanding into emptiness.
 */
function FilterGroupRow({
  label,
  options,
  selected,
  onToggle,
  emptyNote,
  hidden = false,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string; count?: number }>;
  selected: string[];
  onToggle: (value: string, on: boolean) => void;
  emptyNote?: string;
  hidden?: boolean;
}) {
  const [open, setOpen] = useState(selected.length > 0);
  if (hidden) return null;
  return (
    <FilterRow
      label={label}
      count={selected.length || undefined}
      checked={open || selected.length > 0}
      onCheckedChange={(on) => {
        setOpen(on);
        if (!on) for (const v of selected) onToggle(v, false);
      }}
    >
      {options.length === 0 ? (
        <p className="py-1 text-sm text-ink-3">{emptyNote ?? "Nothing to filter by yet"}</p>
      ) : (
        <ul className="flex max-h-56 flex-col overflow-y-auto">
          {options.map((o) => (
            <li key={o.value}>
              <label className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-1 hover:bg-hover">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={(e) => onToggle(o.value, e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-line-strong accent-[var(--os-brand)]"
                />
                <span className="min-w-0 flex-1 truncate text-base text-ink">{o.label}</span>
                {typeof o.count === "number" ? (
                  <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{o.count}</span>
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      )}
    </FilterRow>
  );
}

/* ───────────────────────────── list view ───────────────────────────── */

type Column = { key: string; label: string; width: number };

/**
 * The columns are a MODEL, not a row of `w-28` spans: their order is the
 * stored `fields` list, their widths are stored per key, and the header cells
 * are the controls that change both. Drag a header onto another to reorder;
 * drag the handle at a header's right edge to resize. Show and hide stay in
 * the Display popover the column-settings glyph opens.
 */
function ListView({
  groups,
  columns,
  onResize,
  onReorder,
  now,
  locale,
  selected,
  onToggle,
  onAdd,
  onColumns,
}: {
  groups: ReturnType<typeof listGroups>;
  columns: Column[];
  onResize: (key: string, width: number) => void;
  onReorder: (from: string, to: string) => void;
  now: Date;
  locale: LocaleContext;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAdd: () => void;
  onColumns: () => void;
}) {
  const router = useRouter();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  // Live width while a handle is being dragged, so the column follows the
  // pointer; the write happens once, on release.
  const [live, setLive] = useState<{ key: string; width: number } | null>(null);

  const widthOf = (c: Column) => (live?.key === c.key ? live.width : c.width);

  const startResize = (e: React.PointerEvent, c: Column) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = c.width;
    let latest = startW;
    const onMove = (ev: PointerEvent) => {
      latest = Math.max(MIN_COL_W, startW + (ev.clientX - startX));
      setLive({ key: c.key, width: latest });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLive(null);
      if (latest !== startW) onResize(c.key, latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const cell = (c: Column, r: MyWorkRow) => {
    const style = { width: widthOf(c) };
    switch (c.key) {
      case "status":
        return (
          <span key={c.key} className="shrink-0 truncate" style={style}>
            {r.status ? (
              <span
                className="inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-md px-1.5 text-xs font-medium"
                style={
                  r.statusColor
                    ? { backgroundColor: `${r.statusColor}1F`, color: r.statusColor }
                    : { backgroundColor: "var(--os-surface-2)", color: "var(--os-ink-2)" }
                }
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: r.statusColor ?? "var(--os-ink-3)" }} />
                <span className="truncate">{r.statusLabel ?? r.status}</span>
              </span>
            ) : null}
          </span>
        );
      case "assignees":
        return (
          <span key={c.key} className="shrink-0" style={style}>
            <AvatarStack people={r.assignees} size={24} max={3} />
          </span>
        );
      case "due":
        return (
          <span
            key={c.key}
            className={r.dueBucket === "overdue" ? "shrink-0 truncate text-xs font-medium text-danger-text" : "shrink-0 truncate text-xs text-ink-2"}
            style={style}
          >
            {dueChipLabel(r.dueAt ?? r.startAt, now, locale) ?? ""}
          </span>
        );
      case "priority":
        return (
          <span key={c.key} className="shrink-0" style={style}>
            {r.priority ? (
              // design-system 0.3 fixes the vocabulary: urgent danger, high
              // filled ink, normal and low outline ink.
              <Flag
                className={
                  r.priority === "URGENT"
                    ? "h-4 w-4 text-danger-text"
                    : r.priority === "HIGH"
                      ? "h-4 w-4 fill-current text-ink"
                      : r.priority === "NORMAL"
                        ? "h-4 w-4 text-ink-2"
                        : "h-4 w-4 text-ink-3"
                }
                strokeWidth={1.5}
                aria-label={`Priority ${PRIORITY_LABEL[r.priority] ?? r.priority}`}
              />
            ) : null}
          </span>
        );
      case "list":
        return (
          <span key={c.key} className="shrink-0 truncate text-sm text-ink-2" style={style}>
            {r.board ? (
              r.listReadable ? (
                <Link href={`/boards/${r.board.slug}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                  {r.board.name}
                </Link>
              ) : (
                // Not a link: the viewer holds the task, not the List.
                r.board.name
              )
            ) : null}
          </span>
        );
      case "space":
        return (
          <span key={c.key} className="shrink-0 truncate text-sm text-ink-2" style={style}>
            {r.space ? (
              r.listReadable ? (
                <Link href={`/spaces/${r.space.slug}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                  {r.space.name}
                </Link>
              ) : (
                r.space.name
              )
            ) : null}
          </span>
        );
      case "updated":
        return (
          <span key={c.key} className="shrink-0 truncate text-xs text-ink-2" style={style}>
            {relativeTime(r.updatedAt, null, now)}
          </span>
        );
      default:
        return <span key={c.key} className="shrink-0" style={style} />;
    }
  };

  return (
    <div className="os-row overflow-hidden rounded-lg border border-line bg-raised">
      <div className="flex h-9 items-center gap-3 border-b border-line bg-subtle px-4 text-xs font-medium uppercase tracking-wide text-ink-2">
        <span className="w-[18px] shrink-0" />
        <span className="min-w-0 flex-1">Title</span>
        {columns.map((c) => (
          <span
            key={c.key}
            draggable
            onDragStart={(e) => { setDragKey(c.key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.key); }}
            onDragOver={(e) => { if (dragKey && dragKey !== c.key) { e.preventDefault(); setOverKey(c.key); } }}
            onDragLeave={() => setOverKey((k) => (k === c.key ? null : k))}
            onDrop={(e) => { e.preventDefault(); if (dragKey) onReorder(dragKey, c.key); setDragKey(null); setOverKey(null); }}
            onDragEnd={() => { setDragKey(null); setOverKey(null); }}
            title="Drag to reorder"
            className={
              "group/col relative flex shrink-0 cursor-grab select-none items-center gap-1 truncate rounded-sm " +
              (overKey === c.key ? "bg-brand-soft text-brand-deep" : dragKey === c.key ? "opacity-50" : "")
            }
            style={{ width: widthOf(c) }}
          >
            <GripVertical className="h-3 w-3 shrink-0 opacity-0 group-hover/col:opacity-100" strokeWidth={1.5} aria-hidden />
            <span className="truncate">{c.label}</span>
            {/* The resize handle: the last 6px of the cell. */}
            <span
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize ${c.label}`}
              onPointerDown={(e) => startResize(e, c)}
              onDragStart={(e) => e.preventDefault()}
              draggable={false}
              className="absolute -end-1.5 top-0 h-full w-3 cursor-col-resize after:absolute after:inset-y-1 after:start-1 after:w-px after:bg-line-strong after:opacity-0 hover:after:opacity-100"
            />
          </span>
        ))}
        {/* Column settings, pinned as the last header cell (design-system
            5.1). It opens the same Display popover the toolbar "..." does, so
            there is one place that decides which columns show. */}
        <button
          type="button"
          onClick={onColumns}
          aria-label="Column settings"
          title="Column settings"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      {groups.map((g) => (
        <div key={g.key}>
          {g.label ? (
            <div className="flex h-9 items-center gap-2 bg-subtle px-4">
              <span className="font-medium text-ink">{g.label}</span>
              <span className={g.tone === "danger" ? "text-xs font-medium text-danger-text" : "text-xs font-medium text-ink-2"}>
                {g.rows.length}
              </span>
            </div>
          ) : null}
          {/* An empty group collapses to its one header line: no rows and no
              "+ Add task" ghost, so six buckets do not become six ghost rows. */}
          {g.rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 border-b border-line-soft px-4 last:border-b-0 hover:bg-hover"
              style={{ minHeight: "var(--os-row-h)" }}
            >
              <input
                type="checkbox"
                className="h-[18px] w-[18px] shrink-0 accent-[var(--os-brand)]"
                checked={selected.has(r.id)}
                onChange={() => onToggle(r.id)}
                aria-label={`Select "${r.title}"`}
              />
              <button
                type="button"
                onClick={() => openTask(router, r.id)}
                className="min-w-0 flex-1 truncate text-start text-ink hover:underline"
                style={{ fontWeight: r.priority === "URGENT" ? 500 : 400 }}
              >
                {r.title}
              </button>
              {columns.map((c) => cell(c, r))}
              <span className="w-6 shrink-0" />
            </div>
          ))}
          {/* An empty group really is one line: its header, and nothing else.
              A ghost row under every empty bucket turns six buckets into
              twelve rows of nothing. */}
          {g.rows.length > 0 ? (
            <button
              type="button"
              onClick={onAdd}
              className="flex w-full items-center gap-2 border-b border-line-soft px-4 text-start text-ink-2 last:border-b-0 hover:bg-hover hover:text-ink"
              style={{ minHeight: "var(--os-row-h)" }}
            >
              <span className="text-lg leading-none" aria-hidden>+</span>
              Add task
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── board view ──────────────────────────── */

function BoardView({
  columns,
  now,
  locale,
  onAdd,
}: {
  columns: ReturnType<typeof boardColumns>;
  now: Date;
  locale: LocaleContext;
  onAdd: () => void;
}) {
  const router = useRouter();
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <section key={col.key} className="os-row flex w-[280px] shrink-0 flex-col rounded-lg border border-line bg-subtle">
          <header className="flex h-10 items-center gap-2 px-3">
            <span className="font-medium text-ink">{col.label}</span>
            <span className={col.tone === "danger" ? "text-xs font-medium text-danger-text" : "text-xs font-medium text-ink-2"}>
              {col.rows.length}
            </span>
          </header>
          <div className="flex flex-col gap-2 px-2 pb-2">
            {col.rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openTask(router, r.id)}
                className="rounded-md border border-line bg-raised p-2.5 text-start hover:border-line-strong"
              >
                <span className="line-clamp-2 text-ink">{r.title}</span>
                <span className="mt-1.5 flex items-center gap-2">
                  {r.priority ? (
                    <Flag
                      className={
                        r.priority === "URGENT"
                          ? "h-3.5 w-3.5 text-danger-text"
                          : r.priority === "HIGH"
                            ? "h-3.5 w-3.5 fill-current text-ink"
                            : "h-3.5 w-3.5 text-ink-3"
                      }
                      strokeWidth={1.5}
                      aria-label={PRIORITY_LABEL[r.priority] ?? r.priority}
                    />
                  ) : null}
                  {r.dueAt ? (
                    <span className={r.dueBucket === "overdue" ? "text-xs font-medium text-danger-text" : "text-xs text-ink-2"}>
                      {dueChipLabel(r.dueAt, now, locale)}
                    </span>
                  ) : null}
                  {r.board ? <span className="truncate text-xs text-ink-3">{r.board.name}</span> : null}
                </span>
              </button>
            ))}
            {col.rows.length === 0 ? (
              <p className="px-1 py-3 text-sm text-ink-3">Nothing here</p>
            ) : null}
            {/* The ghost row every column ends with (spec section 2, Board). */}
            <button
              type="button"
              onClick={onAdd}
              className="flex h-9 w-full items-center gap-2 rounded-md px-1 text-start text-ink-2 hover:bg-hover hover:text-ink"
            >
              <span className="text-lg leading-none" aria-hidden>+</span>
              Add task
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

/* ───────────────────────────── skeleton ────────────────────────────── */

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised" aria-busy="true" aria-label="Loading">
      <div className="h-9 border-b border-line bg-subtle" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line-soft px-4 last:border-b-0" style={{ height: "var(--os-row-h)" }}>
          <span className="os-skeleton-pulse h-3.5 w-3.5 rounded bg-skeleton" />
          <span className="os-skeleton-pulse h-3.5 rounded bg-skeleton" style={{ width: `${[60, 40, 80, 50, 70, 45, 65, 55][i]}%` }} />
        </div>
      ))}
    </div>
  );
}
