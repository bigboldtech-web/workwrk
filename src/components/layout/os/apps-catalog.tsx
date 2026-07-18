"use client";

// Central registry for the ClickUp-style app switcher. Each entry is
// one icon in the left rail; clicking it makes its `Sidebar` the
// secondary column, hovering it shows the same `Sidebar` inside a
// floating preview popover. Keep this file lean — sidebars that grow
// past ~30 lines of UI should move to apps/<key>-sidebar.tsx.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Home, Calendar, Sparkles, Users, FileText, BarChart3, Brush, ClipboardCheck,
  Video, Trophy, Clock,
  Inbox, MessageSquare, CheckSquare, MoreHorizontal,
  Plus, ChevronDown, ChevronRight, Pin, Star, X,
  Megaphone, Briefcase, BookOpen, Wrench, Building2,
  HeartHandshake, GraduationCap, UserCheck, Award, ThumbsUp, FileSpreadsheet,
  HardDrive, Boxes,
  Settings as SettingsIcon,
  ShoppingBag, Workflow, ScrollText,
  ShieldCheck, FileSignature,
  Library as LibraryIcon, Folder, Trash2,
  type LucideIcon,
} from "lucide-react";
import { BloomMark } from "./bloom-mark";
import { usePathname, useRouter } from "next/navigation";
import { NewSpaceDialog } from "./new-space-dialog";
import { NewBoardDialog } from "./new-board-dialog";
import { NewFolderDialog } from "./new-folder-dialog";
import { DocsSidebar } from "./docs-sidebar";
import { ShareSpaceDialog } from "./share-space-dialog";
import { SpaceTreeRow } from "./space-tree-row";
import { onSidebarRefresh, refreshSidebar } from "./sidebar-refresh";
import { useSidebarSearch } from "./sidebar-search-context";
import { useOsShell } from "./shell-context";
import { MorePortal } from "./more-portal";
import { EntityTile } from "@/components/ui/entity-tile";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";

export interface AppEntry {
  key: string;
  label: string;
  /** Allow non-Lucide icons (e.g. BloomMark) for AI-branded entries. */
  Icon: LucideIcon | React.ComponentType<{ className?: string }>;
  /** Where to navigate when the user clicks this rail icon. */
  defaultHref: string;
  /** Path prefixes that auto-select this app when the URL matches. */
  matchPaths: string[];
  /** Renders the secondary sidebar body for this app. */
  Sidebar: React.ComponentType;
  /** Grouping label inside the More popover ("Work", "Sales", …). */
  category?: string;
  /** Pinned to the rail by default for new users. More-popover apps default to false. */
  defaultPinned?: boolean;
  /** Cannot be unpinned — always shown in the rail (e.g. Home). */
  alwaysPinned?: boolean;
  /** Hidden in the More-popover catalog (e.g. the "More" tile itself). */
  hideFromCatalog?: boolean;
  /**
   * What the sidebar header's "+" button does for this app. Either a
   * route (href) or a custom-event name the app's Sidebar component
   * listens for. Absent → button hidden.
   */
  newAction?: { label: string; href?: string; event?: string };
  /**
   * Minimum access tier required to see this app at all. Absent =
   * available to everyone (default).
   *
   *   "manager"   — TEAM_LEAD, MANAGER, DIRECTOR, VP, C_LEVEL, HR, admin
   *   "hr-admin"  — HR + COMPANY_ADMIN + SUPER_ADMIN (people management)
   *   "org-admin" — COMPANY_ADMIN + SUPER_ADMIN only (finance/legal)
   *
   * ICs get the management surface as a top-bar popover instead of a
   * full app entry — see ClickTopbar for the read/light-action versions.
   */
  requiredAccess?: "manager" | "hr-admin" | "org-admin";
}

const MANAGER_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);
const HR_ADMIN_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "HR",
]);
const ORG_ADMIN_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN",
]);

export function canAccessApp(app: AppEntry, accessLevel: string | null | undefined): boolean {
  if (!app.requiredAccess) return true;
  if (!accessLevel) return false;
  if (app.requiredAccess === "manager") return MANAGER_LEVELS.has(accessLevel);
  if (app.requiredAccess === "hr-admin") return HR_ADMIN_LEVELS.has(accessLevel);
  if (app.requiredAccess === "org-admin") return ORG_ADMIN_LEVELS.has(accessLevel);
  return true;
}

/** Window event name format for per-app "new" actions. */
export const NEW_EVENT_PREFIX = "workwrk:os:new:";

/** Helper: build a sidebar component from a static link list. */
function linksSidebar(
  links: Array<{ href: string; label: string; Icon: LucideIcon }>,
): React.ComponentType {
  function Sidebar() {
    return (
      <ul>
        {links.map((l) => (
          <NavItem key={l.href} href={l.href} label={l.label} Icon={l.Icon} />
        ))}
      </ul>
    );
  }
  return Sidebar;
}

/* ───────────────────────── shared sidebar primitives ───────────────────────── */

