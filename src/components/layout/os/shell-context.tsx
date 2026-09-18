"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { getApp, type AppEntry } from "./apps-catalog";
import { canAccessTier, parseOrgAppsConfig, visibleRailApps, type OrgAppsConfig } from "@/lib/rail-apps";
import { hubDefaultHref, isHubKey, type HubKey } from "@/lib/nav/route-hub";
import { apiFetch } from "@/lib/api-fetch";
import { readLastAppPath, recordLastAppPath, serverLastAppPath, subscribeLastAppPath } from "@/lib/settings-nav";
import { deepMergePatch, type PreferencesPatch } from "@/lib/preferences-schema";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import type { EffectivePreferences } from "@/lib/preferences";
import { useBoot } from "./boot-context";

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
  /** Legacy Jitsi room name, which CallPanel needs for the dark-box fallback. */
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

export type OpenItem = {
  moduleId: string;
  itemId: string;
  name: string;
  groupColor?: string;
  payload?: Record<string, unknown>;
};

/** Sidebar width bounds (design-system 4.2): 240 to 320, default 264. */
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 320;
export const SIDEBAR_DEFAULT_WIDTH = 264;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

type ShellState = {
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;

  sidekickOpen: boolean;
  openSidekick: (initialPrompt?: string) => void;
  closeSidekick: () => void;
  toggleSidekick: () => void;
  sidekickInitialPrompt: string | null;
  consumeSidekickInitialPrompt: () => string | null;

  customizeOpen: boolean;
  openCustomize: () => void;
  closeCustomize: () => void;
  setCustomizeOpen: (v: boolean) => void;

  createTaskOpen: boolean;
  openCreateTask: (preselect?: CreateTaskPreselect | null) => void;
  closeCreateTask: () => void;
  createTaskPreselect: CreateTaskPreselect | null;

  activeCall: ActiveCall | null;
  startCall: (call: Omit<ActiveCall, "minimized">) => void;
  endCall: () => void;
  setCallMinimized: (minimized: boolean) => void;

  createListOpen: boolean;
  openCreateList: (preselect?: { spaceId?: string; folderId?: string } | null) => void;
  closeCreateList: () => void;
  createListPreselect: { spaceId?: string; folderId?: string } | null;

  createSprintOpen: boolean;
  openCreateSprint: (preselect?: { spaceId?: string; folderId?: string } | null) => void;
  closeCreateSprint: () => void;
  createSprintPreselect: { spaceId?: string; folderId?: string } | null;

  templateCenterOpen: boolean;
  templateCenterOpts: TemplateCenterOpts | null;
  openTemplateCenter: (opts?: TemplateCenterOpts) => void;
  closeTemplateCenter: () => void;

  /**
   * No navigation state lives here. Which hub the rail highlights and which
   * sidebar renders are pure functions of the URL (resolveHub in
   * src/lib/nav/route-hub.ts, spec-shell.md 1.1). The only shell state that
   * touches the sidebar is whether it is collapsed and how wide it is, both
   * viewer preferences persisted through PATCH /api/preferences (1.2 rule 11).
   */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (w: number, opts?: { persist?: boolean }) => void;

  /** The rail hubs this viewer sees, in the org's order. */
  railApps: AppEntry[];
  /** Hubs AND folded apps the viewer may open: what the palette's Apps group lists. */
  launcherApps: AppEntry[];
  /** Premium modules the org has switched off, for Owners and Admins only (1.4). */
  manageableOffModules: string[];
  /**
   * Whether POST /api/spaces would accept this viewer (the manager tier
   * today): the Create menu's Space row and the SPACES "+" render only when
   * true, so a row that appears always works (2.10). The tier read lives
   * here, in the one allow-listed shell file, until the engine's can().
   */
  canCreateSpace: boolean;
  /** Where a rail or launcher click on this app key lands. */
  hubHref: (appKey: string) => string;
  /** Which catalog app's sidebar the grey column renders for a resolved hub. */
  hubSidebarApp: (hub: HubKey) => AppEntry;
  /** Recently launched apps (palette ephemera, most-recent-first, capped at 6). */
  recentAppKeys: string[];
  pushRecentApp: (key: string) => void;

  /** Effective preferences: seeded from boot, refreshed on every change. */
  prefs: EffectivePreferences;
  /** Optimistic PATCH /api/preferences. Resolves false (and reverts) on failure. */
  patchPrefs: (patch: PreferencesPatch) => Promise<boolean>;
  refetchPrefs: () => void;

  /** Presence (local until User.presenceStatus lands, settings spec 9.5). */
  presenceStatus: PresenceStatus;
  setPresenceStatus: (s: PresenceStatus) => void;
  statusModalOpen: boolean;
  openStatusModal: () => void;
  closeStatusModal: () => void;

  /** home.notifications.mutedUntil, ISO or null; true while in the future. */
  mutedUntil: string | null;
  mutedNotifications: boolean;
  setMutedUntil: (iso: string | null) => Promise<boolean>;

  openItem: OpenItem | null;
  openItemDrawer: (it: OpenItem) => void;
  closeItemDrawer: () => void;

  bumpRowVersion: (moduleId: string) => void;
  rowVersion: (moduleId: string) => number;

  registerLayer: (entry: LayerEntry) => () => void;
  closeTopLayer: () => CloseTopLayerResult;
  layerCount: number;
  topLayerKind: LayerKind | null;

  /** True while a route transition is pending past 200ms: the rail logo pulses. */
  routePending: boolean;
  setRoutePending: (v: boolean) => void;

  lastAppPath: string | null;
};

