"use client";

// The AI hub sidebar (sidebar-map section 3, spec-ai-automation section 1.2).
//
//   Ask AI                     /sidekick                 app ai (and AI features on)
//   Agents          (count)    /agents                   app ai
//   CHATS                      15 most recent, pinned first; row "...":
//                              Rename, Pin or Unpin, Archive; "See all chats"
//                              past 15
//   AUTOMATION                 Workflows (count), Templates, Logs (dot when a
//                              run failed in the last 24h), Health, Usage,
//                              Connections (Owner and Admin)
//   APPS                       Marketplace, Integrations, Build apps (Owner
//                              and Admin)
//
// Every row gates on the APP_RULES audience of its key (appAudienceAllows,
// the same table the page gates read) plus the org's hide and floor config
// (the launcher list), never on a manager tier. Section collapse persists in
// sidebar.collapsedSections under ai.chats, ai.automation and ai.apps. The
// live numbers come from ONE call, GET /api/ai/sidebar, refetched on window
// focus and whenever a chat changes (AI_CHATS_CHANGED_EVENT).

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, Bot, Cable, GaugeCircle, Hammer, LayoutTemplate, MessageSquare, MoreHorizontal,
  Pencil, Pin, PinOff, Archive, Plug, ScrollText, ShoppingBag, Sparkles, Workflow, type LucideIcon,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { useBoot } from "./boot-context";
import { useOsToast } from "./toast";
import { useSidebarSearch } from "./sidebar-search-context";
import { useActiveRowHref } from "./use-active-row";
import { MorePortal } from "./more-portal";
import {
  SidebarRow, SidebarGhostRow, SidebarSectionLabel, SidebarErrorLine, SidebarSkeletonRows, SidebarEmptyLine,
} from "./sidebar-primitives";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { isSectionCollapsed, toggleSectionCollapsed } from "@/lib/docs-prefs";
import { appAudienceAllows } from "@/lib/nav/app-audience";
import { parseOrgAppsConfig } from "@/lib/rail-apps";
import { AI_CHATS_CHANGED_EVENT, notifyAiChatsChanged } from "@/lib/ai/events";
import type { AppKey } from "@/lib/access/types";

type Chat = { id: string; title: string; pinned: boolean; updatedAt: string };
type SidebarData = {
  chats: Chat[];
  chatsTotal: number;
  agentsEnabled: number;
  workflowsActive: number;
  runsFailed24h: number;
  /** Build apps this viewer may open (the Member exception, src/lib/build/gate.ts). */
  usableBuildApps?: number;
};

type Row = { href: string; label: string; Icon: LucideIcon; app: AppKey; adminOnly?: boolean };

const TOP_ROWS: Row[] = [
  { href: "/sidekick", label: "Ask AI", Icon: Sparkles, app: "ai" },
  { href: "/agents", label: "Agents", Icon: Bot, app: "ai" },
];
// spec-ai-automation 1.2 order: Workflows, Templates, Logs, Health, Usage,
// Connections.
const AUTOMATION_ROWS: Row[] = [
  { href: "/automation/workflows", label: "Workflows", Icon: Workflow, app: "automation" },
  { href: "/automation/templates", label: "Templates", Icon: LayoutTemplate, app: "automation" },
  { href: "/automation/logs", label: "Logs", Icon: ScrollText, app: "automation" },
  { href: "/automation/health", label: "Health", Icon: Activity, app: "automation" },
  { href: "/automation/usage", label: "Usage", Icon: GaugeCircle, app: "automation" },
  // Connections is Owner and Admin (access section 9, manageIntegrations).
  { href: "/automation/connections", label: "Connections", Icon: Cable, app: "automation", adminOnly: true },
];
// Plug is Integrations, Cable is Connections, Hammer is Build apps: one glyph
// per concept, and Wrench stays with the Teams Tools row.
const APPS_ROWS: Row[] = [
  { href: "/store", label: "Marketplace", Icon: ShoppingBag, app: "store" },
  { href: "/integrations", label: "Integrations", Icon: Plug, app: "integrations" },
  { href: "/build", label: "Build apps", Icon: Hammer, app: "build" },
];

const CHAT_ROWS_SHOWN = 15;
const CHATS_KEY = "ai.chats";
const AUTOMATION_KEY = "ai.automation";
// APPS is collapsed by default (spec-ai-automation 1.2), so the stored list
// records the person OPENING it, under its own key; everything else in
// collapsedSections records a close, as before. (The old "ai.apps" close
// entry is simply no longer read: closed is the default now.)
const APPS_OPEN_KEY = "ai.apps.open";