function NavItem({
  href, label, Icon, active, badge,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active?: boolean;
  badge?: string | number;
}) {
  return (
    <Link
      href={href}
      className={`flex h-7 items-center gap-2 rounded-md px-2 text-[12px] leading-none ${
        active ? "bg-zinc-200/70 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-white/80"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge !== undefined ? <span className="text-[11px] text-zinc-500">{badge}</span> : null}
    </Link>
  );
}

function MoreNavItem() {
  const [open, setOpen] = useState(false);
  const { openCustomize } = useOsShell();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  return (
    <li className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[12px] leading-none text-zinc-700 hover:bg-white/80"
      >
        <MoreHorizontal className="h-4 w-4 shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate text-left">More</span>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={buttonRef} panelRef={panelRef} width={240} open={open} placement="right">
            <MenuList>
              <MenuItem href="#" icon={Inbox} label="Drafts & Sent" disabled title="Coming soon" trailing={<Pin className="w-3.5 h-3.5 text-zinc-400" />} />
              <MenuItem href="/spaces" icon={Folder} label="All Spaces" onClick={() => setOpen(false)} trailing={<Pin className="w-3.5 h-3.5 text-zinc-400" />} />
              <MenuItem href="/tasks" icon={CheckSquare} label="All Tasks" onClick={() => setOpen(false)} trailing={<Pin className="w-3.5 h-3.5 text-zinc-400" />} />
              <MenuSeparator />
              <MenuItem
                href="#"
                icon={SettingsIcon}
                label="Customize"
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  openCustomize();
                }}
              />
            </MenuList>
          </MorePortal>
        </>
      ) : null}
    </li>
  );
}

function MyTasksGroup({ pathname }: { pathname: string }) {
  const isActiveTree =
    pathname === "/tasks" ||
    pathname.startsWith("/tasks/assigned-to-me") ||
    pathname.startsWith("/tasks/today-overdue") ||
    pathname.startsWith("/tasks/personal-list");
  const [expanded, setExpanded] = useState(isActiveTree);

  return (
    <>
      <li className="relative group/taskrow">
        <Link
          href="/tasks"
          className={`flex h-7 items-center gap-2 rounded-md px-2 text-[12px] leading-none ${
            pathname === "/tasks"
              ? "bg-zinc-200/70 text-zinc-900 font-medium"
              : "text-zinc-700 hover:bg-white/80"
          }`}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-500" aria-hidden>
            <CheckSquare className="h-4 w-4 transition-opacity group-hover/taskrow:opacity-0" />
          </span>
          <span className="min-w-0 flex-1 truncate">My Wrk</span>
        </Link>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-label={expanded ? "Collapse My Wrk" : "Expand My Wrk"}
          className="absolute left-2 top-1/2 z-10 flex h-5 w-4 -translate-y-1/2 items-center justify-center rounded-md bg-zinc-200/80 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-900 group-hover/taskrow:opacity-100 focus-visible:opacity-100"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      </li>
      {expanded ? (
        <li>
          <ul className="ml-[18px] border-l border-zinc-200/70 pl-2">
            <SubNavItem
              href="/tasks/assigned-to-me"
              Icon={UserCheck}
              label="Assigned to me"
              active={pathname.startsWith("/tasks/assigned-to-me")}
              iconTint="#f97316"
            />
            <SubNavItem
              href="/tasks/today-overdue"
              Icon={Calendar}
              label="Today & Overdue"
              active={pathname.startsWith("/tasks/today-overdue")}
              iconTint="#3b82f6"
            />
            <SubNavItem
              href="/tasks/personal-list"
              Icon={ClipboardCheck}
              label="Personal List"
              active={pathname.startsWith("/tasks/personal-list")}
            />
          </ul>
        </li>
      ) : null}
    </>
  );
}

function SubNavItem({
  href,
  label,
  Icon,
  active,
  iconTint,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active?: boolean;
  iconTint?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className={`flex h-7 items-center gap-2 rounded-md px-2 text-[12px] leading-none ${
          active ? "bg-zinc-200/70 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-white/80"
        }`}
      >
        <Icon
          className="h-4 w-4 shrink-0"
          style={iconTint ? { color: iconTint } : { color: "var(--os-ink, #71717a)" }}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </Link>
    </li>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-2.5 pb-1 text-[12px] font-semibold text-zinc-500">
      {children}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="px-3 py-6 text-center">
      <div className="text-[12px] font-medium text-zinc-700">{title}</div>
      {body ? <div className="text-[11px] text-zinc-500 mt-1">{body}</div> : null}
    </div>
  );
}

/* ───────────────────────── Home sidebar (Inbox / My Wrk / Favorites / Spaces) ───────────────────────── */

interface SpaceRow {
  id: string;
  slug: string;
  name: string;
  visibility: "PRIVATE" | "WORKSPACE" | "ORG";
  icon: string | null;
  color: string | null;
}

/** Default order if /api/preferences isn't loaded yet or the user hasn't customised. */
const DEFAULT_SECTIONS_ORDER: string[] = ["favorites", "spaces"];

function FavSubLabel({ children }: { children: React.ReactNode }) {
  return (
    <li
      className="px-2 pt-2 pb-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-zinc-400 select-none"
      aria-hidden
    >
      {children}
    </li>
  );
}

function UnstarButton({ kind, id }: { kind: "space" | "board" | "doc" | "folder" | "table" | "whiteboard" | "file"; id: string }) {
  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const body =
        kind === "space" ? { spaceId: id, on: false }
        : kind === "board" ? { boardId: id, on: false }
        : kind === "doc" ? { docId: id, on: false }
        : kind === "folder" ? { folderId: id, on: false }
        : kind === "table" ? { tableId: id, on: false }
        : kind === "whiteboard" ? { whiteboardId: id, on: false }
        : { fileId: id, on: false };
      const res = await fetch(`/api/me/favorites/${kind}s`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      }
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title="Remove from favorites"
      aria-label="Remove from favorites"
      className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/fav:opacity-100 transition-opacity inline-flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
    >
      <X className="w-3 h-3" />
    </button>
  );
}

function HomeSidebar() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { query: searchQuery } = useSidebarSearch();
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favoriteBoards, setFavoriteBoards] = useState<Array<{ id: string; slug: string; name: string; icon: string | null; color: string | null; visibility: string }>>([]);
  const [favoriteSpaces, setFavoriteSpaces] = useState<Array<{ id: string; slug: string; name: string; icon: string | null; color: string | null; visibility: string }>>([]);
  const [favoriteDocs, setFavoriteDocs] = useState<Array<{ id: string; title: string; excerpt: string | null }>>([]);
  const [favoriteFolders, setFavoriteFolders] = useState<Array<{ id: string; name: string; icon: string | null; color: string | null; space: { slug: string } }>>([]);
  const [favoriteTables, setFavoriteTables] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  const [favoriteWhiteboards, setFavoriteWhiteboards] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  const [favoriteFiles, setFavoriteFiles] = useState<Array<{ id: string; name: string; url: string; mimeType: string }>>([]);
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [sectionsOrder, setSectionsOrder] = useState<string[]>(DEFAULT_SECTIONS_ORDER);
  // Per-Space create dialogs — co-hosted at the sidebar level so we
  // don't mount one dialog per row. The SpaceCreateTrigger popover
  // sets the activeSpaceId and which dialog kind to show.
  const [boardDialogSpaceId, setBoardDialogSpaceId] = useState<string | null>(null);
  const [folderDialogSpaceId, setFolderDialogSpaceId] = useState<string | null>(null);
  const [shareDialogSpace, setShareDialogSpace] = useState<SpaceRow | null>(null);

  // The sidebar header "+" dispatches `workwrk:os:new:home-new-space`
  // when Home is active — open the NewSpaceDialog in response.
  useEffect(() => {
    const onNew = () => setNewSpaceOpen(true);
    window.addEventListener("workwrk:os:new:home-new-space", onNew);
    return () => window.removeEventListener("workwrk:os:new:home-new-space", onNew);
  }, []);

  const reload = useCallback(() => {
    fetch("/api/spaces", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setSpaces(Array.isArray(data.spaces) ? data.spaces : []);
      })
      .catch(() => {});
  }, []);

  // Drag-reorder: move `draggedId` to just before/after `targetId`. Updates the
  // list optimistically, then persists the new displayOrder to the server; a
  // failure reloads from the server so the UI never drifts from the truth.
  const reorderSpaces = useCallback(
    (draggedId: string, targetId: string, place: "before" | "after") => {
      setSpaces((prev) => {
        const from = prev.findIndex((s) => s.id === draggedId);
        const targetIdx = prev.findIndex((s) => s.id === targetId);
        if (from < 0 || targetIdx < 0 || draggedId === targetId) return prev;
        const arr = [...prev];
        const [moved] = arr.splice(from, 1);
        let insertAt = arr.findIndex((s) => s.id === targetId);
        if (place === "after") insertAt += 1;
        arr.splice(insertAt, 0, moved);
        const items = arr.map((s, i) => ({ id: s.id, displayOrder: i }));
        fetch("/api/spaces/reorder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items }),
          keepalive: true,
        })
          .then((r) => { if (!r.ok) reload(); })
          .catch(() => reload());
        return arr;
      });
    },
    [reload],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  // Keep the Spaces list live when anything mutates the tree from anywhere.
  useEffect(() => onSidebarRefresh(reload), [reload]);

  // Subscribe to /api/preferences for sectionsOrder. Updates live when
  // CustomizePanel saves (dispatches workwrk:prefs-changed).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/preferences", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const next = data?.effective?.sidebar?.sectionsOrder;
        if (alive && Array.isArray(next)) setSectionsOrder(next);
      } catch {}
    };
    void load();
    const onChange = () => void load();
    window.addEventListener("workwrk:prefs-changed", onChange);
    return () => {
      alive = false;
      window.removeEventListener("workwrk:prefs-changed", onChange);
    };
  }, []);

  // Phases 79/80/82/83/84/89 — hydrate all seven favorite kinds in
  // parallel. Refetches when any favorite button fires the event.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [boardsRes, spacesRes, docsRes, foldersRes, tablesRes, wbsRes, filesRes] = await Promise.all([
          fetch("/api/me/favorites/boards", { cache: "no-store" }),
          fetch("/api/me/favorites/spaces", { cache: "no-store" }),
          fetch("/api/me/favorites/docs", { cache: "no-store" }),
          fetch("/api/me/favorites/folders", { cache: "no-store" }),
          fetch("/api/me/favorites/tables", { cache: "no-store" }),
          fetch("/api/me/favorites/whiteboards", { cache: "no-store" }),
          fetch("/api/me/favorites/files", { cache: "no-store" }),
        ]);
        if (boardsRes.ok) {
          const data = await boardsRes.json();
          if (alive && Array.isArray(data?.boards)) setFavoriteBoards(data.boards);
        }
        if (spacesRes.ok) {
          const data = await spacesRes.json();
          if (alive && Array.isArray(data?.spaces)) setFavoriteSpaces(data.spaces);
        }
        if (docsRes.ok) {
          const data = await docsRes.json();
          if (alive && Array.isArray(data?.docs)) setFavoriteDocs(data.docs);
        }
        if (foldersRes.ok) {
          const data = await foldersRes.json();
          if (alive && Array.isArray(data?.folders)) setFavoriteFolders(data.folders);
        }
        if (tablesRes.ok) {
          const data = await tablesRes.json();
          if (alive && Array.isArray(data?.tables)) setFavoriteTables(data.tables);
        }
        if (wbsRes.ok) {
          const data = await wbsRes.json();
          if (alive && Array.isArray(data?.whiteboards)) setFavoriteWhiteboards(data.whiteboards);
        }
        if (filesRes.ok) {
          const data = await filesRes.json();
          if (alive && Array.isArray(data?.files)) setFavoriteFiles(data.files);
        }
      } catch {}
    };
    void load();
    const onChange = () => void load();
    window.addEventListener("workwrk:favs-changed", onChange);
    return () => {
      alive = false;
      window.removeEventListener("workwrk:favs-changed", onChange);
    };
  }, []);

  const renderFavorites = () => {
    const total =
      favoriteBoards.length + favoriteSpaces.length + favoriteDocs.length
      + favoriteFolders.length + favoriteTables.length
      + favoriteWhiteboards.length + favoriteFiles.length;
    return (
      <div key="favorites">
        <button
          type="button"
          onClick={() => setFavoritesOpen((v) => !v)}
          className="flex h-7 items-center gap-2 px-2 mt-2 text-[12px] font-medium w-full text-zinc-700 hover:text-zinc-900"
        >
          {favoritesOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <span>Favorites</span>
          {total > 0 ? (
            <span className="ml-1 text-[11px] text-zinc-400 font-normal tabular-nums">
              {total}
            </span>
          ) : null}
        </button>
        {favoritesOpen ? (
          total === 0 ? (
            <div className="px-2.5 py-1 text-[12px] text-zinc-400">
              Star a Space or Board to add it here.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {/* Phase 85 — when the user has more than 6 favorites,
                  group by kind with small uppercase sub-headers so the
                  list doesn't become a mystery soup. */}
              {total > 6 && favoriteSpaces.length > 0 ? (
                <FavSubLabel>Spaces</FavSubLabel>
              ) : null}
              {favoriteSpaces.map((s) => {
                const active = pathname === `/spaces/${s.slug}`;
                return (
                  <li key={`s-${s.id}`} className="group/fav relative">
                    <Link
                      href={`/spaces/${s.slug}`}
                      className={`flex h-7 items-center gap-2 px-2 rounded-md text-[12px] ${
                        active ? "bg-zinc-200/70 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-white/80"
                      }`}
                    >
                      <EntityTile size="sm" icon={s.icon} color={s.color} name={s.name} />
                      <span className="truncate flex-1">{s.name}</span>
                    </Link>
                    <UnstarButton kind="space" id={s.id} />
                  </li>
                );
              })}
              {total > 6 && favoriteBoards.length > 0 ? (
                <FavSubLabel>Boards</FavSubLabel>
              ) : null}
              {favoriteBoards.map((b) => {
                const active = pathname === `/boards/${b.slug}`;
                return (
                  <li key={`b-${b.id}`} className="group/fav relative">
                    <Link
                      href={`/boards/${b.slug}`}
                      className={`flex h-7 items-center gap-2 px-2 rounded-md text-[12px] ${
                        active ? "bg-zinc-200/70 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-white/80"
                      }`}
                    >
                      <EntityTile size="sm" icon={b.icon} color={b.color} name={b.name} />
                      <span className="truncate flex-1">{b.name}</span>
                    </Link>
                    <UnstarButton kind="board" id={b.id} />
                  </li>
                );
              })}
              {total > 6 && favoriteDocs.length > 0 ? (
                <FavSubLabel>Docs</FavSubLabel>
              ) : null}
              {favoriteDocs.map((d) => {
                const active = pathname === `/docs/${d.id}`;
                return (
                  <li key={`d-${d.id}`} className="group/fav relative">
                    <Link
                      href={`/docs/${d.id}`}
                      className={`flex h-7 items-center gap-2 px-2 rounded-md text-[12px] ${
                        active ? "bg-zinc-200/70 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-white/80"
                      }`}
                    >
                      <EntityTile size="sm" color="#3B82F6" fallbackIcon={FileText} name={d.title} />
                      <span className="truncate flex-1">{d.title}</span>
                    </Link>
                    <UnstarButton kind="doc" id={d.id} />
                  </li>
                );
              })}
              {total > 6 && favoriteFolders.length > 0 ? (
                <FavSubLabel>Folders</FavSubLabel>
              ) : null}
              {favoriteFolders.map((f) => {
                return (
                  <li key={`f-${f.id}`} className="group/fav relative">
                    <Link
                      href={`/spaces/${f.space.slug}#folder-${f.id}`}
                      className="flex h-7 items-center gap-2 px-2 rounded-md text-[12px] text-zinc-700 hover:bg-white/80"
                    >
                      <EntityTile size="sm" color={f.color} fallbackIcon={Folder} name={f.name} />
                      <span className="truncate flex-1">{f.name}</span>
                    </Link>
                    <UnstarButton kind="folder" id={f.id} />
                  </li>
                );
              })}
              {total > 6 && favoriteTables.length > 0 ? (
                <FavSubLabel>Tables</FavSubLabel>
              ) : null}
              {favoriteTables.map((t) => {
                const active = pathname === `/tables/${t.id}`;
                return (
                  <li key={`t-${t.id}`} className="group/fav relative">
                    <Link
                      href={`/tables/${t.id}`}
                      className={`flex h-7 items-center gap-2 px-2 rounded-md text-[12px] ${
                        active ? "bg-zinc-200/70 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-white/80"
                      }`}
                    >
                      <EntityTile size="sm" color="#0EA5E9" fallbackIcon={FileSpreadsheet} name={t.name} />
                      <span className="truncate flex-1">{t.name}</span>
                    </Link>
                    <UnstarButton kind="table" id={t.id} />
                  </li>
                );
              })}
              {total > 6 && favoriteWhiteboards.length > 0 ? (
                <FavSubLabel>Whiteboards</FavSubLabel>
              ) : null}
              {favoriteWhiteboards.map((w) => {
                const active = pathname === `/whiteboards/${w.id}`;
                return (
                  <li key={`w-${w.id}`} className="group/fav relative">
                    <Link
                      href={`/whiteboards/${w.id}`}
                      className={`flex h-7 items-center gap-2 px-2 rounded-md text-[12px] ${
                        active ? "bg-zinc-200/70 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-white/80"
                      }`}
                    >
                      <EntityTile size="sm" color="#06B6D4" fallbackIcon={Brush} name={w.name} />
                      <span className="truncate flex-1">{w.name}</span>
                    </Link>
                    <UnstarButton kind="whiteboard" id={w.id} />
                  </li>
                );
              })}
              {total > 6 && favoriteFiles.length > 0 ? (
                <FavSubLabel>Files</FavSubLabel>
              ) : null}
              {favoriteFiles.map((f) => (
                <li key={`fl-${f.id}`} className="group/fav relative">
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-7 items-center gap-2 px-2 rounded-md text-[12px] text-zinc-700 hover:bg-white/80"
                  >
                    <EntityTile size="sm" color="#A1A1AA" fallbackIcon={FileText} name={f.name} />
                    <span className="truncate flex-1">{f.name}</span>
                  </a>
                  <UnstarButton kind="file" id={f.id} />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    );
  };

  const renderSpaces = () => {
    const q = searchQuery.trim().toLowerCase();
    const visibleSpaces = q
      ? spaces.filter((s) => s.name.toLowerCase().includes(q))
      : spaces;
    return (
      <div key="spaces">
        <div className="flex h-7 items-center gap-2 px-2 mt-1">
          <span className="text-[12px] font-medium flex-1 text-zinc-700">
            Spaces
            {q && visibleSpaces.length !== spaces.length ? (
              <span className="ml-1 text-[11px] text-zinc-400 font-normal">
                {visibleSpaces.length}/{spaces.length}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => setNewSpaceOpen(true)}
            className="h-[22px] w-[22px] inline-flex items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100"
            aria-label="New space"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <ul>
          {visibleSpaces.map((s) => {
            const isActive = pathname === `/spaces/${s.slug}`;
            return (
              <SpaceTreeRow
                key={s.id}
                space={s}
                isActive={isActive}
                onReloadSpaces={() => void reload()}
                onRequestShareSpace={() => setShareDialogSpace(s)}
                onRequestNewBoard={() => setBoardDialogSpaceId(s.id)}
                onRequestNewFolder={() => setFolderDialogSpaceId(s.id)}
                // Reordering only makes sense on the full, unfiltered list.
                reorderable={!q}
                onReorderSpace={(draggedId, place) => reorderSpaces(draggedId, s.id, place)}
              />
            );
          })}
          {q && visibleSpaces.length === 0 ? (
            <li className="px-2 py-2 text-[11.5px] text-zinc-400">
              No Spaces match &ldquo;{searchQuery}&rdquo;
            </li>
          ) : null}
          <li>
            <button
              type="button"
              onClick={() => setNewSpaceOpen(true)}
              className="w-full flex h-7 items-center gap-2 px-2 rounded-md text-[12px] text-zinc-500 hover:bg-white/80"
            >
              <Plus className="w-4 h-4" />
              <span>New Space</span>
            </button>
          </li>
        </ul>
      </div>
    );
  };

  return (
    <>
      <ul>
        <NavItem href="/inbox" Icon={Inbox} label="Inbox" active={pathname.startsWith("/inbox")} />
        <NavItem href="/assigned-comments" Icon={MessageSquare} label="Assigned Comments" active={pathname.startsWith("/assigned-comments")} />
        <MyTasksGroup pathname={pathname} />
        <MoreNavItem />
      </ul>

      {/* Sections rendered in user's preferred order; hidden ones omitted. */}
      {sectionsOrder.map((key) => {
        if (key === "favorites") return renderFavorites();
        if (key === "spaces") return renderSpaces();
        return null;
      })}

      <NewSpaceDialog
        open={newSpaceOpen}
        onOpenChange={setNewSpaceOpen}
        onCreated={() => { void reload(); refreshSidebar(); router.refresh(); }}
      />

      {boardDialogSpaceId ? (
        <NewBoardDialog
          open
          onOpenChange={(v) => { if (!v) setBoardDialogSpaceId(null); }}
          spaceId={boardDialogSpaceId}
          folderId={null}
          // refreshSidebar updates the tree; router.refresh re-fetches the
          // current route (e.g. the Space Overview) so its cards update too.
          onCreated={() => { setBoardDialogSpaceId(null); refreshSidebar(); router.refresh(); }}
        />
      ) : null}

      {folderDialogSpaceId ? (
        <NewFolderDialog
          open
          onOpenChange={(v) => { if (!v) setFolderDialogSpaceId(null); }}
          spaceId={folderDialogSpaceId}
          parentFolderId={null}
          onCreated={() => { setFolderDialogSpaceId(null); refreshSidebar(); router.refresh(); }}
        />
      ) : null}

      <ShareSpaceDialog
        open={Boolean(shareDialogSpace)}
        onOpenChange={(v) => { if (!v) setShareDialogSpace(null); }}
        spaceId={shareDialogSpace?.id ?? null}
        spaceName={shareDialogSpace?.name ?? ""}
        initialVisibility={shareDialogSpace?.visibility ?? "WORKSPACE"}
        onChanged={() => void reload()}
      />
    </>
  );
}

/* ───────────────────────── Calendar sidebar ───────────────────────── */

function CalendarSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/planner" Icon={Calendar} label="Planner" />
        <NavItem href="/timesheets" Icon={Calendar} label="Timesheets" />
      </ul>
      <SectionLabel>Integrations</SectionLabel>
      <div className="px-2 pt-1 pb-2 space-y-1.5">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-zinc-200 hover:bg-zinc-50 text-[12px]"
        >
          <span className="w-4 h-4 rounded bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center">31</span>
          <span className="flex-1 text-left">Google Calendar</span>
          <span className="text-[10px] text-zinc-500">Connect</span>
        </button>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-zinc-200 hover:bg-zinc-50 text-[12px]"
        >
          <span className="w-4 h-4 rounded bg-sky-600 text-white text-[9px] font-bold flex items-center justify-center">O</span>
          <span className="flex-1 text-left">Outlook</span>
          <span className="text-[10px] text-zinc-500">Connect</span>
        </button>
      </div>
    </>
  );
}

