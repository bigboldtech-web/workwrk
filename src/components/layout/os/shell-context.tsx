"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { getApp, type AppEntry } from "./apps-catalog";
import { canAccessTier, parseOrgAppsConfig, visibleRailApps, type OrgAppsConfig } from "@/lib/rail-apps";
import { hubDefaultHref, isHubKey, type HubKey } from "@/lib/nav/route-hub";
import { decodePresence, encodePresence } from "@/lib/people/presence-codec";
import { runLocalPrefsMigration } from "@/lib/local-prefs-migration-runner";
import { apiFetch } from "@/lib/api-fetch";
import { leaveThen } from "@/lib/dirty-guard";
import { recordWriteQueue } from "@/lib/people/record-write-queue";
import { readLastAppPath, recordLastAppPath, serverLastAppPath, subscribeLastAppPath } from "@/lib/settings-nav";
import { deepMergePatch, type PreferencesPatch } from "@/lib/preferences-schema";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import type { EffectivePreferences } from "@/lib/preferences";
import { useBoot } from "./boot-context";
import { ASK_AI_FOCUS_EVENT, ASK_AI_PANEL_MIN_WIDTH, askAiTarget } from "@/lib/ai/ask-ai-route";
import { appAudienceAllows } from "@/lib/nav/app-audience";
import type { AppKey } from "@/lib/access/types";

