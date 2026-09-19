"use client";

// DocsSidebar — the ClickUp-style left panel for the Docs section.
//
// Header ("Docs" + create button) is rendered by ClickSidebarBody; this is the
// scrolling body: a fixed nav (All Docs / My Docs / Shared with me / Private /
// Meeting Notes) that drives the main list via ?view=, then Favorites, Recent
// Pages and Popular Wikis sections, and one Trash row at the foot.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  FileText, User, Users, Lock, NotebookPen, Star, BookOpen,
  MoreHorizontal, ChevronRight, Plus, Brush, Folder, Video, ScrollText,
  ShieldCheck, FileSignature, Workflow, BarChart3, Trash2, type LucideIcon,
} from "lucide-react";
import { canAccessTier } from "./access-tiers";
import { useActiveRowHref } from "./use-active-row";
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

// The folded apps' rows, in one list per section but resolved as one set, so
// exactly one lights (spec-shell §1.1). The query rows (?tab=, ?view=) used to
// pass no active prop at all, which is why /library stayed lit under all four
// Library tabs. `/clips` is gone from the Clips row: there is no such route.
//
// One label, one door (naming-canon 2.5, 2.14; sidebar-map 6): Canvases is
// /canvas and Files is /files, the same hrefs the palette and the Docs "+"
// use, and Notetaker is one row (the page never read ?mine=1, so "My Clips"
// was a second row to the same destination). The Library and Notes rows
// stay until the Docs unit re-parents /library (Phase 2).
const CONTENT_ROWS = [
  { href: "/library", label: "Library", Icon: BookOpen, match: "exact" as const },
  { href: "/library?tab=notes", label: "Notes", Icon: FileText },
  { href: "/canvas", label: "Canvases", Icon: Brush },
  { href: "/files", label: "Files", Icon: Folder },
  { href: "/notetaker", label: "Notetaker", Icon: Video },
];

// `managerOnly`: the page behind the row answers 404 (/process-runs) or 403
// (/sops/compliance) below the manager tier, and a row that lands on a
// denial is worse than no row (sidebar-map 0, 6 rows 11 and 12).
const PROCESS_ROWS: Array<{
  href: string; label: string; Icon: LucideIcon;
  match?: "exact" | "prefix"; hrAdminOnly?: boolean; managerOnly?: boolean;
}> = [
  { href: "/sops", label: "All SOPs", Icon: ScrollText, match: "exact" },
  { href: "/sops/my-sops", label: "My SOPs", Icon: ScrollText },
  { href: "/process-runs", label: "Run history", Icon: Workflow, managerOnly: true },
  { href: "/sops/compliance", label: "SOP compliance", Icon: ShieldCheck, managerOnly: true },
  { href: "/policies", label: "All policies", Icon: ShieldCheck, match: "exact", hrAdminOnly: true },
  { href: "/policies/compliance", label: "Policy compliance", Icon: BarChart3, hrAdminOnly: true },
  { href: "/agreements", label: "All contracts", Icon: FileSignature, match: "exact", hrAdminOnly: true },
  { href: "/agreements?view=templates", label: "Contract templates", Icon: Folder, hrAdminOnly: true },
  // ONE Trash row, for every hub, with ONE label (naming-canon 2.12: "there
  // is no second Trash row in any other hub sidebar"; sidebar-map section 6
  // row 18 gives the Docs hub exactly `Trash` -> /trash?type=doc).
  //
  // This row used to read "Contract trash" and point at the contracts cut,
  // which left a Docs person reaching for their own deleted docs looking at a
  // row named after contracts, and left the docs cut with no row at all. The
  // contracts cut is not lost: /agreements?view=trash still 308s to
  // /trash?type=contract, and the Trash page's own type filter carries every
  // type including Contracts. It is not hrAdminOnly either, because Trash is
  // a Member's page and each row inside it is gated on its own.
  { href: "/trash?type=doc", label: "Trash", Icon: Trash2 },
];

const DOCS_HUB_ROWS = [...CONTENT_ROWS, ...PROCESS_ROWS];