const Ctx = createContext<ShellState | null>(null);
/** The raw context, for the few hooks that must work outside the frame too (use-hub-back). */
export const OsShellContext = Ctx;

// Retired keys removed from a returning browser on boot so a stale value
// cannot outlive the code that read it. The last four went with the
// icons-only option, the quick-tool pins, the localStorage sidebar state
// and the localStorage mute (all server preferences now, 1.2 rule 11).
const RETIRED_KEYS = [
  "workwrk:os:active-app",
  "workwrk:os:lens",
  "workwrk:os:icons-only",
  "workwrk:os:profile-tool-pins:v2",
  "workwrk:os:sidebar-collapsed",
  "workwrk:os:sidebar-width",
  "workwrk:os:muted-notifs",
  "workwrk:density",
];
const RECENT_APPS_KEY = "workwrk:os:recent-apps";
const PRESENCE_KEY = "workwrk:os:presence";
const MAX_RECENTS = 6;
const WIDTH_PERSIST_MS = 500;

export function OsShellProvider({ children }: { children: React.ReactNode }) {
  const { boot } = useBoot();
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
  const [recentAppKeys, setRecentAppKeysState] = useState<string[]>([]);
  const [presenceStatus, setPresenceStatusState] = useState<PresenceStatus>(DEFAULT_PRESENCE);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [routePending, setRoutePending] = useState(false);

  // Preferences: the boot payload is the first value, so the first paint has
  // the right density, chrome, sidebar width and collapse state.
  const [prefs, setPrefs] = useState<EffectivePreferences>(boot.prefs);
  const prefsRef = useRef(prefs);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(Boolean(boot.prefs.sidebar.collapsed));
  const [sidebarWidth, setSidebarWidthState] = useState<number>(
    clampSidebarWidth(typeof boot.prefs.sidebar.width === "number" ? boot.prefs.sidebar.width : SIDEBAR_DEFAULT_WIDTH),
  );

  const lastAppPath = useSyncExternalStore(subscribeLastAppPath, readLastAppPath, serverLastAppPath);

  // ── LayerStack ──────────────────────────────────────────────────
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

  useEffect(() => {
    if (!pathname) return;
    recordLastAppPath(pathname, window.location.search);
  }, [pathname]);

  // Storage: retire dead keys, restore the two pieces of client ephemera.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        for (const key of RETIRED_KEYS) window.localStorage.removeItem(key);
        const recents = window.localStorage.getItem(RECENT_APPS_KEY);
        if (recents) {
          const parsed = JSON.parse(recents);
          if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
            setRecentAppKeysState(parsed.slice(0, MAX_RECENTS));
          }
        }
        const pres = window.localStorage.getItem(PRESENCE_KEY);
        if (pres) {
          const parsed = JSON.parse(pres);
          if (parsed && typeof parsed.label === "string") {
            const expiresAt = typeof parsed.expiresAt === "string" ? parsed.expiresAt : null;
            if (!expiresAt || new Date(expiresAt).getTime() > Date.now()) {
              setPresenceStatusState({ emoji: typeof parsed.emoji === "string" ? parsed.emoji : null, label: parsed.label, expiresAt });
            }
          }
        }
      } catch {}
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // ── Preferences: refetch on change events, PATCH optimistically ──
  const reloadPrefs = useCallback(async () => {
    const r = await apiFetch<{ effective?: EffectivePreferences }>("/api/preferences", { cache: "no-store" });
    if (r.ok && r.data?.effective) setPrefs(r.data.effective);
  }, []);
  useEffect(() => {
    const onChanged = (e: Event) => {
      // Our own PATCH already applied the server's answer; only other
      // writers (the settings pages, SSE prefs.changed) need a refetch.
      if ((e as CustomEvent<{ source?: string }>).detail?.source === "shell") return;
      void reloadPrefs();
    };
    window.addEventListener(WINDOW_EVENTS.prefsChanged, onChanged);
    return () => window.removeEventListener(WINDOW_EVENTS.prefsChanged, onChanged);
  }, [reloadPrefs]);
  const refetchPrefs = useCallback(() => { void reloadPrefs(); }, [reloadPrefs]);

  const patchPrefs = useCallback(async (patch: PreferencesPatch): Promise<boolean> => {
    const before = prefsRef.current;
    const optimistic = deepMergePatch<EffectivePreferences>(before, patch);
    setPrefs(optimistic);
    const r = await apiFetch<{ effective?: EffectivePreferences }>("/api/preferences", {
      method: "PATCH",
      json: patch,
    });
    if (!r.ok) {
      setPrefs(before);
      return false;
    }
    if (r.data?.effective) setPrefs(r.data.effective);
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.prefsChanged, { detail: { source: "shell" } }));
    return true;
  }, []);

  // Sidebar collapse and width persist through the same PATCH (1.2 rule 11).
  const setSidebarCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsedState(v);
    void patchPrefs({ sidebar: { collapsed: v } });
  }, [patchPrefs]);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsedState((prev) => {
      const next = !prev;
      void patchPrefs({ sidebar: { collapsed: next } });
      return next;
    });
  }, [patchPrefs]);
  const widthTimer = useRef<number | null>(null);
  const setSidebarWidth = useCallback((w: number, opts?: { persist?: boolean }) => {
    const next = clampSidebarWidth(w);
    setSidebarWidthState(next);
    if (opts?.persist === false) return;
    if (widthTimer.current) window.clearTimeout(widthTimer.current);
    widthTimer.current = window.setTimeout(() => {
      widthTimer.current = null;
      void patchPrefs({ sidebar: { width: next } });
    }, WIDTH_PERSIST_MS);
  }, [patchPrefs]);
  useEffect(() => () => { if (widthTimer.current) window.clearTimeout(widthTimer.current); }, []);

  const pushRecentApp = useCallback((key: string) => {
    setRecentAppKeysState((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, MAX_RECENTS);
      try { window.localStorage.setItem(RECENT_APPS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openSidekick = useCallback((initialPrompt?: string) => {
    if (initialPrompt && initialPrompt.trim().length > 0) {
      setSidekickInitialPrompt(initialPrompt);
    }
    setSidekickOpen(true);
  }, []);
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

  // ── The rail (org config + tier + module state), from the live prefs ──
  const railConfig = useMemo<OrgAppsConfig>(() => parseOrgAppsConfig(prefs.sidebar.apps), [prefs.sidebar.apps]);
  const activeModuleKeys = useMemo<string[]>(
    () => (Array.isArray(prefs.modules?.activeAppKeys) ? prefs.modules.activeAppKeys : []),
    [prefs.modules],
  );
  const railApps = useMemo<AppEntry[]>(
    () => visibleRailApps({ config: railConfig, accessLevel, activeModules: new Set(activeModuleKeys) }),
    [railConfig, accessLevel, activeModuleKeys],
  );
  const launcherApps = useMemo<AppEntry[]>(
    () => visibleRailApps({ config: railConfig, accessLevel, activeModules: new Set(activeModuleKeys), includeFolded: true }),
    [railConfig, accessLevel, activeModuleKeys],
  );
  const manageableOffModules = boot.manageableOffModules;
  const canCreateSpace = accessLevel !== undefined && !boot.viewer.isAgent && boot.viewer.orgRole !== "GUEST" && canAccessTier("manager", accessLevel);
  const hubHref = useCallback(
    (appKey: string): string => {
      if (isHubKey(appKey)) {
        return hubDefaultHref(appKey, {
          talkModuleOn: activeModuleKeys.includes("chat"),
          canManageWorkspace: accessLevel === undefined ? true : canAccessTier("org-admin", accessLevel),
        });
      }
      return getApp(appKey)?.defaultHref ?? "/";
    },
    [activeModuleKeys, accessLevel],
  );
  const railKeys = useMemo(() => new Set(railApps.map((a) => a.key)), [railApps]);
  const launcherKeys = useMemo(() => new Set(launcherApps.map((a) => a.key)), [launcherApps]);
  const isHubVisible = useCallback((hubKey: string): boolean => railKeys.has(hubKey), [railKeys]);
  const hubSidebarApp = useCallback(
    (hub: HubKey): AppEntry => {
      const work = getApp("home")!;
      if (hub === "chat" && !activeModuleKeys.includes("chat")) {
        const announce = getApp("announcements");
        if (announce && launcherKeys.has("announcements")) return announce;
      }
      if (!isHubVisible(hub)) return work;
      return getApp(hub) ?? work;
    },
    [activeModuleKeys, launcherKeys, isHubVisible],
  );

  const setPresenceStatus = useCallback((s: PresenceStatus) => {
    setPresenceStatusState(s);
    try { window.localStorage.setItem(PRESENCE_KEY, JSON.stringify(s)); } catch {}
  }, []);
  const openStatusModal = useCallback(() => setStatusModalOpen(true), []);
  const closeStatusModal = useCallback(() => setStatusModalOpen(false), []);

  const mutedUntil = prefs.home.notifications?.mutedUntil ?? null;
  // "Now" is sampled in an effect (never during render) and refreshed each
  // minute, so a mute that lapses flips the flag without a reload.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t0 = window.setTimeout(tick, 0);
    const iv = window.setInterval(tick, 60_000);
    return () => { window.clearTimeout(t0); window.clearInterval(iv); };
  }, []);
  const mutedNotifications = Boolean(mutedUntil && now > 0 && new Date(mutedUntil).getTime() > now);
  const setMutedUntil = useCallback(
    (iso: string | null) => patchPrefs({ home: { notifications: { mutedUntil: iso } } }),
    [patchPrefs],
  );

  // The palette and the legacy item drawer are layers, closed through Esc.
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
      sidebarCollapsed, toggleSidebar, setSidebarCollapsed, sidebarWidth, setSidebarWidth,
      railApps, launcherApps, manageableOffModules, canCreateSpace, hubHref, hubSidebarApp,
      recentAppKeys, pushRecentApp,
      prefs, patchPrefs, refetchPrefs,
      presenceStatus, setPresenceStatus, statusModalOpen, openStatusModal, closeStatusModal,
      mutedUntil, mutedNotifications, setMutedUntil,
      registerLayer, closeTopLayer, layerCount, topLayerKind,
      routePending, setRoutePending,
      lastAppPath,
    }),
    [paletteOpen, openPalette, closePalette, sidekickOpen, openSidekick, closeSidekick, toggleSidekick, sidekickInitialPrompt, consumeSidekickInitialPrompt, customizeOpen, openCustomize, closeCustomize, createTaskOpen, openCreateTask, closeCreateTask, createTaskPreselect, activeCall, startCall, endCall, setCallMinimized, createListOpen, openCreateList, closeCreateList, createListPreselect, createSprintOpen, openCreateSprint, closeCreateSprint, createSprintPreselect, templateCenterOpen, templateCenterOpts, openTemplateCenter, closeTemplateCenter, openItem, openItemDrawer, closeItemDrawer, bumpRowVersion, rowVersion, sidebarCollapsed, toggleSidebar, setSidebarCollapsed, sidebarWidth, setSidebarWidth, railApps, launcherApps, manageableOffModules, canCreateSpace, hubHref, hubSidebarApp, recentAppKeys, pushRecentApp, prefs, patchPrefs, refetchPrefs, presenceStatus, setPresenceStatus, statusModalOpen, openStatusModal, closeStatusModal, mutedUntil, mutedNotifications, setMutedUntil, registerLayer, closeTopLayer, layerCount, topLayerKind, routePending, lastAppPath],
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
