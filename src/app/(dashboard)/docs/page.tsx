"use client";

/* Docs — ClickUp-style "All Docs" home.
 *
 * In-page tabs (All / Recent / Favorites / Created by me) plus the left panel
 * (DocsSidebar, in apps-catalog) both set ?view=; this page reads it and
 * renders the matching set as a rich table (Name / Location / Date updated /
 * Date viewed / Contributors) above a row of starter Templates.
 *
 *   GET  /api/docs                list  (?archived=1 for the Archived view)
 *   POST /api/docs                { title, content }
 *   GET  /api/me/recent-docs      recently-viewed ids + timestamps
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  FileText, Plus, ChevronDown, ChevronUp, Check, MoreHorizontal, Search, ListFilter, ArrowUpDown,
  Import as ImportIcon, Link2, Star, Pencil, Clock, User, Rocket, NotebookPen, BookOpen, Loader2,
} from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { NoteActionMenu, useNoteMenu } from "@/components/docs/note-actions-menu";
import { renderNoteIcon } from "@/components/docs/note-icon";
import { EntityTile, type EntityTileFallback } from "@/components/ui/entity-tile";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";

type ApiDoc = {
  id: string;
  title: string;
  excerpt?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  emoji?: string | null;
  location?: { type: string; name: string; icon: string | null; color: string | null; href: string | null } | null;
  createdById?: string | null;
  createdBy?: { name: string | null; avatar?: string | null } | null;
  contributors?: PersonRef[];
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type SortCol = "title" | "location" | "updated";
const SORT_OPTIONS: Array<{ col: SortCol; label: string }> = [
  { col: "updated", label: "Date updated" },
  { col: "title", label: "Name" },
  { col: "location", label: "Location" },
];

type ViewKey = "all" | "recent" | "favorites" | "my" | "shared" | "private" | "meeting" | "archived";
const VIEW_LABEL: Record<ViewKey, string> = {
  all: "All Docs",
  recent: "Recent",
  favorites: "Favorites",
  my: "My Docs",
  shared: "Shared with me",
  private: "Private",
  meeting: "Meeting Notes",
  archived: "Archived",
};

// The in-page tab strip (ClickUp hub). Sidebar-only views (shared/private/
// meeting/archived) render the strip with no active tab — DocsSidebar still
// highlights them.
const HUB_TABS: Array<{ key: ViewKey; label: string; Icon: typeof FileText }> = [
  { key: "all", label: "All", Icon: FileText },
  { key: "recent", label: "Recent", Icon: Clock },
  { key: "favorites", label: "Favorites", Icon: Star },
  { key: "my", label: "Created by me", Icon: User },
];

// "Just now" / "Jun 29" / "Aug 24, 2024" — ClickUp's date column style.
function smartDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  if (Date.now() - d.getTime() < 60_000) return "Just now";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

// Fallback glyph for a location whose entity has no icon of its own.
function locationFallback(type: string): EntityTileFallback | null {
  if (type === "BOARD") return "board";
  if (type === "FOLDER") return "folder";
  if (type === "BOARD_ITEM") return "list";
  return null;
}

// The three starter templates shown as cards (matches ClickUp's Docs home).
const TEMPLATES: Array<{ key: string; title: string; hint: string; Icon: typeof Rocket; tint: string; emoji: string; verified?: boolean }> = [
  { key: "project", title: "Project Overview", hint: "Summarize goals, scope, and milestones", Icon: Rocket, tint: "#F97316", emoji: "🚀" },
  { key: "meeting", title: "Meeting Notes", hint: "Capture an agenda, notes, and action items", Icon: NotebookPen, tint: "#F59E0B", emoji: "📝" },
  { key: "wiki", title: "Wiki", hint: "Organize information in one place", Icon: BookOpen, tint: "#3B82F6", emoji: "📚", verified: true },
];

export default function DocsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session } = useSession();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const view = (params.get("view") as ViewKey) || "all";

  const [rows, setRows] = useState<ApiDoc[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [recentViews, setRecentViews] = useState<Map<string, string>>(new Map()); // docId → ISO viewed-at
  const [creating, setCreating] = useState(false);
  const [newMenu, setNewMenu] = useState(false);
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" }>({ col: "updated", dir: "desc" });
  const [locFilter, setLocFilter] = useState<Set<string>>(new Set()); // location names; empty = all
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const noteMenu = useNoteMenu();

  const load = useCallback(async () => {
    try {
      const [res, prefRes, recentRes] = await Promise.all([
        fetch(`/api/docs${view === "archived" ? "?archived=1" : ""}`, { cache: "no-store" }),
        fetch("/api/preferences", { cache: "no-store" }).catch(() => null),
        fetch("/api/me/recent-docs", { cache: "no-store" }).catch(() => null),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.docs ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
      // Star state — same read path as DocsSidebar (effective.home.favoriteDocIds).
      if (prefRes?.ok) {
        const p = await prefRes.json();
        setFavIds(new Set<string>(p.effective?.home?.favoriteDocIds ?? []));
      }
      // Recently-viewed markers → Recent tab + "Date viewed" column.
      if (recentRes?.ok) {
        const r = await recentRes.json();
        const views: Array<{ id: string; at: string }> = Array.isArray(r?.views) ? r.views : [];
        setRecentViews(new Map(views.map((x) => [x.id, x.at])));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [view]);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("docs");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener("workwrk:docs-changed", onChange);
    window.addEventListener("workwrk:favs-changed", onChange);
    return () => {
      window.removeEventListener("workwrk:docs-changed", onChange);
      window.removeEventListener("workwrk:favs-changed", onChange);
    };
  }, [load]);

  // Child-count per doc → the little "page count" badge next to a title.
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of rows ?? []) {
      if (d.parentId) m.set(d.parentId, (m.get(d.parentId) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const visible = useMemo(() => {
    let base = rows ?? [];
    if (view === "my") base = base.filter((d) => d.createdById && d.createdById === meId);
    else if (view === "favorites") base = base.filter((d) => favIds.has(d.id));
    else if (view === "recent") base = base.filter((d) => recentViews.has(d.id));
    else if (view === "meeting") base = base.filter((d) => /meeting|minutes|stand.?up|1:1/i.test(d.title));
    else if (view === "private") base = base.filter((d) => d.createdById === meId && !d.entityType);
    else if (view === "shared") base = base.filter((d) => !!d.entityType);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((d) => d.title.toLowerCase().includes(q) || (d.excerpt ?? "").toLowerCase().includes(q));
  }, [rows, view, meId, search, favIds, recentViews]);

  // Distinct locations present in the current set → the Filters popover options.
  const NO_LOC = "__none__";
  const locations = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null; icon: string | null; type: string }>();
    let hasNone = false;
    for (const d of visible) {
      if (d.location) m.set(d.location.name, { name: d.location.name, color: d.location.color, icon: d.location.icon, type: d.location.type });
      else hasNone = true;
    }
    return { list: [...m.values()].sort((a, b) => a.name.localeCompare(b.name)), hasNone };
  }, [visible]);

  const toggleSort = (col: SortCol) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "title" || col === "location" ? "asc" : "desc" }));

  // Apply the Location filter + the active sort.
  const displayed = useMemo(() => {
    let base = visible;
    if (locFilter.size > 0) base = base.filter((d) => locFilter.has(d.location?.name ?? NO_LOC));
    // Recent keeps most-recently-VIEWED order under the default sort
    // (ISO timestamps compare lexicographically).
    if (view === "recent" && sort.col === "updated" && sort.dir === "desc") {
      return [...base].sort((a, b) => (recentViews.get(b.id) ?? "").localeCompare(recentViews.get(a.id) ?? ""));
    }
    const sgn = sort.dir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      if (sort.col === "title") return sgn * (a.title || "").localeCompare(b.title || "");
      if (sort.col === "location") return sgn * (a.location?.name ?? "").localeCompare(b.location?.name ?? "");
      return sgn * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    });
  }, [visible, locFilter, sort, view, recentViews]);

  async function createDoc(template?: (typeof TEMPLATES)[number]) {
    if (creating) return;
    setCreating(true);
    setNewMenu(false);
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          template
            ? { title: template.title, content: { blocks: [], meta: { icon: template.emoji } } }
            : { title: "New Doc", content: { blocks: [] } },
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast(`Couldn't create doc${err?.error ? ` — ${err.error}` : ""}`);
        return;
      }
      const data = await res.json();
      const d = data.doc ?? data.data ?? data;
      window.dispatchEvent(new CustomEvent("workwrk:docs-changed"));
      if (d?.id) router.push(`/docs/${d.id}`);
    } catch { toast("Couldn't create doc"); }
    finally { setCreating(false); }
  }

  // Name / Location / Date updated / Date viewed / Contributors / menu
  const COLS = "grid grid-cols-[minmax(220px,1fr)_150px_130px_130px_110px_44px] items-center";

  return (
    <div className="flex flex-col h-full bg-white text-zinc-900">
      {/* Header */}
      <div className="px-5 pt-3.5 pb-2 flex items-center justify-between gap-3">
        <h1 className="text-[17px] font-semibold text-zinc-900">{VIEW_LABEL[view]}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-zinc-200 text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={() => toast("Import is coming soon")}
          >
            <ImportIcon className="w-3.5 h-3.5" /> Import
          </button>
          <div className="relative">
            <div className="inline-flex items-stretch rounded-md overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => void createDoc()}
                disabled={creating}
                className="inline-flex items-center gap-1.5 h-8 pl-3 pr-2.5 bg-zinc-900 text-white text-[12.5px] font-medium hover:bg-zinc-800 disabled:opacity-60"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} New Doc
              </button>
              <button
                type="button"
                onClick={() => setNewMenu((s) => !s)}
                className="inline-flex items-center px-1.5 bg-zinc-900 text-white border-l border-white/15 hover:bg-zinc-800"
                aria-label="New doc options"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            {newMenu ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNewMenu(false)} />
                <div className="absolute right-0 top-9 z-50 w-[220px] rounded-lg border border-zinc-200 bg-white shadow-xl py-1">
                  <button type="button" onClick={() => void createDoc()} className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-50">
                    <FileText className="w-4 h-4 text-zinc-400" /> Blank doc
                  </button>
                  <div className="h-px bg-zinc-100 my-1" />
                  <div className="px-3 pt-0.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">From template</div>
                  {TEMPLATES.map((t) => (
                    <button key={t.key} type="button" onClick={() => void createDoc(t)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-50">
                      <t.Icon className="w-4 h-4" style={{ color: t.tint }} /> {t.title}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Tabs — All / Recent / Favorites / Created by me */}
      <ViewTabStrip className="px-5">
        {HUB_TABS.map((t) => (
          <ViewTab
            key={t.key}
            icon={t.Icon}
            label={t.label}
            active={view === t.key}
            onClick={() => router.push(t.key === "all" ? "/docs" : `/docs?view=${t.key}`)}
          />
        ))}
      </ViewTabStrip>

      {/* Templates */}
      <div className="px-5 pt-3 pb-3">
        <div className="text-[12px] text-zinc-500 mb-1.5">Templates</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => void createDoc(t)}
              className="group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-3 text-left hover:border-zinc-300 hover:shadow-sm transition-all"
            >
              <span
                className="inline-flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
                style={{ background: `color-mix(in srgb, ${t.tint} 15%, transparent)`, color: t.tint }}
              >
                <t.Icon className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[13.5px] font-semibold text-zinc-900">
                  {t.title}
                  {t.verified ? <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-blue-500 text-white text-[8px]">✓</span> : null}
                </span>
                <span className="block text-[12px] text-zinc-500 truncate">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-5 py-2 flex items-center gap-1.5 border-b border-zinc-100">
        {/* Filters — by Location */}
        <div className="relative">
          <button
            type="button"
            onClick={() => { setFilterOpen((s) => !s); setSortOpen(false); }}
            className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12.5px] ${locFilter.size > 0 ? "text-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_10%,transparent)]" : "text-zinc-600 hover:bg-zinc-100"}`}
          >
            <ListFilter className="w-3.5 h-3.5" /> Filters
            {locFilter.size > 0 ? <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-[var(--os-brand)] text-white text-[10px] font-semibold">{locFilter.size}</span> : null}
          </button>
          {filterOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
              <div className="absolute left-0 top-8 z-50 w-[240px] rounded-lg border border-zinc-200 bg-white shadow-xl py-1">
                <div className="px-3 pt-1 pb-1.5 flex items-center justify-between">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">Location</span>
                  {locFilter.size > 0 ? (
                    <button type="button" onClick={() => setLocFilter(new Set())} className="text-[11px] text-[var(--os-brand)] hover:underline">Clear</button>
                  ) : null}
                </div>
                <div className="max-h-[280px] overflow-y-auto">
                  {locations.list.length === 0 && !locations.hasNone ? (
                    <div className="px-3 py-2 text-[12px] text-zinc-400">No locations</div>
                  ) : null}
                  {locations.list.map((l) => {
                    const on = locFilter.has(l.name);
                    return (
                      <button
                        key={l.name}
                        type="button"
                        onClick={() => setLocFilter((prev) => { const n = new Set(prev); if (n.has(l.name)) n.delete(l.name); else n.add(l.name); return n; })}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-50"
                      >
                        <EntityTile size="xs" icon={l.icon} color={l.color} name={l.name} fallback={locationFallback(l.type)} />
                        <span className="flex-1 truncate">{l.name}</span>
                        {on ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)] shrink-0" /> : null}
                      </button>
                    );
                  })}
                  {locations.hasNone ? (
                    <button
                      type="button"
                      onClick={() => setLocFilter((prev) => { const n = new Set(prev); if (n.has(NO_LOC)) n.delete(NO_LOC); else n.add(NO_LOC); return n; })}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-500 hover:bg-zinc-50"
                    >
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-zinc-100 text-zinc-400 text-[10px] shrink-0">–</span>
                      <span className="flex-1 truncate">No location</span>
                      {locFilter.has(NO_LOC) ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)] shrink-0" /> : null}
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Sort */}
        <div className="relative">
          <button
            type="button"
            onClick={() => { setSortOpen((s) => !s); setFilterOpen(false); }}
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12.5px] text-zinc-600 hover:bg-zinc-100"
          >
            <ArrowUpDown className="w-3.5 h-3.5" /> Sort
          </button>
          {sortOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} />
              <div className="absolute left-0 top-8 z-50 w-[200px] rounded-lg border border-zinc-200 bg-white shadow-xl py-1">
                {SORT_OPTIONS.map((o) => {
                  const active = sort.col === o.col;
                  return (
                    <button
                      key={o.col}
                      type="button"
                      onClick={() => { toggleSort(o.col); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-50"
                    >
                      <span className="flex-1">{o.label}</span>
                      {active ? (sort.dir === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--os-brand)]" />) : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
        <div className="flex-1" />
        <div className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-zinc-200 focus-within:border-zinc-300">
          <Search className="w-3.5 h-3.5 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search docs…"
            className="w-[200px] text-[12.5px] bg-transparent outline-none placeholder:text-zinc-400"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {/* Column header — Name / Location / Date updated are click-to-sort */}
        <div className={`${COLS} sticky top-0 z-10 bg-white border-b border-zinc-100 px-5 h-9 text-[11.5px] font-medium text-zinc-400`}>
          <SortHeader label="Name" col="title" sort={sort} onSort={toggleSort} />
          <SortHeader label="Location" col="location" sort={sort} onSort={toggleSort} />
          <SortHeader label="Date updated" col="updated" sort={sort} onSort={toggleSort} />
          <div>Date viewed</div>
          <div>Contributors</div>
          <div />
        </div>

        {loadError ? (
          <div className="px-5 py-10 text-center text-[13px] text-zinc-500">Couldn&apos;t load docs — {loadError}</div>
        ) : rows === null ? (
          <div className="px-5 py-10 text-center text-[13px] text-zinc-400">Loading docs…</div>
        ) : displayed.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <FileText className="w-8 h-8 mx-auto text-zinc-300" />
            <p className="mt-2 text-[13px] text-zinc-500">
              {search.trim() || locFilter.size > 0
                ? "Nothing matches these filters."
                : view === "recent" ? "No recently viewed docs. Docs you open show up here."
                : view === "favorites" ? "No favorite docs yet. Star a doc to pin it here."
                : view === "my" ? "You haven't created any docs yet."
                : view === "archived" ? "Nothing in Archived."
                : `No docs in ${VIEW_LABEL[view]} yet.`}
            </p>
            {!search.trim() && locFilter.size === 0 && (view === "all" || view === "my") ? (
              <button type="button" onClick={() => void createDoc()} className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-zinc-900 text-white text-[12.5px] font-medium hover:bg-zinc-800">
                <Plus className="w-3.5 h-3.5" /> New Doc
              </button>
            ) : null}
          </div>
        ) : (
          displayed.map((d) => {
            const count = childCount.get(d.id) ?? 0;
            const loc = d.location;
            const fav = favIds.has(d.id);
            const viewedAt = recentViews.get(d.id) ?? null;
            return (
              <div
                key={d.id}
                className={`${COLS} group px-5 h-11 border-b border-zinc-100 hover:bg-zinc-50/70 cursor-pointer text-[13px]`}
                onClick={() => router.push(`/docs/${d.id}`)}
                onContextMenu={(e) => noteMenu.open(e, { id: d.id, title: d.title, favorite: fav })}
              >
                {/* Name + hover actions */}
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 shrink-0 text-blue-500">
                    {d.emoji ? <span className="text-[15px] leading-none">{renderNoteIcon(d.emoji)}</span> : <FileText className="w-[18px] h-[18px]" />}
                  </span>
                  <span className="truncate text-zinc-800">{d.title || "Untitled"}</span>
                  {count > 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-zinc-400 shrink-0">
                      <FileText className="w-3 h-3" />{count}
                    </span>
                  ) : null}
                  <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="inline-flex items-center justify-center w-6 h-6 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100" title="Copy link"
                      onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/docs/${d.id}`); toast("Link copied"); } catch { /* ignore */ } }}>
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" className="inline-flex items-center justify-center w-6 h-6 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100" title={fav ? "Remove from favorites" : "Add to favorites"}
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/me/favorites/docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: d.id, on: !fav }) });
                          if (!res.ok) { toast("Couldn't update favorite"); return; }
                          setFavIds((prev) => { const n = new Set(prev); if (fav) n.delete(d.id); else n.add(d.id); return n; });
                          window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
                          toast(fav ? "Removed from favorites" : "Added to favorites");
                        } catch { toast("Couldn't update favorite"); }
                      }}>
                      <Star className={fav ? "w-3.5 h-3.5 text-amber-400 fill-current" : "w-3.5 h-3.5"} />
                    </button>
                    <button type="button" className="inline-flex items-center justify-center w-6 h-6 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100" title="Open"
                      onClick={() => router.push(`/docs/${d.id}`)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>

                {/* Location — the real Space / Folder / Board / item it lives in */}
                <div className="pr-2 min-w-0">
                  {loc ? (
                    loc.href ? (
                      <span
                        className="inline-flex items-center gap-1.5 max-w-full text-[12.5px] text-zinc-700 hover:text-zinc-900 hover:underline"
                        onClick={(e) => { e.stopPropagation(); router.push(loc.href!); }}
                        title={loc.name}
                      >
                        <EntityTile size="xs" icon={loc.icon} color={loc.color} name={loc.name} fallback={locationFallback(loc.type)} />
                        <span className="truncate">{loc.name}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 max-w-full text-[12.5px] text-zinc-700" title={loc.name}>
                        <EntityTile size="xs" icon={loc.icon} color={loc.color} name={loc.name} fallback={locationFallback(loc.type)} />
                        <span className="truncate">{loc.name}</span>
                      </span>
                    )
                  ) : <span className="text-zinc-300">–</span>}
                </div>

                {/* Date updated */}
                <div className="text-zinc-600 text-[12.5px]">{smartDate(d.updatedAt)}</div>

                {/* Date viewed — this viewer's last open (recent-docs marker) */}
                <div>
                  {viewedAt ? (
                    <span className="text-zinc-600 text-[12.5px]">{smartDate(viewedAt)}</span>
                  ) : (
                    <span className="text-zinc-300">–</span>
                  )}
                </div>

                {/* Contributors — everyone who saved a version (creator fallback) */}
                <div>
                  {d.contributors && d.contributors.length > 0 ? (
                    <div className="flex -space-x-1.5">
                      {d.contributors.slice(0, 4).map((p) => (
                        <span key={p.id} className="rounded-full ring-2 ring-white dark:ring-zinc-900">
                          <PersonAvatar person={p} size={20} />
                        </span>
                      ))}
                      {d.contributors.length > 4 ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full ring-2 ring-white dark:ring-zinc-900 bg-zinc-100 text-zinc-500 text-[10px] font-medium">
                          +{d.contributors.length - 4}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-zinc-300">–</span>
                  )}
                </div>

                {/* Row menu */}
                <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center w-6 h-6 rounded-md text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-zinc-700 hover:bg-zinc-100 transition-opacity"
                    aria-label="Doc actions"
                    onClick={(e) => noteMenu.open(e, { id: d.id, title: d.title, favorite: fav })}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {noteMenu.menu && (
        <NoteActionMenu
          target={noteMenu.menu.target}
          x={noteMenu.menu.x}
          y={noteMenu.menu.y}
          onClose={noteMenu.close}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function SortHeader({ label, col, sort, onSort }: {
  label: string;
  col: SortCol;
  sort: { col: SortCol; dir: "asc" | "desc" };
  onSort: (col: SortCol) => void;
}) {
  const active = sort.col === col;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`inline-flex items-center gap-1 text-left transition-colors hover:text-zinc-600 ${active ? "text-zinc-600" : ""}`}
    >
      {label}
      {active ? (sort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
    </button>
  );
}