export function DocsSidebar() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const params = useSearchParams();
  const { query } = useSidebarSearch();
  const { data: session } = useSession();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  const isHrAdmin = canAccessTier("hr-admin", accessLevel);
  const isManager = canAccessTier("manager", accessLevel);
  const activeHubHref = useActiveRowHref(DOCS_HUB_ROWS);
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

  // The Docs app's sidebar-header "+" dispatches this event — create a
  // fresh top-level page and jump into it, exactly like the Pages tree's
  // own "New page" row (?new=1 focuses the title in the editor).
  useEffect(() => {
    const onNew = () => {
      void (async () => {
        const id = await createChildPage(null);
        if (id) router.push(`/docs/${id}?new=1`);
        void load();
      })();
    };
    window.addEventListener("workwrk:os:new:docs-new-page", onNew);
    return () => window.removeEventListener("workwrk:os:new:docs-new-page", onNew);
  }, [router, load]);

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
    // No "Archived" row. /docs?view=archived now 308s to the one Trash, so
    // this row ejected the reader out of the Docs hub into Work: the rail
    // pill flipped, this sidebar was replaced, and the row could never go
    // active because its URL no longer resolved to itself. Archived docs are
    // reached from the Trash row at the foot of this sidebar, on its
    // Archived tab.
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
                className={`flex items-center gap-3 h-9 px-3 rounded-lg ${
                  active ? "bg-side-pill text-ink font-medium" : "text-ink hover:bg-hover"
                }`}
              >
                <n.Icon className="w-5 h-5 text-ink-2 shrink-0" strokeWidth={1.5} />
                <span className="flex-1 truncate">{n.label}</span>
                {n.badge && n.badge > 0 ? (
                  <span className="text-xs font-medium text-ink-2 tabular-nums">{n.badge}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Content — Library (all/notes/canvases/files) + Clips, folded into Docs.
          Every link the Library and Clips sidebars had is kept. */}
      <SectionLabel>Content</SectionLabel>
      <ul className="flex flex-col gap-0.5">
        {CONTENT_ROWS.map((r) => (
          <HubLink key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHubHref} />
        ))}
      </ul>

      {/* Process — SOPs / Policies / Contracts. Every link their sidebars had is kept. */}
      <SectionLabel>Process</SectionLabel>
      <ul className="flex flex-col gap-0.5">
        {PROCESS_ROWS.filter((r) => (isHrAdmin || !r.hrAdminOnly) && (isManager || !r.managerOnly)).map((r) => (
          <HubLink key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHubHref} />
        ))}
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
        <ul aria-hidden>{["60%","40%","80%"].map((w, i) => (<li key={i} className="flex h-9 items-center gap-3 px-3"><span className="h-5 w-5 shrink-0 rounded-md bg-skeleton os-skeleton-pulse" /><span className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} /></li>))}</ul>
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
  return (
    <div className="mb-2 mt-6 flex h-5 items-center gap-2 ps-3 pe-1 first:mt-2">
      <span className="text-micro uppercase tracking-[0.06em] text-ink-2">{children}</span>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </div>
  );
}

// A plain nav row for a folded app's link — matches the primary nav styling.
function HubLink({ href, label, Icon, active }: { href: string; label: string; Icon: LucideIcon; active?: boolean }) {
  return (
    <li>
      <Link
        href={href}
        className={`flex items-center gap-3 h-9 px-3 rounded-lg ${
          active ? "bg-side-pill text-ink font-medium" : "text-ink hover:bg-hover"
        }`}
      >
        <Icon className="w-5 h-5 text-ink-2 shrink-0" strokeWidth={1.5} />
        <span className="flex-1 truncate">{label}</span>
      </Link>
    </li>
  );
}

function EmptyCard({ text }: { Icon?: LucideIcon; text: string }) {
  // One quiet 36px line (spec-shell 1.2 rule 6); no card, no illustration.
  return (
    <div className="flex h-9 items-center px-3 text-sm text-ink-2">
      <p className="m-0 truncate">{text}</p>
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
    // ?new=1 -> destination editor focuses the title (see block-doc-editor).
    if (id) onOpen(`${id}?new=1`);
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
        className="mt-0.5 flex w-full items-center gap-3 h-9 px-3 rounded-lg text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
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
      className={`group/page flex items-center gap-1 h-9 pe-1 rounded-lg cursor-pointer ${
        active ? "bg-zinc-100 text-zinc-900" : "text-ink hover:bg-hover"
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
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? "rotate-90" : "rtl:rotate-180"}`} />
      </button>
      <span className="w-4 shrink-0 grid place-items-center text-base [&_svg]:w-3.5 [&_svg]:h-3.5 [&_img]:w-4 [&_img]:h-4 [&_img]:rounded-[3px] [&_img]:object-cover">
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
      className={`group/doc flex items-center gap-3 h-9 px-3 rounded-lg cursor-pointer ${
        active ? "bg-zinc-100 text-zinc-900" : "text-ink hover:bg-hover"
      }`}
      onClick={onOpen}
      onContextMenu={onMenu}
    >
      <span className="w-4 shrink-0 grid place-items-center text-base [&_svg]:w-3.5 [&_svg]:h-3.5 [&_img]:w-4 [&_img]:h-4 [&_img]:rounded-[3px] [&_img]:object-cover">
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