/* ───────────────────────── AI sidebar ───────────────────────── */

function AiSidebar() {
  return (
    <ul>
      <NavItem href="/sidekick" Icon={Sparkles} label="Ask Sidekick" />
      <NavItem href="/sidekick/history" Icon={MessageSquare} label="History" />
      <NavItem href="/sidekick/prompts" Icon={FileText} label="Prompts" />
      <NavItem href="/agents" Icon={Sparkles} label="Agents" />
    </ul>
  );
}

/* ───────────────────────── Teams sidebar ───────────────────────── */

function TeamsSidebar() {
  const pathname = usePathname() || "";
  return (
    <>
      <ul>
        <NavItem href="/team/alignment" Icon={Users} label="Alignment" active={pathname === "/team/alignment"} />
        <NavItem href="/team/reviews" Icon={ClipboardCheck} label="Reviews" active={pathname === "/team/reviews"} />
        <NavItem href="/team/kpi-reviews" Icon={Award} label="KPI approvals" active={pathname === "/team/kpi-reviews"} />
        <NavItem href="/team/rollup" Icon={BarChart3} label="Rollup" active={pathname === "/team/rollup"} />
      </ul>
      <SectionLabel>People</SectionLabel>
      <ul>
        <NavItem href="/people" Icon={Users} label="Directory" />
        <NavItem href="/organization" Icon={Building2} label="Org chart" />
        <NavItem href="/kra-kpi" Icon={Star} label="KRA & KPI" />
      </ul>
    </>
  );
}


