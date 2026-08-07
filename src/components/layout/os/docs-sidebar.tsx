"use client";

// DocsSidebar — the ClickUp-style left panel for the Docs section.
//
// Header ("Docs" + create button) is rendered by ClickSidebarBody; this is the
// scrolling body: a fixed nav (All Docs / My Docs / Shared with me / Private /
// Meeting Notes / Archived) that drives the main list via ?view=, then
// Favorites, Recent Pages and Popular Wikis sections.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  FileText, User, Users, Lock, Archive, NotebookPen, Star, BookOpen,
  MoreHorizontal, ChevronRight, Plus, type LucideIcon,
} from "lucide-react";
import { useSidebarSearch } from "./sidebar-search-context";
import { onSidebarRefresh } from "./sidebar-refresh";
import { NoteActionMenu, useNoteMenu } from "@/components/docs/note-actions-menu";
import { createChildPage } from "@/components/docs/doc-pages-panel";
import { renderNoteIcon } from "@/components/docs/note-icon";

type DocRow = {
  id: string;
  title: string;
  emoji?: string | null;
  entityType?: string | null;
  createdById?: string | null;
  parentId?: string | null;
  updatedAt: string;
};

type ViewKey = "all" | "my" | "shared" | "private" | "meeting" | "archived";

export function DocsSidebar() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const params = useSearchParams();
  const { query } = useSidebarSearch();
  const { data: session } = useSession();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const noteMenu = useNoteMenu();

  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [docsRes, prefRes] = await Promise.all([
        fetch("/api/docs", { cache: "no-store" }),
        fetch("/api/preferences", { cache: "no-store" }).catch(() => null),
      ]);
      if (docsRes.ok) {
        const d = await docsRes.json();
        setDocs((d.docs ?? d.data ?? []) as DocRow[]);
      } else setDocs([]);
      if (prefRes?.ok) {
        const p = await prefRes.json();
        setFavIds(new Set<string>(p.effective?.home?.favoriteDocIds ?? []));
      }
    } catch { setDocs([]); }
  }, []);
  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener("workwrk:docs-changed", onChange);
    window.addEventListener("workwrk:favs-changed", onChange);
    // Title renames from the doc editor fire the generic sidebar-refresh
    // event (sidebar-refresh.ts) — without this the Pages tree kept the old
    // title until a manual reload.
    const offRefresh = onSidebarRefresh(onChange);
    return () => {
      window.removeEventListener("workwrk:docs-changed", onChange);
      window.removeEventListener("workwrk:favs-changed", onChange);
      offRefresh();
    };
  }, [load]);

  const activeView: ViewKey | null = pathname === "/docs" ? ((params.get("view") as ViewKey) || "all") : null;

  const { myCount, sharedCount } = useMemo(() => {
    let mine = 0, shared = 0;
    for (const d of docs ?? []) {
      if (d.createdById && d.createdById === meId) mine++;
      else if (d.createdById && d.createdById !== meId) shared++;
    }
    return { myCount: mine, sharedCount: shared };
  }, [docs, meId]);

  const q = query.trim().toLowerCase();
  const favorites = useMemo(
    () => (docs ?? []).filter((d) => favIds.has(d.id) && (!q || d.title.toLowerCase().includes(q))),
    [docs, favIds, q],
  );

  const NAV: Array<{ key: ViewKey; label: string; Icon: LucideIcon; badge?: number }> = [
    { key: "all", label: "All Docs", Icon: FileText },
    { key: "my", label: "My Docs", Icon: User, badge: myCount },
    { key: "shared", label: "Shared with me", Icon: Users, badge: sharedCount },
    { key: "private", label: "Private", Icon: Lock },
    { key: "meeting", label: "Meeting Notes", Icon: NotebookPen },
    { key: "archived", label: "Archived", Icon: Archive },
  ];

  return (
    <div className="flex flex-col">
      {/* Primary nav */}
      <ul className="flex flex-col gap-0.5">
        {NAV.map((n) => {
          const active = activeView === n.key;
          return (
            <li key={n.key}>
              <Link
                href={n.key === "all" ? "/docs" : `/docs?view=${n.key}`}
                className={`flex items-center gap-2 h-8 px-2 rounded-md text-[13px] ${
                  active ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <n.Icon className="w-4 h-4 text-zinc-500 shrink-0" />
                <span className="flex-1 truncate">{n.label}</span>
                {n.badge && n.badge > 0 ? (
                  <span className="text-[11px] text-zinc-400 tabular-nums">{n.badge}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Favorites */}
      <SectionLabel>Favorites</SectionLabel>
      {favorites.length === 0 ? (
        <EmptyCard Icon={Star} text="Star a Doc to see it here" />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {favorites.map((d) => (
            <DocLink key={`fav-${d.id}`} doc={d} onMenu={(e) => noteMenu.open(e, { id: d.id, title: d.title, favorite: true })} onOpen={() => router.push(`/docs/${d.id}`)} active={pathname === `/docs/${d.id}`} />
          ))}
        </ul>
      )}

      {/* Pages — the Notion-style nested tree. Sub-pages live under their
          parent with chevrons; hover a row for "+" (add sub-page) and "…". */}
      <SectionLabel>Pages</SectionLabel>
      {docs === null ? (
        <div className="px-2 py-1.5 text-[11.5px] text-zinc-400">Loading…</div>
      ) : (
        <PagesTree
          docs={docs}
          query={q}
          activePath={pathname}
          onOpen={(id) => router.push(`/docs/${id}`)}
          onMenu={(e, d) => noteMenu.open(e, { id: d.id, title: d.title, favorite: favIds.has(d.id) })}
          onChanged={() => void load()}
        />
      )}

      {/* Popular Wikis */}
      <SectionLabel>Popular Wikis</SectionLabel>
      <EmptyCard Icon={BookOpen} text="Most viewed and active Wikis appear here" />

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{children}</div>;
}

function EmptyCard({ Icon, text }: { Icon: LucideIcon; text: string }) {
  return (
    <div className="mx-0.5 my-1 rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-5 text-center">
      <Icon className="w-4 h-4 mx-auto text-zinc-300" />
      <p className="mt-1.5 text-[11.5px] text-zinc-400 leading-snug">{text}</p>
    </div>
  );
}

const EXPANDED_LS = "workwrk:docs:pages-open";

/**
 * PagesTree — Notion-style nested page list for the docs sidebar.
 * Rows are h-7, children indent under their parent behind a chevron, and
 * hovering a row reveals "+" (add a sub-page) and "…" (actions). While the
 * sidebar search has a query, matches render as a flat list instead.
 */
function PagesTree({ docs, query, activePath, onOpen, onMenu, onChanged }: {
  docs: DocRow[];
  query: string;
  activePath: string;
  onOpen: (id: string) => void;
  onMenu: (e: React.MouseEvent, doc: DocRow) => void;
  onChanged: () => void;
}) {
  // Explicit user toggles (persisted); anything not overridden falls back to
  // "auto-open" — the active doc's ancestor chain stays expanded so the
  // current page is always visible without setState-in-effect.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(EXPANDED_LS) || "{}") as Record<string, boolean>;
      return new Map(Object.entries(raw));
    } catch { return new Map(); }
  });

  const { roots, childrenOf, byId } = useMemo(() => {
    const map = new Map<string, DocRow>();
    for (const d of docs) map.set(d.id, d);
    const kids = new Map<string, DocRow[]>();
    const rootRows: DocRow[] = [];
    for (const d of docs) {
      if (d.parentId && map.has(d.parentId)) {
        const arr = kids.get(d.parentId) ?? [];
        arr.push(d);
        kids.set(d.parentId, arr);
      } else {
        rootRows.push(d);
      }
    }
    const byTitle = (a: DocRow, b: DocRow) => (a.title || "Untitled").localeCompare(b.title || "Untitled");
    rootRows.sort(byTitle);
    for (const arr of kids.values()) arr.sort(byTitle);
    return { roots: rootRows, childrenOf: kids, byId: map };
  }, [docs]);

  // Derived: the active doc's ancestor chain (auto-open unless the user
  // explicitly collapsed a node).
  const activeId = activePath.startsWith("/docs/") ? activePath.slice("/docs/".length) : null;
  const autoOpen = useMemo(() => {
    const set = new Set<string>();
    let cur = activeId ? byId.get(activeId)?.parentId ?? null : null;
    while (cur && !set.has(cur)) {
      set.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return set;
  }, [activeId, byId]);

  const isOpen = useCallback(
    (id: string) => overrides.get(id) ?? autoOpen.has(id),
    [overrides, autoOpen],
  );
  const toggle = useCallback((id: string) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, !(prev.get(id) ?? autoOpen.has(id)));
      try { localStorage.setItem(EXPANDED_LS, JSON.stringify(Object.fromEntries(next))); } catch { /* ignore */ }
      return next;
    });
  }, [autoOpen]);

  const addPage = useCallback(async (parentId: string | null) => {
    const id = await createChildPage(parentId);
    if (id) onOpen(id);
    onChanged();
  }, [onOpen, onChanged]);

  // Search mode: flat matches, no nesting.
  if (query) {
    const matches = docs.filter((d) => (d.title || "Untitled").toLowerCase().includes(query));
    return matches.length === 0 ? (
      <EmptyCard Icon={FileText} text="No pages match" />
    ) : (
      <ul className="flex flex-col gap-0.5">
        {matches.map((d) => (
          <PageRow key={d.id} doc={d} depth={0} hasChildren={false} open={false}
            active={activePath === `/docs/${d.id}`} onToggle={() => {}} onOpen={() => onOpen(d.id)}
            onAdd={() => void addPage(d.id)} onMenu={(e) => onMenu(e, d)} />
        ))}
      </ul>
    );
  }

  const renderRows = (rows: DocRow[], depth: number, seen: Set<string>): React.ReactNode[] =>
    rows.flatMap((d) => {
      if (seen.has(d.id)) return [];
      const nextSeen = new Set(seen).add(d.id);
      const kids = childrenOf.get(d.id) ?? [];
      const open = isOpen(d.id);
      const row = (
        <PageRow key={d.id} doc={d} depth={depth} hasChildren={kids.length > 0} open={open}
          active={activePath === `/docs/${d.id}`} onToggle={() => toggle(d.id)} onOpen={() => onOpen(d.id)}
          onAdd={() => void addPage(d.id)} onMenu={(e) => onMenu(e, d)} />
      );
      return open && kids.length > 0 ? [row, ...renderRows(kids, depth + 1, nextSeen)] : [row];
    });

  return (
    <>
      {roots.length === 0 ? (
        <EmptyCard Icon={FileText} text="Create your first page" />
      ) : (
        <ul className="flex flex-col gap-0.5">{renderRows(roots, 0, new Set())}</ul>
      )}
      <button
        type="button"
        onClick={() => void addPage(null)}
        className="mt-0.5 flex w-full items-center gap-2 h-7 px-2 rounded-md text-[12.5px] text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
      >
        <Plus className="w-3.5 h-3.5 shrink-0" />
        <span>New page</span>
      </button>
    </>
  );
}

function PageRow({ doc, depth, hasChildren, open, active, onToggle, onOpen, onAdd, onMenu }: {
  doc: DocRow;
  depth: number;
  hasChildren: boolean;
  open: boolean;
  active: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onAdd: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <li
      className={`group/page flex items-center gap-1 h-7 pr-1 rounded-md text-[13px] cursor-pointer ${
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
      }`}
      style={{ paddingLeft: 4 + depth * 14 }}
      onClick={onOpen}
      onContextMenu={onMenu}
    >
      <button
        type="button"
        aria-label={hasChildren ? (open ? "Collapse" : "Expand") : undefined}
        tabIndex={hasChildren ? 0 : -1}
        className={`w-4 h-4 grid place-items-center rounded shrink-0 text-zinc-400 ${
          hasChildren ? "hover:bg-zinc-200 hover:text-zinc-700" : "pointer-events-none opacity-0"
        }`}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      <span className="w-4 shrink-0 grid place-items-center text-[13px] [&_svg]:w-3.5 [&_svg]:h-3.5 [&_img]:w-4 [&_img]:h-4 [&_img]:rounded-[3px] [&_img]:object-cover">
        {doc.emoji ? renderNoteIcon(doc.emoji) : <FileText className="w-3.5 h-3.5 text-zinc-400" />}
      </span>
      <span className="truncate flex-1">{doc.title || "Untitled"}</span>
      <span className="hidden group-hover/page:flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          className="w-5 h-5 grid place-items-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
          aria-label="Add page inside"
          title="Add page inside"
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="w-5 h-5 grid place-items-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
          aria-label="Page actions"
          onClick={(e) => { e.stopPropagation(); onMenu(e); }}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </span>
    </li>
  );
}

function DocLink({ doc, active, onOpen, onMenu }: {
  doc: DocRow;
  active: boolean;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <li
      className={`group/doc flex items-center gap-2 h-7 px-2 rounded-md text-[13px] cursor-pointer ${
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
      }`}
      onClick={onOpen}
      onContextMenu={onMenu}
    >
      <span className="w-4 shrink-0 grid place-items-center text-[13px] [&_svg]:w-3.5 [&_svg]:h-3.5 [&_img]:w-4 [&_img]:h-4 [&_img]:rounded-[3px] [&_img]:object-cover">
        {doc.emoji ? renderNoteIcon(doc.emoji) : <FileText className="w-3.5 h-3.5 text-zinc-400" />}
      </span>
      <span className="truncate flex-1">{doc.title || "Untitled"}</span>
      <button
        type="button"
        className="opacity-0 group-hover/doc:opacity-100 w-5 h-5 grid place-items-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 shrink-0"
        aria-label="Doc actions"
        onClick={(e) => { e.stopPropagation(); onMenu(e); }}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}
