"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ALWAYS_PINNED_KEYS, APPS, DEFAULT_PINNED_KEYS, isAlwaysPinned } from "./apps-catalog";

/** Always-pinned keys come first, then the user's chosen order minus dupes. */
function ensureAlwaysPinned(keys: string[]): string[] {
  const appKeys = new Set(APPS.map((app) => app.key));
  const validInput = keys.filter((key) => appKeys.has(key));
  const hasUnknownKeys = validInput.length !== keys.length;
  const onlyAlwaysPinned =
    validInput.length > 0 && validInput.every((key) => ALWAYS_PINNED_KEYS.includes(key));
  const shouldRecoverDefaultPins = hasUnknownKeys && (validInput.length === 0 || onlyAlwaysPinned);
  const source = shouldRecoverDefaultPins ? DEFAULT_PINNED_KEYS : validInput;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of ALWAYS_PINNED_KEYS) { out.push(k); seen.add(k); }
  for (const k of source) {
    if (!seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  return out;
}

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
  "record-clip",
  "create-reminder",
  "create-doc",
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
  openCreateList: () => void;
  closeCreateList: () => void;

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
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  appsGridOpen: boolean;
  openAppsGrid: () => void;
  closeAppsGrid: () => void;

  /** Rail pin set — which app keys render in the left rail (persisted). */
  pinnedAppKeys: string[];
  togglePinned: (key: string) => void;
  setPinnedAppKeys: (keys: string[]) => void;
  isPinned: (key: string) => boolean;
  /** Move a pinned app to a new index (used for drag-to-reorder). */
  movePinned: (fromKey: string, toIndex: number) => void;

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
const PINNED_APPS_KEY = "workwrk:os:pinned-apps";
const RECENT_APPS_KEY = "workwrk:os:recent-apps";
const ICONS_ONLY_KEY = "workwrk:os:icons-only";
const PROFILE_TOOL_PINS_KEY = "workwrk:os:profile-tool-pins";
const PRESENCE_KEY = "workwrk:os:presence";
const MUTED_NOTIFS_KEY = "workwrk:os:muted-notifs";
const MAX_RECENTS = 6;

export function OsShellProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidekickOpen, setSidekickOpen] = useState(false);
  const [sidekickInitialPrompt, setSidekickInitialPrompt] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskPreselect, setCreateTaskPreselect] = useState<CreateTaskPreselect | null>(null);
  const [createListOpen, setCreateListOpen] = useState(false);
  const [templateCenterOpen, setTemplateCenterOpen] = useState(false);
  const [templateCenterOpts, setTemplateCenterOpts] = useState<TemplateCenterOpts | null>(null);
  const [lens, setLensState] = useState<Lens>("me");
  const [openItem, setOpenItem] = useState<OpenItem | null>(null);
  const [rowVersions, setRowVersions] = useState<Record<string, number>>({});
  const [activeAppKey, setActiveAppKeyState] = useState<string>("home");
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(false);
  const [appsGridOpen, setAppsGridOpen] = useState(false);
  const [pinnedAppKeys, setPinnedAppKeysState] = useState<string[]>(DEFAULT_PINNED_KEYS);
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
        const pins = window.localStorage.getItem(PINNED_APPS_KEY);
        if (pins) {
          const parsed = JSON.parse(pins);
          if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
            setPinnedAppKeysState(ensureAlwaysPinned(parsed));
          }
        }
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
        if (Array.isArray(sidebar.pinned) && sidebar.pinned.length > 0) {
          const next = ensureAlwaysPinned(sidebar.pinned.filter((k: unknown): k is string => typeof k === "string"));
          setPinnedAppKeysState(next);
          try { window.localStorage.setItem(PINNED_APPS_KEY, JSON.stringify(next)); } catch {}
        }
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

  // Fire-and-forget server save. Declared before movePinned/togglePinned/
  // setPinnedAppKeys so those useCallback closures can reference it.
  const savePinsToServer = useCallback((keys: string[]) => {
    try {
      void fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sidebar: { pinned: keys } }),
      });
    } catch {}
  }, []);

  const movePinned = useCallback((fromKey: string, toIndex: number) => {
    if (isAlwaysPinned(fromKey)) return; // alwaysPinned apps stay anchored
    setPinnedAppKeysState((prev) => {
      const idx = prev.indexOf(fromKey);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      const clamped = Math.max(0, Math.min(toIndex, next.length));
      next.splice(clamped, 0, fromKey);
      const final = ensureAlwaysPinned(next);
      try { window.localStorage.setItem(PINNED_APPS_KEY, JSON.stringify(final)); } catch {}
      savePinsToServer(final);
      return final;
    });
  }, [savePinsToServer]);

  const pushRecentApp = useCallback((key: string) => {
    setRecentAppKeysState((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, MAX_RECENTS);
      try { window.localStorage.setItem(RECENT_APPS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const setPinnedAppKeys = useCallback((keys: string[]) => {
    const final = ensureAlwaysPinned(keys);
    setPinnedAppKeysState(final);
    try { window.localStorage.setItem(PINNED_APPS_KEY, JSON.stringify(final)); } catch {}
    savePinsToServer(final);
  }, [savePinsToServer]);

  const togglePinned = useCallback((key: string) => {
    if (isAlwaysPinned(key)) return; // alwaysPinned apps can't be unpinned
    setPinnedAppKeysState((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      const final = ensureAlwaysPinned(next);
      try { window.localStorage.setItem(PINNED_APPS_KEY, JSON.stringify(final)); } catch {}
      savePinsToServer(final);
      return final;
    });
  }, [savePinsToServer]);

  const setLens = useCallback((l: Lens) => {
    setLensState(l);
    try { window.localStorage.setItem(LENS_KEY, l); } catch {}
  }, []);

  const setActiveApp = useCallback((key: string) => {
    setActiveAppKeyState(key);
    setSidebarCollapsedState(false);
    try {
      window.localStorage.setItem(ACTIVE_APP_KEY, key);
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "0");
    } catch {}
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
  const openCreateList = useCallback(() => setCreateListOpen(true), []);
  const closeCreateList = useCallback(() => setCreateListOpen(false), []);
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
  const isPinned = useCallback((key: string) => pinnedAppKeys.includes(key), [pinnedAppKeys]);

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
      if (meta && e.key.toLowerCase() === "k") {
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
        // Cmd+1..9 → jump to the Nth pinned app.
        const idx = parseInt(e.key, 10) - 1;
        const key = pinnedAppKeys[idx];
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
  }, [pinnedAppKeys]);

  const value = useMemo<ShellState>(
    () => ({
      paletteOpen, openPalette, closePalette,
      sidekickOpen, openSidekick, closeSidekick, toggleSidekick,
      sidekickInitialPrompt, consumeSidekickInitialPrompt,
      customizeOpen, openCustomize, closeCustomize, setCustomizeOpen,
      createTaskOpen, openCreateTask, closeCreateTask, createTaskPreselect,
      createListOpen, openCreateList, closeCreateList,
      templateCenterOpen, templateCenterOpts, openTemplateCenter, closeTemplateCenter,
      lens, setLens,
      openItem, openItemDrawer, closeItemDrawer,
      bumpRowVersion, rowVersion,
      activeAppKey, setActiveApp,
      sidebarCollapsed, toggleSidebar, setSidebarCollapsed,
      appsGridOpen, openAppsGrid, closeAppsGrid,
      pinnedAppKeys, togglePinned, setPinnedAppKeys, isPinned, movePinned,
      recentAppKeys, pushRecentApp,
      iconsOnly, setIconsOnly,
      profileToolPins, toggleProfileToolPin, setProfileToolPins, isProfileToolPinned,
      presenceStatus, setPresenceStatus, statusModalOpen, openStatusModal, closeStatusModal,
      mutedNotifications, setMutedNotifications,
    }),
    [paletteOpen, openPalette, closePalette, sidekickOpen, openSidekick, closeSidekick, toggleSidekick, sidekickInitialPrompt, consumeSidekickInitialPrompt, customizeOpen, openCustomize, closeCustomize, createTaskOpen, openCreateTask, closeCreateTask, createTaskPreselect, createListOpen, openCreateList, closeCreateList, templateCenterOpen, templateCenterOpts, openTemplateCenter, closeTemplateCenter, lens, setLens, openItem, openItemDrawer, closeItemDrawer, bumpRowVersion, rowVersion, activeAppKey, setActiveApp, sidebarCollapsed, toggleSidebar, setSidebarCollapsed, appsGridOpen, openAppsGrid, closeAppsGrid, pinnedAppKeys, togglePinned, setPinnedAppKeys, isPinned, movePinned, recentAppKeys, pushRecentApp, iconsOnly, setIconsOnly, profileToolPins, toggleProfileToolPin, setProfileToolPins, isProfileToolPinned, presenceStatus, setPresenceStatus, statusModalOpen, openStatusModal, closeStatusModal, mutedNotifications, setMutedNotifications],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOsShell() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOsShell must be used within OsShellProvider");
  return ctx;
}
