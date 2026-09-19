"use client";

// The /everything body: one cursor-paginated call to `GET /api/me/everything`,
// rendered as a list, a board or a calendar.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/everything).
//
// THE URL IS THE STATE, including the scope. `?space=`, `?folder=`, `?view=`,
// `?group=`, `?sort=` and `?done=` are the whole of it, so a scoped view is a
// link and Back works. `view=gantt` resolves to `list` and `view=team` to
// `list&group=assignee`, which is what the old Space "team" view showed, so
// the five redirects spec-spaces-lists sends here land on something real
// rather than on an unknown-view error.
//
// READ-ONLY IS PER ROW. Each row carries the viewer's role on its own List.
// A Can view row's status is plain text with no picker, and its "…" offers
// Open and Copy link only. Before this every row rendered editable and the
// PATCH failed afterwards (critic #4).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Calendar as CalendarIcon, ChevronDown, ChevronRight, ExternalLink, Flag, Kanban, Link2,
  List as ListIcon, ListChecks, Lock, MoreHorizontal, X,
} from "lucide-react";
import { MenuList, MenuItem } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { Breadcrumb, type BreadcrumbItem } from "@/components/layout/os/top-bar/breadcrumb";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { EntityTile } from "@/components/ui/entity-tile";
import { Switch } from "@/components/ui/switch";
import { DotsArt } from "@/components/ui/dots-art";
import { useOsShell } from "@/components/layout/os/shell-context";
import { apiFetch } from "@/lib/api-fetch";
import { useShortcut } from "@/lib/shortcuts";
import { openTask } from "@/lib/nav/open-task";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  WORK_GROUPS,
  WORK_SORTS,
  boardColumns,
  listGroups,
  type MyWorkRow,
  type WorkGroupKey,
  type WorkSortKey,
} from "@/lib/my-work";
import { dueChipLabel, type LocaleContext } from "@/lib/work-buckets";
import type { SavedWorkFilter } from "@/lib/home-prefs";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { SaveViewModal } from "../my-work/save-view-modal";
import { resolveEverythingView } from "@/lib/everything-view";
import { MyWorkCalendar } from "../my-work/my-work-calendar";

type ViewKey = "list" | "board" | "calendar";

interface EverythingRow extends MyWorkRow {
  role: "NONE" | "VIEW" | "COMMENT" | "EDIT" | "FULL";
  canEdit: boolean;
}

interface Payload {
  rows: EverythingRow[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
  facets: {
    spaces: Array<{ id: string; slug: string; name: string; count: number }>;
    lists: Array<{ id: string; name: string; count: number }>;
    statuses: Array<{ value: string; label: string; count: number }>;
    priorities: Array<{ value: string; count: number }>;
    assignees: Array<{ id: string; name: string; avatar: string | null; count: number }>;
  };
  /** Each List's own status words, keyed by List id, for the inline picker. */
  listStatuses: Record<string, Array<{ value: string; label: string; color: string | null }>>;
  scope: {
    space: { id: string; slug: string; name: string } | null;
    folder: { id: string; name: string; spaceId: string } | null;
  };
  /** A `?space=` or `?folder=` that does not exist or is not readable. */
  scopeError: "space" | "folder" | null;
  canCreate: boolean;
  locale: { timeZone: string | null; weekStart: number | null };
}

const VIEWS: ReadonlyArray<{ key: ViewKey; label: string; icon: typeof ListIcon }> = [
  { key: "list", label: "List", icon: ListIcon },
  { key: "board", label: "Board", icon: Kanban },
  { key: "calendar", label: "Calendar", icon: CalendarIcon },
];

const FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "status", label: "Status" },
  { key: "assignees", label: "Assignees" },
  { key: "due", label: "Due date" },
  { key: "priority", label: "Priority" },
  { key: "space", label: "Space" },
  { key: "list", label: "List" },
];
const DEFAULT_FIELDS = ["status", "assignees", "due", "priority", "list"];

/** The panel's field search: an empty query matches everything. */
function matchesField(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || label.toLowerCase().includes(q);
}

/** A stored filter list, tolerating a value written by an older shape. */
function idList(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string") : [];
}

function visibleRows<T>(items: readonly T[], label: (item: T) => string, query: string): T[] {
  return items.filter((item) => matchesField(label(item), query));
}

