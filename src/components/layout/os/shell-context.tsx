"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { getApp, type AppEntry } from "./apps-catalog";
import { canAccessTier, parseOrgAppsConfig, visibleRailApps, type OrgAppsConfig } from "@/lib/rail-apps";
import { hubDefaultHref, isHubKey, type HubKey } from "@/lib/nav/route-hub";
import { MODULE_APP_KEYS } from "@/lib/modules";
import { apiFetch } from "@/lib/api-fetch";
import { readLastAppPath, recordLastAppPath, serverLastAppPath, subscribeLastAppPath } from "@/lib/settings-nav";
import type { EffectivePreferences } from "@/lib/preferences";

/**
 * LayerStack (spec-shell.md sections 1.5 and 2.1): every open overlay
 * registers itself; Esc closes the most recently registered one and nothing
 * else. No kind ordering, no z-index tie-break. A layer may refuse to close
 * (`canClose` false): the Session-expired dialog, a dirty form that opens its
 * confirm as a new layer instead.
 */
export type LayerKind = "palette" | "drawer" | "modal" | "panel" | "popover" | "dialog" | "splash";
export interface LayerEntry {
  id: string;
  kind: LayerKind;
  close: () => void;
  canClose?: () => boolean;
}
export type CloseTopLayerResult = "closed" | "refused" | "none";

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

/** The one call/huddle in progress, hoisted to the shell so it survives page
 *  navigation (a Slack-style floating dock). Exactly one lives at a time; the
 *  CallDock renders a single, never-unmounted CallPanel from it. */
export type ActiveCall = {
  /** Talk call (conversationId) XOR scheduled-meeting call (meetingId). */
  conversationId?: string;
  meetingId?: string;
  /** Legacy Jitsi room name — CallPanel needs it for the dark-box fallback. */
  room: string;
  /** Title shown in the dock header (channel/DM name or meeting subject). */
  subject: string;
  displayName: string | null;
  audioOnly: boolean;
  /** Collapsed to the compact pill vs the full floating window. */
  minimized: boolean;
  /** Where "expand"/clicking the dock takes the user (e.g. /tlk/<id>). */
  href: string;
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

  // Persistent call/huddle dock — survives navigation (see ActiveCall).
  activeCall: ActiveCall | null;
  /** Start (or switch to) a call; opens the floating dock, expanded. */
  startCall: (call: Omit<ActiveCall, "minimized">) => void;
  /** Leave the call and close the dock. */
  endCall: () => void;
  /** Collapse/expand the dock. Pass a value to force it. */
  setCallMinimized: (minimized: boolean) => void;

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

  // No navigation state lives here. Which hub the rail highlights and which
  // sidebar renders are pure functions of the URL (resolveHub in
  // src/lib/nav/route-hub.ts, spec-shell.md §1.1). `activeAppKey`,
  // `previewAppKey`, `setActiveApp` and the hover preview are deleted; the
  // only shell state left that touches the sidebar is whether it is collapsed,
  // which is a viewport preference, not a location.
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
  /**
   * Everything the viewer may open, hubs AND the apps folded into them. Same
   * org config, access and module filters as `railApps`; the folded apps are
   * simply not dropped. This is what a launcher or a search palette lists, so
   * a folded app (Library, SOPs, Kudos, …) is reachable without its own icon.
   */
  launcherApps: AppEntry[];
  /**
   * Where a rail/launcher click on this app key lands. For the eight hubs this
   * is `hubDefaultHref` with the org's module state and the viewer's role
   * applied (Talk and Settings are the only two conditional landings); for a
   * folded app it is the catalog's own `defaultHref`.
   */
  hubHref: (appKey: string) => string;
  /**
   * Which catalog app's sidebar the grey column renders for a resolved hub.
   * Two rules on top of "the URL decides": a hub the viewer may not see (the
   * org hid it, floored it above their tier, or never turned the module on)
   * falls back to Work rather than exposing chrome the access model calls
   * absent for everyone (§1.4), and Talk with its module off renders the
   * Announcements row alone, because Announcements is the only thing left in
   * that hub (§1.1).
   */
  hubSidebarApp: (hub: HubKey) => AppEntry;
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

  /** LayerStack: register an open overlay; returns the unregister. */
  registerLayer: (entry: LayerEntry) => () => void;
  /** Esc's one rule: close the top layer. */
  closeTopLayer: () => CloseTopLayerResult;
  /** How many layers are open (re-renders subscribers on change). */
  layerCount: number;
  /** The kind on top, for consumers that adapt (the shortcuts listener). */
  topLayerKind: LayerKind | null;

  /**
   * The last pathname (+ search) outside /settings and /account, mirrored to
   * sessionStorage["workwrk:shell:last-app-path"] so closeSettings() has a
   * fallback after a hard refresh inside a door (settings spec section 8.3).
   */
  lastAppPath: string | null;

  /** Boot-time preferences fetch failed with a non-401 error; null when fine. */
  prefsError: string | null;
  /** Re-run the preferences fetch (the shell's ErrorState Retry). */
  refetchPrefs: () => void;
};

