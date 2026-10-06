"use client";

// A teammate's settings (docs/plans/ai-teammates.md 5.5): the Drawer (520)
// over the chat, opened from the chat header's Settings, from a line's links
// ("See memory", a routine's Settings) and from the address,
// /agents?chat=<slug>&settings=<tab>. The header is the crumb "AI teammates
// › {name}" and Close; the tabs are Instructions, Tools and approvals,
// Memory, Routines and Activity, and the open one is the address's, so a
// link opens it and Back and Forward move between them.
//
// It reads GET /api/agents/teammates/[slug] (the teammate's settings for this
// person, and whether they manage it) and hands it to the tabs. A tab that
// changes the teammate hands back the route's answer, and the list, the chat
// header and the AI sidebar read it again (onChanged). It is read again,
// too, when the chat changes it (paused from the chat's menu, a decision in
// another tab).
//
// The Instructions tab's unsaved changes hold the drawer: Close, Esc and
// another tab ask first (its dirty guard covers leaving the page).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Drawer } from "@/components/ui/drawer";
import { SkeletonLines } from "@/components/ui/skeleton";
import { ViewTab, ViewTabStrip } from "@/components/ui/view-tabs";
import { AI_CHATS_CHANGED_EVENT } from "@/lib/ai/events";
import { apiFetch } from "@/lib/api-fetch";
import { TEAMMATE_CHAT, TEAMMATE_ROUTE_ERRORS, TEAMMATE_SETTINGS, TEAMMATES_PAGE, settingsCrumb } from "@/lib/agents/teammate-copy";
import type { TeammateSettingsTab } from "@/lib/agents/teammate-thread";
import type { TeammateDetail, ToolSetting } from "@/lib/agents/teammate-views";
import { WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";
import { ActivityTab } from "./settings/activity-tab";
import { InstructionsTab } from "./settings/instructions-tab";
import { MemoryTab } from "./settings/memory-tab";
import { RoutinesTab } from "./settings/routines-tab";
import { ToolsTab } from "./settings/tools-tab";

const GHOST_ICON = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink";
const LINK = "font-medium text-brand-deep hover:underline";

const TABS: ReadonlyArray<{ key: TeammateSettingsTab; label: string }> = [
  { key: "instructions", label: TEAMMATE_SETTINGS.tabInstructions },
  { key: "tools", label: TEAMMATE_SETTINGS.tabTools },
  { key: "memory", label: TEAMMATE_SETTINGS.tabMemory },
  { key: "routines", label: TEAMMATE_SETTINGS.tabRoutines },
  { key: "activity", label: TEAMMATE_SETTINGS.tabActivity },
];

type Loaded = { slug: string; teammate: TeammateDetail; canManage: boolean };

export function TeammateSettingsDrawer({
  slug,
  tab,
  onTab,
  onClose,
  onChanged,
}: {
  /** The teammate whose settings are open; null: closed. */
  slug: string | null;
  tab: TeammateSettingsTab;
  onTab: (tab: TeammateSettingsTab) => void;
  onClose: () => void;
  /** The teammate changed: the list, the chat and the AI sidebar read it again. */
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<{ slug: string; missing: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const latest = useRef(0);
  const load = useCallback(async (s: string) => {
    const n = ++latest.current;
    const r = await apiFetch<{ teammate: TeammateDetail; canManage: boolean }>(`/api/agents/teammates/${encodeURIComponent(s)}`, { cache: "no-store" });
    if (n !== latest.current) return;
    if (!r.ok) {
      setFailed({ slug: s, missing: r.status === 404 });
      return;
    }
    setFailed(null);
    setLoaded({ slug: s, teammate: r.data.teammate, canManage: r.data.canManage });
  }, []);

  // The open teammate's id, for the realtime event (it names agents by id).
  const agentIdRef = useRef<string | null>(null);
  useEffect(() => {
    agentIdRef.current = loaded && loaded.slug === slug ? loaded.teammate.id : null;
  }, [loaded, slug]);

  useEffect(() => {
    if (!slug) return;
    const timer = setTimeout(() => void load(slug), 0);
    const again = () => void load(slug);
    const onRealtime = (e: Event) => {
      const d = (e as CustomEvent<RealtimeEvent>).detail;
      if (d?.type === "agent.changed" && d.agentId === agentIdRef.current) again();
    };
    window.addEventListener(AI_CHATS_CHANGED_EVENT, again);
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(AI_CHATS_CHANGED_EVENT, again);
      window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime);
    };
  }, [slug, load]);

  /** Go on once the Instructions tab's unsaved changes are let go. */
  async function guard(go: () => void) {
    if (dirtyRef.current) {
      const ok = await confirm({
        title: TEAMMATE_SETTINGS.discardTitle,
        description: TEAMMATE_SETTINGS.discardBody,
        confirmLabel: TEAMMATE_SETTINGS.discard,
        destructive: true,
      });
      if (!ok) return;
      dirtyRef.current = false;
      setDirty(false);
    }
    go();
  }

  function saved(teammate: TeammateDetail) {
    setLoaded((l) => (l && l.slug === teammate.slug ? { ...l, teammate } : l));
    onChanged();
  }

  function tools(next: ToolSetting[]) {
    setLoaded((l) => (l ? { ...l, teammate: { ...l.teammate, tools: next } } : l));
  }

  const current = loaded && loaded.slug === slug ? loaded : null;
  const failure = failed && failed.slug === slug ? failed : null;
  const t = current?.teammate ?? null;

  let body: ReactNode;
  if (failure && !current) {
    body = failure.missing ? (
      <p className="m-0 flex min-h-9 items-center text-base text-ink-2">{TEAMMATE_ROUTE_ERRORS.teammateNotFound}</p>
    ) : (
      <div className="flex h-9 items-center gap-2 text-sm text-ink-2">
        {TEAMMATE_SETTINGS.loadError} ·
        <button type="button" className={LINK} onClick={() => slug && void load(slug)}>
          {TEAMMATE_CHAT.tryAgain}
        </button>
      </div>
    );
  } else if (!t || !current) {
    body = <SkeletonLines lines={5} />;
  } else if (tab === "tools") {
    body = <ToolsTab key={t.slug} teammate={t} canManage={current.canManage} onSaved={saved} onTools={tools} />;
  } else if (tab === "memory") {
    body = <MemoryTab key={t.slug} teammate={t} canManage={current.canManage} />;
  } else if (tab === "routines") {
    body = <RoutinesTab key={t.slug} teammate={t} />;
  } else if (tab === "activity") {
    body = <ActivityTab key={t.slug} teammate={t} />;
  } else {
    body = (
      <InstructionsTab
        key={t.slug}
        teammate={t}
        canManage={current.canManage}
        onSaved={saved}
        onRemoved={() => {
          dirtyRef.current = false;
          setDirty(false);
          onChanged();
          onClose();
        }}
        onDirty={setDirty}
      />
    );
  }

  return (
    <Drawer
      open={Boolean(slug)}
      onClose={() => void guard(onClose)}
      ariaLabel={t ? settingsCrumb(t.name) : TEAMMATE_CHAT.settings}
      layerId="teammate-settings"
      // Esc with unsaved instructions asks, the same as Close.
      canClose={() => {
        if (dirtyRef.current) {
          void guard(onClose);
          return false;
        }
        return true;
      }}
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{t ? settingsCrumb(t.name) : TEAMMATES_PAGE.title}</span>
          <button type="button" aria-label={TEAMMATE_SETTINGS.close} title={TEAMMATE_SETTINGS.close} onClick={() => void guard(onClose)} className={GHOST_ICON}>
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </>
      }
    >
      <ViewTabStrip aria-label={TEAMMATE_CHAT.settings} className="border-b border-line px-3">
        {TABS.map((x) => (
          <ViewTab
            key={x.key}
            label={x.label}
            active={tab === x.key}
            onClick={() => {
              if (tab !== x.key) void guard(() => onTab(x.key));
            }}
          />
        ))}
      </ViewTabStrip>
      <div className="p-4">{body}</div>
    </Drawer>
  );
}
