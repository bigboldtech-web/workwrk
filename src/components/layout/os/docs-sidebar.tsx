"use client";

// DocsSidebar: the Docs hub's secondary sidebar.
//
// Spec: docs/plans/ui-refresh/sidebar-map.md section 6 (the row table),
// spec-docs-knowledge.md section 1 (hub sidebar contents) and spec-process.md
// section 1 (the eight PROCESS rows this file renders by reference).
//
// The order is sidebar-map's, top to bottom, and it is the rule every hub
// obeys: the unlabelled personal block first, then FAVORITES when non-empty,
// then the labelled sections.
//
//   (personal) All docs · Recent · Mine · Shared with me
//   FAVORITES  starred Docs, Canvases and Files, newest star first
//   CONTENT    Canvases · Files (+ the drive folder tree) · Notetaker
//   PROCESS    SOPs · My SOPs · Run history · SOP compliance · Policies ·
//              Policy compliance · Contracts · Contract templates
//   DOCS       the doc tree, root docs expandable to sub-docs
//   [rule]     Trash -> /trash?type=doc
//
// WHAT LEFT, and where each destination lives now (nothing is stranded):
//   "Library" and "Notes" rows  -> /library is retired; its four tabs are
//                                  All docs, Canvases, Files and the Tables
//                                  hub. The row hrefs 308 there.
//   "Private"                   -> Mine, plus the Location filter. The view
//                                  meant "mine and unanchored".
//   "Meeting Notes"             -> All docs. It was a title regex, never a
//                                  view; a meeting note is a template.
//   "Popular Wikis" stub card   -> deleted. It rendered a promise with no
//                                  query behind it.
//   "Star a Doc to see it here" -> deleted. The section simply does not
//                                  render when it is empty (1.2 rule 2).
//   the hover "+" on tree rows  -> "New doc inside", inside the row's one
//                                  "..." menu, where a keyboard and a touch
//                                  user can also reach it.
//
// TWO BADGES, NO NEW POLLER. My SOPs and Policies read `counts.mySops` and
// `counts.policiesToAck` from the boot payload, which the shell already
// refreshes over SSE with a 60s fallback (spec-process section 4: "the badge
// must not add a sixth poller; it rides the existing one").
//
// EVERY REMEMBERED PIECE OF THIS SIDEBAR IS A PREFERENCE, not localStorage
// and not React state that a reload throws away (sidebar-map section 0,
// "Persistence"). Four keys, all through PATCH /api/preferences:
//
//   sidebar.docsTreeOpen      expanded rows of the DOCS tree
//   sidebar.docsFoldersOpen   expanded drive folders under the Files row
//   sidebar.docsFilesOpen     whether the Files row itself is open
//   sidebar.collapsedSections the DOCS section's own collapse, keyed
//                             "docs.docs" like every other hub's sections
//
// The last two were useState, which is why the Files row shut on every load
// and took the folder ids that WERE persisted down with it. The old
// localStorage key "workwrk:docs:pages-open" is read ONCE on mount and
// migrated, so nobody loses the tree they had open.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  FileText, User, Users, Clock, Star, Frame, Folder, Mic,
  MoreHorizontal, ChevronRight, Plus, ScrollText, ListChecks,
  ShieldCheck, BookOpenCheck, FileSignature, Workflow, BarChart3,
  LayoutTemplate, Trash2, Link2, type LucideIcon,
} from "lucide-react";
import { canAccessTier } from "./access-tiers";
import { useActiveRowHref } from "./use-active-row";
import { useSidebarSearch } from "./sidebar-search-context";
import { onSidebarRefresh } from "./sidebar-refresh";
import { useOsShell } from "./shell-context";
import { useBoot } from "./boot-context";
import {
  SidebarRow, SidebarGhostRow, SidebarSectionLabel, SidebarEmptyLine,
  SidebarErrorLine, SidebarSkeletonRows,
} from "./sidebar-primitives";
import { DocRowMenuHost, useDocRowMenu } from "@/components/docs/doc-row-menu";
import { FileRowMenuHost, useFileRowMenu } from "@/components/files/file-row-menu";
import { MorePortal } from "./more-portal";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { createChildPage } from "@/components/docs/doc-pages-panel";
import { renderNoteIcon } from "@/components/docs/note-icon";
import { SopKindChooserHost } from "@/components/sops/sop-kind-chooser";
import {
  readDocsTreeOpen, readDocsFoldersOpen, readDocsFilesOpen,
  isSectionCollapsed, toggleSectionCollapsed, toggleExpanded,
} from "@/lib/docs-prefs";
import { useOsToast } from "./toast";

type DocRow = {
  id: string;
  title: string;
  emoji?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  ownerId?: string | null;
  parentId?: string | null;
  updatedAt: string;
  favorite?: boolean;
  myRole?: "edit" | "comment" | "view";
  canManage?: boolean;
};

type DocCounts = { all: number; recent: number; my: number; shared: number; favorites: number };

