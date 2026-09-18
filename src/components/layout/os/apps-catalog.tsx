"use client";

// Central registry for the ClickUp-style app switcher. Each entry is
// one icon in the left rail; clicking it navigates to the hub's landing
// URL and the URL is what decides which `Sidebar` renders. Keep this
// file lean — sidebars that grow past ~30 lines of UI should move to
// apps/<key>-sidebar.tsx.
//
// The URL -> hub mapping is NOT here: it lives in src/lib/nav/route-hub.ts
// (spec-shell.md §1.1). Entries used to carry `matchPaths`, which nothing
// read for highlighting; `ROUTE_HUB` replaced it.

import Link from "next/link";
import { ChatSidebar } from "./chat-sidebar";
import { canAccessTier, MANAGER_LEVELS, type AccessTier } from "./access-tiers";
import { useCallback, useEffect, useRef, useState } from "react";
// Re-exported so existing consumers (rail-apps.ts) keep importing the access
// ladder from the catalog while the definitions live in ./access-tiers.
export { canAccessTier };
export type { AccessTier };
import {
  Home, Calendar, Sparkles, Users, FileText, BarChart3, Brush, ClipboardCheck,
  Video, Trophy, Clock, CircleUser,
  Inbox, MessageSquare, CheckSquare, MoreHorizontal,
  Plus, ChevronDown, ChevronRight, X,
  Megaphone, Briefcase, Wrench, Building2, Bot, Cable, Hammer,
  UserCheck, Award, ThumbsUp, FileSpreadsheet,
  HardDrive, Boxes, Layers, Upload,
  Settings as SettingsIcon,
  ShoppingBag, Workflow, ScrollText,
  ListChecks, ListOrdered, MousePointerClick,
  Activity, LayoutTemplate, Plug,
  ShieldCheck, FileSignature,
  Library as LibraryIcon, Folder, Trash2,
  Target, GaugeCircle, BookUser, Network, Heart,
  type LucideIcon,
  MessageCircle, Hash, Table2 } from "lucide-react";
import { BloomMark } from "./bloom-mark";
import { TeamsCreateMenu } from "./teams-create-menu";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { NewSpaceDialog } from "./new-space-dialog";
import { NewBoardDialog } from "./new-board-dialog";
import { NewFolderDialog } from "./new-folder-dialog";
import { DocsSidebar } from "./docs-sidebar";
import { TablesSidebar } from "./tables-sidebar";
import { ShareSpaceDialog } from "./share-space-dialog";
import { SpaceTreeRow } from "./space-tree-row";
import { onSidebarRefresh, refreshSidebar } from "./sidebar-refresh";
import { useSidebarSearch } from "./sidebar-search-context";
import { useBoot } from "./boot-context";
import { MorePortal } from "./more-portal";
import { FOLDED_APP_HUB, type HubKey } from "@/lib/nav/route-hub";
import { useActiveRowHref } from "./use-active-row";
import { EntityTile } from "@/components/ui/entity-tile";
import { MenuItem, MenuList } from "@/components/ui/menu";
import {
  SidebarEmptyLine, SidebarErrorLine, SidebarGhostRow, SidebarRow, SidebarSectionAction, SidebarSectionLabel,
} from "./sidebar-primitives";

/** Access tiers reused by app entries and per-action gates. */
// AccessTier is defined in ./access-tiers and re-exported above.

/**
 * Shell helpers handed to a CreateAction's `onSelect` so catalog-level
 * actions can navigate, toast, prompt, or open shell modals without
 * hand-rolling hooks per app.
 */
export interface CreateActionContext {
  push: (href: string) => void;
  toast: (message: string) => void;
  prompt: (opts?: { title?: string; description?: string; defaultValue?: string; placeholder?: string }) => Promise<string | null>;
  openCreateTask: () => void;
  bumpRowVersion: (moduleId: string) => void;
}

/**
 * One row of an app's "+" offering. Exactly one of `onSelect` (wins),
 * `href`, or `event` (dispatches `workwrk:os:new:<event>`) should be set.
 * `requiredAccess` hides the row below that tier — hide, never 403.
 */
export interface CreateAction {
  label: string;
  icon?: LucideIcon;
  description?: string;
  /** Icon-tile tint in the menu; defaults to brand blue #0073EA. */
  iconColor?: string;
  href?: string;
  event?: string;
  onSelect?: (ctx: CreateActionContext) => void | Promise<void>;
  requiredAccess?: AccessTier;
}

export interface AppEntry {
  key: string;
  label: string;
  /** Allow non-Lucide icons (e.g. BloomMark) for AI-branded entries. */
  Icon: LucideIcon | React.ComponentType<{ className?: string }>;
  /**
   * Where to navigate when the user clicks this rail icon. For the eight hubs
   * `hubDefaultHref` (src/lib/nav/route-hub.ts) is the authority — it carries
   * the two conditional landings (Talk on module state, Settings on role) — and
   * this value is the static fallback used for folded apps and the palette.
   */
  defaultHref: string;
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
   * Folded into a hub — kept in the catalog (still reachable by route, the
   * More launcher, and search) but NOT shown as its own rail icon. The value
   * names the hub whose secondary sidebar carries this app's rows, so the
   * catalog says where each folded app lives instead of only that it is off
   * the rail. Absent = this app IS a hub. Stamped from `FOLDED_APP_HUB`
   * (src/lib/nav/route-hub.ts), which is the one list of the 19.
   */
  hubKey?: HubKey;
  /**
   * Feeds the global CreateMenu's "Space" row (Home only, today).
   * Either a route (href) or a custom-event name the app's Sidebar
   * component listens for.
   */
  newAction?: { label: string; href?: string; event?: string };
  /**
   * The sidebar header "+" contract:
   *   "global"        → the OS-wide CreateMenu (Home's catch-all)
   *   CreateAction[]  → one visible action fires directly on click;
   *                     two or more open the generic SidebarCreateMenu
   *   [] or absent    → (and no custom CreateMenu) the "+" is hidden —
   *                     this app has nothing the viewer can create
   */
  createActions?: CreateAction[] | "global";
  /**
   * Optional per-app "+" create menu. When set, it REPLACES the global
   * CreateMenu for this app so the "+" offers app-relevant creates (e.g.
   * Teams → Invite person / New role / New KRA …) instead of the generic
   * Task/List/Space/Doc menu.
   */
  CreateMenu?: React.ComponentType<{
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    open: boolean;
    onClose: () => void;
  }>;
  /**
   * Minimum access tier required to see this app at all. Absent =
   * available to everyone (default).
   *
   *   "manager"   — TEAM_LEAD, MANAGER, DIRECTOR, VP, C_LEVEL, HR, admin
   *   "hr-admin"  — HR + COMPANY_ADMIN + SUPER_ADMIN (people management)
   *   "org-admin" — COMPANY_ADMIN + SUPER_ADMIN only (finance/legal)
   *
   * This hides the rail entry only — every gated page ALSO enforces the
   * same tier server-side (src/lib/page-gates.ts). ICs keep their own
   * door: "My Profile" (/people/me) carries their KRAs/KPIs/goals.
   */
  requiredAccess?: AccessTier;
}