export function AiSidebar() {
  const router = useRouter();
  const { boot } = useBoot();
  const { launcherApps, askAiVisible, prefs, patchPrefs } = useOsShell();
  const { query } = useSidebarSearch();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const isAdmin = boot.viewer.orgRole === "OWNER" || boot.viewer.orgRole === "ADMIN";
  const [data, setData] = useState<SidebarData | null>(null);
  const [error, setError] = useState(false);
  const launcherKeys = useMemo(() => new Set(launcherApps.map((a) => a.key)), [launcherApps]);
  const shows = useCallback(
    (r: Row) => {
      if (r.adminOnly && !isAdmin) return false;
      if (r.app === "ai") return askAiVisible;
      // The audience from APP_RULES; the org's hide and floor from the
      // launcher list for the keys the rail config knows (Integrations is a
      // route, not a catalog entry, so it has no config row to consult).
      const audience = appAudienceAllows(r.app, boot.viewer);
      const configured = r.app === "integrations" || launcherKeys.has(r.app);
      return audience && configured;
    },
    [isAdmin, askAiVisible, boot.viewer, launcherKeys],
  );

  const top = TOP_ROWS.filter(shows);
  const automation = AUTOMATION_ROWS.filter(shows);
  // Build apps also renders for a Member when the org has apps they may use
  // (the Member exception): open and fill them, no New app.
  // Not when the org hid or floored Build apps: the pages answer AppOff then.
  const usableBuildApps = data?.usableBuildApps ?? 0;
  const buildConfig = useMemo(() => parseOrgAppsConfig(prefs.sidebar.apps), [prefs.sidebar.apps]);
  const buildOff = (buildConfig.hidden ?? []).includes("build") || Boolean(buildConfig.minAccess?.build);
  const apps = APPS_ROWS.filter((r) => shows(r) || (r.app === "build" && usableBuildApps > 0 && !buildOff && boot.viewer.orgRole !== "GUEST"));
  const load = useCallback(async () => {
    const r = await apiFetch<SidebarData>("/api/ai/sidebar", { cache: "no-store" });
    if (!r.ok) { setError(true); return; }
    setError(false);
    setData(r.data);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    const onChange = () => { void load(); };
    window.addEventListener(AI_CHATS_CHANGED_EVENT, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      clearTimeout(t);
      window.removeEventListener(AI_CHATS_CHANGED_EVENT, onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [load]);

  const chatsCollapsed = isSectionCollapsed(prefs.sidebar, CHATS_KEY);
  const automationCollapsed = isSectionCollapsed(prefs.sidebar, AUTOMATION_KEY);
  const appsOpened = isSectionCollapsed(prefs.sidebar, APPS_OPEN_KEY);
  const toggleSection = useCallback((key: string) => {
    void patchPrefs({ sidebar: { collapsedSections: toggleSectionCollapsed(prefs.sidebar, key) } });
  }, [prefs.sidebar, patchPrefs]);

  const q = query.trim().toLowerCase();
  const match = useCallback((label: string) => !q || label.toLowerCase().includes(q), [q]);
  const chats = useMemo(() => (data?.chats ?? []).filter((c) => match(c.title)), [data, match]);

  // One resolve over every row at once, so exactly one row (or none) lights.
  // "See all chats" is not a candidate: /sidekick?view=all keeps Ask AI lit.
  const candidates = useMemo(
    () => [
      ...top.map((r) => ({ href: r.href })),
      ...chats.map((c) => ({ href: `/sidekick?session=${c.id}` })),
      ...automation.map((r) => ({ href: r.href })),
      ...apps.map((r) => ({ href: r.href })),
    ],
    [top, chats, automation, apps],
  );
  const activeHref = useActiveRowHref(candidates);
  // Collapsed unless opened, and always open while one of its rows is the
  // page you are on, so the lit row is never hidden inside a closed section.
  const appsHoldActive = apps.some((r) => r.href === activeHref);
  const appsCollapsed = !appsOpened && !appsHoldActive;

  const [menu, setMenu] = useState<{ chat: Chat; anchor: RefObject<HTMLElement | null> } | null>(null);

  const patchChat = useCallback(async (chat: Chat, body: { title?: string; pinned?: boolean }, done: string) => {
    const r = await apiFetch(`/api/sidekick/sessions/${chat.id}`, { method: "PATCH", json: body });
    if (!r.ok) { toast("Couldn't update the chat", { tone: "danger" }); return; }
    notifyAiChatsChanged();
    toast(done);
  }, [toast]);

  const rename = useCallback(async (chat: Chat) => {
    setMenu(null);
    const title = await prompt({ title: "Rename chat", defaultValue: chat.title, submitLabel: "Save", required: true });
    if (!title || title.trim() === chat.title) return;
    await patchChat(chat, { title: title.trim().slice(0, 200) }, "Chat renamed");
  }, [prompt, patchChat]);

  const archive = useCallback(async (chat: Chat) => {
    setMenu(null);
    const ok = await confirm({
      title: "Archive this chat?",
      description: "It leaves your chat list. You can restore it from All chats > Archived.",
      confirmLabel: "Archive",
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch(`/api/sidekick/sessions/${chat.id}`, { method: "DELETE" });
    if (!r.ok) { toast("Couldn't archive the chat", { tone: "danger" }); return; }
    notifyAiChatsChanged();
    toast("Chat archived");
    if (activeHref === `/sidekick?session=${chat.id}`) router.push("/sidekick");
  }, [confirm, toast, activeHref, router]);

  const renderRows = (rows: Row[]) =>
    rows.filter((r) => match(r.label)).map((r) => {
      const count =
        r.href === "/agents" ? data?.agentsEnabled || null
          : r.href === "/automation/workflows" ? data?.workflowsActive || null
            : null;
      const dot = r.href === "/automation/logs" && (data?.runsFailed24h ?? 0) > 0;
      return <SidebarRow key={r.href} href={r.href} label={r.label} icon={r.Icon} active={activeHref === r.href} count={count} dot={dot} />;
    });

  return (
    <div className="flex flex-col">
      {top.length > 0 ? <ul className="flex flex-col gap-0.5">{renderRows(top)}</ul> : null}

      {askAiVisible ? (
        <>
          <SidebarSectionLabel collapsed={chatsCollapsed} onToggle={() => toggleSection(CHATS_KEY)}>Chats</SidebarSectionLabel>
          {!chatsCollapsed ? (
            <ul className="flex flex-col gap-0.5">
              {error && !data ? (
                <SidebarErrorLine what="chats" onRetry={() => void load()} />
              ) : data === null ? (
                <SidebarSkeletonRows />
              ) : (
                <>
                  {chats.length === 0 ? (
                    <SidebarEmptyLine>{q ? "No chats match" : "No chats yet"}</SidebarEmptyLine>
                  ) : null}
                  {chats.map((c) => (
                    <SidebarRow
                      key={c.id}
                      href={`/sidekick?session=${c.id}`}
                      label={c.title}
                      icon={c.pinned ? Pin : MessageSquare}
                      active={activeHref === `/sidekick?session=${c.id}`}
                      onContextMenu={(e) => { e.preventDefault(); setMenu({ chat: c, anchor: { current: e.currentTarget as HTMLElement } }); }}
                      trailing={
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ chat: c, anchor: { current: e.currentTarget as HTMLElement } }); }}
                          aria-label={`Actions for ${c.title}`}
                          aria-haspopup="menu"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      }
                    />
                  ))}
                  {/* Always there (not only past fifteen chats): All chats is
                      also where Pinned and Archived live, and the one place an
                      archived chat is restored. */}
                  {!q ? (
                    <SidebarGhostRow
                      href="/sidekick?view=all"
                      label={(data.chatsTotal ?? 0) > CHAT_ROWS_SHOWN ? "See all chats" : "All chats"}
                    />
                  ) : null}
                </>
              )}
            </ul>
          ) : null}
        </>
      ) : null}

      {automation.length > 0 ? (
        <>
          <SidebarSectionLabel collapsed={automationCollapsed} onToggle={() => toggleSection(AUTOMATION_KEY)}>Automation</SidebarSectionLabel>
          {!automationCollapsed ? <ul className="flex flex-col gap-0.5">{renderRows(automation)}</ul> : null}
        </>
      ) : null}

      {apps.length > 0 ? (
        <>
          <SidebarSectionLabel
            collapsed={appsCollapsed}
            onToggle={() => {
              // A section held open by the page you are on has nothing to toggle.
              if (appsHoldActive && !appsOpened) return;
              toggleSection(APPS_OPEN_KEY);
            }}
          >
            Apps
          </SidebarSectionLabel>
          {!appsCollapsed ? <ul className="flex flex-col gap-0.5">{renderRows(apps)}</ul> : null}
        </>
      ) : null}

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${menu.chat.title}`}>
            <MenuItem icon={Pencil} label="Rename" onClick={() => void rename(menu.chat)} />
            <MenuItem
              icon={menu.chat.pinned ? PinOff : Pin}
              label={menu.chat.pinned ? "Unpin" : "Pin"}
              onClick={() => { const c = menu.chat; setMenu(null); void patchChat(c, { pinned: !c.pinned }, c.pinned ? "Chat unpinned" : "Chat pinned"); }}
            />
            <MenuSeparator />
            <MenuItem icon={Archive} label="Archive" destructive onClick={() => void archive(menu.chat)} />
          </MenuList>
        </MorePortal>
      ) : null}
    </div>
  );
}