/* ───────────────────────── Dashboards sidebar ───────────────────────── */

function DashboardsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/dashboards" Icon={BarChart3} label="All Dashboards" />
        <NavItem href="/dashboards?mine=1" Icon={BarChart3} label="My Dashboards" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Dashboard to see it here" />
    </>
  );
}

/* ───────────────────────── Library sidebar (Notes + Whiteboards + Files) ───────────────────────── */

function LibrarySidebar() {
  return (
    <>
      <ul>
        <NavItem href="/library" Icon={LibraryIcon} label="All" />
        <NavItem href="/library?tab=notes" Icon={FileText} label="Notes" />
        <NavItem href="/library?tab=whiteboards" Icon={Brush} label="Whiteboards" />
        <NavItem href="/library?tab=files" Icon={Folder} label="Files" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star an item to see it here" />
    </>
  );
}

/* ───────────────────────── Forms sidebar ───────────────────────── */

function FormsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/forms" Icon={ClipboardCheck} label="All Forms" />
        <NavItem href="/forms?mine=1" Icon={ClipboardCheck} label="My Forms" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Form to see it here" />
    </>
  );
}

/* ───────────────────────── Clips sidebar ───────────────────────── */

function ClipsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/notetaker" Icon={Video} label="All Clips" />
        <NavItem href="/notetaker?mine=1" Icon={Video} label="My Clips" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Clip to see it here" />
    </>
  );
}