// MANAGER_LEVELS + canAccessTier now live in ./access-tiers (imported above).

export function canAccessApp(app: AppEntry, accessLevel: string | null | undefined): boolean {
  return canAccessTier(app.requiredAccess, accessLevel);
}

/** Window event name format for per-app "new" actions. */
export const NEW_EVENT_PREFIX = "workwrk:os:new:";

/* ── "+" onSelect helpers — mirror the create flows the pages themselves
 *    run, so the sidebar "+" is never a dead link. ─────────────────── */

/** Library → New note. Same POST the Library Notes tab's button makes. */
async function createLibraryNote(ctx: CreateActionContext) {
  try {
    const res = await fetch("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New doc" }),
    });
    const data = await res.json().catch(() => null);
    const id: string | undefined = data?.doc?.id;
    if (!res.ok || !id) throw new Error();
    ctx.push(`/docs/${id}`);
  } catch {
    ctx.toast("Couldn't create note");
  }
}

/** Library → New canvas. Same prompt + POST as the Whiteboards tab. */
async function createLibraryWhiteboard(ctx: CreateActionContext) {
  const name = (await ctx.prompt({ title: "Canvas name?", defaultValue: "Untitled canvas" }))?.trim();
  if (!name) return;
  try {
    const res = await fetch("/api/whiteboards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => null);
    const id: string | undefined = data?.whiteboard?.id;
    if (!res.ok || !id) throw new Error();
    ctx.push(`/canvas/${id}`);
  } catch {
    ctx.toast("Couldn't create whiteboard");
  }
}

/** Timesheets → Start this week. POST /api/timesheets is an idempotent
 *  upsert for the current week (same call as the page's own button). */
async function startTimesheetWeek(ctx: CreateActionContext) {
  try {
    const res = await fetch("/api/timesheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error();
    ctx.toast("This week's timesheet is open");
    ctx.bumpRowVersion("timesheets");
    ctx.push("/timesheets");
  } catch {
    ctx.toast("Couldn't start this week's timesheet");
  }
}

/** Helper: build a sidebar component from a static link list. */
function linksSidebar(
  links: Array<{ href: string; label: string; Icon: LucideIcon; match?: "exact" | "prefix" }>,
): React.ComponentType {
  function Sidebar() {
    const activeHref = useActiveRowHref(links);
    return (
      <ul>
        {links.map((l) => (
          <NavItem
            key={l.href}
            href={l.href}
            label={l.label}
            Icon={l.Icon}
            active={l.href === activeHref}
          />
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
  const count = typeof badge === "number" ? badge : typeof badge === "string" ? Number(badge) || 0 : 0;
  return <SidebarRow href={href} label={label} icon={Icon} active={active} count={count} />;
}

// Goals, folded into Work: a group row with the four views as children
// (indent 20). The active row comes from the one resolver over the whole
// sidebar, so two rows can never light at once.
function GroupRow({
  href, label, Icon, active, expanded, onToggle,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <SidebarRow
      href={href}
      label={label}
      icon={Icon}
      active={active}
      trailing={
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={expanded}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-active hover:text-ink"
        >
          {expanded ? <ChevronDown className="h-4 w-4" strokeWidth={1.5} /> : <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} />}
        </button>
      }
    />
  );
}

function GoalsGroup({ activeHref }: { activeHref: string | undefined }) {
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;
  const isManager = canAccessTier("manager", accessLevel);
  const [expanded, setExpanded] = useState(Boolean(activeHref && activeHref.startsWith("/okrs")));
  return (
    <>
      <GroupRow href="/okrs" label="Goals" Icon={Target} active={activeHref === "/okrs"} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      {expanded ? (
        <>
          <SidebarRow depth={1} href="/okrs?mine=1" icon={Trophy} label="My goals" active={activeHref === "/okrs?mine=1"} />
          {isManager ? <SidebarRow depth={1} href="/okrs?team=1" icon={Users} label="Team goals" active={activeHref === "/okrs?team=1"} /> : null}
          <SidebarRow depth={1} href="/okrs?level=company" icon={Building2} label="Company goals" active={activeHref === "/okrs?level=company"} />
          {/* sidebar-map 1 row 5d ("My KRAs & KPIs" as a jump to
              /people/me?tab=kras) waits for the profile page to grow a KRAs
              tab; until then it would be a second row to the My profile
              destination, which spec-shell 1.3 retires. */}
        </>
      ) : null}
    </>
  );
}

function MyTasksGroup({ activeHref }: { activeHref: string | undefined }) {
  const [expanded, setExpanded] = useState(Boolean(activeHref?.startsWith("/tasks")));
  return (
    <>
      <GroupRow href="/tasks" label="My work" Icon={CheckSquare} active={activeHref === "/tasks"} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      {expanded ? (
        <>
          <SidebarRow depth={1} href="/tasks/assigned-to-me" icon={UserCheck} label="Assigned to me" active={activeHref === "/tasks/assigned-to-me"} />
          <SidebarRow depth={1} href="/tasks/today-overdue" icon={Calendar} label="Today & overdue" active={activeHref === "/tasks/today-overdue"} />
          <SidebarRow depth={1} href="/tasks/personal-list" icon={ClipboardCheck} label="Personal list" active={activeHref === "/tasks/personal-list"} />
        </>
      ) : null}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <SidebarSectionLabel>{children}</SidebarSectionLabel>;
}

function EmptyState({ title }: { title: string; body?: string }) {
  return (
    <ul>
      <SidebarEmptyLine>{title}</SidebarEmptyLine>
    </ul>
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

// The person record row (naming-canon 2.18): "My profile" everywhere.
const PROFILE_NAV_LABEL = "My profile";

function FavSubLabel({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-3 pb-0.5 pt-2 text-micro uppercase tracking-[0.06em] text-ink-3 select-none" aria-hidden>
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
      className="absolute end-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/fav:opacity-100 focus-visible:opacity-100 transition-opacity inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-2 hover:text-ink hover:bg-active"
    >
      <X className="w-3 h-3" />
    </button>
  );
}

// Every static row of the Work sidebar in one list, in declaration order, so
// resolveActiveRow can light exactly one of them (spec-shell §1.1). The Spaces
// and Favorites trees are dynamic rows and carry their own active state.
const WORK_ROWS = [
  { href: "/people/me", match: "exact" as const },
  { href: "/inbox" },
  { href: "/assigned-comments" },
  { href: "/tasks", match: "exact" as const },
  { href: "/tasks/assigned-to-me" },
  { href: "/tasks/today-overdue" },
  { href: "/tasks/personal-list" },
  { href: "/everything" },
  { href: "/okrs" },
  { href: "/okrs?mine=1" },
  { href: "/okrs?team=1" },
  { href: "/okrs?level=company" },
  { href: "/templates" },
  { href: "/trash" },
];

function HomeSidebar() {
  const router = useRouter();
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  const activeHref = useActiveRowHref(WORK_ROWS);
  const { counts } = useBoot();
  const inboxUnread = counts.inboxUnread;
  // /people/me redirects to /people/<myId>, so the profile row also answers to
  // the resolved id, which no declared href can match.
  const pathname = usePathname() || "";
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const profileActive =
    activeHref === "/people/me" || (meId !== null && pathname === `/people/${meId}`);
  const { query: searchQuery } = useSidebarSearch();
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  // A failed Spaces read shows the one-line error with Try again (spec-shell
  // 1.2 rule 7); the section never renders empty on a failed fetch.
  const [spacesError, setSpacesError] = useState(false);
  // POST /api/spaces refuses below the manager tier, so the Space creates
  // (section "+", ghost row) exist only for the tier that can use them
  // (spec-shell 2.10: a row that appears always works).
  const canCreateSpace = canAccessTier("manager", accessLevel);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favoriteBoards, setFavoriteBoards] = useState<Array<{ id: string; slug: string; name: string; icon: string | null; color: string | null; visibility: string }>>([]);
  const [favoriteSpaces, setFavoriteSpaces] = useState<Array<{ id: string; slug: string; name: string; icon: string | null; color: string | null; visibility: string }>>([]);
  const [favoriteDocs, setFavoriteDocs] = useState<Array<{ id: string; title: string; excerpt: string | null }>>([]);
  const [favoriteFolders, setFavoriteFolders] = useState<Array<{ id: string; name: string; icon: string | null; color: string | null; space: { slug: string } }>>([]);
  const [favoriteTables, setFavoriteTables] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  const [favoriteWhiteboards, setFavoriteWhiteboards] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  const [favoriteFiles, setFavoriteFiles] = useState<Array<{ id: string; name: string; url: string; mimeType: string }>>([]);
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [spacesMenuOpen, setSpacesMenuOpen] = useState(false);
  const spacesMenuRef = useRef<HTMLButtonElement>(null);
  const [sectionsOrder, setSectionsOrder] = useState<string[]>(DEFAULT_SECTIONS_ORDER);
  const [hiddenSections, setHiddenSections] = useState<string[]>([]);
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
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSpaces(Array.isArray(data.spaces) ? data.spaces : []);
        setSpacesError(false);
      })
      .catch(() => setSpacesError(true));
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
        const hidden = data?.effective?.sidebar?.hiddenSections;
        if (alive && Array.isArray(hidden)) setHiddenSections(hidden);
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
    // FAVORITES renders only when non-empty (sidebar-map 1).
    if (total === 0) return null;
    return (
      <div key="favorites">
        <SidebarSectionLabel collapsed={!favoritesOpen} onToggle={() => setFavoritesOpen((v) => !v)} count={total}>
          Favorites
        </SidebarSectionLabel>
        {favoritesOpen ? (
          total === 0 ? (
            <ul>
              <SidebarEmptyLine>No favorites yet</SidebarEmptyLine>
            </ul>
          ) : (
            <ul>
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
                      className={`flex h-9 items-center gap-3 px-3 rounded-lg ${
                        active ? "bg-side-pill text-ink font-medium" : "text-ink hover:bg-hover"
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
                      className={`flex h-9 items-center gap-3 px-3 rounded-lg ${
                        active ? "bg-side-pill text-ink font-medium" : "text-ink hover:bg-hover"
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
                      className={`flex h-9 items-center gap-3 px-3 rounded-lg ${
                        active ? "bg-side-pill text-ink font-medium" : "text-ink hover:bg-hover"
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
                      className="flex h-9 items-center gap-3 px-3 rounded-lg text-ink hover:bg-hover"
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
                      className={`flex h-9 items-center gap-3 px-3 rounded-lg ${
                        active ? "bg-side-pill text-ink font-medium" : "text-ink hover:bg-hover"
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
                <FavSubLabel>Canvases</FavSubLabel>
              ) : null}
              {favoriteWhiteboards.map((w) => {
                const active = pathname === `/canvas/${w.id}`;
                return (
                  <li key={`w-${w.id}`} className="group/fav relative">
                    <Link
                      href={`/canvas/${w.id}`}
                      className={`flex h-9 items-center gap-3 px-3 rounded-lg ${
                        active ? "bg-side-pill text-ink font-medium" : "text-ink hover:bg-hover"
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
                    className="flex h-9 items-center gap-3 px-3 rounded-lg text-ink hover:bg-hover"
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
        <SidebarSectionLabel
          count={q && visibleSpaces.length !== spaces.length ? visibleSpaces.length : null}
          actions={
            <>
              <SidebarSectionAction ref={spacesMenuRef} icon={MoreHorizontal} label="Spaces options" aria-haspopup="menu" aria-expanded={spacesMenuOpen} onClick={() => setSpacesMenuOpen((v) => !v)} />
              {canCreateSpace ? <SidebarSectionAction icon={Plus} label="New Space" onClick={() => setNewSpaceOpen(true)} /> : null}
            </>
          }
        >
          Spaces
        </SidebarSectionLabel>
        {spacesMenuOpen ? (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setSpacesMenuOpen(false)} aria-hidden />
            <MorePortal anchorRef={spacesMenuRef} width={220} open={spacesMenuOpen} placement="below">
              <MenuList>
                <MenuItem href="/spaces" icon={Layers} label="Browse all Spaces" onClick={() => setSpacesMenuOpen(false)} />
              </MenuList>
            </MorePortal>
          </>
        ) : null}
        <ul>
          {visibleSpaces.map((s, i) => {
            const isActive = pathname === `/spaces/${s.slug}`;
            const prev = q ? null : visibleSpaces[i - 1];
            const next = q ? null : visibleSpaces[i + 1];
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
                onMoveUp={prev ? () => reorderSpaces(s.id, prev.id, "before") : undefined}
                onMoveDown={next ? () => reorderSpaces(s.id, next.id, "after") : undefined}
              />
            );
          })}
          {spacesError ? (
            <SidebarErrorLine what="Spaces" onRetry={() => void reload()} />
          ) : q && visibleSpaces.length === 0 ? (
            <SidebarEmptyLine>No Spaces match &ldquo;{searchQuery}&rdquo;</SidebarEmptyLine>
          ) : null}
          {canCreateSpace ? <SidebarGhostRow icon={Plus} label="New Space" onClick={() => setNewSpaceOpen(true)} /> : null}
        </ul>
      </div>
    );
  };

  return (
    <>
      <ul>
        <NavItem href="/people/me" Icon={CircleUser} label={PROFILE_NAV_LABEL} active={profileActive} />
        <MyTasksGroup activeHref={activeHref} />
        <NavItem href="/inbox" Icon={Inbox} label="Inbox" active={activeHref === "/inbox"} badge={inboxUnread} />
        <NavItem href="/assigned-comments" Icon={MessageSquare} label="Assigned comments" active={activeHref === "/assigned-comments"} />
        {/* sidebar-map 1 row 4. /activity is a live, ungated page that had no
            row, no catalog key and no link anywhere in src, so the palette's
            Apps group could not list it either: it was reachable by typing
            the URL and by nothing else. */}
        <NavItem href="/activity" Icon={Activity} label="Activity" active={activeHref === "/activity"} />
        <NavItem href="/everything" Icon={Layers} label="Everything" active={activeHref === "/everything"} />
        <GoalsGroup activeHref={activeHref} />
        {/* The rule between the personal rows and the two workspace rows
            (sidebar-map 1). Templates (row 6): the workspace starter bundles
            at /templates, every Member; this row is the page's one door since
            the workspace menu lost its Templates row. Trash (row 7): the
            org-wide recycle bin. The spec gives it to every Member, but
            GET /api/trash and the page still answer 403 below manager, so the
            row keeps the manager tier until the trash rule moves into
            APP_RULES; a row that lands on a denial is worse than no row. */}
        {accessLevel ? <li aria-hidden className="my-2 h-px bg-line" /> : null}
        {accessLevel ? (
          <NavItem href="/templates" Icon={LayoutTemplate} label="Templates" active={activeHref === "/templates"} />
        ) : null}
        {canAccessTier("manager", accessLevel) ? (
          <NavItem href="/trash" Icon={Trash2} label="Trash" active={activeHref === "/trash"} />
        ) : null}
      </ul>

      {/* Sections in the viewer's order; hidden ones (Customize) omitted. */}
      {sectionsOrder.map((key) => {
        if (hiddenSections.includes(key)) return null;
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

// sidebar-map 2. Meetings (row 2) and Clock in/out (row 4) are live, ungated
// pages that carried a ROUTE_HUB row and a ROUTE_TITLES label but no door
// anywhere in the product; these two rows are that door. Team calendar (row 5)
// and Approvals (row 6) still have no page and stay out until they do.
const PLANNER_ROWS = [
  { href: "/planner", label: "Calendar", Icon: Calendar },
  { href: "/meetings", label: "Meetings", Icon: Video },
  { href: "/clock", label: "Clock in/out", Icon: Clock },
  { href: "/timesheets", label: "Timesheets", Icon: ListOrdered },
];

function CalendarSidebar() {
  const activeHref = useActiveRowHref(PLANNER_ROWS);
  return (
    <>
      <ul>
        {PLANNER_ROWS.map((r) => (
          <NavItem key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHref} />
        ))}
      </ul>
    </>
  );
}

/* ───────────────────────── AI sidebar ───────────────────────── */

// sidebar-map section 3: the personal rows are Ask AI and Agents. History
// and Prompts had no page behind them (/sidekick/history and
// /sidekick/prompts 404), and a row with no destination is not a row.
const AI_ROWS = [
  { href: "/sidekick", label: "Ask AI", Icon: Sparkles },
  { href: "/agents", label: "Agents", Icon: Bot },
];
const AI_AUTOMATION_ROWS = [
  { href: "/automation/workflows", label: "Workflows", Icon: Workflow },
  { href: "/automation/templates", label: "Templates", Icon: LayoutTemplate },
  { href: "/automation/health", label: "Health", Icon: Activity },
  { href: "/automation/usage", label: "Usage", Icon: GaugeCircle },
  { href: "/automation/logs", label: "Logs", Icon: ScrollText },
  { href: "/automation/connections", label: "Connections", Icon: Cable },
];
// APPS (sidebar-map section 3 rows 10 to 12): Marketplace and Build apps
// re-parented from the Settings sidebar (ROUTE_HUB puts /build and /store in
// this hub, and Settings is a takeover with no sidebar of its own, spec-shell
// §1.2 rule 3), plus Integrations, whose only member-wide door used to be a
// palette command. Icons per the map: Cable for Connections so it does not
// share Plug with Integrations, Hammer for Build apps so it does not share
// Wrench with the Teams Tools row.
// The map says every Member browses Integrations, but /integrations/layout.tsx
// still redirects below manager (requireManagerOrRedirect, a tools-misc gate
// this phase does not touch), so the row renders for the viewers the route
// serves and never lands anyone on a redirect.
const AI_BUILD_ROWS: { href: string; label: string; Icon: LucideIcon; manager?: boolean }[] = [
  { href: "/store", label: "Marketplace", Icon: ShoppingBag },
  { href: "/integrations", label: "Integrations", Icon: Plug, manager: true },
  { href: "/build", label: "Build apps", Icon: Hammer },
];
// One list across every section: the active row is resolved over every
// candidate at once, so two sections can never both light up.
const AI_ALL_ROWS = [...AI_ROWS, ...AI_AUTOMATION_ROWS, ...AI_BUILD_ROWS];

function AiSidebar() {
  const activeHref = useActiveRowHref(AI_ALL_ROWS);
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  const isManager = canAccessTier("manager", accessLevel);
  return (
    <>
      <ul>
        {AI_ROWS.map((r) => (
          <NavItem key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHref} />
        ))}
      </ul>
      {isManager ? (
        <>
          <SectionLabel>Automation</SectionLabel>
          <ul>
            {AI_AUTOMATION_ROWS.map((r) => (
              <NavItem key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHref} />
            ))}
          </ul>
        </>
      ) : null}
      <SectionLabel>Apps</SectionLabel>
      <ul>
        {AI_BUILD_ROWS.filter((r) => !r.manager || isManager).map((r) => (
          <NavItem key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHref} />
        ))}
      </ul>
    </>
  );
}

/* ───────────────────────── Teams sidebar ───────────────────────── */

// Teams — a people-operation cockpit. Three buckets: who (People), what they
// own & are measured on (Alignment), how they're doing (Performance), plus an
// Overview landing. Every item has one clear job.
//
// The app entry is manager-gated, but this sidebar can still render for an
// employee (route match on /people/[id] — their own career home), so it is
// access-aware: below manager tier it shows only the personal door, and the
// director-gated Rollup row is hidden below director (no dead controls).
const DIRECTOR_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR"]);

// Every static row of the Teams sidebar in one list, so the resolver lights
// exactly one (spec-shell §1.1). Tools and Assets are re-parented here from the
// Settings sidebar: ROUTE_HUB puts both routes in this hub, and Settings is a
// takeover with no sidebar of its own.
const TEAMS_ROWS = [
  { href: "/team", match: "exact" as const },
  { href: "/people/me", match: "exact" as const },
  { href: "/people", match: "exact" as const },
  { href: "/organization" },
  { href: "/people/roles" },
  { href: "/kra-kpi" },
  { href: "/team/alignment", match: "exact" as const },
  { href: "/team/reviews", match: "exact" as const },
  { href: "/team/kpi-reviews", match: "exact" as const },
  { href: "/team/rollup", match: "exact" as const },
  { href: "/team/workload", match: "exact" as const },
  { href: "/reviews" },
  { href: "/talent" },
  { href: "/candor" },
  { href: "/kudos" },
  { href: "/surveys" },
  { href: "/tools" },
  { href: "/assets" },
];

function TeamsSidebar() {
  const activeHref = useActiveRowHref(TEAMS_ROWS);
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  const isManagerTier = MANAGER_LEVELS.has(accessLevel);
  const isHrAdmin = canAccessTier("hr-admin", accessLevel);

  if (!isManagerTier) {
    return (
      <ul>
        <NavItem href="/people/me" Icon={CircleUser} label="My profile" active={activeHref === "/people/me"} />
      </ul>
    );
  }

  return (
    <>
      <ul>
        <NavItem href="/team" Icon={Users} label="My team" active={activeHref === "/team"} />
        <NavItem href="/people/me" Icon={CircleUser} label="My profile" active={activeHref === "/people/me"} />
      </ul>
      <SectionLabel>People</SectionLabel>
      <ul>
        <NavItem href="/people" Icon={BookUser} label="Directory" active={activeHref === "/people"} />
        <NavItem href="/organization" Icon={Network} label="Org chart" active={activeHref === "/organization"} />
        <NavItem href="/people/roles" Icon={Briefcase} label="Job titles" active={activeHref === "/people/roles"} />
      </ul>
      <SectionLabel>Alignment</SectionLabel>
      <ul>
        <NavItem href="/kra-kpi" Icon={GaugeCircle} label="KRAs & KPIs" active={activeHref === "/kra-kpi"} />
        <NavItem href="/team/alignment" Icon={Target} label="Alignment" active={activeHref === "/team/alignment"} />
      </ul>
      <SectionLabel>Performance</SectionLabel>
      <ul>
        <NavItem href="/team/reviews" Icon={ClipboardCheck} label="Weekly reviews" active={activeHref === "/team/reviews"} />
        <NavItem href="/team/kpi-reviews" Icon={ClipboardCheck} label="KPI reviews" active={activeHref === "/team/kpi-reviews"} />
        {DIRECTOR_LEVELS.has(accessLevel) ? (
          <NavItem href="/team/rollup" Icon={BarChart3} label="Sub-teams" active={activeHref === "/team/rollup"} />
        ) : null}
        <NavItem href="/team/workload" Icon={GaugeCircle} label="Workload" active={activeHref === "/team/workload"} />
        {isHrAdmin ? (
          <>
            <NavItem href="/reviews" Icon={ClipboardCheck} label="Review cycles" active={activeHref === "/reviews"} />
            <NavItem href="/talent" Icon={Award} label="Talent (9-box)" active={activeHref === "/talent"} />
          </>
        ) : null}
      </ul>
      {isHrAdmin ? (
        <>
          <SectionLabel>Culture</SectionLabel>
          <ul>
            <NavItem href="/candor" Icon={MessageSquare} label="Candor" active={activeHref === "/candor"} />
            <NavItem href="/kudos" Icon={Heart} label="Kudos" active={activeHref === "/kudos"} />
            <NavItem href="/surveys" Icon={ListChecks} label="Surveys" active={activeHref === "/surveys"} />
          </ul>
        </>
      ) : null}
      {isHrAdmin ? (
        <>
          {/* Re-parented from the Settings sidebar. Same hr-admin gate they
              carried there. */}
          <SectionLabel>Resourcing</SectionLabel>
          <ul>
            <NavItem href="/tools" Icon={Wrench} label="Tools" active={activeHref === "/tools"} />
            <NavItem href="/assets" Icon={Boxes} label="Assets" active={activeHref === "/assets"} />
          </ul>
        </>
      ) : null}
    </>
  );
}


/* ───────────────────────── Library sidebar (Notes + Whiteboards + Files) ───────────────────────── */

const LIBRARY_ROWS = [
  { href: "/library", label: "All", Icon: LibraryIcon },
  { href: "/library?tab=notes", label: "Notes", Icon: FileText },
  { href: "/library?tab=whiteboards", label: "Canvases", Icon: Brush },
  { href: "/library?tab=files", label: "Files", Icon: Folder },
];

function LibrarySidebar() {
  const activeHref = useActiveRowHref(LIBRARY_ROWS);
  return (
    <>
      <ul>
        {LIBRARY_ROWS.map((r) => (
          <NavItem key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHref} />
        ))}
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star an item to see it here" />
    </>
  );
}

/* ───────────────────────── Forms sidebar ───────────────────────── */

const FORMS_ROWS = [
  { href: "/forms", label: "All Forms", Icon: ClipboardCheck },
  { href: "/forms?mine=1", label: "My Forms", Icon: ClipboardCheck },
];

function FormsSidebar() {
  const activeHref = useActiveRowHref(FORMS_ROWS);
  return (
    <>
      <ul>
        {FORMS_ROWS.map((r) => (
          <NavItem key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHref} />
        ))}
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Form to see it here" />
    </>
  );
}

/* ───────────────────────── Clips sidebar ───────────────────────── */

const CLIPS_ROWS = [
  { href: "/notetaker", label: "All Clips", Icon: Video },
  { href: "/notetaker?mine=1", label: "My Clips", Icon: Video },
];

function ClipsSidebar() {
  const activeHref = useActiveRowHref(CLIPS_ROWS);
  return (
    <>
      <ul>
        {CLIPS_ROWS.map((r) => (
          <NavItem key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHref} />
        ))}
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Clip to see it here" />
    </>
  );
}

/* ───────────────────────── Goals sidebar ───────────────────────── */

const GOALS_ROWS = [
  { href: "/okrs?mine=1", label: "My Goals", Icon: Trophy },
  { href: "/okrs?team=1", label: "Team Goals", Icon: Users },
  { href: "/okrs?level=company", label: "Company Goals", Icon: Building2 },
  { href: "/people/me", label: "My KRAs & KPIs", Icon: Target },
];

function GoalsSidebar() {
  const activeHref = useActiveRowHref(GOALS_ROWS);
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;
  const isManager = canAccessTier("manager", accessLevel);
  return (
    <>
      <ul>
        {/* My Goals is primary: what I own or am assigned. Team Goals (my
            report tree) is manager-only. Company objectives show as context
            inside each view — no "All Goals" firehose. */}
        {GOALS_ROWS.filter((r) => isManager || r.href !== "/okrs?team=1").map((r) => (
          <NavItem key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHref} />
        ))}
      </ul>
    </>
  );
}

/* ───────────────────────── Timesheets sidebar ───────────────────────── */

const TIMESHEETS_ROWS = [{ href: "/timesheets", label: "My Timesheets", Icon: Clock }];

function TimesheetsSidebar() {
  const activeHref = useActiveRowHref(TIMESHEETS_ROWS);
  return (
    <>
      <ul>
        {TIMESHEETS_ROWS.map((r) => (
          <NavItem key={r.href} href={r.href} Icon={r.Icon} label={r.label} active={r.href === activeHref} />
        ))}
      </ul>
      <SectionLabel>Approvals</SectionLabel>
      <EmptyState title="No pending approvals" />
    </>
  );
}

/* ───────────────────────── Settings ─────────────────────────
 * Settings is a takeover (spec-shell 2.8): SettingsShell carries its own 264px
 * list, so the hub has no sidebar body. /imports renders inside it too. */
function SettingsSidebar() {
  return null;
}

/* ───────────────────────── catalog ─────────────────────────
 * Apps are grouped by `category` for the More popover. `defaultPinned`
 * decides which icons render in the rail for new users; users override
 * via the More popover's pin toggles (persisted to localStorage).
 *
 * Adding a new app:
 *   1. add an entry below — set category + defaultPinned
 *   2. its Sidebar is the linksSidebar helper for simple link lists
 *   3. give its routes a ROUTE_HUB row in src/lib/nav/route-hub.ts, and a
 *      FOLDED_APP_HUB entry when it folds into a hub rather than taking a
 *      rail icon of its own. A route with no row fails the nav CI test.
 */

export const APPS: AppEntry[] = [
  // ── Core (always pinned by default) ──────────────────────────
  { key: "home", label: "Work", Icon: Home, defaultHref: "/today",
    Sidebar: HomeSidebar, category: "Core", defaultPinned: true, alwaysPinned: true,
    newAction: { label: "New Space", event: "home-new-space" },
    // Home is the OS-wide catch-all — it keeps the global create menu.
    createActions: "global" },
  { key: "planner", label: "Planner", Icon: Calendar, defaultHref: "/planner", Sidebar: CalendarSidebar,
    category: "Core", defaultPinned: true,
    createActions: [{ label: "New task", icon: CheckSquare, onSelect: (ctx) => ctx.openCreateTask() }] },
  { key: "ai", label: "AI", Icon: Sparkles, defaultHref: "/sidekick", Sidebar: AiSidebar,
    category: "Core", defaultPinned: true,
    createActions: [{ label: "New chat", icon: Sparkles, href: "/sidekick?new=1" }] },
  { key: "chat", label: "Talk", Icon: MessageCircle, defaultHref: "/tlk", Sidebar: ChatSidebar, category: "Core", defaultPinned: true,
    createActions: [
      { label: "New message", icon: MessageCircle, event: "chat-new" },
      { label: "New channel", icon: Hash, event: "chat-new-channel" },
    ] },
  // /people (the Directory), not /team: /team is gated on having reports, so a
  // rail pill pointed at it would land a plain Member on a denial. My team is
  // the second row of the hub sidebar (spec-shell §1.1).
  { key: "teams", label: "Teams", Icon: Users, defaultHref: "/people",
    Sidebar: TeamsSidebar, category: "Core", defaultPinned: true,
    requiredAccess: "manager",
    CreateMenu: TeamsCreateMenu },
  { key: "docs", label: "Docs", Icon: FileText, defaultHref: "/docs",
    Sidebar: DocsSidebar, category: "Core", defaultPinned: true,
    // sidebar-map section 6: the Docs "+" offers the three content creates.
    // DocsSidebar listens for the event and runs its "New page" flow; the
    // canvas list page opens its name prompt on ?new=1; Files has the upload
    // zone. The PROCESS creates (SOP, policy, contract) stay on their pages'
    // own primaries until the Docs phase gates them here by role.
    createActions: [
      { label: "New doc", icon: FileText, event: "docs-new-page" },
      { label: "New canvas", icon: Brush, href: "/canvas?new=1" },
      { label: "Upload file", icon: Upload, href: "/files" },
    ] },
  { key: "tables", label: "Tables", Icon: Table2, defaultHref: "/tables", category: "Core", defaultPinned: true,
    // TablesSidebar lists every worksheet (like Docs lists docs); the old
    // single "All tables" link survives as a secondary row inside it.
    Sidebar: TablesSidebar,
    // sidebar-map section 7: New table, New form, Import a CSV. ?new=1 is an
    // armed latch on each list page: it opens the create flow once on
    // arrival, so the "+" goes straight into creation.
    createActions: [
      { label: "New table", icon: Table2, href: "/tables?new=1" },
      { label: "New form", icon: ClipboardCheck, href: "/forms?new=1" },
      { label: "Import a CSV", icon: Upload, href: "/imports" },
    ] },
  // "Library" is retired as a word (naming-canon 2.8); the key survives as
  // the gate for Files, and that is the label and door the palette prints.
  { key: "library", label: "Files", Icon: LibraryIcon, defaultHref: "/files", Sidebar: LibrarySidebar,
    category: "Core", defaultPinned: true,
    createActions: [
      { label: "New note", icon: FileText, description: "A standalone note in the Library", onSelect: createLibraryNote },
      { label: "New canvas", icon: Brush, description: "Freeform canvas", onSelect: createLibraryWhiteboard },
      // One label, one door (naming-canon 2.5): Files is /files everywhere
      // in the chrome (the Docs sidebar row, the palette and the Docs "+").
      { label: "Upload file", icon: Upload, description: "Drop a file into Files", href: "/files" },
    ] },
  { key: "forms", label: "Forms", Icon: ClipboardCheck, defaultHref: "/forms", Sidebar: FormsSidebar, category: "Core", defaultPinned: true,
    createActions: [{ label: "New form", icon: ClipboardCheck, href: "/forms?new=1" }] },
  // Clips has no separate creatable object — /notetaker IS the composer,
  // so the sidebar "+" stays hidden for it.
  { key: "clips", label: "Notetaker", Icon: Video, defaultHref: "/notetaker", Sidebar: ClipsSidebar,
    category: "Core", defaultPinned: true },
  { key: "goals", label: "Goals", Icon: Trophy, defaultHref: "/okrs", Sidebar: GoalsSidebar,
    category: "Core", defaultPinned: true,
    createActions: [{ label: "New Goal", icon: Trophy, href: "/okrs?new=1" }] },
  { key: "timesheets", label: "Timesheets", Icon: Clock, defaultHref: "/timesheets", Sidebar: TimesheetsSidebar,
    category: "Core", defaultPinned: true,
    createActions: [{ label: "Start this week", icon: Clock, onSelect: startTimesheetWeek }] },

  // ── PPMS scope (2026-06-03): CRM / Marketing / Helpdesk / ITSM
  // intentionally not pinned. WorkwrK is a People + Project Management
  // System; sales/external-support/IT are not core. Their /api routes
  // and pages still exist for direct linking if needed.
  // Tools + Assets ARE PPMS-core (per-employee provisioning) — see
  // the People section below.

  // ── People ──────────────────────────────────────────────────
  // "Review cycles", not "Reviews" — the Teams sidebar's weekly "Reviews"
  // queue keeps that name, and the two colliding was the confusion.
  { key: "reviews", label: "Review cycles", Icon: ClipboardCheck, defaultHref: "/reviews", category: "People", requiredAccess: "hr-admin",
    // /reviews?new=1 auto-opens NewReviewCycleDialog (armed latch in
    // reviews-client.tsx, so repeat "+" clicks re-open it).
    createActions: [{ label: "Start review cycle", icon: ClipboardCheck, href: "/reviews?new=1", requiredAccess: "manager" }],
    Sidebar: linksSidebar([
      { href: "/reviews", label: "Review cycles", Icon: ClipboardCheck },
      { href: "/talent",  label: "Talent (9-box)", Icon: Award },
    ]) },
  { key: "candor", label: "Candor", Icon: MessageSquare, defaultHref: "/candor", category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/candor", label: "Candor", Icon: MessageSquare }]) },
  // Every Member reads announcements (sidebar-map section 4 row 4; the page
  // renders read-only below manager). Ungated here so the Talk hub and its
  // Announcements row stay reachable with the Talk module off.
  { key: "announcements", label: "Announcements", Icon: Megaphone, defaultHref: "/announcements", category: "People",
    Sidebar: linksSidebar([{ href: "/announcements", label: "Announcements", Icon: Megaphone }]) },
  { key: "kudos", label: "Kudos", Icon: ThumbsUp, defaultHref: "/kudos", category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/kudos", label: "Kudos", Icon: ThumbsUp }]) },
  { key: "surveys", label: "Surveys", Icon: FileSpreadsheet, defaultHref: "/surveys", category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/surveys", label: "Surveys", Icon: FileSpreadsheet }]) },

  // ── People resourcing — provisioning what employees need to do work.
  // Tools = SaaS subscriptions + access grants (Slack, GitHub, Figma…).
  // Assets = physical equipment (laptops, monitors, keys, badges).
  // Both are per-employee provisioning surfaces — natural fit under
  // People. Tied to joiner (grant) and offboarding (revoke) flows.
  { key: "tools", label: "Tools", Icon: HardDrive, defaultHref: "/tools", category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/tools", label: "Tools & subscriptions", Icon: HardDrive }]) },
  { key: "assets", label: "Assets", Icon: Boxes, defaultHref: "/assets", category: "People", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([{ href: "/assets", label: "Assets & equipment", Icon: Boxes }]) },

  // ── Knowledge ───────────────────────────────────────────────
  { key: "sops", label: "SOPs", Icon: ScrollText, defaultHref: "/sops", category: "Knowledge", defaultPinned: true,
    // One action per SOP kind — /sops/new?type=STEPS pre-creates a
    // step-list SOP and drops straight into inline editing.
    createActions: [
      { label: "New written SOP",       icon: FileText,          href: "/sops/new/text" },
      { label: "New step-by-step SOP",  icon: ListOrdered,       href: "/sops/new?type=STEPS" },
      { label: "New checklist SOP",     icon: ListChecks,        href: "/sops/new/checklist" },
      { label: "New click-capture SOP", icon: MousePointerClick, href: "/sops/new/record" },
    ],
    Sidebar: linksSidebar([
      { href: "/sops",               label: "All SOPs",             Icon: ScrollText },
      { href: "/sops/my-sops",       label: "My SOPs",              Icon: ScrollText },
      { href: "/process-runs",       label: "Run history",          Icon: Workflow },
      { href: "/sops/compliance",    label: "Compliance",           Icon: ShieldCheck },
    ]) },
  { key: "policies", label: "Policies", Icon: ShieldCheck, defaultHref: "/policies", category: "Knowledge", requiredAccess: "hr-admin",
    Sidebar: linksSidebar([
      { href: "/policies",            label: "All policies", Icon: ShieldCheck },
      { href: "/policies/compliance", label: "Compliance",   Icon: BarChart3 },
    ]) },
  { key: "agreements", label: "Contracts", Icon: FileSignature, defaultHref: "/agreements", category: "Knowledge", requiredAccess: "hr-admin",
    createActions: [{ label: "New contract", icon: FileSignature, href: "/agreements?new=1", requiredAccess: "hr-admin" }],
    Sidebar: linksSidebar([
      { href: "/agreements", label: "All contracts", Icon: FileSignature },
      { href: "/agreements?view=templates", label: "Templates", Icon: Folder },
      { href: "/agreements?view=trash", label: "Trash", Icon: Trash2 },
    ]) },
  // ── Build & Extend ──────────────────────────────────────────
  { key: "build", label: "Build apps", Icon: Hammer, defaultHref: "/build", category: "Build & Extend",
    Sidebar: linksSidebar([{ href: "/build", label: "Build apps", Icon: Wrench }]) },
  { key: "store", label: "Marketplace", Icon: ShoppingBag, defaultHref: "/store", category: "Build & Extend",
    Sidebar: linksSidebar([{ href: "/store", label: "Marketplace", Icon: ShoppingBag }]) },
  { key: "automation", label: "Automation", Icon: Workflow, defaultHref: "/automation/workflows", category: "Build & Extend", requiredAccess: "manager",
    Sidebar: linksSidebar([
      { href: "/automation/workflows",   label: "Workflows",   Icon: Workflow },
      { href: "/automation/templates",   label: "Templates",   Icon: LayoutTemplate },
      { href: "/automation/health",      label: "Health",      Icon: Activity },
      { href: "/automation/usage",       label: "Usage",       Icon: GaugeCircle },
      { href: "/automation/logs",        label: "Logs",        Icon: ScrollText },
      { href: "/automation/connections", label: "Connections", Icon: Plug },
    ]) },

  // ── Workspace ───────────────────────────────────────────────
  // alwaysPinned: the escape hatch. If an admin could hide or floor
  // Settings, a bad config could lock the org out of the page that fixes
  // configs. Everyone gets the door; the Admin sections gate inside it.
  { key: "settings", label: "Settings", Icon: SettingsIcon, defaultHref: "/settings",
    category: "Workspace", alwaysPinned: true,
    Sidebar: SettingsSidebar },
  // Org-wide Trash: one place to recover anything deleted (60-day window).
  // Manager tier, matching GET /api/trash and the page (isManager) today;
  // sidebar-map 1 row 7 widens it to every Member when the API's rule does.
  { key: "trash", label: "Trash", Icon: Trash2, defaultHref: "/trash", category: "Workspace", defaultPinned: true,
    requiredAccess: "manager",
    Sidebar: linksSidebar([
      { href: "/trash", label: "All deleted items", Icon: Trash2 },
    ]) },
];

// Rail consolidation: these apps are FOLDED into a hub — still in the catalog,
// still reachable by route / the More launcher / search, but not their own rail
// icon. Their rows live inside the hub's secondary sidebar. The list of 19 and
// the hub each one folds into is FOLDED_APP_HUB in src/lib/nav/route-hub.ts, so
// one alias-free module carries it and a CI test can assert it; stamping it
// here keeps the entry literals readable. The 8 rail hubs are everything this
// leaves without a hubKey: home, planner, ai, chat, teams, docs, tables,
// settings.
for (const a of APPS) {
  const hub = FOLDED_APP_HUB[a.key];
  if (hub) a.hubKey = hub;
}

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
  "Core", "Sales", "Marketing", "Service", "People",
  "Finance", "Dev", "Knowledge", "Build & Extend", "Workspace",
];

// findAppForPath is gone: resolveHub(pathname) in src/lib/nav/route-hub.ts is
// the one URL -> hub answer, and it is longest-prefix rather than
// first-match-in-catalog-order, so overlapping prefixes resolve the same way
// every time.

export function getApp(key: string): AppEntry | undefined {
  return APPS.find((a) => a.key === key);
}