export function EverythingClient({
  initialSpace,
  initialFolder,
  initialView,
  initialGroup,
  initialSort,
  initialShowDone,
  initialFields,
  initialSubtasks = true,
  initialCollapsed = [],
  initialViews = [],
  initialFilterId = null,
}: {
  initialSpace: string | null;
  initialFolder: string | null;
  initialView: string | null;
  initialGroup: string | null;
  initialSort: string | null;
  initialShowDone: boolean;
  initialFields: string[] | null;
  initialSubtasks?: boolean;
  /** This page's own saved views (`home.work.everythingFilters[]`). */
  initialViews?: SavedWorkFilter[];
  /** `?filter=<id>`: which saved view the URL says is showing. */
  initialFilterId?: string | null;
  /** Group headers this person collapsed last time (`home.work.surface.everything`). */
  initialCollapsed?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { openCreateTask, patchPrefs } = useOsShell();
  const { toast } = useOsToast();

  const resolved = resolveEverythingView(initialView);
  const [view, setView] = useState<ViewKey>(resolved.view);
  const [group, setGroup] = useState<WorkGroupKey>(
    (initialGroup as WorkGroupKey) || resolved.group || "list",
  );
  const [sort, setSort] = useState<WorkSortKey>((initialSort as WorkSortKey) || "created");
  const [showDone, setShowDone] = useState(initialShowDone);
  const [fields, setFields] = useState<string[]>(initialFields ?? DEFAULT_FIELDS);
  // PAGING IS A STACK, NOT A ONE-WAY DOOR. The footer used to offer "Next 50"
  // and "Back to the start", so reaching page 4 and stepping back meant
  // starting over. The spec's footer is "Total records N · 1 to 50 < >", so
  // every cursor consumed is kept and the back arrow pops one.
  const [cursors, setCursors] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(50);
  const cursor = cursors.length ? cursors[cursors.length - 1] : null;
  const page = cursors.length + 1;

  // `?filter=<id>` has to arrive APPLIED, not just highlighted: a link to a
  // saved view that shows the unfiltered list with the view's pill lit is the
  // same lie the scope parameter used to tell.
  const openingView = initialFilterId ? initialViews.find((v) => v.id === initialFilterId) ?? null : null;
  const openingFilters = (openingView?.filters ?? {}) as Record<string, unknown>;

  const [spaceIds, setSpaceIds] = useState<string[]>(idList(openingFilters.spaceIds));
  const [listIds, setListIds] = useState<string[]>(idList(openingFilters.listIds));
  const [statuses, setStatuses] = useState<string[]>(idList(openingFilters.statuses));
  const [priorities, setPriorities] = useState<string[]>(idList(openingFilters.priorities));
  const [assigneeIds, setAssigneeIds] = useState<string[]>(idList(openingFilters.assigneeIds));
  const [includeSubtasks, setIncludeSubtasks] = useState(
    openingView ? openingFilters.includeSubtasks !== false : initialSubtasks,
  );

  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [views, setViews] = useState<SavedWorkFilter[]>(initialViews);
  const [activeViewId, setActiveViewId] = useState<string | null>(initialFilterId);

  // Selection drives the bulk bar, which is the one place a row's `role`
  // becomes load-bearing rather than decorative: a Can view row has no
  // checkbox at all, because every action the bar offers is a write and a
  // control with nothing behind it is a control with no handler.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPicker, setBulkPicker] = useState<"status" | "priority" | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which group headers this person has collapsed, per surface. */
  const [collapsed, setCollapsed] = useState<string[]>(initialCollapsed);

  const space = initialSpace ?? params.get("space");
  const folder = initialFolder ?? params.get("folder");

  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ group, sort, limit: String(pageSize), done: showDone ? "1" : "0" });
    if (space) qs.set("space", space);
    if (folder) qs.set("folder", folder);
    if (cursor) qs.set("cursor", cursor);
    if (spaceIds.length) qs.set("spaceId", spaceIds.join(","));
    if (listIds.length) qs.set("list", listIds.join(","));
    if (statuses.length) qs.set("status", statuses.join(","));
    if (priorities.length) qs.set("priority", priorities.join(","));
    if (assigneeIds.length) qs.set("assignee", assigneeIds.join(","));
    if (!includeSubtasks) qs.set("subtasks", "0");
    return qs.toString();
  }, [group, sort, showDone, space, folder, cursor, spaceIds, listIds, statuses, priorities, assigneeIds, includeSubtasks, pageSize]);

  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(`/api/me/everything?${queryString}`, { cache: "no-store" });
    if (!res.ok) { setFailed(res.error); return; }
    setData(res.data);
    setFailed(null);
  }, [queryString]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await apiFetch<Payload>(`/api/me/everything?${queryString}`, { cache: "no-store" });
      // A request whose query is already stale must not overwrite a newer one.
      if (!live) return;
      if (!res.ok) { setFailed(res.error); return; }
      setData(res.data);
      setFailed(null);
    })();
    return () => { live = false; };
  }, [queryString]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    window.addEventListener(WINDOW_EVENTS.itemChanged, refresh);
    // The create-task modal's own event, which predates the realtime union.
    window.addEventListener("workwrk:item-created", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(WINDOW_EVENTS.itemChanged, refresh);
      window.removeEventListener("workwrk:item-created", refresh);
    };
  }, [load]);

  // Plain functions, not useCallback: the React Compiler memoizes them, and a
  // hand-written dependency list here trips preserve-manual-memoization because
  // the compiler infers the useState setters these call as dependencies.
  /** Any change to what is being asked for starts the walk again. */
  const resetPaging = () => {
    setCursors([]);
    setSelected(new Set());
  };

  /** Mirror a control into the URL, so every view is a link. */
  const writeUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const qs = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) qs.delete(k); else qs.set(k, v);
      }
      const q = qs.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  /* ────────────────────────── saved views ────────────────────────── */
  //
  // The views row used to carry the three VIEW TYPES (List, Board, Calendar),
  // which design-system 4.4 puts in the toolbar's switcher; the row itself is
  // "All + the viewer's saved filters + '+ View'" (spec section 2). The page
  // therefore had no way to save what it was showing, and `home.work
  // .everythingFilters[]` had no writer at all.
  //
  // The key is this page's OWN: a view saved over "tasks assigned to me" does
  // not describe "every task I can see", so /my-work's savedFilters are not
  // reused here.

  const confirm = useConfirm();
  const prompt = usePrompt();

  const persistViews = useCallback(
    async (next: SavedWorkFilter[]) => {
      const previous = views;
      setViews(next);
      const ok = await patchPrefs({ home: { work: { everythingFilters: next } } });
      if (!ok) { setViews(previous); toast("Couldn't save your views"); return false; }
      return true;
    },
    [views, patchPrefs, toast],
  );

  /** What a saved view remembers: every filter, plus sort, group and view. */
  const currentFilters = useMemo(
    () => ({ spaceIds, listIds, statuses, priorities, assigneeIds, includeSubtasks, showDone }),
    [spaceIds, listIds, statuses, priorities, assigneeIds, includeSubtasks, showDone],
  );

  const applyView = (v: SavedWorkFilter | null) => {
      resetPaging();
      if (!v) {
        setSpaceIds([]); setListIds([]); setStatuses([]); setPriorities([]); setAssigneeIds([]);
        setIncludeSubtasks(true); setShowDone(false);
        setActiveViewId(null);
        writeUrl({ filter: null });
        return;
      }
      const f = (v.filters ?? {}) as Record<string, unknown>;
      setSpaceIds(idList(f.spaceIds));
      setListIds(idList(f.listIds));
      setStatuses(idList(f.statuses));
      setPriorities(idList(f.priorities));
      setAssigneeIds(idList(f.assigneeIds));
      setIncludeSubtasks(f.includeSubtasks !== false);
      setShowDone(f.showDone === true);
      if (v.sort) setSort(v.sort as WorkSortKey);
      if (v.group) setGroup(v.group as WorkGroupKey);
      if (v.view) setView(v.view as ViewKey);
      setActiveViewId(v.id);
      writeUrl({
        filter: v.id,
        sort: v.sort && v.sort !== "created" ? v.sort : null,
        group: v.group && v.group !== "list" ? v.group : null,
        view: v.view && v.view !== "list" ? v.view : null,
      });
  };

  const saveView = useCallback(
    async (name: string, isDefault: boolean) => {
      const id = `ev_${Date.now().toString(36)}`;
      const next: SavedWorkFilter[] = [
        ...views.map((v) => (isDefault ? { ...v, isDefault: false } : v)),
        { id, name, filters: currentFilters, sort, group, view, isDefault },
      ];
      const ok = await persistViews(next);
      setSaveOpen(false);
      if (ok) { toast(`View "${name}" saved`); setActiveViewId(id); writeUrl({ filter: id }); }
    },
    [views, currentFilters, sort, group, view, persistViews, toast, writeUrl],
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

  const deleteView = async (v: SavedWorkFilter) => {
    const yes = await confirm({
      title: `Delete "${v.name}"?`,
      description: "The view goes; the tasks it showed do not.",
      confirmLabel: "Delete view",
      destructive: true,
    });
    if (!yes) return;
    const ok = await persistViews(views.filter((row) => row.id !== v.id));
    if (ok) { applyView(null); toast(`View "${v.name}" deleted`); }
  };

  const persistDisplay = useCallback(
    (next: { fields: string[]; done: boolean }) => {
      void patchPrefs({ home: { work: { surface: { everything: { viewOptions: next } } } } });
    },
    [patchPrefs],
  );

  const persistCollapsed = useCallback(
    (next: string[]) => {
      void patchPrefs({ home: { work: { surface: { everything: { collapsedGroups: next } } } } });
    },
    [patchPrefs],
  );

  const toggleGroup = useCallback(
    (key: string) => {
      setCollapsed((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
        persistCollapsed(next);
        return next;
      });
    },
    [persistCollapsed],
  );

  /**
   * One request for the whole selection. `POST /api/items/bulk` gates every id
   * on its own, so a selection that strays into a List the viewer can only
   * read is reported ("38 updated · 2 you can't edit") rather than silently
   * half-applied.
   */
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
      if (!res.ok) { toast("Couldn't update those tasks", { tone: "danger", description: res.error }); return; }
      const { updated, skipped } = res.data;
      toast(skipped > 0 ? `${updated} ${describe} · ${skipped} you can't edit` : `${updated} ${describe}`);
      setSelected(new Set());
      void load();
    },
    [selected, toast, load],
  );

  /** One row's status, written where the person is reading it. */
  const setRowStatus = useCallback(
    async (row: EverythingRow, value: string) => {
      const res = await apiFetch(`/api/items/${row.id}`, { method: "PATCH", json: { status: value } });
      if (!res.ok) { toast("Couldn't change that status", { tone: "danger", description: res.error }); return; }
      void load();
    },
    [toast, load],
  );

  const shows = useCallback((key: string) => fields.includes(key), [fields]);
  // A stable identity: the two selection memos below list it, and a fresh
  // array per render would recompute them after every commit.
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const locale: LocaleContext = { timeZone: data?.locale.timeZone ?? null, weekStart: data?.locale.weekStart ?? null };
  const now = useMemo(() => new Date(), []);
  const activeFilters =
    spaceIds.length + listIds.length + statuses.length + priorities.length + assigneeIds.length
    + (includeSubtasks ? 0 : 1) + (space || folder ? 1 : 0);

  useShortcut({ id: "everything-filter", keys: "f", label: "Filter", scope: "page", run: () => setFilterOpen((v) => !v) });

  const loading = data === null && failed === null;
  const scopeName = data?.scope.folder?.name ?? data?.scope.space?.name ?? null;

  /** The statuses shared by every selected row's List, for the bulk bar. */
  const bulkStatusOptions = useMemo(() => {
    const picked = rows.filter((r) => selected.has(r.id));
    const seen = new Map<string, string>();
    for (const r of picked) if (r.status) seen.set(r.status, r.statusLabel ?? r.status);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [rows, selected]);

  /** One done word across the whole selection, or null when the Lists disagree. */
  const doneStatusForSelection = useMemo(() => {
    const picked = rows.filter((r) => selected.has(r.id));
    const values = new Set(picked.map((r) => r.doneStatus).filter((v): v is string => Boolean(v)));
    if (picked.length === 0 || values.size !== 1) return null;
    return [...values][0];
  }, [rows, selected]);

  const firstRow = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = rows.length === 0 ? 0 : (page - 1) * pageSize + rows.length;

  const activeView = views.find((v) => v.id === activeViewId) ?? null;

  const menu = [
    { label: "Display", onClick: () => setDisplayOpen(true) },
    // The selected saved view's own actions, rendered only while one IS
    // selected: renaming "All" is not a thing.
    ...(activeView
      ? [
          { separator: true as const },
          { label: `Rename "${activeView.name}"`, onClick: () => void renameView(activeView) },
          { label: "Delete view", destructive: true, onClick: () => void deleteView(activeView) },
        ]
      : []),
    { label: "Export CSV", href: `/api/me/everything/export.csv?${queryString}` },
  ];

  /**
   * "Work › Everything › {Space}" when the URL carries a scope, with the Space
   * and Folder crumbs linking back to where the reader came from. Without the
   * declaration the bar fell back to the static table and printed "Work ›
   * Everything" while the H1 said the Space's name.
   */
  const scopeSpace = data?.scope.space ?? null;
  const scopeFolder = data?.scope.folder ?? null;
  const crumbs = useMemo<BreadcrumbItem[]>(() => {
    // Every crumb but the last carries its href; the last is the page itself.
    if (scopeFolder) {
      return [
        { label: "Everything", href: "/everything" },
        ...(scopeSpace ? [{ label: scopeSpace.name, href: `/spaces/${scopeSpace.slug}` }] : []),
        { label: scopeFolder.name },
      ];
    }
    if (scopeSpace) {
      return [{ label: "Everything", href: "/everything" }, { label: scopeSpace.name }];
    }
    return [{ label: "Everything" }];
  }, [scopeSpace, scopeFolder]);

  return (
    <>
      <Breadcrumb items={crumbs} />
      <OsPageHeader
        title={scopeName ?? "Everything"}
        views={
          <>
            <ViewTab label="All" active={!activeViewId} onClick={() => applyView(null)} />
            {views.map((v) => (
              <ViewTab
                key={v.id}
                label={v.name}
                active={activeViewId === v.id}
                onClick={() => applyView(v)}
              />
            ))}
            {/* Immediately after the pills, because it belongs to the run of
                views it adds to. It opens the Filter panel, whose footer is
                the writer. */}
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
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeFilters },
          // The view TYPES live in the toolbar switcher (design-system 4.4);
          // the views row above is saved views, which is a different thing.
          switcher: {
            value: view,
            options: VIEWS.map((v) => ({ key: v.key, label: v.label, icon: v.icon })),
            onChange: (key) => { setView(key as ViewKey); writeUrl({ view: key }); },
          },
          sort: {
            onClick: () => setSortOpen((v) => !v),
            label: sort === "created" ? "Sort" : WORK_SORTS.find((s) => s.key === sort)?.label,
            active: sort !== "created",
          },
          group: {
            onClick: () => setGroupOpen((v) => !v),
            label: group === "list" ? "Group" : WORK_GROUPS.find((g) => g.key === group)?.label,
            active: group !== "list",
          },
          // One blue button, and only when there is somewhere to write: with
          // every readable List at Can view the create modal's picker would be
          // empty, so the button is absent and the empty state says why.
          ...(data?.canCreate === false ? {} : { primary: { label: "Create task", onClick: () => openCreateTask() } }),
          menu,
        }}
      />

      {scopeName ? (
        <div className="flex h-9 items-center gap-2 px-6 text-sm text-ink-2">
          <span>{data?.scope.folder ? "All tasks in this folder" : "All tasks in this Space"}</span>
          <Link href="/everything" className="font-medium text-brand-deep hover:underline">Show everything</Link>
        </div>
      ) : null}

      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker
              open
              onClose={() => setSortOpen(false)}
              ariaLabel="Sort tasks"
              selected={sort}
              sections={[{ options: WORK_SORTS.map((s) => ({ value: s.key, label: s.label })) }]}
              onSelect={(v) => { setSortOpen(false); setSort(v as WorkSortKey); resetPaging(); writeUrl({ sort: v }); }}
            />
          </div>
        ) : null}
        {groupOpen ? (
          <div className="absolute start-[210px] top-0 z-40">
            <Picker
              open
              onClose={() => setGroupOpen(false)}
              ariaLabel="Group tasks"
              selected={group}
              sections={[{ options: WORK_GROUPS.map((g) => ({ value: g.key, label: g.label })) }]}
              onSelect={(v) => { setGroupOpen(false); setGroup(v as WorkGroupKey); resetPaging(); writeUrl({ group: v }); }}
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
                { label: "Fields", options: FIELDS.map((f) => ({ value: f.key, label: f.label })) },
                { options: [{ value: "__done", label: "Show done tasks" }] },
              ]}
              onSelect={(v) => {
                if (v === "__done") {
                  const done = !showDone;
                  setShowDone(done);
                  resetPaging();
                  persistDisplay({ fields, done });
                  return;
                }
                const next = fields.includes(v) ? fields.filter((f) => f !== v) : [...fields, v];
                setFields(next);
                persistDisplay({ fields: next, done: showDone });
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
            activeCount={activeFilters}
            search={{ value: filterSearch, onChange: setFilterSearch, placeholder: "Search fields…" }}
            onSaveView={() => setSaveOpen(true)}
            onClearAll={() => {
              setSpaceIds([]); setListIds([]); setStatuses([]); setPriorities([]); setAssigneeIds([]);
              setIncludeSubtasks(true);
              resetPaging();
              // Clearing everything clears the SCOPE too, which is why the
              // scope is shown here as a row: a `?space=` that cannot be seen
              // or removed from the panel is a filter you cannot turn off.
              if (space || folder) writeUrl({ space: null, folder: null });
            }}
          >
            {/* The scope arrives from the URL and leaves the same way. */}
            {data?.scope.space || data?.scope.folder ? (
              <FilterGroup label="Scope">
                <li className="flex h-9 items-center gap-2 rounded-md px-2">
                  <span className="min-w-0 flex-1 truncate text-row text-ink">
                    {data.scope.folder?.name ?? data.scope.space?.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => { writeUrl({ space: null, folder: null }); resetPaging(); }}
                    aria-label="Clear the scope"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                  </button>
                </li>
              </FilterGroup>
            ) : null}
            {visibleRows(data?.facets.spaces ?? [], (s) => s.name, filterSearch).length ? (
              <FilterGroup label="Space">
                {visibleRows(data?.facets.spaces ?? [], (s) => s.name, filterSearch).map((s) => (
                  <FilterRow
                    key={`sp-${s.id}`}
                    label={s.name}
                    count={s.count}
                    checked={spaceIds.includes(s.id)}
                    onCheckedChange={(on) => { setSpaceIds((p) => (on ? [...p, s.id] : p.filter((v) => v !== s.id))); resetPaging(); }}
                  />
                ))}
              </FilterGroup>
            ) : null}
            {visibleRows(data?.facets.lists ?? [], (l) => l.name, filterSearch).length ? (
              <FilterGroup label="List">
                {visibleRows(data?.facets.lists ?? [], (l) => l.name, filterSearch).slice(0, 20).map((l) => (
                  <FilterRow
                    key={`l-${l.id}`}
                    label={l.name}
                    count={l.count}
                    checked={listIds.includes(l.id)}
                    onCheckedChange={(on) => { setListIds((p) => (on ? [...p, l.id] : p.filter((v) => v !== l.id))); resetPaging(); }}
                  />
                ))}
              </FilterGroup>
            ) : null}
            {visibleRows(data?.facets.assignees ?? [], (a) => a.name, filterSearch).length ? (
              <FilterGroup label="Assignee">
                {visibleRows(data?.facets.assignees ?? [], (a) => a.name, filterSearch).slice(0, 20).map((a) => (
                  <FilterRow
                    key={`as-${a.id}`}
                    label={a.name}
                    count={a.count}
                    checked={assigneeIds.includes(a.id)}
                    onCheckedChange={(on) => { setAssigneeIds((p) => (on ? [...p, a.id] : p.filter((v) => v !== a.id))); resetPaging(); }}
                  />
                ))}
              </FilterGroup>
            ) : null}
            {visibleRows(data?.facets.statuses ?? [], (s) => s.label, filterSearch).length ? (
              <FilterGroup label="Status">
                {visibleRows(data?.facets.statuses ?? [], (s) => s.label, filterSearch).slice(0, 20).map((s) => (
                  <FilterRow
                    key={`st-${s.value}`}
                    label={s.label}
                    count={s.count}
                    checked={statuses.includes(s.value)}
                    onCheckedChange={(on) => { setStatuses((p) => (on ? [...p, s.value] : p.filter((v) => v !== s.value))); resetPaging(); }}
                  />
                ))}
              </FilterGroup>
            ) : null}
            {PRIORITY_ORDER.filter(
              (p) => (data?.facets.priorities ?? []).some((f) => f.value === p)
                && matchesField(PRIORITY_LABEL[p] ?? p, filterSearch),
            ).length ? (
              <FilterGroup label="Priority">
                {PRIORITY_ORDER.filter(
                  (p) => (data?.facets.priorities ?? []).some((f) => f.value === p)
                    && matchesField(PRIORITY_LABEL[p] ?? p, filterSearch),
                ).map((p) => (
                  <FilterRow
                    key={`pr-${p}`}
                    label={PRIORITY_LABEL[p] ?? p}
                    count={(data?.facets.priorities ?? []).find((f) => f.value === p)?.count}
                    checked={priorities.includes(p)}
                    onCheckedChange={(on) => { setPriorities((prev) => (on ? [...prev, p] : prev.filter((v) => v !== p))); resetPaging(); }}
                  />
                ))}
              </FilterGroup>
            ) : null}
            {matchesField("Includes subtasks", filterSearch) ? (
              <li className="flex h-9 items-center gap-3 rounded-md px-2">
                <span className="min-w-0 flex-1 truncate text-row text-ink">Includes subtasks</span>
                <Switch
                  checked={includeSubtasks}
                  onChange={(on) => { setIncludeSubtasks(on); resetPaging(); }}
                  aria-label="Includes subtasks"
                />
              </li>
            ) : null}
          </FilterPanel>
        ) : null}

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {failed ? (
            <OsEmptyView variant="error" title="Couldn't load tasks" hint={failed} action={{ label: "Retry", onClick: () => void load() }} />
          ) : data?.scopeError ? (
            /* A scope that could not be resolved says so. Falling back to the
               whole workspace under the title "Everything" was the quiet
               failure: a stale or mistyped link showed every task in the org
               and nothing told the reader the scope had been dropped. */
            <OsEmptyView
              variant="error"
              title={data.scopeError === "folder" ? "We couldn't find that folder" : "We couldn't find that Space"}
              hint="It may have been deleted, renamed, or you may not have access to it."
              action={{ label: "Show everything", href: "/everything" }}
            />
          ) : loading ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            activeFilters > 0 ? (
              <div className="flex h-11 items-center gap-3 rounded-lg border border-line bg-raised px-4 text-base text-ink-2">
                No results
                <button
                  type="button"
                  onClick={() => { setSpaceIds([]); setListIds([]); setStatuses([]); setPriorities([]); }}
                  className="font-medium text-brand-deep hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                <DotsArt arrangement="row" size={64} />
                <p className="text-base font-medium text-ink">
                  {data?.canCreate === false ? "You can view tasks here but not create them" : "No tasks in your Spaces yet"}
                </p>
                {data?.canCreate !== false ? (
                  <button type="button" onClick={() => openCreateTask()} className="text-base font-medium text-brand-deep hover:underline">
                    Create a task
                  </button>
                ) : null}
              </div>
            )
          ) : view === "calendar" ? (
            <MyWorkCalendar rows={rows} locale={locale} onCreate={() => openCreateTask()} />
          ) : view === "board" ? (
            <BoardView columns={boardColumns(rows, group)} onOpen={(id) => openTask(router, id)} />
          ) : (
            <>
              <ListView
                groups={listGroups(rows, group)}
                group={group}
                shows={shows}
                now={now}
                locale={locale}
                onOpen={(id) => openTask(router, id)}
                selected={selected}
                onToggle={(id) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  })
                }
                collapsed={collapsed}
                onToggleGroup={toggleGroup}
                listStatuses={data?.listStatuses ?? {}}
                onSetStatus={setRowStatus}
              />
              {/* "Total records N · 1 to 50 < >" (spec section 2). */}
              <div className="mt-2 flex h-11 items-center gap-4 px-1 text-sm text-ink-2">
                <span>Total records {data?.total ?? rows.length}</span>
                <span className="flex-1" />
                <label className="flex items-center gap-1.5">
                  <span className="sr-only">Rows per page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); resetPaging(); }}
                    className="h-7 rounded-md border border-line bg-raised px-1 text-sm text-ink"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <span>{firstRow} to {lastRow}</span>
                <button
                  type="button"
                  disabled={cursors.length === 0}
                  onClick={() => { setCursors((c) => c.slice(0, -1)); setSelected(new Set()); }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40"
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <button
                  type="button"
                  disabled={!data?.hasMore || !data?.nextCursor}
                  onClick={() => {
                    const next = data?.nextCursor;
                    if (!next) return;
                    setCursors((c) => [...c, next]);
                    setSelected(new Set());
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40"
                  aria-label="Next page"
                >
                  ›
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <SaveViewModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={(name, isDefault) => void saveView(name, isDefault)}
        activeCount={activeFilters}
      />

      {/* The bulk bar. Only editable rows can be selected, so every control
          here has somewhere to write; the server still gates each id and the
          toast reports anything it refused. */}
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
                disabled={busy || bulkStatusOptions.length === 0}
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
                    sections={[{ options: bulkStatusOptions }]}
                    onSelect={(value) => { setBulkPicker(null); void runBulk({ status: value }, "updated"); }}
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
                    sections={[{ options: PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p] ?? p })) }]}
                    onSelect={(value) => { setBulkPicker(null); void runBulk({ priority: value }, "updated"); }}
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy || doneStatusForSelection === null}
              onClick={() => doneStatusForSelection && void runBulk({ status: doneStatusForSelection }, "marked done")}
              title={doneStatusForSelection === null ? "These tasks are in Lists with different done statuses" : undefined}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
            >
              Mark done
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ───────────────────────────── list view ───────────────────────────── */