/* ───────────────────────── Goals sidebar ───────────────────────── */

function GoalsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/okrs" Icon={Trophy} label="All Goals" />
        <NavItem href="/okrs?mine=1" Icon={Trophy} label="My Goals" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Goal to see it here" />
    </>
  );
}

/* ───────────────────────── Timesheets sidebar ───────────────────────── */

function TimesheetsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/timesheets" Icon={Clock} label="My Timesheets" />
        <NavItem href="/time-off" Icon={Calendar} label="Time off" />
      </ul>
      <SectionLabel>Approvals</SectionLabel>
      <EmptyState title="No pending approvals" />
    </>
  );
}

/* ───────────────────────── catalog ─────────────────────────
 * Apps are grouped by `category` for the More popover. `defaultPinned`
 * decides which icons render in the rail for new users; users override
 * via the More popover's pin toggles (persisted to localStorage).
 *
 * Adding a new app:
 *   1. add an entry below — set category + defaultPinned
 *   2. its Sidebar is the linksSidebar helper for simple link lists
 *   3. matchPaths is what makes route-based auto-select work
 */

export const APPS: AppEntry[] = [
  // ── Core (always pinned by default) ──────────────────────────
  { key: "home", label: "Home", Icon: Home, defaultHref: "/today",
    matchPaths: ["/today", "/inbox", "/tasks", "/spaces", "/activity", "/favorites", "/files"],
    Sidebar: HomeSidebar, category: "Core", defaultPinned: true, alwaysPinned: true,
    newAction: { label: "New Space", event: "home-new-space" } },
  { key: "planner", label: "Planner", Icon: Calendar, defaultHref: "/planner",
    matchPaths: ["/calendar", "/planner"], Sidebar: CalendarSidebar,
    category: "Core", defaultPinned: true },
  { key: "ai", label: "AI", Icon: BloomMark, defaultHref: "/sidekick",
    matchPaths: ["/sidekick", "/agents"], Sidebar: AiSidebar,
    category: "Core", defaultPinned: true },
  { key: "teams", label: "Teams", Icon: Users, defaultHref: "/team/alignment",
    matchPaths: ["/team", "/people", "/organization", "/kra-kpi"],
    Sidebar: TeamsSidebar, category: "Core", defaultPinned: true },
  { key: "docs", label: "Docs", Icon: FileText, defaultHref: "/docs",
    matchPaths: ["/docs"], Sidebar: DocsSidebar, category: "Core", defaultPinned: true,
    newAction: { label: "New doc", href: "/docs?new=1" } },
  { key: "dashboards", label: "Dashboard", Icon: BarChart3, defaultHref: "/dashboards",
    matchPaths: ["/dashboards"], Sidebar: DashboardsSidebar,
    category: "Core", defaultPinned: true,
    newAction: { label: "New Dashboard", href: "/dashboards?new=1" } },
  { key: "library", label: "Library", Icon: LibraryIcon, defaultHref: "/library",
    matchPaths: ["/library", "/whiteboards", "/docs"], Sidebar: LibrarySidebar,
    category: "Core", defaultPinned: true,
    newAction: { label: "New Note", href: "/library?tab=notes&new=1" } },
  { key: "forms", label: "Forms", Icon: ClipboardCheck, defaultHref: "/forms",
    matchPaths: ["/forms"], Sidebar: FormsSidebar, category: "Core", defaultPinned: true,
    newAction: { label: "New Form", href: "/forms?new=1" } },
  { key: "clips", label: "Clips", Icon: Video, defaultHref: "/notetaker",
    matchPaths: ["/notetaker", "/clips"], Sidebar: ClipsSidebar,
    category: "Core", defaultPinned: true,
    newAction: { label: "Record clip", href: "/notetaker?new=1" } },
  { key: "goals", label: "Goals", Icon: Trophy, defaultHref: "/okrs",
    matchPaths: ["/okrs", "/goals"], Sidebar: GoalsSidebar,
    category: "Core", defaultPinned: true,
    newAction: { label: "New Goal", href: "/okrs?new=1" } },
  { key: "timesheets", label: "Timesheets", Icon: Clock, defaultHref: "/timesheets",
    matchPaths: ["/timesheets", "/time-off"], Sidebar: TimesheetsSidebar,
    category: "Core", defaultPinned: true,
    newAction: { label: "Log time", href: "/timesheets?new=1" } },

  // ── PPMS scope (2026-06-03): CRM / Marketing / Helpdesk / ITSM
  // intentionally not pinned. WorkwrK is a People + Project Management
  // System; sales/external-support/IT are not core. Their /api routes
  // and pages still exist for direct linking if needed.
  // Tools + Assets ARE PPMS-core (per-employee provisioning) — see
  // the People section below.

  // ── People & HR ─────────────────────────────────────────────
  { key: "recruiting", label: "Recruiting", Icon: UserCheck, defaultHref: "/recruiting",
    matchPaths: ["/recruiting"], category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([
      { href: "/recruiting",            label: "Recruiting",      Icon: UserCheck },
      { href: "/recruiting/jobs",       label: "Jobs",            Icon: Briefcase },
      { href: "/recruiting/candidates", label: "Candidates",      Icon: Users },
      { href: "/recruiting/pipeline",   label: "Hiring pipeline", Icon: Workflow },
      { href: "/recruiting/interviews", label: "Interviews",      Icon: MessageSquare },
    ]) },
  { key: "onboarding", label: "Onboarding", Icon: HeartHandshake, defaultHref: "/onboarding",
    matchPaths: ["/onboarding"], category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([
      { href: "/onboarding", label: "Onboarding", Icon: HeartHandshake },
    ]) },
  { key: "reviews", label: "Reviews", Icon: ClipboardCheck, defaultHref: "/reviews",
    matchPaths: ["/reviews"], category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([
      { href: "/reviews", label: "Reviews", Icon: ClipboardCheck },
      { href: "/talent",  label: "Talent (9-box)", Icon: Award },
    ]) },
  { key: "candor", label: "Candor", Icon: MessageSquare, defaultHref: "/candor",
    matchPaths: ["/candor"], category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/candor", label: "Candor", Icon: MessageSquare }]) },
  { key: "announcements", label: "Announce", Icon: Megaphone, defaultHref: "/announcements",
    matchPaths: ["/announcements"], category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/announcements", label: "Announcements", Icon: Megaphone }]) },
  { key: "kudos", label: "Kudos", Icon: ThumbsUp, defaultHref: "/kudos",
    matchPaths: ["/kudos"], category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/kudos", label: "Kudos", Icon: ThumbsUp }]) },
  { key: "surveys", label: "Surveys", Icon: FileSpreadsheet, defaultHref: "/surveys",
    matchPaths: ["/surveys"], category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/surveys", label: "Surveys", Icon: FileSpreadsheet }]) },

  // ── Time off ────────────────────────────────────────────────
  // PPMS scope: Payroll / Benefits / Expenses / Compensation are
  // partner-integration targets (Phase 2 strategy), not in-house.
  // Financials / Planning / Procurement / Dev sit outside PPMS —
  // pages remain on disk; just not pinned to the rail.
  { key: "time-off", label: "Time off", Icon: Calendar, defaultHref: "/time-off",
    matchPaths: ["/time-off"], category: "Time & Pay",
    Sidebar: linksSidebar([{ href: "/time-off", label: "Time off", Icon: Calendar }]) },

  // ── People resourcing — provisioning what employees need to do work.
  // Tools = SaaS subscriptions + access grants (Slack, GitHub, Figma…).
  // Assets = physical equipment (laptops, monitors, keys, badges).
  // Both are per-employee provisioning surfaces — natural fit under
  // People. Tied to onboarding (grant) and offboarding (revoke) flows.
  { key: "tools", label: "Tools", Icon: HardDrive, defaultHref: "/tools",
    matchPaths: ["/tools"], category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/tools", label: "Tools & subscriptions", Icon: HardDrive }]) },
  { key: "assets", label: "Assets", Icon: Boxes, defaultHref: "/assets",
    matchPaths: ["/assets"], category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/assets", label: "Assets & equipment", Icon: Boxes }]) },

  // ── Knowledge ───────────────────────────────────────────────
  { key: "sops", label: "SOPs", Icon: ScrollText, defaultHref: "/sops",
    matchPaths: ["/sops"], category: "Knowledge", defaultPinned: true,
    newAction: { label: "New SOP", href: "/sops/new" },
    Sidebar: linksSidebar([
      { href: "/sops",               label: "All SOPs",             Icon: ScrollText },
      { href: "/sops/new/checklist", label: "New step-by-step SOP", Icon: Workflow },
      { href: "/sops/my-sops",       label: "My SOPs",              Icon: ScrollText },
      { href: "/process-runs",       label: "Run history",          Icon: Workflow },
      { href: "/sops/compliance",    label: "Compliance",           Icon: ShieldCheck },
    ]) },
  { key: "policies", label: "Policies", Icon: ShieldCheck, defaultHref: "/policies",
    matchPaths: ["/policies"], category: "Knowledge", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([
      { href: "/policies",            label: "All policies", Icon: ShieldCheck },
      { href: "/policies/compliance", label: "Compliance",   Icon: BarChart3 },
    ]) },
  { key: "agreements", label: "Contracts", Icon: FileSignature, defaultHref: "/agreements",
    matchPaths: ["/agreements"], category: "Knowledge", requiredAccess: "hr-admin",
    newAction: { label: "New contract", href: "/agreements?new=1" },
    Sidebar: linksSidebar([
      { href: "/agreements", label: "All contracts", Icon: FileSignature },
      { href: "/agreements?view=templates", label: "Templates", Icon: Folder },
      { href: "/agreements?view=trash", label: "Trash", Icon: Trash2 },
    ]) },
  { key: "learning", label: "Learning", Icon: GraduationCap, defaultHref: "/learning",
    matchPaths: ["/learning"], category: "Knowledge",
    Sidebar: linksSidebar([
      { href: "/learning/catalog", label: "Catalog",    Icon: BookOpen },
      { href: "/learning/mine",    label: "My courses", Icon: GraduationCap },
      { href: "/learning/manage",  label: "Manage",     Icon: SettingsIcon },
    ]) },

  // ── Build & Extend ──────────────────────────────────────────
  { key: "build", label: "Build", Icon: Wrench, defaultHref: "/build",
    matchPaths: ["/build"], category: "Build & Extend",
    Sidebar: linksSidebar([{ href: "/build", label: "Build apps", Icon: Wrench }]) },
  { key: "store", label: "Marketplace", Icon: ShoppingBag, defaultHref: "/store",
    matchPaths: ["/store"], category: "Build & Extend",
    Sidebar: linksSidebar([{ href: "/store", label: "Marketplace", Icon: ShoppingBag }]) },

  // ── Workspace ───────────────────────────────────────────────
  { key: "settings", label: "Settings", Icon: SettingsIcon, defaultHref: "/settings",
    matchPaths: ["/settings", "/account"], category: "Workspace",
    Sidebar: linksSidebar([
      { href: "/settings",         label: "Workspace settings", Icon: SettingsIcon },
      { href: "/account/security", label: "Account · Security", Icon: ShieldCheck },
    ]) },
  // Org-wide recycle bin — one place to recover anything deleted (60-day window).
  { key: "trash", label: "Trash", Icon: Trash2, defaultHref: "/trash",
    matchPaths: ["/trash"], category: "Workspace", requiredAccess: "hr-admin", defaultPinned: true,
    Sidebar: linksSidebar([
      { href: "/trash", label: "All deleted items", Icon: Trash2 },
    ]) },
];

/** Apps to render in the rail when the user hasn't customised yet. */
export const DEFAULT_PINNED_KEYS: string[] = APPS.filter((a) => a.defaultPinned).map((a) => a.key);

/** Apps that must always appear in the rail regardless of user prefs. */
export const ALWAYS_PINNED_KEYS: string[] = APPS.filter((a) => a.alwaysPinned).map((a) => a.key);

export function isAlwaysPinned(key: string): boolean {
  return ALWAYS_PINNED_KEYS.includes(key);
}

/** Apps shown in the More popover (everything except the More tile itself). */
export const CATALOG_APPS: AppEntry[] = APPS.filter((a) => !a.hideFromCatalog);

/** Stable category order in the More popover. */
export const CATEGORY_ORDER: string[] = [
  "Core", "Sales", "Marketing", "Service", "People", "Time & Pay",
  "Finance", "Dev", "Knowledge", "Build & Extend", "Workspace",
];

export function findAppForPath(pathname: string): AppEntry | undefined {
  return APPS.find((a) =>
    a.matchPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`)),
  );
}

export function getApp(key: string): AppEntry | undefined {
  return APPS.find((a) => a.key === key);
}
