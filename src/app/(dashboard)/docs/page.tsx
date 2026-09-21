"use client";

/* /docs (spec-docs-knowledge section 2): every doc I can open, in one table,
 * with the views I actually use.
 *
 *   header   title "Docs" · views All · Recent · Mine · Shared with me ·
 *            Favorites (each with its count) · toolbar Filter, Sort, search,
 *            Display, the one blue "New doc" split, the bordered "..."
 *   body     TableCard: checkbox · Name · Location · Date updated · Date viewed
 *            · Owner (· Contributors behind Display) · row "..."
 *            (DocRowMenu, the one doc menu); bulk bar; footer with the real
 *            total and cursor pages
 *
 *   GET  /api/docs?view=&q=&location=&owner=&updatedFrom=&updatedTo=
 *        &includeChildren=&sort=&dir=&cursor=&limit=   server views, filters,
 *        sort and pages; the 200-row cap and the client-side filtering are gone
 *   POST /api/docs                                     { title: "Untitled doc" }
 *
 * Every view, filter and sort is in the URL, so a filtered page is a link.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Clock, FileText, FolderInput, LayoutTemplate, Search, SlidersHorizontal, Star, Trash2, User, Users, Import as ImportIcon,
} from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useRetiredView } from "@/components/layout/os/use-retired-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { BulkAction, RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { SplitPrimary } from "@/components/ui/split-primary";
import { ComingSoonRow, UpcomingOnly } from "@/components/ui/coming-soon-row";
import { EntityTile, type EntityTileFallback } from "@/components/ui/entity-tile";
import { PersonAvatar, PersonAvatarStack, type PersonRef } from "@/components/board-view/assignee-picker";
import { renderNoteIcon } from "@/components/docs/note-icon";
import { DocRowMenuHost, useDocRowMenu, dispatchDocsChanged, type DocMenuTarget } from "@/components/docs/doc-row-menu";
import { DocShareModal } from "@/components/docs/doc-share-modal";
import { useBoot } from "@/components/layout/os/boot-context";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { DOCS_COLUMNS, readDocsColumns, type DocsColumnKey } from "@/lib/docs-prefs";
import type { DocsSort, DocsView } from "@/lib/docs-list";
import { cn } from "@/lib/utils";

/* ───────────────────────────── types ───────────────────────────── */

type Loc = { type: string; name: string; icon: string | null; color: string | null; href: string | null };
type DocRow = {
  id: string;
  title: string;
  emoji: string | null;
  parentId: string | null;
  parentTitle: string | null;
  childCount: number;
  location: Loc | null;
  entityType: string | null;
  entityId: string | null;
  ownerId: string | null;
  owner: (PersonRef & { name: string | null }) | null;
  updatedAt: string;
  viewedAt: string | null;
  favorite: boolean;
  contributors?: PersonRef[];
  myRole: "edit" | "view";
  canManage: boolean;
};
type ListResponse = { data: DocRow[]; total: number; nextCursor: string | null; counts?: Record<DocsView, number> };
type SpaceRow = { id: string; name: string; slug?: string; icon?: string | null; color?: string | null };

const VIEW_LABEL: Record<DocsView, string> = {
  all: "All",
  recent: "Recent",
  my: "Mine",
  shared: "Shared with me",
  favorites: "Favorites",
};
const VIEWS: Array<{ key: DocsView; Icon: typeof FileText }> = [
  { key: "all", Icon: FileText },
  { key: "recent", Icon: Clock },
  { key: "my", Icon: User },
  { key: "shared", Icon: Users },
  { key: "favorites", Icon: Star },
];
const SORTS: Array<{ key: DocsSort; label: string }> = [
  { key: "updated", label: "Date updated" },
  { key: "viewed", label: "Date viewed" },
  { key: "name", label: "Name" },
  { key: "location", label: "Location" },
  { key: "owner", label: "Owner" },
];
const COLUMN_LABEL: Record<DocsColumnKey, string> = {
  location: "Location",
  updated: "Date updated",
  viewed: "Date viewed",
  owner: "Owner",
  contributors: "Contributors",
};
const PAGE_SIZES = [40, 100];

