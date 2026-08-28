"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { type AppEntry } from "./apps-catalog";
import { parseOrgAppsConfig, visibleRailApps, type OrgAppsConfig } from "@/lib/rail-apps";

export type Lens = "me" | "we";

/** Options for opening the Template Center. `kind` scopes the browser to
 *  one template type (e.g. LIST from the create-list modal); `applyContext`
 *  carries the target Space for applying a LIST template inline. */
export type TemplateCenterKind = "TASK" | "LIST" | "SPACE" | "FOLDER" | "DOC" | "VIEW" | "WHITEBOARD";
export type TemplateCenterOpts = {
  kind?: TemplateCenterKind;
  applyContext?: { spaceId?: string };
};

/** Board the create-task modal should preselect as its destination
 *  list (mirrors the modal's SelectedList shape). */
export type CreateTaskPreselect = {
  id: string;
  slug: string;
  name: string;
  spaceId: string | null;
};

export type PresenceStatus = {
  emoji: string | null;
  label: string;
  /** Optional expiry ISO timestamp; null = no expiry. */
  expiresAt: string | null;
};

export const DEFAULT_PRESENCE: PresenceStatus = { emoji: null, label: "Online", expiresAt: null };

/** Default top-bar quick icons (subset of PROFILE_TOOLS). Order is the
 *  order they render. Users can pin/unpin from the profile dropdown. */
export const DEFAULT_PROFILE_TOOL_PINS: string[] = [
  "create-task",
  "my-work",
  "notepad",
  "create-reminder",
  "create-doc",
  "voice",
];

export type OpenItem = {
  moduleId: string;
  itemId: string;
  name: string;
  groupColor?: string;
  /**
   * Snapshot of the row's cell values at the moment the drawer opened.
   * The drawer renders inline fields from this so users see the *actual*
   * status / owner / due / tags / etc. for the row they clicked, instead
   * of placeholder copy. Shape matches the OsMainTable Row.cells map.
   */
  payload?: Record<string, unknown>;
};