function ListView({
  groups,
  group,
  shows,
  now,
  locale,
  onOpen,
  selected,
  onToggle,
  collapsed,
  onToggleGroup,
  listStatuses,
  onSetStatus,
}: {
  groups: ReturnType<typeof listGroups>;
  group: WorkGroupKey;
  shows: (key: string) => boolean;
  now: Date;
  locale: LocaleContext;
  onOpen: (id: string) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  collapsed: string[];
  onToggleGroup: (key: string) => void;
  listStatuses: Record<string, Array<{ value: string; label: string; color: string | null }>>;
  onSetStatus: (row: EverythingRow, value: string) => void;
}) {
  return (
    <div className="os-row overflow-x-auto rounded-lg border border-line bg-raised">
      <div className="flex h-9 min-w-[840px] items-center gap-3 border-b border-line bg-subtle px-4 text-xs font-medium uppercase tracking-wide text-ink-2">
        <span className="w-[18px] shrink-0" />
        <span className="min-w-0 flex-1">Title</span>
        {shows("status") ? <span className="w-28 shrink-0">Status</span> : null}
        {shows("assignees") ? <span className="w-20 shrink-0">Assignees</span> : null}
        {shows("due") ? <span className="w-24 shrink-0">Due</span> : null}
        {shows("priority") ? <span className="w-20 shrink-0">Priority</span> : null}
        {shows("space") ? <span className="w-32 shrink-0">Space</span> : null}
        {shows("list") ? <span className="w-40 shrink-0">List</span> : null}
        <span className="w-8 shrink-0" />
      </div>

      {groups.map((g) => {
        const isCollapsed = collapsed.includes(g.key);
        const first = (g.rows as EverythingRow[])[0];
        return (
        <div key={g.key}>
          {g.label ? (
            /* Grouped by List the header is the object, not a word: the
               EntityTile plus the "Space › List" crumbs, so a reader knows
               which room a run of rows came from. It collapses, and the
               choice is kept at `home.work.surface.everything`. */
            <button
              type="button"
              onClick={() => onToggleGroup(g.key)}
              aria-expanded={!isCollapsed}
              className="flex h-9 w-full min-w-[840px] items-center gap-2 bg-subtle px-4 text-start hover:bg-hover"
            >
              {isCollapsed
                ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />}
              {group === "list" && first?.board ? (
                <>
                  <EntityTile size="xs" icon={ListChecks} />
                  {first.space ? <span className="truncate text-sm text-ink-2">{first.space.name} ›</span> : null}
                  <span className="truncate font-medium text-ink">{first.board.name}</span>
                </>
              ) : (
                <span className="truncate font-medium text-ink">{g.label}</span>
              )}
              <span className={g.tone === "danger" ? "text-xs font-medium text-danger-text" : "text-xs font-medium text-ink-2"}>
                {g.rows.length}
              </span>
            </button>
          ) : null}
          {isCollapsed ? null : (g.rows as EverythingRow[]).map((r) => (
            <div
              key={r.id}
              className="flex min-w-[840px] items-center gap-3 border-b border-line-soft px-4 last:border-b-0 hover:bg-hover"
              style={{ minHeight: "var(--os-row-h)" }}
            >
              {/* THE CHECKBOX IS THE ROLE, MADE VISIBLE. Everything the bulk
                  bar offers is a write, so a Can view row gets the lock in
                  this cell rather than a checkbox that leads nowhere. */}
              {r.canEdit ? (
                <input
                  type="checkbox"
                  className="h-[18px] w-[18px] shrink-0 accent-[var(--os-brand)]"
                  checked={selected.has(r.id)}
                  onChange={() => onToggle(r.id)}
                  aria-label={`Select "${r.title}"`}
                />
              ) : (
                <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                  <Lock className="h-3 w-3 text-ink-3" aria-label="View only" />
                </span>
              )}
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-start text-ink hover:underline"
                style={{ fontWeight: r.priority === "URGENT" ? 500 : 400 }}
              >
                <span className="truncate">{r.title}</span>
              </button>
              {shows("status") ? (
                <span className="w-28 shrink-0 truncate">
                  <StatusCell row={r} options={listStatuses[r.board?.id ?? ""] ?? []} onSet={onSetStatus} />
                </span>
              ) : null}
              {shows("assignees") ? (
                <span className="w-20 shrink-0"><AvatarStack people={r.assignees} size={24} max={3} /></span>
              ) : null}
              {shows("due") ? (
                <span className={r.dueBucket === "overdue" ? "w-24 shrink-0 text-xs font-medium text-danger-text" : "w-24 shrink-0 text-xs text-ink-2"}>
                  {dueChipLabel(r.dueAt ?? r.startAt, now, locale) ?? ""}
                </span>
              ) : null}
              {shows("priority") ? (
                /* Weight tracks severity: Urgent is the solid flag, High the
                   outline, and the label is beside it, so the more severe
                   priority never reads lighter than the less severe one and
                   colour is never the only carrier. */
                <span className="flex w-20 shrink-0 items-center gap-1 truncate">
                  {r.priority ? (
                    <>
                      <Flag
                        className={
                          r.priority === "URGENT" ? "h-3.5 w-3.5 shrink-0 fill-current text-danger-text"
                            : r.priority === "HIGH" ? "h-3.5 w-3.5 shrink-0 text-danger-text"
                              : r.priority === "NORMAL" ? "h-3.5 w-3.5 shrink-0 text-ink-2"
                                : "h-3.5 w-3.5 shrink-0 text-ink-3"
                        }
                        strokeWidth={1.5}
                        aria-hidden
                      />
                      <span className="truncate text-xs text-ink-2">{PRIORITY_LABEL[r.priority] ?? r.priority}</span>
                    </>
                  ) : null}
                </span>
              ) : null}
              {shows("space") ? (
                <span className="w-32 shrink-0 truncate text-sm text-ink-2">
                  {r.space ? <Link href={`/spaces/${r.space.slug}`} className="hover:underline">{r.space.name}</Link> : null}
                </span>
              ) : null}
              {shows("list") ? (
                <span className="w-40 shrink-0 truncate text-sm text-ink-2">
                  {r.board ? <Link href={`/boards/${r.board.slug}`} className="hover:underline">{r.board.name}</Link> : null}
                </span>
              ) : null}
              {/* Every row has a door out. The read-only contract (spec
                  section 2: a Can view row's "…" offers Open and Copy link
                  only) needs the menu to exist before it can be narrowed, and
                  it did not exist for anyone, which made `role` decorative. */}
              <RowMoreMenu row={r} onOpen={onOpen} />
            </div>
          ))}
        </div>
        );
      })}
    </div>
  );
}