function locationFallback(type: string): EntityTileFallback | null {
  if (type === "BOARD") return "board";
  if (type === "FOLDER") return "folder";
  if (type === "BOARD_ITEM") return "list";
  return null;
}
function personName(p: PersonRef | null | undefined): string {
  if (!p) return "";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "";
}
const isView = (v: string | null): v is DocsView => !!v && v in VIEW_LABEL;
const isSort = (v: string | null): v is DocsSort => !!v && SORTS.some((s) => s.key === v);

/* ───────────────────────────── page ───────────────────────────── */

export default function DocsPage() {
  const router = useRouter();
  const params = useSearchParams();
  // Two retired views land here with their old query on: ?view=meeting and
  // ?view=private. Both are normalised in the URL (retired-views.ts).
  useRetiredView();
  const { rowVersion, prefs, patchPrefs, openTemplateCenter } = useOsShell();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();

  /* ── URL state ── */
  const view: DocsView = isView(params.get("view")) ? (params.get("view") as DocsView) : "all";
  const q = params.get("q") ?? "";
  const sort: DocsSort = isSort(params.get("sort")) ? (params.get("sort") as DocsSort) : view === "recent" ? "viewed" : "updated";
  const dir: "asc" | "desc" = params.get("dir") === "asc" || params.get("dir") === "desc" ? (params.get("dir") as "asc" | "desc") : (sort === "name" || sort === "location" || sort === "owner" ? "asc" : "desc");
  const location = params.get("location");
  const owner = params.get("owner");
  const updatedFrom = params.get("updatedFrom");
  const updatedTo = params.get("updatedTo");
  const includeChildren = params.get("includeChildren") === "1";
  const cursor = params.get("cursor");
  const limitRaw = Number(params.get("limit"));
  const limit = PAGE_SIZES.includes(limitRaw) ? limitRaw : PAGE_SIZES[0];

  // The cursors of the pages before this one (state, so the footer can read
  // its length in render); a filter or sort change resets it in setParams.
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const pageIndex = cursorStack.length;
  const setParams = useCallback((patch: Record<string, string | null>, opts?: { keepCursor?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!opts?.keepCursor) { next.delete("cursor"); setCursorStack([]); }
    const s = next.toString();
    router.push(s ? `/docs?${s}` : "/docs");
  }, [params, router]);

  const activeFilters = [location, owner, updatedFrom || updatedTo ? "updated" : null, includeChildren ? "children" : null].filter(Boolean).length;

  /* ── data ── */
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<DocsView, number> | null>(null);
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
    if (includeChildren) qs.set("includeChildren", "1");
    if (cursor) qs.set("cursor", cursor);
    return qs.toString();
  }, [view, sort, dir, limit, q, location, owner, updatedFrom, updatedTo, includeChildren, cursor]);

  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/docs?${queryString}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); return; }
    setLoadError(false);
    setRows(r.data.data);
    setTotal(r.data.total);
    setNextCursor(r.data.nextCursor);
    if (r.data.counts) setCounts(r.data.counts);
    setSelected(new Set());
  }, [queryString]);
  // A tick after the effect, so the loader's own setState never runs inside
  // an effect body (the same shape src/components/access/who-has-access.tsx uses).
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const rv = rowVersion("docs");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [rv, load]);
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener("workwrk:docs-changed", onChange);
    window.addEventListener("workwrk:favs-changed", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener("workwrk:docs-changed", onChange);
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
  useEffect(() => {
    if (!filterOpen || spaces !== null) return;
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
  }, [filterOpen, spaces]);

  /* ── create ── */
  const [creating, setCreating] = useState(false);
  const createDoc = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    const r = await apiFetch<{ doc: { id: string } }>("/api/docs", { method: "POST", json: { title: "Untitled doc", content: { blocks: [] } } });
    setCreating(false);
    if (!r.ok) { toast(r.error || "Couldn't create doc", { tone: "danger" }); return; }
    dispatchDocsChanged();
    router.push(`/docs/${r.data.doc.id}?new=1`);
  }, [creating, router, toast]);

  // `n` with no field focused = New doc (spec keyboard row).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      void createDoc();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createDoc]);

  /* ── favorites ── */
  const toggleFav = useCallback(async (d: DocRow) => {
    const next = !d.favorite;
    setRows((prev) => prev?.map((r) => (r.id === d.id ? { ...r, favorite: next } : r)) ?? prev);
    const r = await apiFetch("/api/me/favorites/docs", { method: "POST", json: { docId: d.id, on: next } });
    if (!r.ok) { setRows((prev) => prev?.map((x) => (x.id === d.id ? { ...x, favorite: !next } : x)) ?? prev); toast("Couldn't update favorite", { tone: "danger" }); return; }
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
  }, [toast]);

  /* ── row menu + share ── */
  const menu = useDocRowMenu();
  const [shareFor, setShareFor] = useState<DocRow | null>(null);
  const shareAnchor = useRef<HTMLButtonElement | null>(null);
  const meId = boot.viewer.id;
  const toTarget = (d: DocRow): DocMenuTarget => ({
    id: d.id, title: d.title, parentId: d.parentId, entityType: d.entityType, entityId: d.entityId,
    favorite: d.favorite, role: d.canManage ? "full" : d.myRole, own: d.ownerId === meId,
  });

  /* ── bulk ── */
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const selectedRows = useMemo(() => (rows ?? []).filter((r) => selected.has(r.id)), [rows, selected]);
  async function bulkFavorite() {
    const ids = [...selected];
    await Promise.allSettled(ids.map((id) => apiFetch("/api/me/favorites/docs", { method: "POST", json: { docId: id, on: true } })));
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
    toast(`Added ${ids.length} doc${ids.length === 1 ? "" : "s"} to favorites`);
    setSelected(new Set());
    void load();
  }
  async function bulkTrash() {
    const ids = selectedRows.filter((r) => r.canManage || (r.myRole === "edit" && r.ownerId === meId)).map((r) => r.id);
    if (ids.length === 0) { toast("You cannot move these docs to Trash"); return; }
    const ok = await confirm({ title: `Move ${ids.length} doc${ids.length === 1 ? "" : "s"} to Trash?`, description: `You can restore them for ${boot.org.trashDays} days.`, destructive: true, confirmLabel: "Move to Trash" });
    if (!ok) return;
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/docs/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    toast(failed ? `Moved ${ids.length - failed}, ${failed} failed` : "Moved to Trash", failed ? { tone: "danger" } : { action: { label: "View Trash", onClick: () => router.push("/trash?type=doc") } });
    setSelected(new Set());
    dispatchDocsChanged();
    void load();
  }
  async function bulkMove(value: string) {
    setBulkMoveOpen(false);
    const ids = selectedRows.filter((r) => r.myRole !== "view").map((r) => r.id);
    const body = value === "none" ? { entityType: null, entityId: null } : { entityType: "SPACE", entityId: value };
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/docs/${id}`, { method: "PUT", json: body })));
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    toast(failed ? `Moved ${ids.length - failed}, ${failed} failed` : `Moved ${ids.length} doc${ids.length === 1 ? "" : "s"}`, failed ? { tone: "danger" } : undefined);
    setSelected(new Set());
    dispatchDocsChanged();
    void load();
  }
  useEffect(() => {
    if (!bulkMoveOpen || spaces !== null) return;
    void (async () => { const s = await apiFetch<{ spaces: SpaceRow[] }>("/api/spaces", { cache: "no-store" }); setSpaces(s.ok ? s.data.spaces ?? [] : []); })();
  }, [bulkMoveOpen, spaces]);

  /* ── columns (Display) ── */
  const cols = readDocsColumns(prefs.home);
  const [displayOpen, setDisplayOpen] = useState(false);
  const toggleColumn = (key: string) => {
    const next = { ...cols, [key]: !cols[key as DocsColumnKey] };
    void patchPrefs({ home: { docs: { columns: next } } });
  };

  const columns = useMemo<TableColumn<DocRow>[]>(() => {
    const out: TableColumn<DocRow>[] = [
      {
        key: "name", label: "Name", title: true, sortable: true, width: "minmax(240px,2fr)",
        render: (d) => (
          <span className="group/name flex min-w-0 flex-1 items-center gap-2">
            <span className="grid h-5 w-5 shrink-0 place-items-center text-base [&_svg]:h-4 [&_svg]:w-4 [&_img]:h-5 [&_img]:w-5 [&_img]:rounded-sm">
              {d.emoji ? renderNoteIcon(d.emoji) : <FileText className="text-ink-2" strokeWidth={1.5} aria-hidden />}
            </span>
            <span className="truncate">{d.title || "Untitled doc"}</span>
            {d.childCount > 0 ? <span className="shrink-0 text-xs font-medium text-ink-2">· {d.childCount} sub-doc{d.childCount === 1 ? "" : "s"}</span> : null}
            {includeChildren && d.parentTitle ? <span className="shrink-0 truncate text-xs text-ink-2">in {d.parentTitle}</span> : null}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggleFav(d); }}
              aria-label={d.favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={d.favorite}
              title={d.favorite ? "Remove from favorites" : "Star"}
              className={cn("ms-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-active", d.favorite ? "text-ink" : "text-ink-3 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100")}
            >
              <Star className="h-4 w-4" strokeWidth={1.5} style={d.favorite ? { fill: "currentColor" } : undefined} aria-hidden />
            </button>
          </span>
        ),
      },
    ];
    if (cols.location) out.push({
      key: "location", label: "Location", sortable: true, width: "minmax(140px,1fr)",
      headerFilter: (
        <button type="button" onClick={(e) => { e.stopPropagation(); setFilterOpen(true); }} className="text-sm font-normal text-ink-2 hover:text-ink">
          {location ? (location === "none" ? "No location ▾" : "1 ▾") : "All ▾"}
        </button>
      ),
      render: (d) => d.location ? (
        d.location.href ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-ink hover:underline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(d.location!.href!); }} title={d.location.name}>
            <EntityTile size="xs" icon={d.location.icon} color={d.location.color} name={d.location.name} fallback={locationFallback(d.location.type)} />
            <span className="truncate">{d.location.name}</span>
          </span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-ink" title={d.location.name}>
            <EntityTile size="xs" icon={d.location.icon} color={d.location.color} name={d.location.name} fallback={locationFallback(d.location.type)} />
            <span className="truncate">{d.location.name}</span>
          </span>
        )
      ) : <span className="text-ink-3">No location</span>,
    });
    if (cols.updated) out.push({ key: "updated", label: "Date updated", sortable: true, width: "130px", render: (d) => <span className="tabular-nums text-ink-2" title={fmt.title(d.updatedAt)}>{fmt.date(d.updatedAt)}</span> });
    if (cols.viewed) out.push({ key: "viewed", label: "Date viewed", sortable: true, width: "130px", render: (d) => d.viewedAt ? <span className="tabular-nums text-ink-2" title={fmt.title(d.viewedAt)}>{fmt.date(d.viewedAt)}</span> : <span className="text-ink-3">Never</span> });
    if (cols.owner) out.push({
      key: "owner", label: "Owner", sortable: true, width: "minmax(140px,1fr)",
      headerFilter: (
        <button type="button" onClick={(e) => { e.stopPropagation(); setFilterOpen(true); }} className="text-sm font-normal text-ink-2 hover:text-ink">{owner ? "1 ▾" : "All ▾"}</button>
      ),
      render: (d) => d.owner ? (
        <span className="inline-flex min-w-0 items-center gap-2"><PersonAvatar person={d.owner} size={24} /><span className="truncate">{d.owner.name ?? personName(d.owner)}</span></span>
      ) : <span className="text-ink-3">Nobody</span>,
    });
    if (cols.contributors) out.push({ key: "contributors", label: "Contributors", width: "120px", render: (d) => d.contributors && d.contributors.length > 0 ? <PersonAvatarStack people={d.contributors} size={20} max={4} /> : <span className="text-ink-3">None</span> });
    return out;
  }, [cols, includeChildren, location, owner, fmt, router, toggleFav]);

  const filteredEmpty = !!(q || activeFilters);
  const emptyNode = filteredEmpty ? (
    <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={() => setParams({ q: null, location: null, owner: null, updatedFrom: null, updatedTo: null, includeChildren: null })} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
  ) : view === "recent" ? "Nothing opened yet"
    : view === "shared" ? "Nothing has been shared with you yet"
    : view === "favorites" ? "Star a doc and it shows up here"
    : view === "my" ? <span className="inline-flex items-center gap-2">You have not created a doc yet · <button type="button" onClick={() => void createDoc()} className="font-medium text-brand-deep hover:underline">Create a doc</button></span>
    : null;

  const showQuietEmpty = rows !== null && rows.length === 0 && view === "all" && !filteredEmpty;

  return (
    <>
      {/* A single crumb, "Docs": the bar renders the hub label itself. */}
      <Breadcrumb items={[]} />
      <OsPageHeader
        title="Docs"
        views={VIEWS.map((v) => (
          <ViewTab
            key={v.key}
            icon={v.Icon}
            label={VIEW_LABEL[v.key]}
            active={view === v.key}
            href={v.key === "all" ? "/docs" : `/docs?view=${v.key}`}
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
                ariaLabel="Sort docs"
                selected={sort}
                onSelect={(v) => { setSortOpen(false); setParams(v === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: v, dir: null }); }}
                sections={[{ options: SORTS.map((s) => ({ value: s.key, label: s.label, hint: s.key === sort ? (dir === "asc" ? "Ascending" : "Descending") : undefined })) }]}
                width={240}
              />
            </div>
          ),
          right: (
            <>
              <SearchField value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search docs" />
              {/* Display lives in the bordered "..." (spec /docs toolbar); the
                  picker anchors here, at the end of the cluster, under it. */}
              <span className="relative">
                <Picker open={displayOpen} onClose={() => setDisplayOpen(false)} ariaLabel="Columns shown" multi selected={DOCS_COLUMNS.filter((k) => cols[k])} onSelect={toggleColumn} align="end" width={240}
                  sections={[{ label: "Columns shown", options: DOCS_COLUMNS.map((k) => ({ value: k, label: COLUMN_LABEL[k] })) }]} />
              </span>
              <SplitPrimary label="New doc" onClick={() => void createDoc()} busy={creating}>
                <MenuItem icon={FileText} label="Blank doc" onClick={() => void createDoc()} />
                <MenuItem icon={LayoutTemplate} label="From template…" onClick={() => openTemplateCenter({ kind: "DOC" })} />
                <UpcomingOnly>
                  <MenuSeparator />
                  <ComingSoonRow label="Import…" icon={ImportIcon} />
                </UpcomingOnly>
              </SplitPrimary>
            </>
          ),
          menu: [
            { label: "Display", icon: SlidersHorizontal, onClick: () => setDisplayOpen(true) },
            { label: "Browse templates", icon: LayoutTemplate, href: "/templates?kind=doc" },
            { label: "Trash", icon: Trash2, href: "/trash?type=doc" },
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="docs"
          activeCount={activeFilters}
          onClearAll={() => setParams({ location: null, owner: null, updatedFrom: null, updatedTo: null, includeChildren: null })}
          search={{ value: filterSearch, onChange: setFilterSearch, placeholder: "Search fields" }}
        >
          {"location".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Location">
              <FilterRow label="No location" checked={location === "none"} onCheckedChange={(on) => setParams({ location: on ? "none" : null })} />
              {(spaces ?? []).map((s) => (
                <FilterRow key={s.id} label={<span className="inline-flex items-center gap-2"><EntityTile size="xs" icon={s.icon} color={s.color} name={s.name} fallback="folder" />{s.name}</span>} checked={location === `SPACE:${s.id}`} onCheckedChange={(on) => setParams({ location: on ? `SPACE:${s.id}` : null })} />
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
                  <label className="flex items-center gap-2 text-sm text-ink-2">To <input type="date" value={(updatedTo ?? "").slice(0, 10)} onChange={(e) => setParams({ updatedTo: e.target.value ? `${e.target.value}T23:59:59` : null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                </div>
              </FilterRow>
            </FilterGroup>
          ) : null}
          {"include sub-docs".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Sub-docs">
              <FilterRow label="Include sub-docs" checked={includeChildren} onCheckedChange={(on) => setParams({ includeChildren: on ? "1" : null })} />
            </FilterGroup>
          ) : null}
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col">
          {loadError ? (
            <OsEmptyView variant="error" context="docs" title="Couldn't load your docs" action={{ label: "Retry", onClick: () => void load() }} />
          ) : showQuietEmpty ? (
            <OsEmptyView context="docs" title="No docs yet" action={{ label: "Create a doc", onClick: () => void createDoc() }} />
          ) : (
            <TableCard<DocRow>
              ariaLabel={VIEW_LABEL[view]}
              columns={columns}
              rows={rows}
              rowKey={(d) => d.id}
              rowHref={(d) => `/docs/${d.id}`}
              selectable
              selected={selected}
              onSelectedChange={setSelected}
              sort={{ key: sort, dir }}
              onSort={(key) => setParams(key === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: key, dir: null })}
              onRowContextMenu={(d, e) => menu.openAt(e, toTarget(d))}
              rowMenu={(d) => <RowMenuTrigger onOpen={(ref) => menu.openFrom(ref, toTarget(d))} open={menu.state?.doc.id === d.id} />}
              empty={emptyNode}
              footer={{ total, noun: "docs", from, to, onPrev: goPrev, onNext: goNext, pageSize: limit, pageSizes: PAGE_SIZES, onPageSize: (n) => setParams({ limit: n === PAGE_SIZES[0] ? null : String(n) }) }}
              bulkActions={
                <>
                  <span className="relative">
                    <BulkAction icon={FolderInput} label="Move to…" onClick={() => setBulkMoveOpen((o) => !o)} />
                    <Picker open={bulkMoveOpen} onClose={() => setBulkMoveOpen(false)} ariaLabel="Move selected docs" side="top" onSelect={(v) => void bulkMove(v)}
                      sections={[{ options: [{ value: "none", label: "No location" }] }, { label: "Spaces", options: (spaces ?? []).map((s) => ({ value: s.id, label: s.name, glyph: <EntityTile size="xs" icon={s.icon} color={s.color} name={s.name} fallback="folder" /> })) }]} />
                  </span>
                  <BulkAction icon={Star} label="Add to favorites" onClick={() => void bulkFavorite()} />
                  <BulkAction icon={Trash2} label="Move to Trash" destructive onClick={() => void bulkTrash()} />
                </>
              }
            />
          )}
        </div>
      </div>

      <DocRowMenuHost
        menu={menu}
        context="table"
        onChanged={() => void load()}
        onShare={(d) => { shareAnchor.current = (menu.state?.anchor?.current as HTMLButtonElement | null) ?? null; const row = rows?.find((r) => r.id === d.id) ?? null; setShareFor(row); }}
      />
      {shareFor ? (
        <DocShareModal
          docId={shareFor.id}
          docTitle={shareFor.title || "Untitled doc"}
          createdById={shareFor.ownerId}
          meId={meId}
          open
          onClose={() => setShareFor(null)}
          anchorRef={shareAnchor}
          viewerRole={shareFor.myRole}
        />
      ) : null}
    </>
  );
}

/* ───────────────────────────── bits ───────────────────────────── */

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
      <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="h-9 w-[200px] max-md:w-36 rounded-md border border-line-strong bg-raised ps-8 pe-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
    </label>
  );
}

function RowMenuTrigger({ onOpen, open }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Doc actions" />;
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