type ShellState = {
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;

  sidekickOpen: boolean;
  /** Open the Brain panel. Optional `initialPrompt` pre-fills the input
   *  on a fresh chat — used when handing off from the command palette's
   *  Ask AI pill. */
  openSidekick: (initialPrompt?: string) => void;
  closeSidekick: () => void;
  toggleSidekick: () => void;
  /** One-shot initial prompt for the Brain panel's input. The panel
   *  consumes this via `consumeSidekickInitialPrompt()` on mount/open
   *  so it doesn't leak into subsequent opens. */
  sidekickInitialPrompt: string | null;
  consumeSidekickInitialPrompt: () => string | null;

  // 🆕 Phase 2 — ClickUp-style "Customize" modal. Opened from the
  // sidebar foot button; mounted once at the OsShell level.
  customizeOpen: boolean;
  openCustomize: () => void;
  closeCustomize: () => void;
  setCustomizeOpen: (v: boolean) => void;

  createTaskOpen: boolean;
  /** Optionally pass the board (list) the modal should preselect —
   *  used by the board page's "+ Task" button. */
  openCreateTask: (preselect?: CreateTaskPreselect | null) => void;
  closeCreateTask: () => void;
  /** Board to preselect in the create-task modal; null = none. */
  createTaskPreselect: CreateTaskPreselect | null;

  createListOpen: boolean;
  openCreateList: (preselect?: { spaceId?: string; folderId?: string } | null) => void;
  closeCreateList: () => void;
  /** Space to preselect in the create-list modal; null = derive from route. */
  createListPreselect: { spaceId?: string; folderId?: string } | null;

  createSprintOpen: boolean;
  openCreateSprint: (preselect?: { spaceId?: string; folderId?: string } | null) => void;
  closeCreateSprint: () => void;
  /** Space to preselect in the create-sprint modal; null = derive from route. */
  createSprintPreselect: { spaceId?: string; folderId?: string } | null;

  // 🆕 Template Center — the OS-wide template browser/apply modal.
  // Mounted once at OsShell level; opened from the "+" menu, the
  // create-list/space modals ("Use Templates"), and "…" context menus.
  templateCenterOpen: boolean;
  templateCenterOpts: TemplateCenterOpts | null;
  openTemplateCenter: (opts?: TemplateCenterOpts) => void;
  closeTemplateCenter: () => void;

  // 🆕 2026-06-03 — App-switcher state (ClickUp-style two-column nav).
  // activeAppKey drives which "app" (Home/Planner/Teams/…) the
  // secondary sidebar renders. sidebarCollapsed hides that whole
  // column so the canvas can use the full width. Both persist across
  // reloads via localStorage.
  activeAppKey: string;
  setActiveApp: (key: string) => void;
  // Rail-hover preview: the middle sidebar shows THIS app's options while the
  // mouse is over its rail icon (or the sidebar itself); clicking commits it to
  // activeApp. Null = no preview (show the active app).
  previewAppKey: string | null;
  setPreviewApp: (key: string | null) => void;
  keepPreview: () => void;
  clearPreviewSoon: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  appsGridOpen: boolean;
  openAppsGrid: () => void;
  closeAppsGrid: () => void;

  /**
   * Apps the left rail renders — the org ACCESS config (order / hidden /
   * minAccess from OrgPreference.sidebarDefault.apps) applied over the
   * catalog and the viewer's access tier (2026-08-22, replaces personal
   * pins): every user sees every app they have access to, in the admin's
   * order. alwaysPinned apps (Home) always survive, so this is never empty.
   */
  railApps: AppEntry[];
  /** Recently launched apps (most-recent-first, capped at 6). */
  recentAppKeys: string[];
  pushRecentApp: (key: string) => void;

  /** Rail appearance — hide labels under the icons when true. */
  iconsOnly: boolean;
  setIconsOnly: (v: boolean) => void;

  /** Personal-tool pin set — which tools surface as quick-icons in the
   *  top bar (e.g. Create task, My Work, Notepad). Driven from the
   *  profile dropdown's pin toggles; persists in localStorage. */
  profileToolPins: string[];
  toggleProfileToolPin: (key: string) => void;
  setProfileToolPins: (keys: string[]) => void;
  isProfileToolPinned: (key: string) => boolean;

  /** User presence status (Online / In a meeting / Focusing / Sick / Vacation). */
  presenceStatus: PresenceStatus;
  setPresenceStatus: (s: PresenceStatus) => void;
  statusModalOpen: boolean;
  openStatusModal: () => void;
  closeStatusModal: () => void;

  /** Mute-notifications toggle (persisted). */
  mutedNotifications: boolean;
  setMutedNotifications: (v: boolean) => void;

  lens: Lens;
  setLens: (l: Lens) => void;

  openItem: OpenItem | null;
  openItemDrawer: (it: OpenItem) => void;
  closeItemDrawer: () => void;

  /**
   * Tiny pub/sub for cross-component "row changed" notifications.
   * Bumped by the drawer (or Sidekick tool calls) whenever an item is
   * mutated; pages subscribe via `rowVersion(moduleId)` to know when to
   * re-fetch. Keeps shell state minimal — no global cache of row data.
   */
  bumpRowVersion: (moduleId: string) => void;
  rowVersion: (moduleId: string) => number;
};

const Ctx = createContext<ShellState | null>(null);

const LENS_KEY = "workwrk:os:lens";
const ACTIVE_APP_KEY = "workwrk:os:active-app";
const SIDEBAR_COLLAPSED_KEY = "workwrk:os:sidebar-collapsed";
const RECENT_APPS_KEY = "workwrk:os:recent-apps";
const ICONS_ONLY_KEY = "workwrk:os:icons-only";
// v2: the quick-tools bar replaced the old nav-link tool set, so reset cached
// pins to the new functional default.
const PROFILE_TOOL_PINS_KEY = "workwrk:os:profile-tool-pins:v2";
const PRESENCE_KEY = "workwrk:os:presence";
const MUTED_NOTIFS_KEY = "workwrk:os:muted-notifs";
const MAX_RECENTS = 6;