const PANEL_FITS_QUERY = `(min-width: ${ASK_AI_PANEL_MIN_WIDTH}px)`;
function subscribePanelFits(cb: () => void) {
  const mq = window.matchMedia(PANEL_FITS_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function readPanelFits() {
  return window.matchMedia(PANEL_FITS_QUERY).matches;
}

/** The folded keys whose launcher entry follows APP_RULES rather than a tier. */
const AUDIENCE_KEYS: ReadonlySet<string> = new Set(["tools", "assets", "build", "store", "automation", "reviews", "candor", "surveys"]);

/** The launcher rule of an audience-gated key: APP_RULES, plus the two respondent doors (the Teams rows' rule). */
function launcherAudienceAllows(key: string, v: { orgRole: string; peopleTeam?: boolean; hasReports?: boolean; candorInvited?: boolean; surveyTargeted?: boolean }): boolean {
  if (appAudienceAllows(key as AppKey, v)) return true;
  if (v.orgRole === "GUEST") return false;
  if (key === "candor") return v.candorInvited === true;
  if (key === "surveys") return v.surveyTargeted === true;
  return false;
}

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

/**
 * The layer kinds that carry their own primary (a modal, a drawer, a dialog).
 * While one is open ANYWHERE in the stack the page's blue primary gives way
 * (design-system principle 1). "Anywhere", not "on top": a Picker or a "..."
 * menu opened inside the dialog registers a popover above it, and reading
 * only the top layer brought the page's "+ Add widget" back beside the
 * dialog's "Create schedule", two blues on one screen.
 */
const BLOCKING_LAYER_KINDS: ReadonlySet<LayerKind> = new Set<LayerKind>(["modal", "drawer", "dialog"]);
export function hasBlockingLayer(layers: ReadonlyArray<Pick<LayerEntry, "kind">>): boolean {
  return layers.some((l) => BLOCKING_LAYER_KINDS.has(l.kind));
}

/** Options for opening the Template Center. `kind` scopes the browser to
 *  one template type (e.g. LIST from the create-list modal); `applyContext`
 *  carries the target Space for applying a LIST template inline. */
export type TemplateCenterKind = "TASK" | "LIST" | "SPACE" | "FOLDER" | "DOC" | "VIEW" | "WHITEBOARD";
export type TemplateCenterOpts = {
  kind?: TemplateCenterKind;
  /** `folderId` lands a LIST template inside a Folder rather than at the
   *  Space root, which is what "applied inside this Folder" means. */
  applyContext?: { spaceId?: string; folderId?: string };
};

/** Board the create-task modal should preselect as its destination
 *  list (mirrors the modal's SelectedList shape). */
export type CreateTaskPreselect = {
  id: string;
  slug: string;
  name: string;
  spaceId: string | null;
};

/**
 * A Task template the create-task modal should open PREFILLED with.
 *
 * Applying a Task template used to dead-end: the apply POST ran, usedCount was
 * incremented, and nothing opened, because the shell called openCreateTask()
 * with no argument and `CreateTaskPreselect` is a board, not a config. The
 * config travels beside the preselect now, so "Applying navigates: Task ->
 * the CreateTaskModal prefilled" is true from the page and from the modal.
 */
export type CreateTaskTemplate = {
  name: string;
  config: Record<string, unknown>;
};

/** The one call in progress, hoisted to the shell so it survives page
 *  navigation (a Slack-style floating dock). Exactly one lives at a time; the
 *  CallDock renders a single, never-unmounted CallPanel from it. */
export type ActiveCall = {
  /** Talk call (conversationId) XOR scheduled-meeting call (meetingId). */
  conversationId?: string;
  meetingId?: string;
  // `room` is GONE (Phase 4, decision Q1). It carried the legacy Jitsi room
  // name for the public fallback, and the fallback is gone: the LiveKit room
  // is derived server side by POST /api/calls/token from the conversation or
  // meeting id, so no client has to know or forward it.
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
/** Do not disturb: a status everyone sees on the dot (presence.ts draws it busy). */
export const DND_PRESENCE: PresenceStatus = { emoji: "⛔", label: "Do not disturb", expiresAt: null };

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
  /**
   * Whether any Ask AI entry point renders for this viewer: the `ai` rail app
   * is visible, AI features are on for the workspace (settings.data.aiEnabled)
   * and the viewer is not a Guest. Every entry point reads this one fact.
   */
  askAiVisible: boolean;
  /**
   * The window is 1024 or wider, so the 360 panel fits beside the content.
   * Below it the panel is not in the DOM at all and cannot be open.
   */
  askAiPanelFits: boolean;
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
  openCreateTask: (preselect?: CreateTaskPreselect | null, template?: CreateTaskTemplate | null) => void;
  closeCreateTask: () => void;
  createTaskPreselect: CreateTaskPreselect | null;
  createTaskTemplate: CreateTaskTemplate | null;

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
  /** Resolves true once the server kept it; false after a revert. */
  setSidebarCollapsed: (v: boolean) => Promise<boolean>;
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
  /**
   * The Teams hub as a plain Member holds it: no rail pill (the hub tier is
   * manager until the Teams unit opens the Directory), but its sidebar still
   * renders its Member branch (My profile, RESOURCING > Tools) on Teams URLs,
   * with no "+" and a landing of /people/me. False for Guests and for anyone
   * who has the full hub on the rail.
   */
  memberTeamsHub: boolean;
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
  /** Resolves true once the server kept it; false after a revert. */
  setPresenceStatus: (s: PresenceStatus) => Promise<boolean>;
  statusModalOpen: boolean;
  openStatusModal: () => void;
  closeStatusModal: () => void;

  /** home.notifications.mutedUntil, ISO or null; true while in the future. */
  mutedUntil: string | null;
  mutedNotifications: boolean;
  setMutedUntil: (iso: string | null) => Promise<boolean>;

  /**
   * The LEGACY module-view drawer state (the demo surfaces of the removed
   * verticals, kanban.tsx, calendar.tsx and main-table.tsx, all now deleted).
   * It is NOT the task drawer.
   *
   * A task opens at its own URL: `router.push("/item/<id>")`, which the
   * (dashboard)/@drawer/(.)item/[id] intercept renders over the list. Wiring
   * the task drawer into this state instead would put a second mechanism back
   * beside the one Phase 2 exists to establish, and it would have no URL, so
   * Copy link would silently stop working.
   *
   * WHAT IT ACTUALLY IS TODAY: dead. `OsItemDrawer`, the only component that
   * ever rendered `openItem`, was deleted in Phase 1 (24aaf922), and the three
   * files that called `openItemDrawer` were rendered by nothing and are gone
   * (main-table.tsx and kanban.tsx in Phase 5; their demo types moved to
   * catalog.ts). So this state has no writer and no reader at all.
   *
   * It is left in place because removing a shell-context field touches every
   * consumer of the context value; nothing renders behind it, so nothing
   * regresses either way.
   */
  openItem: OpenItem | null;
  openItemDrawer: (it: OpenItem) => void;
  closeItemDrawer: () => void;

  bumpRowVersion: (moduleId: string) => void;
  rowVersion: (moduleId: string) => number;

  registerLayer: (entry: LayerEntry) => () => void;
  closeTopLayer: () => CloseTopLayerResult;
  layerCount: number;
  topLayerKind: LayerKind | null;
  /** A modal, drawer or dialog is open somewhere in the stack, even under a popover. */
  blockingLayerOpen: boolean;

  /** True while a route transition is pending past 200ms: the rail logo pulses. */
  routePending: boolean;
  setRoutePending: (v: boolean) => void;

  lastAppPath: string | null;
};

const Ctx = createContext<ShellState | null>(null);
/** The raw context, for the few hooks that must work outside the frame too (use-hub-back). */
export const OsShellContext = Ctx;

const RECENT_APPS_KEY = "workwrk:os:recent-apps";
const MAX_RECENTS = 6;
const WIDTH_PERSIST_MS = 500;

export function OsShellProvider({ children }: { children: React.ReactNode }) {
  const { boot } = useBoot();
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidekickOpen, setSidekickOpen] = useState(false);
  const sidekickOpenRef = useRef(false);
  const [sidekickInitialPrompt, setSidekickInitialPrompt] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskPreselect, setCreateTaskPreselect] = useState<CreateTaskPreselect | null>(null);
  const [createTaskTemplate, setCreateTaskTemplate] = useState<CreateTaskTemplate | null>(null);
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
  // The person's own status comes from the server (User.presenceStatus, via
  // boot), so it is the same on every device; localStorage is only read once
  // below, to carry an old browser's status up.
  const [presenceStatus, setPresenceStatusState] = useState<PresenceStatus>(
    () => decodePresence(boot.viewer.presenceStatus, boot.viewer.presenceUntil) ?? DEFAULT_PRESENCE,
  );
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [routePending, setRoutePending] = useState(false);

  // Preferences: the boot payload is the first value, so the first paint has
  // the right density, chrome, sidebar width and collapse state.
  const [prefs, setPrefs] = useState<EffectivePreferences>(boot.prefs);
  const prefsRef = useRef(prefs);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(Boolean(boot.prefs.sidebar.collapsed));
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  useEffect(() => { sidebarCollapsedRef.current = sidebarCollapsed; }, [sidebarCollapsed]);
  const [sidebarWidth, setSidebarWidthState] = useState<number>(
    clampSidebarWidth(typeof boot.prefs.sidebar.width === "number" ? boot.prefs.sidebar.width : SIDEBAR_DEFAULT_WIDTH),
  );

  const lastAppPath = useSyncExternalStore(subscribeLastAppPath, readLastAppPath, serverLastAppPath);

  // ── LayerStack ──────────────────────────────────────────────────
  const layersRef = useRef<LayerEntry[]>([]);
  const [layerSnapshot, setLayerSnapshot] = useState<{ count: number; top: LayerKind | null; blocking: boolean }>({ count: 0, top: null, blocking: false });
  const snapshotLayers = useCallback(() => {
    const list = layersRef.current;
    const top = list[list.length - 1]?.kind ?? null;
    const blocking = hasBlockingLayer(list);
    setLayerSnapshot((prev) =>
      prev.count === list.length && prev.top === top && prev.blocking === blocking ? prev : { count: list.length, top, blocking },
    );
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
  const blockingLayerOpen = layerSnapshot.blocking;

  useEffect(() => {
    if (!pathname) return;
    recordLastAppPath(pathname, window.location.search);
  }, [pathname]);

  // Storage: restore the one piece of client ephemera (recent apps), and
  // carry the old browser-only settings up to their server keys ONCE
  // (settings-architecture 7.3, src/lib/local-prefs-migration.ts): the
  // server wins where it already has a value, and a key is removed only
  // after the write that carries it has succeeded.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const recents = window.localStorage.getItem(RECENT_APPS_KEY);
        if (recents) {
          const parsed = JSON.parse(recents);
          if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
            setRecentAppKeysState(parsed.slice(0, MAX_RECENTS));
          }
        }
      } catch {}
      void runLocalPrefsMigration({
        serverPresence: boot.viewer.presenceStatus,
        onPrefs: (effective) => setPrefs(effective),
        onPresence: (p) => setPresenceStatusState(p),
      });
    }, 0);
    return () => window.clearTimeout(t);
    // Once per mount: the boot values are the starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // A refused write reverts the rail, so the screen never shows a state the
  // server did not keep; the caller gets the result for its own Saved or
  // Retry (settings-architecture 9.1).
  const setSidebarCollapsed = useCallback(async (v: boolean): Promise<boolean> => {
    const before = sidebarCollapsedRef.current;
    setSidebarCollapsedState(v);
    const ok = await patchPrefs({ sidebar: { collapsed: v } });
    if (!ok) setSidebarCollapsedState(before);
    return ok;
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
  // Every Ask AI entry point funnels through openSidekick / toggleSidekick, so
  // the width rule and the /sidekick rule live here once (askAiTarget).
  const askAiVisibleRef = useRef(false);
  const pathnameRef = useRef<string | null>(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  const openSidekick = useCallback((initialPrompt?: string) => {
    if (!askAiVisibleRef.current) return;
    const width = typeof window === "undefined" ? 1440 : window.innerWidth;
    const target = askAiTarget({ width, pathname: pathnameRef.current, prompt: initialPrompt });
    if (target.kind === "navigate") {
      // Below 1024 Ask AI is a page: unsaved work asks first.
      void leaveThen(() => {
        setSidekickOpen(false);
        router.push(target.href);
      });
      return;
    }
    if (target.kind === "focus-page") {
      window.dispatchEvent(new CustomEvent(ASK_AI_FOCUS_EVENT));
      return;
    }
    if (initialPrompt && initialPrompt.trim().length > 0) {
      setSidekickInitialPrompt(initialPrompt);
    }
    setSidekickOpen(true);
  }, [router]);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      openSidekick(typeof prompt === "string" ? prompt : undefined);
    };
    window.addEventListener("workwrk:os:ask-sidekick", onAsk);
    return () => window.removeEventListener("workwrk:os:ask-sidekick", onAsk);
  }, [openSidekick]);
  const closeSidekick = useCallback(() => setSidekickOpen(false), []);
  // Below 1024 the panel does not render. Shrinking the window past the
  // breakpoint closes it outright, so no invisible layer is left to swallow
  // the next Esc or Cmd+J, and widening again does not pop it back open.
  const askAiPanelFits = useSyncExternalStore(subscribePanelFits, readPanelFits, () => false);
  useEffect(() => {
    const mq = window.matchMedia(PANEL_FITS_QUERY);
    const onChange = () => { if (!mq.matches) setSidekickOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const toggleSidekick = useCallback(() => {
    if (sidekickOpenRef.current) { setSidekickOpen(false); return; }
    openSidekick();
  }, [openSidekick]);
  const consumeSidekickInitialPrompt = useCallback(() => {
    const v = sidekickInitialPrompt;
    if (v !== null) setSidekickInitialPrompt(null);
    return v;
  }, [sidekickInitialPrompt]);
  const openCustomize = useCallback(() => setCustomizeOpen(true), []);
  const closeCustomize = useCallback(() => setCustomizeOpen(false), []);
  const openCreateTask = useCallback((preselect?: CreateTaskPreselect | null, template?: CreateTaskTemplate | null) => {
    setCreateTaskPreselect(preselect ?? null);
    setCreateTaskTemplate(template ?? null);
    setCreateTaskOpen(true);
  }, []);
  const closeCreateTask = useCallback(() => {
    setCreateTaskOpen(false);
    setCreateTaskPreselect(null);
    setCreateTaskTemplate(null);
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
  // The palette's JUMP TO list and every sidebar's "is this key open" check.
  // The Phase 7 keys also answer to their APP_RULES audience (access 5.2.1),
  // which no tier can express (Assets is "anyone with reports, the People
  // team and Admin"), so the palette never offers a page that would 404.
  const launcherApps = useMemo<AppEntry[]>(
    () => visibleRailApps({ config: railConfig, accessLevel, activeModules: new Set(activeModuleKeys), includeFolded: true })
      .filter((a) => !AUDIENCE_KEYS.has(a.key) || launcherAudienceAllows(a.key, boot.viewer)),
    [railConfig, accessLevel, activeModuleKeys, boot.viewer],
  );
  const askAiVisible = useMemo(
    () => railApps.some((a) => a.key === "ai") && boot.org.aiEnabled !== false && boot.viewer.orgRole !== "GUEST",
    [railApps, boot.org.aiEnabled, boot.viewer.orgRole],
  );
  useEffect(() => { askAiVisibleRef.current = askAiVisible; }, [askAiVisible]);
  // The panel is open only while the viewer has Ask AI and is not on the
  // /sidekick page, whose own thread would make two on screen. Derived, not
  // written back, so losing the right or arriving on /sidekick closes it.
  const onAskAiPage = pathname === "/sidekick" || Boolean(pathname?.startsWith("/sidekick/"));
  const panelOpen = sidekickOpen && askAiVisible && !onAskAiPage && askAiPanelFits;
  useEffect(() => { sidekickOpenRef.current = panelOpen; }, [panelOpen]);
  const manageableOffModules = boot.manageableOffModules;
  const canCreateSpace = accessLevel !== undefined && !boot.viewer.isAgent && boot.viewer.orgRole !== "GUEST" && canAccessTier("manager", accessLevel);
  const railKeys = useMemo(() => new Set(railApps.map((a) => a.key)), [railApps]);
  // sidebar-map section 5: the Teams hub lands on /people for every Member.
  // This branch is only for a viewer whose rail does NOT carry Teams (an
  // Admin hid or floored it in Apps config): /people reads the same app row,
  // so their landing is their own record (/people/me, never gated) rather
  // than a page that may refuse them. The "+" stays: TeamsCreateMenu renders
  // only the rows this viewer's create would pass (Give kudos for every
  // Member), so it never offers a dead door. Guests never see this hub.
  const memberTeamsHub = !railKeys.has("teams") && boot.viewer.orgRole !== "GUEST";
  const hubHref = useCallback(
    (appKey: string): string => {
      if (appKey === "teams" && memberTeamsHub) return "/people/me";
      if (isHubKey(appKey)) {
        return hubDefaultHref(appKey, {
          talkModuleOn: activeModuleKeys.includes("chat"),
          tablesModuleOn: activeModuleKeys.includes("tables"),
          canManageWorkspace: accessLevel === undefined ? true : canAccessTier("org-admin", accessLevel),
          askAiOn: askAiVisible,
        });
      }
      return getApp(appKey)?.defaultHref ?? "/";
    },
    [activeModuleKeys, accessLevel, memberTeamsHub, askAiVisible],
  );
  const launcherKeys = useMemo(() => new Set(launcherApps.map((a) => a.key)), [launcherApps]);
  const isHubVisible = useCallback((hubKey: string): boolean => railKeys.has(hubKey), [railKeys]);
  const memberTeamsApp = useMemo<AppEntry | null>(() => {
    if (!memberTeamsHub) return null;
    const teams = getApp("teams");
    return teams ? { ...teams, defaultHref: "/people/me" } : null;
  }, [memberTeamsHub]);
  const hubSidebarApp = useCallback(
    (hub: HubKey): AppEntry => {
      const work = getApp("home")!;
      if (hub === "chat" && !activeModuleKeys.includes("chat")) {
        const announce = getApp("announcements");
        if (announce && launcherKeys.has("announcements")) return announce;
      }
      if (hub === "teams" && memberTeamsApp) return memberTeamsApp;
      if (!isHubVisible(hub)) return work;
      return getApp(hub) ?? work;
    },
    [activeModuleKeys, launcherKeys, isHubVisible, memberTeamsApp],
  );

  const presenceRef = useRef(presenceStatus);
  useEffect(() => { presenceRef.current = presenceStatus; }, [presenceStatus]);
  const setPresenceStatus = useCallback(async (s: PresenceStatus): Promise<boolean> => {
    const before = presenceRef.current;
    setPresenceStatusState(s);
    // ONE store (User.presenceStatus): this device, every other device and
    // the dots on the Directory, the Org chart and the record all read it.
    // The write queue retries a dropped connection; "Online" clears the dot.
    // A write the server refused for good reverts the dot, so the screen
    // never shows a status teammates do not see.
    const shared = encodePresence(s);
    const r = await recordWriteQueue().write("PUT", "/api/me/presence", { status: shared, until: shared ? s.expiresAt : null });
    if (!r.ok) setPresenceStatusState((cur) => (cur === s ? before : cur));
    return r.ok;
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
    return registerLayer({ id: "module-item-drawer", kind: "drawer", close: () => setOpenItem(null) });
  }, [openItem, registerLayer]);

  const value = useMemo<ShellState>(
    () => ({
      paletteOpen, openPalette, closePalette,
      sidekickOpen: panelOpen, askAiVisible, askAiPanelFits, openSidekick, closeSidekick, toggleSidekick,
      sidekickInitialPrompt, consumeSidekickInitialPrompt,
      customizeOpen, openCustomize, closeCustomize, setCustomizeOpen,
      createTaskOpen, openCreateTask, closeCreateTask, createTaskPreselect, createTaskTemplate,
      activeCall, startCall, endCall, setCallMinimized,
      createListOpen, openCreateList, closeCreateList, createListPreselect,
      createSprintOpen, openCreateSprint, closeCreateSprint, createSprintPreselect,
      templateCenterOpen, templateCenterOpts, openTemplateCenter, closeTemplateCenter,
      openItem, openItemDrawer, closeItemDrawer,
      bumpRowVersion, rowVersion,
      sidebarCollapsed, toggleSidebar, setSidebarCollapsed, sidebarWidth, setSidebarWidth,
      railApps, launcherApps, manageableOffModules, canCreateSpace, hubHref, hubSidebarApp, memberTeamsHub,
      recentAppKeys, pushRecentApp,
      prefs, patchPrefs, refetchPrefs,
      presenceStatus, setPresenceStatus, statusModalOpen, openStatusModal, closeStatusModal,
      mutedUntil, mutedNotifications, setMutedUntil,
      registerLayer, closeTopLayer, layerCount, topLayerKind, blockingLayerOpen,
      routePending, setRoutePending,
      lastAppPath,
    }),
    [paletteOpen, openPalette, closePalette, panelOpen, askAiVisible, askAiPanelFits, openSidekick, closeSidekick, toggleSidekick, sidekickInitialPrompt, consumeSidekickInitialPrompt, customizeOpen, openCustomize, closeCustomize, createTaskOpen, openCreateTask, closeCreateTask, createTaskPreselect, createTaskTemplate, activeCall, startCall, endCall, setCallMinimized, createListOpen, openCreateList, closeCreateList, createListPreselect, createSprintOpen, openCreateSprint, closeCreateSprint, createSprintPreselect, templateCenterOpen, templateCenterOpts, openTemplateCenter, closeTemplateCenter, openItem, openItemDrawer, closeItemDrawer, bumpRowVersion, rowVersion, sidebarCollapsed, toggleSidebar, setSidebarCollapsed, sidebarWidth, setSidebarWidth, railApps, launcherApps, manageableOffModules, canCreateSpace, hubHref, hubSidebarApp, memberTeamsHub, recentAppKeys, pushRecentApp, prefs, patchPrefs, refetchPrefs, presenceStatus, setPresenceStatus, statusModalOpen, openStatusModal, closeStatusModal, mutedUntil, mutedNotifications, setMutedUntil, registerLayer, closeTopLayer, layerCount, topLayerKind, blockingLayerOpen, routePending, lastAppPath],
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
  const stack = useContext(LayerStackContext);
  const register = ctx?.registerLayer ?? stack?.registerLayer;
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

/* ── A layer stack without the product frame ───────────────────────
 * The Staff console (src/app/(admin)) cannot mount OsShellProvider: it
 * fetches /api/preferences and /api/boot, which the admin host never
 * serves. It still needs the one Esc rule (the top layer closes first, then
 * the one under it), so it mounts this instead. `useLayer` falls back to it
 * when there is no shell, and `useLayerStack` reads whichever is present, so
 * a Drawer, Picker or header menu behaves the same in both frames.
 */
export interface LayerStackValue {
  registerLayer: (entry: LayerEntry) => () => void;
  closeTopLayer: () => CloseTopLayerResult;
  layerCount: number;
  topLayerKind: LayerKind | null;
  blockingLayerOpen: boolean;
}

export const LayerStackContext = createContext<LayerStackValue | null>(null);

/** The product shell's stack when inside it, else a LayerStackProvider's, else null. */
export function useLayerStack(): LayerStackValue | null {
  const ctx = useContext(Ctx);
  const stack = useContext(LayerStackContext);
  return ctx ?? stack;
}

export function LayerStackProvider({ children }: { children: React.ReactNode }) {
  const layersRef = useRef<LayerEntry[]>([]);
  const [snap, setSnap] = useState<{ count: number; top: LayerKind | null; blocking: boolean }>({ count: 0, top: null, blocking: false });
  const snapshot = useCallback(() => {
    const list = layersRef.current;
    const top = list[list.length - 1]?.kind ?? null;
    const blocking = hasBlockingLayer(list);
    setSnap((prev) => (prev.count === list.length && prev.top === top && prev.blocking === blocking ? prev : { count: list.length, top, blocking }));
  }, []);
  const registerLayer = useCallback((entry: LayerEntry) => {
    layersRef.current = [...layersRef.current.filter((l) => l.id !== entry.id), entry];
    snapshot();
    return () => {
      if (layersRef.current.some((l) => l.id === entry.id)) {
        layersRef.current = layersRef.current.filter((l) => l.id !== entry.id);
        snapshot();
      }
    };
  }, [snapshot]);
  const closeTopLayer = useCallback((): CloseTopLayerResult => {
    const top = layersRef.current[layersRef.current.length - 1];
    if (!top) return "none";
    if (top.canClose && !top.canClose()) return "refused";
    top.close();
    return "closed";
  }, []);
  const value = useMemo<LayerStackValue>(
    () => ({ registerLayer, closeTopLayer, layerCount: snap.count, topLayerKind: snap.top, blockingLayerOpen: snap.blocking }),
    [registerLayer, closeTopLayer, snap],
  );
  return <LayerStackContext.Provider value={value}>{children}</LayerStackContext.Provider>;
}
