"use client";

/* /tables (spec-tables-forms section 2): every table I can open, in one list,
 * with the ones I made and the ones people shared with me one click apart.
 *
 *   header   title "Tables" · views All · Mine · Shared with me · Favorites
 *            (each with its count) · toolbar Filter, Sort, search, the one blue
 *            "New table" split (Blank table, From a CSV...), the bordered "..."
 *            (Display, Import a CSV..., Export list as CSV, Trash)
 *   body     FilterPanel (Location, Owner, Updated, Has a form; the Location
 *            row is the Library's old Tables tab Space chips) + TableCard:
 *            checkbox · Name · Location · Rows (filled rows, never the seeded
 *            blanks) · Owner · Last updated · row "..." (TableRowMenu, the one
 *            table menu); bulk bar; footer with the real total and pages
 *
 *   GET  /api/tables?view=&q=&location=&owner=&updatedFrom=&updatedTo=&hasForm=
 *        &sort=&dir=&cursor=&limit=
 *   POST /api/tables   the canonical seed, then /tables/[id]?new=1
 *
 * Every view, filter and sort is in the URL, so a filtered page is a link.
 * `?import=1` (the /imports Ask-an-admin strip's link) opens the CSV import
 * dialog once and is stripped. `/tables?new=1` is NOT read: every create door
 * posts first and lands on the new table's own URL.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Download, FolderInput, Globe, LayoutGrid, SlidersHorizontal, Star, Table2, Trash2, Upload, User, Users, Search,
} from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { MenuItem } from "@/components/ui/menu";
import { BulkAction, RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { SplitPrimary } from "@/components/ui/split-primary";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { TableRowMenuHost, useTableRowMenu, type TableMenuTarget } from "@/components/tables/table-row-menu";
import { CsvImportDialog } from "@/components/tables/csv-import-dialog";
import { notifyTablesChanged } from "@/components/layout/os/sidebar-refresh";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { createNewTable, newTableHref } from "@/lib/sheet-new";
import { readTablesColumns, TABLES_LIST_COLUMNS, type TablesListColumn } from "@/lib/tables-prefs";
import { toCsvMatrix } from "@/lib/csv";
import type { ObjectListView, TablesSort } from "@/lib/tables-forms-list";
import { cn } from "@/lib/utils";
import { NotFoundView } from "@/components/access/not-found-view";

/* ───────────────────────────── types ───────────────────────────── */

type Owner = (PersonRef & { name: string | null }) | null;
type TableRow = {
  id: string;
  name: string;
  description: string | null;
  spaceId: string | null;
  spaceName: string | null;
  space: { id: string; name: string; slug: string; icon: string | null; color: string | null } | null;
  createdById: string | null;
  owner: Owner;
  filledRowCount: number;
  hasPublicLink: boolean;
  hasForm: boolean;
  isFavorite: boolean;
  canManage: boolean;
  updatedAt: string;
};
type ListResponse = { data: TableRow[]; total: number; nextCursor: string | null; counts?: Record<ObjectListView, number> };
type SpaceRow = { id: string; name: string; icon?: string | null; color?: string | null };

const VIEW_LABEL: Record<ObjectListView, string> = { all: "All", mine: "Mine", shared: "Shared with me", favorites: "Favorites" };
const VIEWS: Array<{ key: ObjectListView; Icon: typeof Table2 }> = [
  { key: "all", Icon: LayoutGrid },
  { key: "mine", Icon: User },
  { key: "shared", Icon: Users },
  { key: "favorites", Icon: Star },
];
const SORTS: Array<{ key: TablesSort; label: string }> = [
  { key: "updated", label: "Last updated" },
  { key: "name", label: "Name" },
  { key: "rows", label: "Rows" },
  { key: "owner", label: "Owner" },
];
const COLUMN_LABEL: Record<TablesListColumn, string> = { location: "Location", rows: "Rows", owner: "Owner", updated: "Last updated" };
const PAGE_SIZES = [40, 100];