/**
 * The status cell.
 *
 * A Can edit row opens a Picker of the words ITS OWN List knows and writes
 * one; a Can view or Can comment row is the same chip as plain text. There is
 * no org-wide status vocabulary, so a cross-List picker can only offer what
 * the row's List carries, which is why `listStatuses` is keyed by List id.
 */
function StatusCell({
  row,
  options,
  onSet,
}: {
  row: EverythingRow;
  options: Array<{ value: string; label: string; color: string | null }>;
  onSet: (row: EverythingRow, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chip = row.status ? (
    <span
      className="inline-flex h-[22px] max-w-full items-center gap-1.5 truncate rounded-md px-1.5 text-xs font-medium"
      style={
        row.statusColor
          ? { backgroundColor: `${row.statusColor}1F`, color: row.statusColor }
          : { backgroundColor: "var(--os-surface-2)", color: "var(--os-ink-2)" }
      }
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: row.statusColor ?? "var(--os-ink-3)" }} />
      <span className="truncate">{row.statusLabel ?? row.status}</span>
    </span>
  ) : (
    <span className="text-xs text-ink-3">Set status</span>
  );

  if (!row.canEdit || options.length === 0) return row.status ? chip : null;

  return (
    <span className="relative inline-flex max-w-full">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Status of "${row.title}"`}
        className="max-w-full rounded-md hover:bg-active"
      >
        {chip}
      </button>
      {open ? (
        <div className="absolute start-0 top-7 z-50">
          <Picker
            open
            onClose={() => setOpen(false)}
            ariaLabel="Set status"
            selected={row.status ?? undefined}
            sections={[{ options: options.map((o) => ({ value: o.value, label: o.label })) }]}
            onSelect={(value) => { setOpen(false); onSet(row, value); }}
          />
        </div>
      ) : null}
    </span>
  );
}

/**
 * The per-row "…".
 *
 * Open and Copy link are offered on every row, whatever the viewer's role on
 * the List, because both are reads. A Can edit row additionally gets "Open in
 * the List", which is the door to the editing surface; a Can view row does not
 * get an edit affordance it could not use.
 */
function RowMoreMenu({ row, onOpen }: { row: EverythingRow; onOpen: (id: string) => void }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { toast } = useOsToast();
  const close = () => setOpen(false);

  const copyLink = async () => {
    close();
    const url = `${window.location.origin}/item/${row.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      // Clipboard access can be refused (insecure origin, a denied permission).
      // Saying so beats a toast that claims a copy that did not happen.
      toast("Couldn't copy the link", { tone: "danger", description: url });
    }
  };

  return (
    <span className="relative inline-flex w-8 shrink-0 justify-end">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={`More actions for ${row.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-active hover:text-ink"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={200} open={open} placement="below">
        <MenuList className="min-w-[200px]" onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={ExternalLink} label="Open" onClick={() => { close(); onOpen(row.id); }} />
          <MenuItem icon={Link2} label="Copy link" onClick={() => void copyLink()} />
          {row.canEdit && row.board ? (
            <MenuItem icon={ListIcon} label="Open in the List" href={`/boards/${row.board.slug}`} onClick={close} />
          ) : null}
        </MenuList>
      </MorePortal>
    </span>
  );
}

/* ───────────────────────────── board view ──────────────────────────── */

function BoardView({
  columns,
  onOpen,
}: {
  columns: ReturnType<typeof boardColumns>;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((c) => (
        <div key={c.key} className="flex w-[280px] shrink-0 flex-col gap-2">
          <div className="flex h-9 items-center gap-2 px-1">
            <span className="font-medium text-ink">{c.label || "Tasks"}</span>
            <span className={c.tone === "danger" ? "text-xs font-medium text-danger-text" : "text-xs font-medium text-ink-2"}>{c.rows.length}</span>
          </div>
          {c.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-ink-3">Nothing here</div>
          ) : (
            c.rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpen(r.id)}
                className="os-row rounded-lg border border-line bg-raised p-3 text-start hover:bg-hover"
              >
                <span className="line-clamp-2 text-base text-ink">{r.title}</span>
                <span className="mt-2 flex items-center gap-2">
                  <AvatarStack people={r.assignees} size={20} max={3} />
                  {r.board ? <span className="truncate text-xs text-ink-2">{r.board.name}</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised" aria-busy="true" aria-label="Loading">
      <div className="h-9 border-b border-line bg-subtle" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line-soft px-4 last:border-b-0" style={{ height: "var(--os-row-h)" }}>
          <span className="os-skeleton-pulse h-3.5 rounded bg-skeleton" style={{ width: `${[52, 40, 66, 45, 58, 36, 49, 57][i]}%` }} />
        </div>
      ))}
    </div>
  );
}
