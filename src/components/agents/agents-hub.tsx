"use client";

// AI teammates, the /agents page (docs/plans/ai-teammates.md 5.1). One header,
// "AI teammates", over four views:
//
//   /agents, ?tab=chats        Chats: the teammates, and the chat with one
//   ?chat=<slug>               that chat (with Chats or Waiting for you);
//                              &action=<id> scrolls to the card,
//                              &settings=<tab> opens its settings drawer
//                              on that tab (teammate-settings-drawer.tsx)
//   ?tab=waiting               Waiting for you: only the teammates with
//                              something waiting, the count on the tab
//   ?tab=workspace             Workspace agents: the agents table, its drawer
//                              and Add agent, exactly as before
//   ?agent=<slug>[&run=<id>]   with no tab: Workspace agents with that drawer,
//                              so every link from before keeps working
//   ?tab=runs                  Run history, as before
//
// Chats and Waiting have a 32px search and a secondary "New teammate" in the
// toolbar and no blue button: the page's one blue thing there is the
// composer's Send, as on Ask AI. Workspace agents keeps "Add agent" as its
// primary for Owners and Admins. The two views from before own their header
// toolbar (their filter, sort and dialog state live with them), so the hub
// hands them `header`, which draws this page's title and views around it.
//
// The list of teammates is read here, not in the Chats view, because the
// Waiting for you count shows on every view.
//
// New teammate (the toolbar's button, and the empty list's "Start from a
// template") opens the new teammate dialog at its templates; a teammate made
// there opens in Chats. Settings (the chat header's, a line's links) puts
// &settings=<tab> in the address, which opens the drawer; closing it takes
// it out. Picking another chat with unsaved settings asks first (the dirty
// guard's leaveThen).

import { useCallback, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { OsPageHeader, type HeaderMenuEntry, type OsToolbarProps } from "@/components/layout/os/page-header";
import { ViewTab } from "@/components/ui/view-tabs";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import { TEAMMATES_PAGE } from "@/lib/agents/teammate-copy";
import { useTeammateList } from "@/lib/agents/teammate-store";
import { hubViewFor, settingsTabFor, type TeammateSettingsTab } from "@/lib/agents/teammate-thread";
import { leaveThen } from "@/lib/dirty-guard";
import { NewTeammateDialog } from "./new-teammate-dialog";
import { TeammateSettingsDrawer } from "./teammate-settings-drawer";
import { TeammatesView } from "./teammates-view";
import { WorkspaceAgentsView } from "./workspace-agents-view";

const SECONDARY = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60";

/** The page's header with a view's own toolbar and "..." entries. */
export type HubHeader = (opts: { toolbar?: OsToolbarProps; more?: HeaderMenuEntry[] }) => ReactNode;

export function AgentsHub() {
  const router = useRouter();
  const sp = useSearchParams();
  const view = hubViewFor(sp);
  const chat = sp?.get("chat") || null;
  const [query, setQuery] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  const list = useTeammateList({ removed: showRemoved });
  const waitingTotal = list.data?.waitingTotal ?? 0;
  const settingsTab = settingsTabFor(sp?.get("settings"));
  const [newOpen, setNewOpen] = useState(false);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp?.toString() ?? "");
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `/agents?${qs}` : "/agents", { scroll: false });
    },
    [router, sp],
  );

  // The new teammate dialog, at its templates (spec 5.5).
  const openNewTeammate = useCallback(() => setNewOpen(true), []);
  // The open chat's settings drawer, on a tab (Instructions unless named).
  const openSettings = useCallback(
    (tab?: TeammateSettingsTab) => {
      if (chat) setParams({ settings: tab ?? "instructions" });
    },
    [chat, setParams],
  );

  // Chats and Waiting for you keep the open chat between them.
  const chatParam = chat ? `chat=${encodeURIComponent(chat)}` : "";
  const views = (
    <>
      <ViewTab label={TEAMMATES_PAGE.tabChats} active={view === "chats"} href={chatParam ? `/agents?${chatParam}` : "/agents"} />
      <ViewTab
        label={TEAMMATES_PAGE.tabWaiting}
        active={view === "waiting"}
        href={`/agents?tab=waiting${chatParam ? `&${chatParam}` : ""}`}
        trailing={waitingTotal > 0 ? <span className="text-xs font-medium tabular-nums text-ink-2">{waitingTotal}</span> : undefined}
      />
      <ViewTab label={TEAMMATES_PAGE.tabWorkspace} active={view === "workspace"} href="/agents?tab=workspace" />
      <ViewTab label={TEAMMATES_PAGE.tabRuns} active={view === "runs"} href="/agents?tab=runs" />
    </>
  );

  const header: HubHeader = ({ toolbar, more }) => <OsPageHeader title={TEAMMATES_PAGE.title} views={views} toolbar={toolbar} more={more} />;

  if (view === "workspace" || view === "runs") {
    return <WorkspaceAgentsView tab={view === "runs" ? "runs" : "agents"} header={header} />;
  }

  return (
    // The page fills <main>, so the composer sits at the foot of the chat and
    // only the list and the thread scroll.
    <div className="flex h-full min-h-0 flex-col">
      {header({
        toolbar: {
          left: (
            <label className="relative block min-w-0 max-w-[240px] flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.5} aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={TEAMMATES_PAGE.search}
                aria-label={TEAMMATES_PAGE.search}
                className="h-8 w-full rounded-md border border-line-strong bg-raised ps-8 pe-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand"
              />
            </label>
          ),
          right: (
            <button type="button" onClick={openNewTeammate} className={SECONDARY}>
              <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {TEAMMATES_PAGE.newTeammate}
            </button>
          ),
        },
      })}
      <TeammatesView
        list={list.data}
        listError={list.error}
        onReload={() => void list.reload()}
        waitingOnly={view === "waiting"}
        query={query}
        onClearQuery={() => setQuery("")}
        showRemoved={showRemoved}
        onShowRemoved={setShowRemoved}
        selectedSlug={chat}
        actionId={sp?.get("action") || null}
        onSelect={(slug) => void leaveThen(() => setParams({ chat: slug, action: null, settings: null }))}
        onBack={() => void leaveThen(() => setParams({ chat: null, action: null, settings: null }))}
        onNewTeammate={openNewTeammate}
        onOpenSettings={openSettings}
      />
      <NewTeammateDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        list={list.data}
        onCreated={(t) => {
          setNewOpen(false);
          // The list, its count and the AI sidebar read it again.
          notifyAiChatsChanged();
          setParams({ tab: null, chat: t.slug, action: null, settings: null });
        }}
      />
      <TeammateSettingsDrawer
        slug={chat && settingsTab ? chat : null}
        tab={settingsTab ?? "instructions"}
        onTab={(tab) => setParams({ settings: tab })}
        onClose={() => setParams({ settings: null })}
        onChanged={notifyAiChatsChanged}
      />
    </div>
  );
}