const isView = (v: string | null): v is ObjectListView => !!v && v in VIEW_LABEL;
const isSort = (v: string | null): v is TablesSort => !!v && SORTS.some((s) => s.key === v);
function personName(p: PersonRef | null | undefined): string {
  if (!p) return "";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "";
}

/* ───────────────────────────── page ───────────────────────────── */

export default function TablesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { rowVersion, prefs, patchPrefs } = useOsShell();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();
  const isAgent = boot.viewer.isAgent;
  const isGuest = boot.viewer.orgRole === "GUEST";

  /* ── URL state ── */
  const view: ObjectListView = isView(params.get("view")) ? (params.get("view") as ObjectListView) : "all";
  const q = params.get("q") ?? "";
  const sort: TablesSort = isSort(params.get("sort")) ? (params.get("sort") as TablesSort) : "updated";
  const dir: "asc" | "desc" = params.get("dir") === "asc" || params.get("dir") === "desc" ? (params.get("dir") as "asc" | "desc") : (sort === "name" || sort === "owner" ? "asc" : "desc");
  const location = params.get("location");
  const owner = params.get("owner");
  const updatedFrom = params.get("updatedFrom");
  const updatedTo = params.get("updatedTo");
  const hasForm = params.get("hasForm") === "1";
  const cursor = params.get("cursor");
  const limitRaw = Number(params.get("limit"));
  const limit = PAGE_SIZES.includes(limitRaw) ? limitRaw : PAGE_SIZES[0];

  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const pageIndex = cursorStack.length;
  const setParams = useCallback((patch: Record<string, string | null>, opts?: { keepCursor?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("import");
    if (!opts?.keepCursor) { next.delete("cursor"); setCursorStack([]); }
    const s = next.toString();
    router.push(s ? `/tables?${s}` : "/tables");
  }, [params, router]);

  const activeFilters = [location, owner, updatedFrom || updatedTo ? "updated" : null, hasForm ? "form" : null].filter(Boolean).length;

  /* ── ?import=1: open the CSV dialog once, strip the param ── */
  const [importOpen, setImportOpen] = useState(false);
  const importLatch = useRef(false);
  useEffect(() => {
    if (params.get("import") !== "1" || importLatch.current) return;
    // The latch is set inside the tick, so a StrictMode double effect (whose
    // cleanup clears the first tick) still opens the dialog exactly once.
    const t = setTimeout(() => {
      if (importLatch.current) return;
      importLatch.current = true;
      setImportOpen(true);
      const next = new URLSearchParams(params.toString());
      next.delete("import");
      const s = next.toString();
      router.replace(s ? `/tables?${s}` : "/tables");
    }, 0);
    return () => clearTimeout(t);
  }, [params, router]);

  /* ── data ── */
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<ObjectListView, number> | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ view, sort, dir, limit: String(limit) });
    if (q) qs.set("q", q);
    if (location) qs.set("location", location);
    if (owner) qs.set("owner", owner);
    if (updatedFrom) qs.set("updatedFrom", updatedFrom);
    if (updatedTo) qs.set("updatedTo", updatedTo);
    if (hasForm) qs.set("hasForm", "1");
    if (cursor) qs.set("cursor", cursor);
    return qs.toString();
  }, [view, sort, dir, limit, q, location, owner, updatedFrom, updatedTo, hasForm, cursor]);

  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/tables?${queryString}`, { cache: "no-store" });
    if (!r.ok) {
      setLoadError(true);
      // The status lands in the console, never on the page (data.md 4.4).
      console.warn(`GET /api/tables: ${r.status} ${r.error}`);
      return;
    }
    setLoadError(false);
    setRows(r.data.data);
    setTotal(r.data.total);
    setNextCursor(r.data.nextCursor);
    if (r.data.counts) setCounts(r.data.counts);
    setSelected(new Set());
  }, [queryString]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const rv = rowVersion("tables");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [rv, load]);
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener("workwrk:tables-changed", onChange);
    window.addEventListener("workwrk:favs-changed", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener("workwrk:tables-changed", onChange);
      window.removeEventListener("workwrk:favs-changed", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [load]);

  /* ── pagination ── */
  const from = total === 0 ? 0 : pageIndex * limit + 1;
  const to = Math.min(total, pageIndex * limit + (rows?.length ?? 0));
  const goNext = nextCursor ? () => { setCursorStack((st) => [...st, cursor ?? ""]); setParams({ cursor: nextCursor }, { keepCursor: true }); } : undefined;
  const goPrev = cursor ? () => { const prev = cursorStack[cursorStack.length - 1] ?? ""; setCursorStack((st) => st.slice(0, -1)); setParams({ cursor: prev || null }, { keepCursor: true }); } : undefined;

  /* ── filter options ── */
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [ownerPickOpen, setOwnerPickOpen] = useState(false);
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  useEffect(() => {
    if ((!filterOpen && !bulkMoveOpen) || spaces !== null) return;
    let live = true;
    void (async () => {
      const [s, p] = await Promise.all([
        apiFetch<{ spaces: SpaceRow[] }>("/api/spaces", { cache: "no-store" }),
        apiFetch<{ data: PersonRef[] }>("/api/users?scope=all&limit=200", { cache: "no-store" }),
      ]);
      if (!live) return;
      setSpaces(s.ok ? s.data.spaces ?? [] : []);
      setPeople(p.ok && Array.isArray(p.data?.data) ? p.data.data : []);
    })();
    return () => { live = false; };
  }, [filterOpen, bulkMoveOpen, spaces]);

  /* ── create ── */
  const [creating, setCreating] = useState(false);
  const createTable = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const t = await createNewTable();
      notifyTablesChanged();
      router.push(newTableHref(t.id));
    } catch {
      toast("Couldn't create the table", { tone: "danger", action: { label: "Try again", onClick: () => void createTable() } });
    } finally {
      setCreating(false);
    }
  }, [creating, router, toast]);

  /* ── row menu ── */
  const menu = useTableRowMenu();
  const toTarget = (t: TableRow): TableMenuTarget => ({
    id: t.id, name: t.name, spaceId: t.spaceId, spaceName: t.spaceName, isFavorite: t.isFavorite,
    isPublic: t.hasPublicLink, canManage: t.canManage, ownerName: t.owner ? t.owner.name ?? personName(t.owner) : null,
  });

  const toggleFav = useCallback(async (t: TableRow) => {
    const next = !t.isFavorite;
    setRows((prev) => prev?.map((r) => (r.id === t.id ? { ...r, isFavorite: next } : r)) ?? prev);
    const r = await apiFetch("/api/me/favorites/tables", { method: "POST", json: { tableId: t.id, on: next } });
    if (!r.ok) { setRows((prev) => prev?.map((x) => (x.id === t.id ? { ...x, isFavorite: !next } : x)) ?? prev); toast("Couldn't update favorites", { tone: "danger" }); return; }
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
  }, [toast]);

  /* ── bulk ── */
  const selectedRows = useMemo(() => (rows ?? []).filter((r) => selected.has(r.id)), [rows, selected]);
  // Move to Space and Move to Trash exist in the bulk bar only while the
  // selection holds a table the viewer may manage (its creator or an admin,
  // principle 14: a control the role cannot use is not rendered).
  const anyManageable = selectedRows.some((r) => r.canManage);
  async function bulkFavorite() {
    const ids = [...selected];
    await Promise.allSettled(ids.map((id) => apiFetch("/api/me/favorites/tables", { method: "POST", json: { tableId: id, on: true } })));
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
    toast(`Added ${ids.length} table${ids.length === 1 ? "" : "s"} to favorites`);
    setSelected(new Set());
    void load();
  }
  // `only` is the one focused row (Cmd+Backspace on the list), else the selection.
  async function bulkTrash(only?: TableRow[]) {
    const from = only ?? selectedRows;
    const ids = from.filter((r) => r.canManage).map((r) => r.id);
    if (ids.length === 0) { toast("Only the person who made a table, or an admin, can move it to Trash"); return; }
    const skipped = from.length - ids.length;
    const ok = await confirm({
      title: `Move ${ids.length} table${ids.length === 1 ? "" : "s"} to Trash?`,
      description: `Their rows go with them. You can restore them for ${boot.org.trashDays} days.${skipped ? ` ${skipped} you did not make stay where they are.` : ""}`,
      destructive: true,
      confirmLabel: "Move to Trash",
    });
    if (!ok) return;
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/tables/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    toast(failed ? `Moved ${ids.length - failed}, ${failed} failed` : "Moved to Trash", failed ? { tone: "danger" } : { action: { label: "View Trash", onClick: () => router.push("/trash?type=table") } });
    setSelected(new Set());
    notifyTablesChanged();
    void load();
  }
  async function bulkMove(value: string) {
    setBulkMoveOpen(false);
    const ids = selectedRows.filter((r) => r.canManage).map((r) => r.id);
    if (ids.length === 0) { toast("Only the person who made a table, or an admin, can move it"); return; }
    const skipped = selectedRows.length - ids.length;
    const spaceId = value === "none" ? null : value;
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/tables/${id}`, { method: "PATCH", json: { spaceId } })));
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    const leftBehind = skipped ? `. ${skipped} you did not make stay where they are` : "";
    toast(failed ? `Moved ${ids.length - failed}, ${failed} failed${leftBehind}` : `Moved ${ids.length} table${ids.length === 1 ? "" : "s"}${leftBehind}`, failed ? { tone: "danger" } : undefined);
    setSelected(new Set());
    notifyTablesChanged();
    void load();
  }
  function bulkExport() {
    // One download per table: each file is that table's formatted values.
    for (const r of selectedRows) {
      const a = document.createElement("a");
      a.href = `/api/tables/${r.id}/export`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  /* ── Export list as CSV: every row of this view, not just this page ── */
  async function exportList() {
    const out: TableRow[] = [];
    let c: string | null = null;
    for (let guard = 0; guard < 100; guard++) {
      const qs = new URLSearchParams(queryString);
      qs.set("limit", "100");
      if (c) qs.set("cursor", c); else qs.delete("cursor");
      const r = await apiFetch<ListResponse>(`/api/tables?${qs.toString()}`, { cache: "no-store" });
      if (!r.ok) { toast("Couldn't export the list", { tone: "danger" }); return; }
      out.push(...r.data.data);
      c = r.data.nextCursor;
      if (!c) break;
    }
    const csv = toCsvMatrix([
      ["Name", "Location", "Rows", "Owner", "Last updated"],
      ...out.map((t) => [t.name, t.spaceName ?? "No Space", t.filledRowCount, t.owner ? t.owner.name ?? personName(t.owner) : "", t.updatedAt]),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tables-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── columns (Display) ── */
  const cols = readTablesColumns(prefs.home);
  const [displayOpen, setDisplayOpen] = useState(false);
  const toggleColumn = (key: string) => {
    const next = { ...cols, [key]: !cols[key as TablesListColumn] };
    void patchPrefs({ home: { tables: { columns: next } } });
  };

  // The tracks give way before the card scrolls. At full width Location,
  // Owner and Last updated grow to their old 200/160/140 (a fixed max fills
  // before the 2fr Name takes the rest), but their floors sum to about 744px
  // with the checkbox and "..." columns, so every column still fits beside
  // the open Filter panel at 1440 (the card is about 774px there). Fixed
  // tracks summed to 924 and pushed Last updated and the row menu out of view.
  const columns = useMemo<TableColumn<TableRow>[]>(() => {
    const out: TableColumn<TableRow>[] = [
      {
        key: "name", label: "Name", title: true, sortable: true, width: "minmax(200px,2fr)",
        render: (t) => (
          <span className="group/name flex min-w-0 flex-1 items-center gap-2">
            <EntityTile size="sm" name={t.name} fallback="table" {...NEUTRAL_TILE} />
            <span className="truncate">{t.name || "Untitled table"}</span>
            {t.hasPublicLink ? <span title="Public link is on" className="inline-flex shrink-0"><Globe className="h-3 w-3 text-ink-2" strokeWidth={1.5} aria-label="Public link is on" /></span> : null}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggleFav(t); }}
              aria-label={t.isFavorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={t.isFavorite}
              title={t.isFavorite ? "Remove from favorites" : "Add to favorites"}
              className={cn("ms-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-active", t.isFavorite ? "text-ink" : "text-ink-3 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100")}
            >
              <Star className="h-4 w-4" strokeWidth={1.5} style={t.isFavorite ? { fill: "currentColor" } : undefined} aria-hidden />
            </button>
          </span>
        ),
      },
    ];
    if (cols.location) out.push({
      key: "location", label: "Location", width: "minmax(120px,200px)",
      headerFilter: (
        <button type="button" onClick={(e) => { e.stopPropagation(); setFilterOpen(true); }} className="text-sm font-normal text-ink-2 hover:text-ink">
          {location ? (location === "none" ? "No Space ▾" : "1 ▾") : "All ▾"}
        </button>
      ),
      render: (t) => t.space ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-ink hover:underline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/spaces/${t.space!.slug}`); }} title={t.space.name}>
          <EntityTile size="xs" icon={t.space.icon} color={t.space.color} name={t.space.name} fallback="folder" />
          <span className="truncate">{t.space.name}</span>
        </span>
      ) : <span className="text-ink-2">No Space</span>,
    });
    if (cols.rows) out.push({ key: "rows", label: "Rows", sortable: true, numeric: true, width: "96px", render: (t) => <span className="tabular-nums">{fmt.count(t.filledRowCount)}</span> });
    if (cols.owner) out.push({
      key: "owner", label: "Owner", sortable: true, width: "minmax(120px,160px)",
      render: (t) => t.owner ? (
        <span className="inline-flex min-w-0 items-center gap-2"><PersonAvatar person={t.owner} size={24} /><span className="truncate">{t.owner.name ?? personName(t.owner)}</span></span>
      ) : <span className="text-ink-3">Nobody</span>,
    });
    if (cols.updated) out.push({ key: "updated", label: "Last updated", sortable: true, width: "minmax(120px,140px)", render: (t) => <span className="tabular-nums text-ink-2" title={fmt.title(t.updatedAt)}>{fmt.date(t.updatedAt)}</span> });
    return out;
  }, [cols, location, fmt, router, toggleFav]);

  const filteredEmpty = !!(q || activeFilters);
  const emptyNode = filteredEmpty ? (
    <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={() => setParams({ q: null, location: null, owner: null, updatedFrom: null, updatedTo: null, hasForm: null })} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
  ) : view === "shared" ? "Nothing has been shared with you yet"
    : view === "favorites" ? "Star a table and it shows up here"
    : view === "mine" ? "You have not made a table yet"
    : null;
  const showQuietEmpty = rows !== null && rows.length === 0 && view === "all" && !filteredEmpty;
  // A Guest with nothing in this hub gets the shell 404, never an empty list
  // (spec-tables-forms section 1 Access, access 5.5 items 2 and 6): an empty
  // list would confirm the hub exists for them. counts.all is every table the
  // Guest can read with no filter applied.
  const guestHasNothing = isGuest && rows !== null && !filteredEmpty && counts !== null && counts.all === 0;
  if (guestHasNothing) return <NotFoundView />;

  return (
    <>
      <Breadcrumb items={[]} />
      <OsPageHeader
        title="Tables"
        views={VIEWS.map((v) => (
          <ViewTab
            key={v.key}
            icon={v.Icon}
            label={VIEW_LABEL[v.key]}
            active={view === v.key}
            href={v.key === "all" ? "/tables" : `/tables?view=${v.key}`}
            trailing={counts ? <span className={cn("text-xs font-medium tabular-nums", view === v.key ? "text-ink-strong" : "text-ink-2")}>{fmt.count(counts[v.key])}</span> : undefined}
          />
        ))}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: SORTS.find((s) => s.key === sort)?.label, active: true },
          left: (
            <div className="relative">
              <Picker
                open={sortOpen}
                onClose={() => setSortOpen(false)}
                ariaLabel="Sort tables"
                selected={sort}
                onSelect={(v) => { setSortOpen(false); setParams(v === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: v, dir: null }); }}
                sections={[{ options: SORTS.map((s) => ({ value: s.key, label: s.label, hint: s.key === sort ? (dir === "asc" ? "Ascending" : "Descending") : undefined })) }]}
                width={240}
              />
            </div>
          ),
          right: (
            <>
              <SearchField value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search tables" />
              <span className="relative">
                <Picker open={displayOpen} onClose={() => setDisplayOpen(false)} ariaLabel="Columns shown" multi selected={TABLES_LIST_COLUMNS.filter((k) => cols[k])} onSelect={toggleColumn} align="end" width={240}
                  sections={[{ label: "Columns shown", options: TABLES_LIST_COLUMNS.map((k) => ({ value: k, label: COLUMN_LABEL[k] })) }]} />
              </span>
              {!isGuest ? (
                <SplitPrimary label="New table" onClick={() => void createTable()} busy={creating} menuLabel="More ways to make a table">
                  <MenuItem icon={Table2} label="Blank table" onClick={() => void createTable()} />
                  <MenuItem icon={Upload} label="From a CSV…" onClick={() => setImportOpen(true)} />
                </SplitPrimary>
              ) : null}
            </>
          ),
          menu: [
            { label: "Display", icon: SlidersHorizontal, onClick: () => setDisplayOpen(true) },
            ...(!isGuest ? [{ label: "Import a CSV…", icon: Upload, onClick: () => setImportOpen(true) }] : []),
            ...(!isAgent ? [{ label: "Export list as CSV", icon: Download, onClick: () => void exportList() }] : []),
            ...(!isGuest ? [{ label: "Trash", icon: Trash2, href: "/trash?type=table" }] : []),
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="tables"
          activeCount={activeFilters}
          onClearAll={() => setParams({ location: null, owner: null, updatedFrom: null, updatedTo: null, hasForm: null })}
          search={{ value: filterSearch, onChange: setFilterSearch, placeholder: "Search fields" }}
        >
          {"location space".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Location">
              <FilterRow label="No Space" checked={location === "none"} onCheckedChange={(on) => setParams({ location: on ? "none" : null })} />
              {(spaces ?? []).map((s) => (
                <FilterRow key={s.id} label={<span className="inline-flex items-center gap-2"><EntityTile size="xs" icon={s.icon} color={s.color} name={s.name} fallback="folder" />{s.name}</span>} checked={location === s.id} onCheckedChange={(on) => setParams({ location: on ? s.id : null })} />
              ))}
            </FilterGroup>
          ) : null}
          {"owner".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Owner">
              <FilterRow label="Filter by owner" checked={!!owner} onCheckedChange={(on) => { if (!on) setParams({ owner: null }); else setOwnerPickOpen(true); }}>
                <OwnerPick people={people} value={owner} onChange={(id) => setParams({ owner: id })} open={ownerPickOpen} setOpen={setOwnerPickOpen} />
              </FilterRow>
            </FilterGroup>
          ) : null}
          {"updated".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Updated">
              <FilterRow label="Date range" checked={!!(updatedFrom || updatedTo)} onCheckedChange={(on) => { if (!on) setParams({ updatedFrom: null, updatedTo: null }); else setParams({ updatedFrom: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10) }); }}>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-sm text-ink-2">From <input type="date" value={(updatedFrom ?? "").slice(0, 10)} onChange={(e) => setParams({ updatedFrom: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                  <label className="flex items-center gap-2 text-sm text-ink-2">To <input type="date" value={(updatedTo ?? "").slice(0, 10)} onChange={(e) => setParams({ updatedTo: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                </div>
              </FilterRow>
            </FilterGroup>
          ) : null}
          {"has a form".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Forms">
              <FilterRow label="Has a form" checked={hasForm} onCheckedChange={(on) => setParams({ hasForm: on ? "1" : null })} />
            </FilterGroup>
          ) : null}
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col">
          {loadError ? (
            <OsEmptyView variant="error" context="list" title="We could not load your tables." action={{ label: "Retry", onClick: () => void load() }} />
          ) : showQuietEmpty ? (
            <OsEmptyView context="list" title="No tables yet" action={isGuest ? undefined : { label: "Import a CSV", onClick: () => setImportOpen(true) }} />
          ) : (
            <TableCard<TableRow>
              ariaLabel={VIEW_LABEL[view]}
              columns={columns}
              rows={rows}
              rowKey={(t) => t.id}
              rowHref={(t) => `/tables/${t.id}`}
              selectable={!isGuest}
              selected={selected}
              onSelectedChange={setSelected}
              sort={{ key: sort, dir }}
              onSort={(key) => setParams(key === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: key, dir: null })}
              onRowContextMenu={(t, e) => menu.open(e, toTarget(t))}
              onRowDeleteKey={isAgent || isGuest ? undefined : (t) => void bulkTrash([t])}
              rowMenu={(t) => <RowMenuTrigger onOpen={(ref) => menu.openFrom(ref, toTarget(t))} open={menu.state?.table.id === t.id} />}
              empty={emptyNode}
              footer={{ total, noun: "records", from, to, onPrev: goPrev, onNext: goNext, pageSize: limit, pageSizes: PAGE_SIZES, onPageSize: (n) => setParams({ limit: n === PAGE_SIZES[0] ? null : String(n) }) }}
              bulkActions={
                <>
                  {anyManageable ? (
                    <span className="relative">
                      <BulkAction icon={FolderInput} label="Move to Space…" onClick={() => setBulkMoveOpen((o) => !o)} />
                      <Picker open={bulkMoveOpen} onClose={() => setBulkMoveOpen(false)} ariaLabel="Move selected tables" side="top" onSelect={(v) => void bulkMove(v)}
                        sections={[{ options: [{ value: "none", label: "No Space" }] }, { label: "Spaces", options: (spaces ?? []).map((s) => ({ value: s.id, label: s.name, glyph: <EntityTile size="xs" icon={s.icon} color={s.color} name={s.name} fallback="folder" /> })) }]} />
                    </span>
                  ) : null}
                  {!isAgent ? <BulkAction icon={Download} label="Export as CSV" onClick={bulkExport} /> : null}
                  <BulkAction icon={Star} label="Add to favorites" onClick={() => void bulkFavorite()} />
                  {!isAgent && anyManageable ? <BulkAction icon={Trash2} label="Move to Trash" destructive onClick={() => void bulkTrash()} /> : null}
                </>
              }
            />
          )}
        </div>
      </div>

      <TableRowMenuHost
        menu={menu}
        context="table"
        onChanged={(kind, t, next) => {
          if (next) setRows((prev) => prev?.map((r) => (r.id === t.id ? { ...r, ...(next.name !== undefined ? { name: next.name } : {}), ...(next.isFavorite !== undefined ? { isFavorite: next.isFavorite } : {}), ...(next.isPublic !== undefined ? { hasPublicLink: next.isPublic } : {}) } : r)) ?? prev);
          if (kind === "trashed" || kind === "duplicated" || kind === "moved") void load();
        }}
      />
      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={({ tableId, created }) => { void load(); if (created) router.push(`/tables/${tableId}`); }} />
    </>
  );
}

/* ───────────────────────────── bits ───────────────────────────── */

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(value); }
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft.trim()), 350);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.5} aria-hidden />
      <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="h-9 w-[200px] max-md:w-36 rounded-md border border-line-strong bg-raised ps-8 pe-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
    </label>
  );
}

function RowMenuTrigger({ onOpen, open }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Table actions" />;
}

function OwnerPick({ people, value, onChange, open, setOpen }: { people: PersonRef[]; value: string | null; onChange: (id: string) => void; open: boolean; setOpen: (v: boolean) => void }) {
  const current = people.find((p) => p.id === value) ?? null;
  const options: PickerOption[] = people.map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> }));
  return (
    <span className="relative block">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink">
        {current ? <><PersonAvatar person={current} size={20} />{personName(current)}</> : <span className="text-ink-3">Choose a person</span>}
      </button>
      <Picker open={open} onClose={() => setOpen(false)} ariaLabel="Owner" searchPlaceholder="Find a person" selected={value} onSelect={(v) => { onChange(v); setOpen(false); }} sections={[{ options }]} />
    </span>
  );
}