export function OsShellProvider({ children }: { children: React.ReactNode }) {
  // Access tier drives rail visibility (canAccessApp + org minAccess).
  // SessionProvider wraps the whole app (src/components/layout/providers.tsx),
  // so useSession is safe here.
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidekickOpen, setSidekickOpen] = useState(false);
  const [sidekickInitialPrompt, setSidekickInitialPrompt] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskPreselect, setCreateTaskPreselect] = useState<CreateTaskPreselect | null>(null);
  const [createListOpen, setCreateListOpen] = useState(false);
  const [createListPreselect, setCreateListPreselect] = useState<{ spaceId?: string; folderId?: string } | null>(null);
  const [createSprintOpen, setCreateSprintOpen] = useState(false);
  const [createSprintPreselect, setCreateSprintPreselect] = useState<{ spaceId?: string; folderId?: string } | null>(null);
  const [templateCenterOpen, setTemplateCenterOpen] = useState(false);
  const [templateCenterOpts, setTemplateCenterOpts] = useState<TemplateCenterOpts | null>(null);
  const [lens, setLensState] = useState<Lens>("me");
  const [openItem, setOpenItem] = useState<OpenItem | null>(null);
  const [rowVersions, setRowVersions] = useState<Record<string, number>>({});
  const [activeAppKey, setActiveAppKeyState] = useState<string>("home");
  const [previewAppKey, setPreviewAppKeyState] = useState<string | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(false);
  const [appsGridOpen, setAppsGridOpen] = useState(false);
  // Org rail config (ACCESS system). {} until /api/preferences answers —
  // the rail then shows the plain access-filtered catalog in catalog order,
  // which is also the correct steady state for orgs that never customized.
  const [railConfig, setRailConfig] = useState<OrgAppsConfig>({});
  // Premium module app keys the org has ACTIVE (from /api/preferences). null
  // until the fetch answers — visibleRailApps treats that as "no modules on"
  // so a disabled module never flashes into the rail on first paint.
  const [activeModuleKeys, setActiveModuleKeys] = useState<string[] | null>(null);
  const [recentAppKeys, setRecentAppKeysState] = useState<string[]>([]);
  const [iconsOnly, setIconsOnlyState] = useState<boolean>(false);
  const [profileToolPins, setProfileToolPinsState] = useState<string[]>(DEFAULT_PROFILE_TOOL_PINS);
  const [presenceStatus, setPresenceStatusState] = useState<PresenceStatus>(DEFAULT_PRESENCE);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [mutedNotifications, setMutedNotificationsState] = useState(false);

  useEffect(() => {
    const storageTimer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(LENS_KEY);
        if (stored === "me" || stored === "we") setLensState(stored);
        const app = window.localStorage.getItem(ACTIVE_APP_KEY);
        if (app) setActiveAppKeyState(app);
        const collapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
        if (collapsed === "1") setSidebarCollapsedState(true);
        const recents = window.localStorage.getItem(RECENT_APPS_KEY);
        if (recents) {
          const parsed = JSON.parse(recents);
          if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
            setRecentAppKeysState(parsed.slice(0, MAX_RECENTS));
          }
        }
        const io = window.localStorage.getItem(ICONS_ONLY_KEY);
        if (io === "1") setIconsOnlyState(true);
        const profilePins = window.localStorage.getItem(PROFILE_TOOL_PINS_KEY);
        if (profilePins) {
          const parsed = JSON.parse(profilePins);
          if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
            setProfileToolPinsState(parsed);
          }
        }
        const pres = window.localStorage.getItem(PRESENCE_KEY);
        if (pres) {
          const parsed = JSON.parse(pres);
          if (parsed && typeof parsed.label === "string") {
            setPresenceStatusState({
              emoji: typeof parsed.emoji === "string" ? parsed.emoji : null,
              label: parsed.label,
              expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : null,
            });
          }
        }
        const muted = window.localStorage.getItem(MUTED_NOTIFS_KEY);
        if (muted === "1") setMutedNotificationsState(true);
      } catch {}
    }, 0);

    // Reconcile with server-stored preference (syncs across devices).
    // Server is the source of truth when present; localStorage is a
    // cached read-through so the rail doesn't flash on first paint.
    let alive = true;
    const loadServerPrefs = async () => {
      try {
        const res = await fetch("/api/preferences", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const sidebar = data?.effective?.sidebar;
        if (!alive || !sidebar) return;
        if (typeof sidebar.iconsOnly === "boolean") {
          setIconsOnlyState(sidebar.iconsOnly);
          try { window.localStorage.setItem(ICONS_ONLY_KEY, sidebar.iconsOnly ? "1" : "0"); } catch {}
        }
        // Org ACCESS config for the rail. parseOrgAppsConfig is tolerant
        // of stale payloads that don't carry sidebar.apps yet (absent →
        // {} → access-filtered catalog default). The workwrk:prefs-changed
        // listener below refetches, so an admin save in the Settings door
        // updates this tab's rail immediately (other tabs and users pick it up on their next load — window CustomEvents are same-tab only) without a reload.
        setRailConfig(parseOrgAppsConfig(sidebar.apps));
        // Premium module entitlement, org-level. Absent on a stale payload →
        // [] → modules stay hidden until a fresh payload carries them.
        const activeAppKeys = data?.effective?.modules?.activeAppKeys;
        setActiveModuleKeys(
          Array.isArray(activeAppKeys) && activeAppKeys.every((k: unknown) => typeof k === "string")
            ? activeAppKeys
            : [],
        );
      } catch {}
    };
    void loadServerPrefs();
    const onPrefsChanged = () => void loadServerPrefs();
    window.addEventListener("workwrk:prefs-changed", onPrefsChanged);
    return () => {
      alive = false;
      window.clearTimeout(storageTimer);
      window.removeEventListener("workwrk:prefs-changed", onPrefsChanged);
    };
  }, []);

  const setIconsOnly = useCallback((v: boolean) => {
    setIconsOnlyState(v);
    try { window.localStorage.setItem(ICONS_ONLY_KEY, v ? "1" : "0"); } catch {}
  }, []);

  const pushRecentApp = useCallback((key: string) => {
    setRecentAppKeysState((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, MAX_RECENTS);
      try { window.localStorage.setItem(RECENT_APPS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const setLens = useCallback((l: Lens) => {
    setLensState(l);
    try { window.localStorage.setItem(LENS_KEY, l); } catch {}
  }, []);

  const setActiveApp = useCallback((key: string) => {
    setActiveAppKeyState(key);
    // Committing an app ends any hover-preview.
    if (previewTimerRef.current) { clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
    setPreviewAppKeyState(null);
    setSidebarCollapsedState(false);
    try {
      window.localStorage.setItem(ACTIVE_APP_KEY, key);
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "0");
    } catch {}
  }, []);

  // Rail-hover preview coordination. setPreviewApp opens immediately;
  // clearPreviewSoon closes after a short grace period so the mouse can travel
  // from the rail icon into the sidebar without the preview flickering away;
  // keepPreview cancels a pending close while the pointer is over the sidebar.
  const setPreviewApp = useCallback((key: string | null) => {
    if (previewTimerRef.current) { clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
    setPreviewAppKeyState(key);
  }, []);
  const keepPreview = useCallback(() => {
    if (previewTimerRef.current) { clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
  }, []);
  const clearPreviewSoon = useCallback(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => { setPreviewAppKeyState(null); previewTimerRef.current = null; }, 160);
  }, []);

  const setSidebarCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsedState(v);
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? "1" : "0"); } catch {}
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsedState((v) => {
      const next = !v;
      try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  const openAppsGrid = useCallback(() => setAppsGridOpen(true), []);
  const closeAppsGrid = useCallback(() => setAppsGridOpen(false), []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openSidekick = useCallback((initialPrompt?: string) => {
    if (initialPrompt && initialPrompt.trim().length > 0) {
      setSidekickInitialPrompt(initialPrompt);
    }
    setSidekickOpen(true);
  }, []);
  const closeSidekick = useCallback(() => setSidekickOpen(false), []);
  const toggleSidekick = useCallback(() => setSidekickOpen((v) => !v), []);
  const consumeSidekickInitialPrompt = useCallback(() => {
    const v = sidekickInitialPrompt;
    if (v !== null) setSidekickInitialPrompt(null);
    return v;
  }, [sidekickInitialPrompt]);
  const openCustomize = useCallback(() => setCustomizeOpen(true), []);
  const closeCustomize = useCallback(() => setCustomizeOpen(false), []);
  const openCreateTask = useCallback((preselect?: CreateTaskPreselect | null) => {
    setCreateTaskPreselect(preselect ?? null);
    setCreateTaskOpen(true);
  }, []);
  const closeCreateTask = useCallback(() => {
    setCreateTaskOpen(false);
    setCreateTaskPreselect(null);
  }, []);
  const openCreateList = useCallback((preselect?: { spaceId?: string; folderId?: string } | null) => {
    setCreateListPreselect(preselect ?? null);
    setCreateListOpen(true);
  }, []);
  const closeCreateList = useCallback(() => setCreateListOpen(false), []);
  const openCreateSprint = useCallback((preselect?: { spaceId?: string; folderId?: string } | null) => {
    setCreateSprintPreselect(preselect ?? null);
    setCreateSprintOpen(true);
  }, []);
  const closeCreateSprint = useCallback(() => setCreateSprintOpen(false), []);
  const openTemplateCenter = useCallback((opts?: TemplateCenterOpts) => {
    setTemplateCenterOpts(opts ?? null);
    setTemplateCenterOpen(true);
  }, []);
  const closeTemplateCenter = useCallback(() => {
    setTemplateCenterOpen(false);
    setTemplateCenterOpts(null);
  }, []);
  const openItemDrawer = useCallback((it: OpenItem) => setOpenItem(it), []);
  const closeItemDrawer = useCallback(() => setOpenItem(null), []);
  const bumpRowVersion = useCallback((moduleId: string) => {
    setRowVersions((v) => ({ ...v, [moduleId]: (v[moduleId] ?? 0) + 1 }));
  }, []);
  const rowVersion = useCallback((moduleId: string) => rowVersions[moduleId] ?? 0, [rowVersions]);
  // ── ACCESS-system rail (replaces personal pins, 2026-08-22) ────────
  // visibleRailApps = catalog − org hidden, filtered by canAccessApp
  // (baseline, never weakened) and the org minAccess floor, ordered by
  // the admin's order then catalog order. Home (alwaysPinned) always
  // survives, so the rail is never empty for any access level.
  const railApps = useMemo<AppEntry[]>(
    () =>
      visibleRailApps({
        config: railConfig,
        accessLevel,
        // null (pre-fetch) → undefined → module apps stay hidden until known.
        activeModules: activeModuleKeys ? new Set(activeModuleKeys) : undefined,
      }),
    [railConfig, accessLevel, activeModuleKeys],
  );
  const setProfileToolPins = useCallback((keys: string[]) => {
    setProfileToolPinsState(keys);
    try { window.localStorage.setItem(PROFILE_TOOL_PINS_KEY, JSON.stringify(keys)); } catch {}
  }, []);
  const toggleProfileToolPin = useCallback((key: string) => {
    setProfileToolPinsState((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { window.localStorage.setItem(PROFILE_TOOL_PINS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const isProfileToolPinned = useCallback((key: string) => profileToolPins.includes(key), [profileToolPins]);
  const setPresenceStatus = useCallback((s: PresenceStatus) => {
    setPresenceStatusState(s);
    try { window.localStorage.setItem(PRESENCE_KEY, JSON.stringify(s)); } catch {}
  }, []);
  const openStatusModal = useCallback(() => setStatusModalOpen(true), []);
  const closeStatusModal = useCallback(() => setStatusModalOpen(false), []);
  const setMutedNotifications = useCallback((v: boolean) => {
    setMutedNotificationsState(v);
    try { window.localStorage.setItem(MUTED_NOTIFS_KEY, v ? "1" : "0"); } catch {}
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === "k") {
        // Cmd/Ctrl+Shift+K → quick task. Replaces the old Cmd+T chord, which
        // Chrome/Safari swallow for "new tab" and never deliver to the page —
        // so the advertised shortcut silently did nothing. ⇧K sits next to the
        // ⌘K search chord and is free in the target browsers.
        e.preventDefault();
        setCreateTaskPreselect(null);
        setCreateTaskOpen(true);
      } else if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (meta && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSidekickOpen((v) => !v);
      } else if (meta && e.key.toLowerCase() === "b") {
        // Cmd+B → toggle secondary sidebar (matches common app shortcuts).
        e.preventDefault();
        setSidebarCollapsedState((v) => {
          const next = !v;
          try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0"); } catch {}
          return next;
        });
      } else if (meta && /^[1-9]$/.test(e.key)) {
        // Cmd+1..9 → jump to the Nth rail app (org order).
        const idx = parseInt(e.key, 10) - 1;
        const key = railApps[idx]?.key;
        if (key) {
          e.preventDefault();
          setActiveAppKeyState(key);
          setSidebarCollapsedState(false);
          try {
            window.localStorage.setItem(ACTIVE_APP_KEY, key);
            window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "0");
          } catch {}
        }
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setOpenItem(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railApps]);

  const value = useMemo<ShellState>(
    () => ({
      paletteOpen, openPalette, closePalette,
      sidekickOpen, openSidekick, closeSidekick, toggleSidekick,
      sidekickInitialPrompt, consumeSidekickInitialPrompt,
      customizeOpen, openCustomize, closeCustomize, setCustomizeOpen,
      createTaskOpen, openCreateTask, closeCreateTask, createTaskPreselect,
      createListOpen, openCreateList, closeCreateList, createListPreselect,
      createSprintOpen, openCreateSprint, closeCreateSprint, createSprintPreselect,
      templateCenterOpen, templateCenterOpts, openTemplateCenter, closeTemplateCenter,
      lens, setLens,
      openItem, openItemDrawer, closeItemDrawer,
      bumpRowVersion, rowVersion,
      activeAppKey, setActiveApp,
      previewAppKey, setPreviewApp, keepPreview, clearPreviewSoon,
      sidebarCollapsed, toggleSidebar, setSidebarCollapsed,
      appsGridOpen, openAppsGrid, closeAppsGrid,
      railApps,
      recentAppKeys, pushRecentApp,
      iconsOnly, setIconsOnly,
      profileToolPins, toggleProfileToolPin, setProfileToolPins, isProfileToolPinned,
      presenceStatus, setPresenceStatus, statusModalOpen, openStatusModal, closeStatusModal,
      mutedNotifications, setMutedNotifications,
    }),
    [paletteOpen, openPalette, closePalette, sidekickOpen, openSidekick, closeSidekick, toggleSidekick, sidekickInitialPrompt, consumeSidekickInitialPrompt, customizeOpen, openCustomize, closeCustomize, createTaskOpen, openCreateTask, closeCreateTask, createTaskPreselect, createListOpen, openCreateList, closeCreateList, createListPreselect, createSprintOpen, openCreateSprint, closeCreateSprint, createSprintPreselect, templateCenterOpen, templateCenterOpts, openTemplateCenter, closeTemplateCenter, lens, setLens, openItem, openItemDrawer, closeItemDrawer, bumpRowVersion, rowVersion, activeAppKey, setActiveApp, previewAppKey, setPreviewApp, keepPreview, clearPreviewSoon, sidebarCollapsed, toggleSidebar, setSidebarCollapsed, appsGridOpen, openAppsGrid, closeAppsGrid, railApps, recentAppKeys, pushRecentApp, iconsOnly, setIconsOnly, profileToolPins, toggleProfileToolPin, setProfileToolPins, isProfileToolPinned, presenceStatus, setPresenceStatus, statusModalOpen, openStatusModal, closeStatusModal, mutedNotifications, setMutedNotifications],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOsShell() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOsShell must be used within OsShellProvider");
  return ctx;
}