const Ctx = createContext<ShellState | null>(null);

// Retired with the URL-derived nav (spec-shell.md §1.1): "active-app" stored
// which hub the sidebar showed, "lens" had no consumer at all. Both are removed
// from a returning user's browser on boot so a stale value cannot outlive the
// code that read it.
const RETIRED_KEYS = ["workwrk:os:active-app", "workwrk:os:lens"];
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
  const pathname = usePathname();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidekickOpen, setSidekickOpen] = useState(false);
  const [sidekickInitialPrompt, setSidekickInitialPrompt] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskPreselect, setCreateTaskPreselect] = useState<CreateTaskPreselect | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [createListOpen, setCreateListOpen] = useState(false);
  const [createListPreselect, setCreateListPreselect] = useState<{ spaceId?: string; folderId?: string } | null>(null);
  const [createSprintOpen, setCreateSprintOpen] = useState(false);
  const [createSprintPreselect, setCreateSprintPreselect] = useState<{ spaceId?: string; folderId?: string } | null>(null);
  const [templateCenterOpen, setTemplateCenterOpen] = useState(false);
  const [templateCenterOpts, setTemplateCenterOpts] = useState<TemplateCenterOpts | null>(null);
  const [openItem, setOpenItem] = useState<OpenItem | null>(null);
  const [rowVersions, setRowVersions] = useState<Record<string, number>>({});
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
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [prefsVersion, setPrefsVersion] = useState(0);
  // lastAppPath: the last pathname outside the settings takeover, kept in
  // sessionStorage by settings-nav so a hard refresh inside a door still has
  // an exit; read as an external store (null during SSR and hydration).
  const lastAppPath = useSyncExternalStore(subscribeLastAppPath, readLastAppPath, serverLastAppPath);

  // ── LayerStack ──────────────────────────────────────────────────
  // The stack lives in a ref so closeTopLayer (called from the one window
  // keydown listener) always sees the current top synchronously. The two
  // values consumers render, count and top kind, are a state snapshot taken
  // whenever the stack changes, so nothing reads the ref during render.
  const layersRef = useRef<LayerEntry[]>([]);
  const [layerSnapshot, setLayerSnapshot] = useState<{ count: number; top: LayerKind | null }>({ count: 0, top: null });
  const snapshotLayers = useCallback(() => {
    const list = layersRef.current;
    const top = list[list.length - 1]?.kind ?? null;
    setLayerSnapshot((prev) => (prev.count === list.length && prev.top === top ? prev : { count: list.length, top }));
  }, []);
  const registerLayer = useCallback((entry: LayerEntry) => {
    layersRef.current = [...layersRef.current.filter((l) => l.id !== entry.id), entry];
    snapshotLayers();
    return () => {
      if (layersRef.current.some((l) => l.id === entry.id)) {
        layersRef.current = layersRef.current.filter((l) => l.id !== entry.id);
        snapshotLayers();
      }
    };
  }, [snapshotLayers]);
  const closeTopLayer = useCallback((): CloseTopLayerResult => {
    const top = layersRef.current[layersRef.current.length - 1];
    if (!top) return "none";
    if (top.canClose && !top.canClose()) return "refused";
    top.close();
    return "closed";
  }, []);
  const layerCount = layerSnapshot.count;
  const topLayerKind = layerSnapshot.top;

  // Record every app pathname (recordLastAppPath ignores the doors itself);
  // the store notifies the reader above.
  useEffect(() => {
    if (!pathname) return;
    recordLastAppPath(pathname, window.location.search);
  }, [pathname]);

  useEffect(() => {
    const storageTimer = window.setTimeout(() => {
      try {
        // Migration courtesy: drop the keys the URL-derived nav retired. A
        // stored value is never read, so this only keeps a dead key from
        // living forever in every existing browser.
        for (const key of RETIRED_KEYS) window.localStorage.removeItem(key);
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
    // Through apiFetch (spec-shell section 1.7): a 401 here surfaces the
    // SessionExpiredDialog instead of leaving the rail in its pre-fetch
    // state forever; any other failure is kept as `prefsError` for the
    // shell to render, never swallowed.
    let alive = true;
    const loadServerPrefs = async () => {
      const r = await apiFetch<{ effective?: Partial<EffectivePreferences> }>("/api/preferences", { cache: "no-store" });
      if (!alive) return;
      if (!r.ok) {
        // 401 has already been announced by apiFetch; anything else is ours.
        if (r.status !== 401) setPrefsError(r.error);
        return;
      }
      setPrefsError(null);
      const sidebar = r.data?.effective?.sidebar;
      if (!sidebar) return;
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
      const activeAppKeys = r.data?.effective?.modules?.activeAppKeys;
      setActiveModuleKeys(
        Array.isArray(activeAppKeys) && activeAppKeys.every((k: unknown) => typeof k === "string")
          ? activeAppKeys
          : [],
      );
    };
    void loadServerPrefs();
    const onPrefsChanged = () => void loadServerPrefs();
    window.addEventListener("workwrk:prefs-changed", onPrefsChanged);
    return () => {
      alive = false;
      window.clearTimeout(storageTimer);
      window.removeEventListener("workwrk:prefs-changed", onPrefsChanged);
    };
  }, [prefsVersion]);

  const refetchPrefs = useCallback(() => setPrefsVersion((v) => v + 1), []);

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
  // Lets any component open the Sidekick without threading this context through
  // it (the empty-state "Ask Sidekick" buttons, header "Ask AI", etc.).
  useEffect(() => {
    const onAsk = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      openSidekick(typeof prompt === "string" ? prompt : undefined);
    };
    window.addEventListener("workwrk:os:ask-sidekick", onAsk);
    return () => window.removeEventListener("workwrk:os:ask-sidekick", onAsk);
  }, [openSidekick]);
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
  const startCall = useCallback((call: Omit<ActiveCall, "minimized">) => {
    // Same target already live → just make sure it's visible (expanded).
    setActiveCall((prev) =>
      prev &&
      prev.conversationId === call.conversationId &&
      prev.meetingId === call.meetingId
        ? { ...prev, minimized: false }
        : { ...call, minimized: false },
    );
  }, []);
  const endCall = useCallback(() => setActiveCall(null), []);
  const setCallMinimized = useCallback((minimized: boolean) => {
    setActiveCall((prev) => (prev ? { ...prev, minimized } : prev));
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
  // The same resolution with the folded apps kept in. The rail shows hubs; a
  // launcher or the palette shows this, so none of the 19 folded apps is
  // reachable only by typing its URL.
  const launcherApps = useMemo<AppEntry[]>(
    () =>
      visibleRailApps({
        config: railConfig,
        accessLevel,
        activeModules: activeModuleKeys ? new Set(activeModuleKeys) : undefined,
        includeFolded: true,
      }),
    [railConfig, accessLevel, activeModuleKeys],
  );
  // Talk's landing depends on the module being on, Settings' on whether the
  // viewer may open the workspace door. Both inputs live here, so the two
  // branches resolve here once instead of at every click site.
  const hubHref = useCallback(
    (appKey: string): string => {
      if (isHubKey(appKey)) {
        return hubDefaultHref(appKey, {
          // null = /api/preferences has not answered; unknown reads as on,
          // which is what the hub does today.
          talkModuleOn: activeModuleKeys === null ? undefined : activeModuleKeys.includes("chat"),
          // undefined = the session has not hydrated. Every viewer landed on
          // /settings before this change, so unknown keeps the workspace door
          // rather than sending an Owner to the personal one on a fast click.
          canManageWorkspace:
            accessLevel === undefined ? true : canAccessTier("org-admin", accessLevel),
        });
      }
      return getApp(appKey)?.defaultHref ?? "/";
    },
    [activeModuleKeys, accessLevel],
  );
  const railKeys = useMemo(() => new Set(railApps.map((a) => a.key)), [railApps]);
  const launcherKeys = useMemo(() => new Set(launcherApps.map((a) => a.key)), [launcherApps]);
  const isHubVisible = useCallback(
    (hubKey: string): boolean => {
      // Module state arrives with /api/preferences. While it is unknown the two
      // module hubs count as visible, so a reload inside Talk or Tables never
      // blinks through another hub's chrome on the way to the answer.
      if (activeModuleKeys === null && MODULE_APP_KEYS.has(hubKey)) return true;
      return railKeys.has(hubKey);
    },
    [railKeys, activeModuleKeys],
  );
  const hubSidebarApp = useCallback(
    (hub: HubKey): AppEntry => {
      const work = getApp("home")!; // alwaysPinned, so it is always resolvable
      if (hub === "chat" && activeModuleKeys !== null && !activeModuleKeys.includes("chat")) {
        // Module off: Announcements is all that is left in the hub, so its one
        // row is the sidebar. Only when the viewer may actually open it.
        const announce = getApp("announcements");
        if (announce && launcherKeys.has("announcements")) return announce;
      }
      if (!isHubVisible(hub)) return work;
      return getApp(hub) ?? work;
    },
    [activeModuleKeys, launcherKeys, isHubVisible],
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

  // The global keyboard map moved to src/lib/shortcuts.ts, dispatched by the
  // one window listener in shell-shortcuts.tsx (spec-shell section 1.8).
  // The palette and the item drawer are layers, so Esc closes them through
  // the LayerStack (topmost first) instead of a hard-coded branch here.
  useEffect(() => {
    if (!paletteOpen) return;
    return registerLayer({ id: "palette", kind: "palette", close: () => setPaletteOpen(false) });
  }, [paletteOpen, registerLayer]);
  useEffect(() => {
    if (!openItem) return;
    return registerLayer({ id: "item-drawer", kind: "drawer", close: () => setOpenItem(null) });
  }, [openItem, registerLayer]);

  const value = useMemo<ShellState>(
    () => ({
      paletteOpen, openPalette, closePalette,
      sidekickOpen, openSidekick, closeSidekick, toggleSidekick,
      sidekickInitialPrompt, consumeSidekickInitialPrompt,
      customizeOpen, openCustomize, closeCustomize, setCustomizeOpen,
      createTaskOpen, openCreateTask, closeCreateTask, createTaskPreselect,
      activeCall, startCall, endCall, setCallMinimized,
      createListOpen, openCreateList, closeCreateList, createListPreselect,
      createSprintOpen, openCreateSprint, closeCreateSprint, createSprintPreselect,
      templateCenterOpen, templateCenterOpts, openTemplateCenter, closeTemplateCenter,
      openItem, openItemDrawer, closeItemDrawer,
      bumpRowVersion, rowVersion,
      sidebarCollapsed, toggleSidebar, setSidebarCollapsed,
      appsGridOpen, openAppsGrid, closeAppsGrid,
      railApps, launcherApps, hubHref, hubSidebarApp,
      recentAppKeys, pushRecentApp,
      iconsOnly, setIconsOnly,
      profileToolPins, toggleProfileToolPin, setProfileToolPins, isProfileToolPinned,
      presenceStatus, setPresenceStatus, statusModalOpen, openStatusModal, closeStatusModal,
      mutedNotifications, setMutedNotifications,
      registerLayer, closeTopLayer, layerCount, topLayerKind,
      lastAppPath,
      prefsError, refetchPrefs,
    }),
    [paletteOpen, openPalette, closePalette, sidekickOpen, openSidekick, closeSidekick, toggleSidekick, sidekickInitialPrompt, consumeSidekickInitialPrompt, customizeOpen, openCustomize, closeCustomize, createTaskOpen, openCreateTask, closeCreateTask, createTaskPreselect, activeCall, startCall, endCall, setCallMinimized, createListOpen, openCreateList, closeCreateList, createListPreselect, createSprintOpen, openCreateSprint, closeCreateSprint, createSprintPreselect, templateCenterOpen, templateCenterOpts, openTemplateCenter, closeTemplateCenter, openItem, openItemDrawer, closeItemDrawer, bumpRowVersion, rowVersion, sidebarCollapsed, toggleSidebar, setSidebarCollapsed, appsGridOpen, openAppsGrid, closeAppsGrid, railApps, launcherApps, hubHref, hubSidebarApp, recentAppKeys, pushRecentApp, iconsOnly, setIconsOnly, profileToolPins, toggleProfileToolPin, setProfileToolPins, isProfileToolPinned, presenceStatus, setPresenceStatus, statusModalOpen, openStatusModal, closeStatusModal, mutedNotifications, setMutedNotifications, registerLayer, closeTopLayer, layerCount, topLayerKind, lastAppPath, prefsError, refetchPrefs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOsShell() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOsShell must be used within OsShellProvider");
  return ctx;
}

/**
 * Register an overlay as a layer while `open` is true. Esc then closes it
 * through the LayerStack, topmost first; the component registers a layer
 * instead of its own keydown listener (spec-shell section 1.5). Safe to call
 * outside the provider (no-op), so a component mounted above OsShell, such
 * as the Session-expired dialog, can share the code path.
 */
export function useLayer(open: boolean, entry: Omit<LayerEntry, "id"> & { id?: string }): void {
  const ctx = useContext(Ctx);
  const register = ctx?.registerLayer;
  // The latest close/canClose live in refs, refreshed after every render, so
  // the registered layer never re-registers when the caller's callbacks change.
  const closeRef = useRef(entry.close);
  const canCloseRef = useRef(entry.canClose);
  useEffect(() => {
    closeRef.current = entry.close;
    canCloseRef.current = entry.canClose;
  });
  const autoId = useId();
  const id = entry.id ?? `layer-${autoId}`;
  const kind = entry.kind;
  useEffect(() => {
    if (!open || !register) return;
    return register({
      id,
      kind,
      close: () => closeRef.current(),
      canClose: () => (canCloseRef.current ? canCloseRef.current() : true),
    });
  }, [open, register, id, kind]);
}
