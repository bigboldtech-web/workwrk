"use client";

/* /canvas (spec-docs-knowledge section 2): every canvas I can open, and a
 * way to start a new one.
 *
 *   header   "Canvases" · views All · Recent · Mine · Favorites · toolbar
 *            Filter, Sort, list / gallery switcher (home.canvas.viewType),
 *            search, Display, the one blue "New canvas" split, "..."
 *   gallery  cards with a 16:10 thumbnail (Whiteboard.thumbnail, else the
 *            grid-dots placeholder), name, "Edited {smart date} · {owner}",
 *            a Location chip when anchored, hover star + "..."
 *   list     TableCard: checkbox · Name · Location · Last edited · Owner · "..."
 *
 *   GET  /api/whiteboards?view=&q=&location=&owner=&sort=&dir=&cursor=&limit=
 *   POST /api/whiteboards { name: "Untitled canvas" }  then /canvas/[id]?new=1
 *
 * No grouping by the removed verticals: productSlug is ignored. The name
 * prompt is gone; a canvas is created blank and renamed inline in its title.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, FolderInput, Frame, LayoutGrid, LayoutTemplate, Rows3, Search, SlidersHorizontal, Star, Trash2, User } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useBoot } from "@/components/layout/os/boot-context";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { MenuItem } from "@/components/ui/menu";
import { BulkAction, RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { SplitPrimary } from "@/components/ui/split-primary";
import { EntityTile } from "@/components/ui/entity-tile";
import { EntityCard } from "@/components/ui/entity-card";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { CanvasRowMenuHost, useCanvasRowMenu, dispatchCanvasesChanged, type CanvasMenuTarget } from "@/components/canvas/canvas-row-menu";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { CANVAS_COLUMNS, readCanvasColumns, readCanvasViewType, type CanvasColumnKey } from "@/lib/docs-prefs";
import type { CanvasSort, CanvasView } from "@/lib/canvas-list";
import { cn } from "@/lib/utils";

type Loc = { type: string; id: string; name: string; icon: string | null; color: string | null; href: string };
type CanvasRow = {
  id: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  ownerId: string | null;
  owner: (PersonRef & { name: string | null }) | null;
  spaceId: string | null;
  location: Loc | null;
  lastEditedAt: string | null;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
};
type ListResponse = { data: CanvasRow[]; total: number; nextCursor: string | null };
type SpaceRow = { id: string; name: string; icon?: string | null; color?: string | null };

const VIEW_LABEL: Record<CanvasView, string> = { all: "All", recent: "Recent", my: "Mine", favorites: "Favorites" };
const VIEWS: Array<{ key: CanvasView; Icon: typeof Frame }> = [
  { key: "all", Icon: Frame }, { key: "recent", Icon: Clock }, { key: "my", Icon: User }, { key: "favorites", Icon: Star },
];
const SORTS: Array<{ key: CanvasSort; label: string }> = [
  { key: "edited", label: "Last edited" }, { key: "name", label: "Name" }, { key: "owner", label: "Owner" }, { key: "created", label: "Created" },
];
const COLUMN_LABEL: Record<CanvasColumnKey, string> = { location: "Location", updated: "Last edited", owner: "Owner" };
const PAGE_SIZES = [40, 100];
const isView = (v: string | null): v is CanvasView => !!v && v in VIEW_LABEL;
const isSort = (v: string | null): v is CanvasSort => !!v && SORTS.some((s) => s.key === v);
const personName = (p: PersonRef | null | undefined) => (p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "" : "");

export default function CanvasesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { rowVersion, prefs, patchPrefs, openTemplateCenter } = useOsShell();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();

  const view: CanvasView = isView(params.get("view")) ? (params.get("view") as CanvasView) : "all";
  const q = params.get("q") ?? "";
  const sort: CanvasSort = isSort(params.get("sort")) ? (params.get("sort") as CanvasSort) : "edited";
  const dir: "asc" | "desc" = params.get("dir") === "asc" || params.get("dir") === "desc" ? (params.get("dir") as "asc" | "desc") : (sort === "name" || sort === "owner" ? "asc" : "desc");
  const location = params.get("location");
  const owner = params.get("owner");
  const editedFrom = params.get("editedFrom");
  const editedTo = params.get("editedTo");
  const cursor = params.get("cursor");
  const limitRaw = Number(params.get("limit"));
  const limit = PAGE_SIZES.includes(limitRaw) ? limitRaw : PAGE_SIZES[0];
  const viewType = readCanvasViewType(prefs.home);
  const cols = readCanvasColumns(prefs.home);

  // The cursors of the pages before this one (state, so the footer can read
  // its length in render); a filter or sort change resets it in setParams.
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const pageIndex = cursorStack.length;
  const setParams = useCallback((patch: Record<string, string | null>, opts?: { keepCursor?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    if (!opts?.keepCursor) { next.delete("cursor"); setCursorStack([]); }
    next.delete("new");
    const s = next.toString();
    router.push(s ? `/canvas?${s}` : "/canvas");
  }, [params, router]);
  const activeFilters = [location, owner, editedFrom || editedTo ? "edited" : null].filter(Boolean).length;

  /* ── data ── */
  const [rows, setRows] = useState<CanvasRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ view, sort, dir, limit: String(limit) });
    if (q) qs.set("q", q);
    if (location) qs.set("location", location);
    if (owner) qs.set("owner", owner);
    if (editedFrom) qs.set("editedFrom", editedFrom);
    if (editedTo) qs.set("editedTo", editedTo);
    if (cursor) qs.set("cursor", cursor);
    return qs.toString();
  }, [view, sort, dir, limit, q, location, owner, editedFrom, editedTo, cursor]);
  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/whiteboards?${queryString}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); return; }
    setLoadError(false);
    setRows(r.data.data); setTotal(r.data.total); setNextCursor(r.data.nextCursor); setSelected(new Set());
  }, [queryString]);
  // A tick after the effect, so the loader's own setState never runs inside
  // an effect body (the same shape src/components/access/who-has-access.tsx uses).
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const rv = rowVersion("whiteboards");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [rv, load]);
  useEffect(() => {
    const on = () => { void load(); };
    window.addEventListener("workwrk:whiteboards-changed", on);
    window.addEventListener("workwrk:favs-changed", on);
    window.addEventListener("focus", on);
    return () => { window.removeEventListener("workwrk:whiteboards-changed", on); window.removeEventListener("workwrk:favs-changed", on); window.removeEventListener("focus", on); };
  }, [load]);
  const from = total === 0 ? 0 : pageIndex * limit + 1;
  const to = Math.min(total, pageIndex * limit + (rows?.length ?? 0));
  const goNext = nextCursor ? () => { setCursorStack((st) => [...st, cursor ?? ""]); setParams({ cursor: nextCursor }, { keepCursor: true }); } : undefined;
  const goPrev = cursor ? () => { const prev = cursorStack[cursorStack.length - 1] ?? ""; setCursorStack((st) => st.slice(0, -1)); setParams({ cursor: prev || null }, { keepCursor: true }); } : undefined;

  /* ── filters ── */
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  useEffect(() => {
    if (!(filterOpen || bulkMoveOpen) || spaces !== null) return;
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
  const createCanvas = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    const r = await apiFetch<{ whiteboard: { id: string } }>("/api/whiteboards", { method: "POST", json: { name: "Untitled canvas" } });
    setCreating(false);
    if (!r.ok) { toast(r.error || "Couldn't create canvas", { tone: "danger" }); return; }
    dispatchCanvasesChanged();
    router.push(`/canvas/${r.data.whiteboard.id}?new=1`);
  }, [creating, router, toast]);
  // The Docs "+" routes here with ?new=1: create once, strip the param
  // (an armed latch, like /files?upload=1).
  const newArmed = useRef(false);
  useEffect(() => {
    if (params.get("new") !== "1" || newArmed.current) return;
    newArmed.current = true;
    router.replace("/canvas");
    const t = setTimeout(() => void createCanvas(), 0);
    return () => clearTimeout(t);
  }, [params, router, createCanvas]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      void createCanvas();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createCanvas]);

  /* ── favorites, menu, bulk ── */
  const meId = boot.viewer.id;
  const isAdmin = boot.viewer.orgRole === "OWNER" || boot.viewer.orgRole === "ADMIN";
  const toggleFav = useCallback(async (c: CanvasRow) => {
    const next = !c.favorite;
    setRows((prev) => prev?.map((r) => (r.id === c.id ? { ...r, favorite: next } : r)) ?? prev);
    const r = await apiFetch("/api/me/favorites/whiteboards", { method: "POST", json: { whiteboardId: c.id, on: next } });
    if (!r.ok) { setRows((prev) => prev?.map((x) => (x.id === c.id ? { ...x, favorite: !next } : x)) ?? prev); toast("Couldn't update favorite", { tone: "danger" }); return; }
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
  }, [toast]);
  const menu = useCanvasRowMenu();
  const toTarget = (c: CanvasRow): CanvasMenuTarget => ({ id: c.id, name: c.name, spaceId: c.spaceId, favorite: c.favorite, canManage: isAdmin || c.ownerId === meId });
  const selectedRows = useMemo(() => (rows ?? []).filter((r) => selected.has(r.id)), [rows, selected]);
  async function bulkFavorite() {
    const ids = [...selected];
    await Promise.allSettled(ids.map((id) => apiFetch("/api/me/favorites/whiteboards", { method: "POST", json: { whiteboardId: id, on: true } })));
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
    toast(`Added ${ids.length} canvas${ids.length === 1 ? "" : "es"} to favorites`);
    setSelected(new Set()); void load();
  }
  async function bulkTrash() {
    const ids = selectedRows.filter((r) => isAdmin || r.ownerId === meId).map((r) => r.id);
    if (ids.length === 0) { toast("You cannot move these canvases to Trash"); return; }
    const ok = await confirm({ title: `Move ${ids.length} canvas${ids.length === 1 ? "" : "es"} to Trash?`, description: `Restore within ${boot.org.trashDays} days.`, destructive: true, confirmLabel: "Move to Trash" });
    if (!ok) return;
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/whiteboards/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    toast(failed ? `Moved ${ids.length - failed}, ${failed} failed` : "Moved to Trash", failed ? { tone: "danger" } : { action: { label: "View Trash", onClick: () => router.push("/trash?type=canvas") } });
    setSelected(new Set()); dispatchCanvasesChanged(); void load();
  }
  async function bulkMove(value: string) {
    setBulkMoveOpen(false);
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/whiteboards/${id}`, { method: "PATCH", json: { spaceId: value === "none" ? null : value } })));
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    toast(failed ? `Moved ${ids.length - failed}, ${failed} failed` : `Moved ${ids.length} canvas${ids.length === 1 ? "" : "es"}`, failed ? { tone: "danger" } : undefined);
    setSelected(new Set()); dispatchCanvasesChanged(); void load();
  }

  const columns = useMemo<TableColumn<CanvasRow>[]>(() => {
    const out: TableColumn<CanvasRow>[] = [{
      key: "name", label: "Name", title: true, sortable: true, width: "minmax(240px,2fr)",
      render: (c) => (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Frame className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
          <span className="truncate">{c.name || "Untitled canvas"}</span>
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggleFav(c); }} aria-label={c.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={c.favorite} title={c.favorite ? "Remove from favorites" : "Star"}
            className={cn("ms-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-active", c.favorite ? "text-ink" : "text-ink-3 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100")}>
            <Star className="h-4 w-4" strokeWidth={1.5} style={c.favorite ? { fill: "currentColor" } : undefined} aria-hidden />
          </button>
        </span>
      ),
    }];
    if (cols.location) out.push({ key: "location", label: "Location", width: "minmax(140px,1fr)", render: (c) => c.location ? <span className="inline-flex min-w-0 items-center gap-1.5 hover:underline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(c.location!.href); }}><EntityTile size="xs" icon={c.location.icon} color={c.location.color} name={c.location.name} fallback="folder" /><span className="truncate">{c.location.name}</span></span> : <span className="text-ink-3">No location</span> });
    if (cols.updated) out.push({ key: "edited", label: "Last edited", sortable: true, width: "130px", render: (c) => <span className="tabular-nums text-ink-2" title={fmt.title(c.lastEditedAt ?? c.updatedAt)}>{fmt.date(c.lastEditedAt ?? c.updatedAt)}</span> });
    if (cols.owner) out.push({ key: "owner", label: "Owner", sortable: true, width: "minmax(140px,1fr)", render: (c) => c.owner ? <span className="inline-flex min-w-0 items-center gap-2"><PersonAvatar person={c.owner} size={24} /><span className="truncate">{c.owner.name ?? personName(c.owner)}</span></span> : <span className="text-ink-3">Nobody</span> });
    return out;
  }, [cols, fmt, router, toggleFav]);

  const filteredEmpty = !!(q || activeFilters);
  const emptyText = filteredEmpty ? null : view === "recent" ? "Nothing edited recently" : view === "favorites" ? "Star a canvas and it shows up here" : view === "my" ? "You have not created a canvas yet" : "No canvases yet";
  const showQuietEmpty = rows !== null && rows.length === 0 && !filteredEmpty;

  return (
    <>
      <OsPageHeader
        title="Canvases"
        views={VIEWS.map((v) => <ViewTab key={v.key} icon={v.Icon} label={VIEW_LABEL[v.key]} active={view === v.key} href={v.key === "all" ? "/canvas" : `/canvas?view=${v.key}`} />)}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: SORTS.find((s) => s.key === sort)?.label, active: true },
          switcher: { value: viewType, options: [{ key: "list", label: "List", icon: Rows3 }, { key: "grid", label: "Gallery", icon: LayoutGrid }], onChange: (k) => void patchPrefs({ home: { canvas: { viewType: k as "grid" | "list" } } }) },
          left: (
            <div className="relative">
              <Picker open={sortOpen} onClose={() => setSortOpen(false)} ariaLabel="Sort canvases" selected={sort} width={240}
                onSelect={(v) => { setSortOpen(false); setParams(v === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: v, dir: null }); }}
                sections={[{ options: SORTS.map((s) => ({ value: s.key, label: s.label, hint: s.key === sort ? (dir === "asc" ? "Ascending" : "Descending") : undefined })) }]} />
            </div>
          ),
          right: (
            <>
              <SearchField value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search canvases" />
              {viewType === "list" ? (
                <span className="relative">
                  <Picker open={displayOpen} onClose={() => setDisplayOpen(false)} ariaLabel="Columns shown" multi align="end" width={240} selected={CANVAS_COLUMNS.filter((k) => cols[k])} onSelect={(k) => void patchPrefs({ home: { canvas: { columns: { ...cols, [k]: !cols[k as CanvasColumnKey] } } } })} sections={[{ label: "Columns shown", options: CANVAS_COLUMNS.map((k) => ({ value: k, label: COLUMN_LABEL[k] })) }]} />
                </span>
              ) : null}
              <SplitPrimary label="New canvas" onClick={() => void createCanvas()} busy={creating}>
                <MenuItem icon={Frame} label="Blank canvas" onClick={() => void createCanvas()} />
                <MenuItem icon={LayoutTemplate} label="From template…" onClick={() => openTemplateCenter({ kind: "WHITEBOARD" })} />
              </SplitPrimary>
            </>
          ),
          menu: [
            ...(viewType === "list" ? [{ label: "Display", icon: SlidersHorizontal, onClick: () => setDisplayOpen(true) }] : []),
            { label: "Browse templates", icon: LayoutTemplate, href: "/templates?kind=canvas" },
            { label: "Trash", icon: Trash2, href: "/trash?type=canvas" },
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="canvases" activeCount={activeFilters} onClearAll={() => setParams({ location: null, owner: null, editedFrom: null, editedTo: null })}>
          <FilterGroup label="Location">
            <FilterRow label="No location" checked={location === "none"} onCheckedChange={(on) => setParams({ location: on ? "none" : null })} />
            {(spaces ?? []).map((s) => <FilterRow key={s.id} label={<span className="inline-flex items-center gap-2"><EntityTile size="xs" icon={s.icon} color={s.color} name={s.name} fallback="folder" />{s.name}</span>} checked={location === `SPACE:${s.id}`} onCheckedChange={(on) => setParams({ location: on ? `SPACE:${s.id}` : null })} />)}
          </FilterGroup>
          <FilterGroup label="Owner">
            <FilterRow label="Filter by owner" checked={!!owner} onCheckedChange={(on) => { if (!on) setParams({ owner: null }); else setOwnerOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setOwnerOpen((o) => !o)} className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink">
                  {owner && people.find((p) => p.id === owner) ? personName(people.find((p) => p.id === owner)) : <span className="text-ink-3">Choose a person</span>}
                </button>
                <Picker open={ownerOpen} onClose={() => setOwnerOpen(false)} ariaLabel="Owner" searchPlaceholder="Find a person" selected={owner} onSelect={(v) => { setParams({ owner: v }); setOwnerOpen(false); }} sections={[{ options: people.map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> })) }]} />
              </span>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Last edited">
            <FilterRow label="Date range" checked={!!(editedFrom || editedTo)} onCheckedChange={(on) => { if (!on) setParams({ editedFrom: null, editedTo: null }); else setParams({ editedFrom: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10) }); }}>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-sm text-ink-2">From <input type="date" value={(editedFrom ?? "").slice(0, 10)} onChange={(e) => setParams({ editedFrom: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                <label className="flex items-center gap-2 text-sm text-ink-2">To <input type="date" value={(editedTo ?? "").slice(0, 10)} onChange={(e) => setParams({ editedTo: e.target.value ? `${e.target.value}T23:59:59` : null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
              </div>
            </FilterRow>
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col">
          {loadError ? (
            <OsEmptyView variant="error" context="board" title="Couldn't load canvases" action={{ label: "Retry", onClick: () => void load() }} />
          ) : showQuietEmpty ? (
            <OsEmptyView context="board" title={emptyText ?? "No canvases yet"} action={view === "all" || view === "my" ? { label: "Create a canvas", onClick: () => void createCanvas() } : undefined} />
          ) : viewType === "grid" ? (
            <>
              {rows === null ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4" aria-busy="true" aria-label="Loading">
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-52 rounded-lg bg-skeleton os-skeleton-pulse" />)}
                </div>
              ) : rows.length === 0 ? (
                <div className="flex h-11 items-center gap-2 text-row text-ink-2">No results · <button type="button" onClick={() => setParams({ q: null, location: null, owner: null, editedFrom: null, editedTo: null })} className="font-medium text-brand-deep hover:underline">Clear filters</button></div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                  {rows.map((c) => (
                    <EntityCard
                      key={c.id}
                      variant="template"
                      href={`/canvas/${c.id}`}
                      title={c.name || "Untitled canvas"}
                      subtitle={`Edited ${fmt.date(c.lastEditedAt ?? c.updatedAt)}${c.owner ? ` · ${c.owner.name ?? personName(c.owner)}` : ""}`}
                      media={<Thumb src={c.thumbnail} alt={c.name} />}
                      meta={c.location ? <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-2"><EntityTile size="xs" icon={c.location.icon} color={c.location.color} name={c.location.name} fallback="folder" /><span className="truncate">{c.location.name}</span></span> : null}
                      menu={
                        <span className="flex items-center gap-0.5 rounded-md bg-raised">
                          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggleFav(c); }} aria-label={c.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={c.favorite} className={cn("inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-active", c.favorite ? "text-ink" : "text-ink-2")}>
                            <Star className="h-4 w-4" strokeWidth={1.5} style={c.favorite ? { fill: "currentColor" } : undefined} aria-hidden />
                          </button>
                          <RowMenuTrigger onOpen={(ref) => menu.openFrom(ref, toTarget(c))} open={menu.state?.canvas.id === c.id} />
                        </span>
                      }
                    />
                  ))}
                </div>
              )}
              {rows !== null && rows.length > 0 ? (
                <div className="mt-3 flex h-11 items-center gap-3 rounded-lg border border-line bg-raised px-4 text-sm">
                  <span className="font-medium text-ink">Total canvases <span className="tabular-nums">{fmt.count(total)}</span></span>
                  <span className="flex-1" />
                  <span className="tabular-nums text-ink-2">{from} to {to}</span>
                  <button type="button" onClick={goPrev} disabled={!goPrev} aria-label="Previous page" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-40">‹</button>
                  <button type="button" onClick={goNext} disabled={!goNext} aria-label="Next page" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-40">›</button>
                </div>
              ) : null}
            </>
          ) : (
            <TableCard<CanvasRow>
              ariaLabel="Canvases"
              columns={columns}
              rows={rows}
              rowKey={(c) => c.id}
              rowHref={(c) => `/canvas/${c.id}`}
              selectable selected={selected} onSelectedChange={setSelected}
              sort={{ key: sort === "edited" ? "edited" : sort, dir }}
              onSort={(key) => { const k = key === "edited" ? "edited" : key; setParams(k === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: k, dir: null }); }}
              onRowContextMenu={(c, e) => menu.openAt(e, toTarget(c))}
              rowMenu={(c) => <RowMenuTrigger onOpen={(ref) => menu.openFrom(ref, toTarget(c))} open={menu.state?.canvas.id === c.id} />}
              empty={filteredEmpty ? <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={() => setParams({ q: null, location: null, owner: null, editedFrom: null, editedTo: null })} className="font-medium text-brand-deep hover:underline">Clear filters</button></span> : emptyText}
              footer={{ total, noun: "canvases", from, to, onPrev: goPrev, onNext: goNext, pageSize: limit, pageSizes: PAGE_SIZES, onPageSize: (n) => setParams({ limit: n === PAGE_SIZES[0] ? null : String(n) }) }}
              bulkActions={
                <>
                  <span className="relative">
                    <BulkAction icon={FolderInput} label="Move to…" onClick={() => setBulkMoveOpen((o) => !o)} />
                    <Picker open={bulkMoveOpen} onClose={() => setBulkMoveOpen(false)} ariaLabel="Move selected canvases" side="top" onSelect={(v) => void bulkMove(v)} sections={[{ options: [{ value: "none", label: "No location" }] }, { label: "Spaces", options: (spaces ?? []).map((s) => ({ value: s.id, label: s.name, glyph: <EntityTile size="xs" icon={s.icon} color={s.color} name={s.name} fallback="folder" /> })) }]} />
                  </span>
                  <BulkAction icon={Star} label="Add to favorites" onClick={() => void bulkFavorite()} />
                  <BulkAction icon={Trash2} label="Move to Trash" destructive onClick={() => void bulkTrash()} />
                </>
              }
            />
          )}
        </div>
      </div>

      <CanvasRowMenuHost menu={menu} onChanged={() => void load()} />
    </>
  );
}

/**
 * A 16:10 thumbnail, or the grid-dots placeholder (design-system 5.16 `grid`).
 * A stored preview that fails to decode falls back to the dots too, so a card
 * never shows a broken image with its alt text inside an empty frame.
 */
function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  const show = !!src && !broken;
  return (
    <span className="block aspect-[16/10] w-full overflow-hidden rounded-md border border-line-soft bg-app" style={show ? undefined : { backgroundImage: "radial-gradient(var(--os-line-soft) 1px, transparent 1px)", backgroundSize: "24px 24px" }}>
      {show ? <img src={src} alt={alt} className="h-full w-full object-cover" onError={() => setBroken(true)} /> : null}
    </span>
  );
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  // Adopt a new URL value during render (the Picker pattern), never in an effect.
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
      <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 w-[200px] max-md:w-36 rounded-md border border-line-strong bg-raised ps-8 pe-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
    </label>
  );
}

function RowMenuTrigger({ onOpen, open }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Canvas actions" />;
}