/**
 * ONE QUERY FOR THE TREE AND THE BADGES. The tree rows and the Mine /
 * Shared with me counts come from the same GET /api/docs?view= the /docs page
 * reads (spec-docs-knowledge section 2: "the sidebar badge counts and the
 * page counts come from the same query"), paged through to the end so the
 * tree is whole. The rows carry the viewer's role, so the row menu gates its
 * rows exactly as the /docs table does.
 */
async function loadDocRows(): Promise<{ rows: DocRow[]; counts: DocCounts | null }> {
  const rows: DocRow[] = [];
  let counts: DocCounts | null = null;
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const qs = new URLSearchParams({ view: "all", includeChildren: "1", sort: "name", dir: "asc", limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(`/api/docs?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json() as { data?: DocRow[]; nextCursor?: string | null; counts?: DocCounts };
    rows.push(...(d.data ?? []));
    if (page === 0 && d.counts) counts = d.counts;
    cursor = d.nextCursor ?? null;
    if (!cursor) break;
  }
  return { rows, counts };
}

type FolderRow = {
  id: string;
  name: string;
  parentId: string | null;
  _count?: { files?: number; children?: number };
};

type FavoriteRow = { kind: string; id: string; name: string; href: string; icon: string | null };

/** The personal block: four views of the same table, all reachable by URL. */
const VIEW_ROWS: Array<{
  href: string; label: string; Icon: LucideIcon;
  match?: "exact" | "prefix";
  /** Rows 3 and 4 carry a count (sidebar-map section 6). */
  count?: "mine" | "shared";
}> = [
  { href: "/docs", label: "All docs", Icon: FileText, match: "exact" },
  { href: "/docs?view=recent", label: "Recent", Icon: Clock },
  { href: "/docs?view=my", label: "Mine", Icon: User, count: "mine" },
  { href: "/docs?view=shared", label: "Shared with me", Icon: Users, count: "shared" },
];

/**
 * CONTENT. "Library" and "Notes" are gone: the page is retired and both rows
 * pointed at lists the other three rows already carry.
 */
const CONTENT_ROWS: Array<{ href: string; label: string; Icon: LucideIcon; app: string; needsAi?: boolean }> = [
  // The app key each row needs on the rail (sidebar-map section 6, rows 6 to
  // 8). Hiding or flooring an app in Settings > Admin > Apps has to take its
  // row with it: a row whose destination renders AppOff is a door that is
  // locked from the inside. Notetaker also needs the AI module, which is what
  // /notetaker itself gates on.
  { href: "/canvas", label: "Canvases", Icon: Frame, app: "docs" },
  { href: "/files", label: "Files", Icon: Folder, app: "library" },
  { href: "/notetaker", label: "Notetaker", Icon: Mic, app: "clips", needsAi: true },
];

/**
 * PROCESS, contributed by the process unit (spec-process section 1), in its
 * order, with its gates.
 *
 * `managerOnly` / `hrAdminOnly` are the legacy tier helper, which is what the
 * shell still gates on; the access engine stays inert until its own step.
 * What DID change is who passes:
 *
 *   Policies and Policy compliance were both `hrAdminOnly`, so the people who
 *   have to ACKNOWLEDGE a policy had no route to one at all (knowledge High
 *   #6). Policies is a Member row, which is also what APP_RULES already says
 *   (src/lib/access/settings.ts: `policies` audience "member").
 *
 *   Run history was `managerOnly` for the same reason its layout 404'd every
 *   Member: both hid a person's OWN runs from them. The layout gate is gone
 *   and so is this one; the API scopes the rows per role.
 */
//
// NO `match: "exact"` ON THE THREE ROOT ROWS, and that is the spec, not an
// omission. spec-process section 1 ("Active row resolution") puts
// `/sops/[id]`, `/sops/new/*` and `/sops/manage` on SOPs, `/policies/[id]`
// and `/policies/[id]/compliance` on Policies, and `/agreements/[id]` on
// Contracts. With "exact" every one of those detail routes lit no row at all.
// Prefix matching cannot steal a sibling: `resolveActiveRow` takes the
// LONGEST path, so `/sops/my-sops`, `/sops/compliance` and
// `/policies/compliance` still win their own rows, and `/agreements` with
// `?view=templates` still resolves to Contract templates because that row's
// query is the tie-break on an equal path.
const PROCESS_ROWS: Array<{
  href: string; label: string; Icon: LucideIcon;
  match?: "exact" | "prefix"; hrAdminOnly?: boolean; managerOnly?: boolean;
  badge?: "mySops" | "policiesToAck";
}> = [
  { href: "/sops", label: "SOPs", Icon: ScrollText },
  { href: "/sops/my-sops", label: "My SOPs", Icon: ListChecks, badge: "mySops" },
  { href: "/process-runs", label: "Run history", Icon: Workflow },
  { href: "/sops/compliance", label: "SOP compliance", Icon: ShieldCheck, managerOnly: true },
  { href: "/policies", label: "Policies", Icon: BookOpenCheck, badge: "policiesToAck" },
  { href: "/policies/compliance", label: "Policy compliance", Icon: BarChart3, managerOnly: true },
  { href: "/agreements", label: "Contracts", Icon: FileSignature, hrAdminOnly: true },
  { href: "/agreements?view=templates", label: "Contract templates", Icon: LayoutTemplate, hrAdminOnly: true },
];

// ONE Trash row, for every hub, with ONE label (naming-canon 2.12; sidebar-map
// section 6 row 18). It is a jump OUT of this hub to the Work hub's one
// /trash, pre-filtered to Doc; the Type filter there reaches Canvas, File and
// every other kind. Ungated beyond the app key, because Trash is a Member's
// page and each row inside it is gated on its own.
const TRASH_ROW = { href: "/trash?type=doc", label: "Trash", Icon: Trash2 };

/**
 * Favorites is a real /docs view with no row of its own: the FAVORITES section
 * below lists the starred objects themselves. It is declared here anyway so
 * `resolveActiveRow` sees it. Without it `/docs?view=favorites` matched the
 * "All docs" row exactly (same path, no query declared) and lit it, which is
 * the "exactly one row is active, or none" rule failing in the "wrong one"
 * direction. With it, the longest-href tie-break picks this phantom and no
 * visible row lights, which is the honest answer.
 */
const FAVORITES_VIEW_ROW = { href: "/docs?view=favorites", match: "exact" as const };

const ALL_ROWS = [...VIEW_ROWS, ...CONTENT_ROWS, ...PROCESS_ROWS, TRASH_ROW, FAVORITES_VIEW_ROW];

/** The localStorage key the doc tree used before it became a preference. */
const LEGACY_TREE_LS = "workwrk:docs:pages-open";

/** `sidebar.collapsedSections` is keyed `{hub}.{section}` for every hub. */
const DOCS_SECTION_KEY = "docs.docs";
const FAV_SECTION_KEY = "docs.favorites";
const CONTENT_SECTION_KEY = "docs.content";
const PROCESS_SECTION_KEY = "docs.process";

export function DocsSidebar() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { query } = useSidebarSearch();
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  const isHrAdmin = canAccessTier("hr-admin", accessLevel);
  const isManager = canAccessTier("manager", accessLevel);
  const activeHref = useActiveRowHref(ALL_ROWS);
  const noteMenu = useDocRowMenu();
  const { prefs, patchPrefs, launcherApps } = useOsShell();
  // Every app this viewer can reach, RAIL PLUS FOLDED: `library` and `clips`
  // are off-rail by design (they live inside this very sidebar), so they are
  // never in railApps and gating on that list would hide Files and Notetaker
  // from everyone. Settings > Admin > Apps can still hide or floor any of
  // them, and the AI module can be off; a CONTENT row whose app is gone goes
  // with it rather than landing on a denial view.
  const appKeys = useMemo(() => new Set(launcherApps.map((a) => a.key)), [launcherApps]);
  const { counts, boot } = useBoot();
  // spec-process section 1: a Guest never sees the PROCESS rows; My SOPs
  // renders for a Guest only while they hold an assignment. A row that
  // lands on the in-shell 404 is the fabricated chrome this refresh removes.
  const isGuest = boot.viewer.orgRole === "GUEST";

  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [docCounts, setDocCounts] = useState<DocCounts | null>(null);
  const [docsError, setDocsError] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteRow[] | null>(null);
  const [favError, setFavError] = useState(false);

  // No setState before the first await: an effect that calls this must not
  // set state synchronously in its body (react-hooks/set-state-in-effect).
  // The error flag is cleared on the success path instead.
  const loadDocs = useCallback(async () => {
    try {
      const { rows, counts } = await loadDocRows();
      setDocs(rows);
      setDocCounts(counts);
      setDocsError(false);
    } catch { setDocs(null); setDocsError(true); }
  }, []);

  // FAVORITES comes from the ONE aggregate (/api/me/favorites), not from the
  // doc list plus a preference: the section shows starred Canvases and Files
  // too, and neither is in /api/docs. The route also prunes ids whose object
  // is gone and hides ones the viewer can no longer read, which is exactly
  // "a starred object the viewer lost access to is dropped, not locked".
  const loadFavorites = useCallback(async () => {
    try {
      const res = await fetch("/api/me/favorites", { cache: "no-store" });
      if (!res.ok) { setFavorites(null); setFavError(true); return; }
      const d = await res.json();
      setFavorites((d.favorites ?? []) as FavoriteRow[]);
      setFavError(false);
    } catch { setFavorites(null); setFavError(true); }
  }, []);

  useEffect(() => {
    const run = async () => { await Promise.all([loadDocs(), loadFavorites()]); };
    void run();
  }, [loadDocs, loadFavorites]);

  useEffect(() => {
    const onDocs = () => { void loadDocs(); };
    const onFavs = () => { void loadFavorites(); };
    window.addEventListener("workwrk:docs-changed", onDocs);
    window.addEventListener("workwrk:favs-changed", onFavs);
    // Title renames from the doc editor fire the generic sidebar-refresh bus;
    // without this the tree kept the old title until a manual reload.
    const offRefresh = onSidebarRefresh(onDocs);
    return () => {
      window.removeEventListener("workwrk:docs-changed", onDocs);
      window.removeEventListener("workwrk:favs-changed", onFavs);
      offRefresh();
    };
  }, [loadDocs, loadFavorites]);

  // The hub header "+" row "New doc" dispatches this; the DOCS section's own
  // "+ New doc" ghost row calls the same function, so there is one create.
  const newDoc = useCallback(async (parentId: string | null) => {
    const id = await createChildPage(parentId);
    if (id) router.push(`/docs/${id}?new=1`);
    void loadDocs();
  }, [router, loadDocs]);

  useEffect(() => {
    const onNew = () => { void newDoc(null); };
    window.addEventListener("workwrk:os:new:docs-new-page", onNew);
    return () => window.removeEventListener("workwrk:os:new:docs-new-page", onNew);
  }, [newDoc]);

  const q = query.trim().toLowerCase();
  const matches = useCallback((s: string) => !q || s.toLowerCase().includes(q), [q]);

  // The hub search filters the personal block, FAVORITES, CONTENT and the
  // DOCS tree, and NEVER the PROCESS rows (spec-process section 1).
  const viewRows = VIEW_ROWS.filter((r) => matches(r.label));
  const contentRows = CONTENT_ROWS.filter(
    (r) => matches(r.label) && appKeys.has(r.app) && (!r.needsAi || appKeys.has("ai")),
  );
  const favRows = useMemo(
    () => (favorites ?? []).filter((f) => ["doc", "canvas", "file"].includes(f.kind) && matches(f.name)),
    [favorites, matches],
  );
  const processRows = PROCESS_ROWS.filter(
    (r) => (isHrAdmin || !r.hrAdminOnly) && (isManager || !r.managerOnly)
      && (!isGuest || (r.badge === "mySops" && counts.mySops > 0)),
  );

  const badgeFor = (key?: "mySops" | "policiesToAck") =>
    key === "mySops" ? counts.mySops : key === "policiesToAck" ? counts.policiesToAck : null;

  const favIds = useMemo(
    () => new Set((favorites ?? []).filter((f) => f.kind === "doc").map((f) => f.id)),
    [favorites],
  );

  // Rows 3 and 4 carry a number: the `counts` the same /api/docs query gives
  // the page, so the badge and the view pill can never disagree. No count
  // renders until the query answers (a 0 that means "not loaded" is a lie).
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const viewCounts = useMemo(() => ({
    mine: docCounts ? docCounts.my : null,
    shared: docCounts ? docCounts.shared : null,
  }), [docCounts]);

  // Section and row collapse, as preferences rather than as state that a
  // reload discards (sidebar-map section 0).
  const docsCollapsed = isSectionCollapsed(prefs.sidebar, DOCS_SECTION_KEY);
  const toggleDocsSection = useCallback(() => {
    void patchPrefs({ sidebar: { collapsedSections: toggleSectionCollapsed(prefs.sidebar, DOCS_SECTION_KEY) } });
  }, [prefs.sidebar, patchPrefs]);
  // Every section label is a collapse control (sidebar-map section 0), the
  // other three included; each keeps its state under the same
  // `sidebar.collapsedSections` key as DOCS (spec-process section 1 for
  // PROCESS: "collapse persisted under the docs unit's existing sidebar key").
  const favCollapsed = isSectionCollapsed(prefs.sidebar, FAV_SECTION_KEY);
  const contentCollapsed = isSectionCollapsed(prefs.sidebar, CONTENT_SECTION_KEY);
  const processCollapsed = isSectionCollapsed(prefs.sidebar, PROCESS_SECTION_KEY);
  const toggleSection = useCallback((key: string) => {
    void patchPrefs({ sidebar: { collapsedSections: toggleSectionCollapsed(prefs.sidebar, key) } });
  }, [prefs.sidebar, patchPrefs]);

  const filesOpenPref = readDocsFilesOpen(prefs.sidebar);
  const toggleFilesRow = useCallback(() => {
    void patchPrefs({ sidebar: { docsFilesOpen: !filesOpenPref } });
  }, [filesOpenPref, patchPrefs]);

  const [favMenu, setFavMenu] = useState<{ row: FavoriteRow; anchor: RefObject<HTMLElement | null> } | null>(null);

  return (
    <div className="flex flex-col">
      {/* Personal block: no section label, per 1.2 rule 2. The list itself
          does not render when the hub search matches none of its rows: an
          empty <ul> is 8px of nothing above the next section. */}
      {viewRows.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {viewRows.map((r) => (
            <SidebarRow
              key={r.href}
              href={r.href}
              label={r.label}
              icon={r.Icon}
              active={r.href === activeHref}
              count={r.count ? viewCounts[r.count] : null}
            />
          ))}
        </ul>
      ) : null}

      {/* FAVORITES renders only when it has rows. No empty card: an empty
          section is not a place to advertise a feature. */}
      {favError ? (
        <>
          <SidebarSectionLabel collapsed={favCollapsed} onToggle={() => toggleSection(FAV_SECTION_KEY)}>Favorites</SidebarSectionLabel>
          {!favCollapsed ? <ul><SidebarErrorLine what="favorites" onRetry={() => void loadFavorites()} /></ul> : null}
        </>
      ) : favRows.length > 0 ? (
        <>
          <SidebarSectionLabel collapsed={favCollapsed} onToggle={() => toggleSection(FAV_SECTION_KEY)}>Favorites</SidebarSectionLabel>
          {!favCollapsed ? <ul className="flex flex-col gap-0.5">
            {favRows.map((f) => (
              <SidebarRow
                key={`${f.kind}-${f.id}`}
                href={f.href}
                label={
                  <span className="inline-flex min-w-0 items-center gap-3">
                    {f.icon ? (
                      <span className="grid h-5 w-5 shrink-0 place-items-center text-base [&_svg]:h-4 [&_svg]:w-4 [&_img]:h-5 [&_img]:w-5 [&_img]:rounded-sm [&_img]:object-cover">
                        {renderNoteIcon(f.icon)}
                      </span>
                    ) : null}
                    <span className="truncate">{f.name || "Untitled"}</span>
                  </span>
                }
                // The object's own emoji takes the glyph slot when it has one,
                // so a doc does not read as FileText here and as its emoji in
                // the DOCS tree ten rows below.
                icon={f.icon ? undefined : f.kind === "canvas" ? Frame : f.kind === "file" ? Folder : FileText}
                // FAVORITES never takes the active pill. The canonical row for
                // the object does (the DOCS tree row for a doc, Canvases for a
                // canvas, Files for a file), and sidebar-map section 0 allows
                // exactly one active row: a starred doc used to light up twice
                // and set aria-current="page" on both.
                trailing={
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFavMenu({ row: f, anchor: { current: e.currentTarget } }); }}
                    aria-label={`Actions for ${f.name || "Untitled"}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                }
              />
            ))}
          </ul> : null}
        </>
      ) : null}

      {/* A section renders only when at least one row inside it does
          (sidebar-map section 0). A hub search that matches no CONTENT row
          used to leave the label and its rule sitting over empty space. */}
      {contentRows.length > 0 ? (
        <>
          <SidebarSectionLabel collapsed={contentCollapsed} onToggle={() => toggleSection(CONTENT_SECTION_KEY)}>Content</SidebarSectionLabel>
          {!contentCollapsed ? <ul className="flex flex-col gap-0.5">
            {contentRows.map((r) =>
              r.href === "/files" ? (
                <FilesRow
                  key={r.href}
                  active={activeHref === "/files"}
                  open={filesOpenPref}
                  onToggle={toggleFilesRow}
                  prefs={prefs}
                  patchPrefs={patchPrefs}
                />
              ) : (
                <SidebarRow key={r.href} href={r.href} label={r.label} icon={r.Icon} active={r.href === activeHref} />
              ),
            )}
          </ul> : null}
        </>
      ) : null}

      {/* PROCESS renders only the rows the viewer passes, and not at all when
          that is none (a Guest with no assignment sees no label). */}
      {processRows.length > 0 ? (
        <>
          <SidebarSectionLabel collapsed={processCollapsed} onToggle={() => toggleSection(PROCESS_SECTION_KEY)}>Process</SidebarSectionLabel>
          {!processCollapsed ? <ul className="flex flex-col gap-0.5">
            {processRows.map((r) => (
              <SidebarRow
                key={r.href}
                href={r.href}
                label={r.label}
                icon={r.Icon}
                active={r.href === activeHref}
                count={badgeFor(r.badge)}
              />
            ))}
          </ul> : null}
        </>
      ) : null}

      <SidebarSectionLabel collapsed={docsCollapsed} onToggle={toggleDocsSection}>Docs</SidebarSectionLabel>
      {!docsCollapsed ? (
        docsError ? (
          <ul><SidebarErrorLine what="docs" onRetry={() => void loadDocs()} /></ul>
        ) : docs === null ? (
          <ul><SidebarSkeletonRows /></ul>
        ) : (
          <DocsTree
            docs={docs}
            query={q}
            activePath={pathname}
            favIds={favIds}
            prefs={prefs}
            patchPrefs={patchPrefs}
            onOpen={(id) => router.push(`/docs/${id}`)}
            onMenu={(e, d) => noteMenu.open(e, {
              id: d.id, title: d.title, parentId: d.parentId ?? null, entityType: d.entityType ?? null, entityId: d.entityId ?? null,
              favorite: favIds.has(d.id),
              role: d.canManage ? "full" : d.myRole ?? "view",
              own: !!meId && d.ownerId === meId,
            })}
            onNewDoc={() => void newDoc(null)}
          />
        )
      ) : null}

      {/* The 1px rule above Trash is the section label's own rule; this row
          sits below every section with its own hairline. */}
      <div className="mt-6 h-px bg-line" aria-hidden />
      <ul className="mt-2 flex flex-col gap-0.5">
        <SidebarRow
          href={TRASH_ROW.href}
          label={TRASH_ROW.label}
          icon={TRASH_ROW.Icon}
          active={TRASH_ROW.href === activeHref}
        />
      </ul>

      {/* The Docs "+" row "New SOP" opens this; it lives in the sidebar
          because the sidebar is what is mounted under every Docs-hub route,
          so the row works from /docs, /files, /sops and every other one. */}
      <SopKindChooserHost />

      {favMenu ? (
        <FavoriteRowMenu
          row={favMenu.row}
          anchor={favMenu.anchor}
          onClose={() => setFavMenu(null)}
          onChanged={() => { void loadFavorites(); }}
        />
      ) : null}

      <DocRowMenuHost menu={noteMenu} context="tree" onChanged={() => { void loadDocs(); void loadFavorites(); }} />
    </div>
  );
}

/* ─────────────────────────── FAVORITES row menu ────────────────────────── */

/**
 * The hover "…" on a FAVORITES row: Remove from favorites, Copy link.
 *
 * sidebar-map section 6 row 5 names exactly these two. Without them the only
 * way to unstar from the sidebar was to open the object and find its own star,
 * which is a trip out of the sidebar to undo something the sidebar shows.
 *
 * Portalled and anchored to the row's "...", like the doc row menu, so an
 * overflow-hidden sidebar cannot clip it. It writes through the same per-kind
 * favorite routes the object pages use, so there is one toggle per kind and
 * not two.
 */
const FAVORITE_TOGGLE: Record<string, { url: string; idKey: string } | undefined> = {
  doc: { url: "/api/me/favorites/docs", idKey: "docId" },
  canvas: { url: "/api/me/favorites/whiteboards", idKey: "whiteboardId" },
  file: { url: "/api/me/favorites/files", idKey: "fileId" },
};

function FavoriteRowMenu({
  row, anchor, onClose, onChanged,
}: {
  row: FavoriteRow;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useOsToast();

  async function unstar() {
    const target = FAVORITE_TOGGLE[row.kind];
    if (!target) { onClose(); return; }
    try {
      const res = await fetch(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [target.idKey]: row.id, on: false }),
      });
      if (!res.ok) throw new Error(String(res.status));
      window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      onChanged();
      toast("Removed from favorites");
    } catch {
      // A failed write says so; the row stays where it is.
      toast("Couldn't update favorites");
    }
    onClose();
  }

  function copyLink() {
    navigator.clipboard?.writeText(`${window.location.origin}${row.href}`).catch(() => {});
    toast("Link copied");
    onClose();
  }

  // Anchored to the row's "..." (never the pointer), so a keyboard activation
  // opens it beside the row; MorePortal owns Esc and the outside click.
  return (
    <MorePortal anchorRef={anchor} width={220} open placement="below" onClose={onClose}>
      <MenuList aria-label={`Actions for ${row.name || "Untitled"}`}>
        <MenuItem icon={Star} iconFilled label="Remove from favorites" onClick={() => void unstar()} />
        <MenuItem icon={Link2} label="Copy link" onClick={copyLink} />
      </MenuList>
    </MorePortal>
  );
}

/* ───────────────────────── Files row + drive folder tree ───────────────── */

/**
 * The Files row with the drive folder tree behind its chevron.
 *
 * The tree is the FileFolder hierarchy from GET /api/files/folders, which is
 * the same tree /files renders in its own left rail. Two things persist, and
 * both are preferences (sidebar-map section 0), so they survive a reload and
 * a second device the way a localStorage key never did: whether this row is
 * open (`sidebar.docsFilesOpen`) and which folders inside it are
 * (`sidebar.docsFoldersOpen`).
 *
 * THE URL OPENS THE ROW TOO. Arriving on /files?folder=<id> expands the row
 * and the folder's whole ancestor chain, so the active folder is on screen
 * rather than hidden behind a chevron nobody clicked. That is the same rule
 * the DOCS tree follows for the open doc, and without it the spec's "active
 * row = the folder in ?folder=" could never render.
 *
 * Folders load ONLY once the row is expanded: a person who never opens it
 * never pays for the request.
 */
function FilesRow({
  active, open, onToggle, prefs, patchPrefs,
}: {
  active: boolean;
  open: boolean;
  onToggle: () => void;
  prefs: ReturnType<typeof useOsShell>["prefs"];
  patchPrefs: ReturnType<typeof useOsShell>["patchPrefs"];
}) {
  const params = useSearchParams();
  const activeFolder = params?.get("folder") ?? null;
  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [error, setError] = useState(false);
  // A folder in the URL opens the row, whatever the stored preference says.
  const expanded = open || !!activeFolder;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/files/folders", { cache: "no-store" });
      if (!res.ok) { setFolders(null); setError(true); return; }
      // GET /api/files/folders answers with a BARE ARRAY today, while most
      // routes answer { data }. /files already reads both shapes; so does
      // this, or the tree renders empty against a route that is working.
      const d = await res.json();
      const rows = Array.isArray(d) ? d : (d.data ?? d.folders ?? []);
      setFolders(rows as FolderRow[]);
      setError(false);
    } catch { setFolders(null); setError(true); }
  }, []);

  useEffect(() => {
    if (!expanded || folders !== null || error) return;
    const run = async () => { await load(); };
    void run();
  }, [expanded, folders, error, load]);
  useEffect(() => {
    const onChange = () => { if (expanded) void load(); };
    window.addEventListener("workwrk:files-changed", onChange);
    return () => window.removeEventListener("workwrk:files-changed", onChange);
  }, [expanded, load]);

  const folderMenu = useFileRowMenu();

  const openIds = readDocsFoldersOpen(prefs.sidebar);
  const toggleFolder = (id: string) => {
    void patchPrefs({ sidebar: { docsFoldersOpen: toggleExpanded(openIds, id) } });
  };

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, FolderRow[]>();
    for (const f of folders ?? []) {
      const arr = map.get(f.parentId) ?? [];
      arr.push(f);
      map.set(f.parentId, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [folders]);

  // The ancestors of the folder in `?folder=`, expanded on top of the stored
  // list so the active row is reachable without a click. Computed, never
  // written: nobody's stored preference changes because they followed a link.
  const autoOpen = useMemo(() => {
    const set = new Set<string>();
    if (!activeFolder) return set;
    const byId = new Map((folders ?? []).map((f) => [f.id, f]));
    let cur = byId.get(activeFolder)?.parentId ?? null;
    while (cur && !set.has(cur)) {
      set.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return set;
  }, [activeFolder, folders]);

  const renderLevel = (parentId: string | null, depth: number, seen: Set<string>): React.ReactNode[] =>
    (childrenOf.get(parentId) ?? []).flatMap((f) => {
      if (seen.has(f.id) || depth > 6) return [];
      const next = new Set(seen).add(f.id);
      const kids = childrenOf.get(f.id) ?? [];
      const isOpen = openIds.includes(f.id) || autoOpen.has(f.id);
      const row = (
        <SidebarRow
          key={f.id}
          href={`/files?folder=${encodeURIComponent(f.id)}`}
          label={f.name}
          icon={Folder}
          depth={depth}
          active={activeFolder === f.id}
          count={f._count?.files ?? null}
          trailing={
            // One "..." per row, the same control the DOCS tree rows carry
            // (sidebar-map section 6, row 7: Rename, New folder inside, Move
            // to Trash). Hover and focus reach it; right-click is never the
            // only way in.
            <span className="flex items-center">
              {kids.length > 0 ? (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFolder(f.id); }}
                  aria-label={isOpen ? `Collapse ${f.name}` : `Expand ${f.name}`}
                  aria-expanded={isOpen}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
                >
                  <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : "rtl:rotate-180"}`} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); folderMenu.openFolderAt(e, { id: f.id, name: f.name, parentId: f.parentId }); }}
                aria-label={`Actions for ${f.name}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </span>
          }
        />
      );
      return isOpen && kids.length > 0 ? [row, ...renderLevel(f.id, depth + 1, next)] : [row];
    });

  return (
    <>
      <SidebarRow
        href="/files"
        label="Files"
        icon={Folder}
        // With a folder in the URL the FOLDER row is the active one
        // (sidebar-map section 6 row 7), so the parent steps aside: one pill
        // per sidebar, never two.
        active={active && !activeFolder}
        trailing={
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
            aria-label={expanded ? "Collapse folders" : "Expand folders"}
            aria-expanded={expanded}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : "rtl:rotate-180"}`} />
          </button>
        }
      />
      {expanded ? (
        error ? <SidebarErrorLine what="folders" onRetry={() => void load()} />
        : folders === null ? <SidebarSkeletonRows rows={2} />
        : folders.length === 0 ? <SidebarEmptyLine>No folders yet</SidebarEmptyLine>
        : renderLevel(null, 1, new Set())
      ) : null}
      <FileRowMenuHost menu={folderMenu} onChanged={() => void load()} />
    </>
  );
}

/* ───────────────────────────── DOCS tree ───────────────────────────────── */

/**
 * The DOCS section: root docs the viewer can read, expandable to sub-docs.
 *
 * ONE hover control, not two. The row used to carry a "+" and a "...", which
 * sidebar-map section 0 forbids ("there are no three-icon hover clusters") and
 * which put "add a sub-page" somewhere no keyboard user could reach. It is
 * "New doc inside" inside the one menu now.
 *
 * NO STAR GLYPH ON THE ROW EITHER. A 12px filled star in the count slot read
 * as a numeral beside the real counts two sections above, and it repeated
 * what the FAVORITES section directly overhead already says. The menu still
 * knows: it is what opens on "Remove from favorites".
 *
 * Expansion is `sidebar.docsTreeOpen`, with the ancestor chain of the open doc
 * auto-expanded on top of it, so the current doc is always visible without a
 * setState in an effect. The old localStorage key is migrated once on mount.
 */
function DocsTree({
  docs, query, activePath, favIds, prefs, patchPrefs, onOpen, onMenu, onNewDoc,
}: {
  docs: DocRow[];
  query: string;
  activePath: string;
  favIds: Set<string>;
  prefs: ReturnType<typeof useOsShell>["prefs"];
  patchPrefs: ReturnType<typeof useOsShell>["patchPrefs"];
  onOpen: (id: string) => void;
  onMenu: (e: React.MouseEvent, doc: DocRow) => void;
  onNewDoc: () => void;
}) {
  const stored = readDocsTreeOpen(prefs.sidebar);
  const migrated = useRef(false);

  // One-time migration off localStorage. It runs only when the preference is
  // still empty, so it can never overwrite a choice made on another device,
  // and it removes the old key so it cannot fight the preference later.
  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    if (stored.length > 0) return;
    try {
      const raw = localStorage.getItem(LEGACY_TREE_LS);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      const ids = Object.entries(parsed).filter(([, v]) => v === true).map(([k]) => k);
      localStorage.removeItem(LEGACY_TREE_LS);
      if (ids.length > 0) void patchPrefs({ sidebar: { docsTreeOpen: ids } });
    } catch { /* a malformed key is not worth a broken sidebar */ }
  }, [stored.length, patchPrefs]);

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

  const isOpen = (id: string) => stored.includes(id) || autoOpen.has(id);
  const toggle = (id: string) => {
    // An auto-open ancestor is not in the stored list, so collapsing it has to
    // put it there first and then take it out, or the click would look dead.
    const base = stored.includes(id) || !autoOpen.has(id) ? stored : [...stored, id];
    void patchPrefs({ sidebar: { docsTreeOpen: toggleExpanded(base, id) } });
  };

  // Search mode: flat matches, no nesting, so a deep doc is one click away.
  if (query) {
    const found = docs.filter((d) => (d.title || "Untitled").toLowerCase().includes(query));
    return found.length === 0 ? (
      <ul><SidebarEmptyLine>No docs match</SidebarEmptyLine></ul>
    ) : (
      <ul className="flex flex-col gap-0.5">
        {found.map((d) => (
          <DocTreeRow
            key={d.id} doc={d} depth={0} hasChildren={false} open={false}
            active={activePath === `/docs/${d.id}`}
            onToggle={() => {}} onOpen={() => onOpen(d.id)} onMenu={(e) => onMenu(e, d)}
          />
        ))}
      </ul>
    );
  }

  const renderRows = (rows: DocRow[], depth: number, seen: Set<string>): React.ReactNode[] =>
    rows.flatMap((d) => {
      if (seen.has(d.id) || depth > 6) return [];
      const next = new Set(seen).add(d.id);
      const kids = childrenOf.get(d.id) ?? [];
      const open = isOpen(d.id);
      const row = (
        <DocTreeRow
          key={d.id} doc={d} depth={depth} hasChildren={kids.length > 0} open={open}
          active={activePath === `/docs/${d.id}`}
          onToggle={() => toggle(d.id)} onOpen={() => onOpen(d.id)} onMenu={(e) => onMenu(e, d)}
        />
      );
      return open && kids.length > 0 ? [row, ...renderRows(kids, depth + 1, next)] : [row];
    });

  return (
    <ul className="flex flex-col gap-0.5">
      {roots.length === 0 ? <SidebarEmptyLine>No docs yet</SidebarEmptyLine> : renderRows(roots, 0, new Set())}
      <SidebarGhostRow label="New doc" icon={Plus} onClick={onNewDoc} />
    </ul>
  );
}

function DocTreeRow({
  doc, depth, hasChildren, open, active, onToggle, onOpen, onMenu,
}: {
  doc: DocRow;
  depth: number;
  hasChildren: boolean;
  open: boolean;
  active: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const title = doc.title || "Untitled doc";
  return (
    <SidebarRow
      href={`/docs/${doc.id}`}
      // The doc's own emoji takes the 20px glyph slot when it has one, and
      // FileText stands in when it does not, so every row's label starts on
      // the same x. It rides in the label rather than in `icon`, which is
      // typed to a Lucide component.
      icon={doc.emoji ? undefined : FileText}
      label={
        <span className="inline-flex min-w-0 items-center gap-3">
          {doc.emoji ? (
            <span className="grid h-5 w-5 shrink-0 place-items-center text-base [&_svg]:h-4 [&_svg]:w-4 [&_img]:h-5 [&_img]:w-5 [&_img]:rounded-sm [&_img]:object-cover">
              {renderNoteIcon(doc.emoji)}
            </span>
          ) : null}
          <span className="truncate">{title}</span>
        </span>
      }
      depth={depth}
      active={active}
      onClick={(e) => { if (!e.defaultPrevented) onOpen(); }}
      trailing={
        <span className="flex items-center">
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
              aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
              aria-expanded={open}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : "rtl:rotate-180"}`} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(e); }}
            aria-label={`Actions for ${title}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </span>
      }
    />
  );
}
