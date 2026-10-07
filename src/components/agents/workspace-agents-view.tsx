"use client";

// Workspace agents (spec-ai-automation section 2), on the real endpoints:
// the body of the Agents page, moved unchanged when /agents became AI
// teammates (docs/plans/ai-teammates.md 5.1). The hub (agents-hub.tsx)
// draws the page's title and views around this view's own toolbar, through
// `header`.
//
// Turn on an AI teammate that does a job for you, on a schedule or when you
// ask. Every Member reads; Owners and Admins add, turn on, pause, schedule,
// run and remove (the Apps settings gate, access section 9), and a control a
// viewer cannot use is not rendered.
//
//   /agents?tab=workspace            Workspace agents
//   /agents?tab=runs                 Run history (&agentSlug= &status= &from= &to=)
//   /agents?agent=<slug>             the agent drawer (no tab: Workspace agents)
//   /agents?agent=<slug>&run=<id>    the drawer with that run expanded
//
// One drawer (520), with the run detail as a section inside it, not a
// second layer: Esc collapses an expanded run first and closes the drawer
// second. The Add agent modal lists the real catalogue (GET /api/agents
// `available`). Sort and page size of the Run history persist per viewer in
// home.work.surface["agents.runs"]; the filters are URL state.
//
// What the move changed: the view is named by the hub (`tab`), so the
// address keeps its tab when the drawer opens and closes (a bare /agents is
// Chats now); "Open chat" opens the teammate chat (/agents?chat=<slug>); a
// run's chat link is the route's chatHref; "See all agents" lands on this
// view.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { History, Link2, MessageSquare, Pause, Play, Plus, Power, Search, Trash2, X } from "lucide-react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useConfirm } from "@/components/ui/dialog-provider";
import { TableCard, RowMoreButton, type TableColumn } from "@/components/ui/table-card";
import { StatusChip } from "@/components/ui/chip";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { Switch } from "@/components/ui/switch";
import { Picker } from "@/components/ui/picker";
import { SkeletonLines, SkeletonRows } from "@/components/ui/skeleton";
import { ToolCallRow } from "@/components/ai/tool-call-row";
import { RunStatusChip, RunStatusDot } from "@/components/automation/run-status-chip";
import { apiFetch } from "@/lib/api-fetch";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import { agentState, runsOnWords, scheduleZone, wordsInZone } from "@/lib/agents/schedule-words";
import { toolOutcome } from "@/lib/agents/tool-verbs";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { formatDate, formatRelative } from "@/lib/format/date";
import { formatDuration } from "@/lib/format/duration";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { LEGACY_COPY, TEAMMATE_RUN_DRAWER } from "@/lib/agents/teammate-copy";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import type { AgentScheduleView } from "@/lib/agents/teammate-views";
import { useSurfaceState } from "@/lib/use-surface-state";
import { pick } from "@/lib/surface-prefs";
import type { HubHeader } from "./agents-hub";
import { PAGE_SIZES, RUN_SORTS, RUN_SORT_LABEL, RunHistory, TRIGGER_LABEL, type RunRow } from "./run-history-view";

/**
 * A backstop only: Run now is offered again when its run's end is heard
 * (runNowDone). If that never comes (this tab lost its connection), after
 * this long, past any turn's length.
 */
const RUN_NOW_MAX_MS = 20 * 60 * 1000;

export type Agent = {
  id: string;
  slug: string;
  name: string;
  persona: string | null;
  description: string;
  status: "ENABLED" | "DISABLED" | "ARCHIVED";
  autonomousEnabled: boolean;
  scheduleCron: string | null;
  autonomousPrompt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunId: string | null;
  /** Where its old schedule went (legacy-schedules.ts); absent from an older server. */
  schedule?: AgentScheduleView;
};
type Available = { slug: string; name: string; persona: string | null; description: string; removed?: boolean };
/** An agent that was removed: its run history is kept and still opens. */
export type RemovedAgent = { id: string; slug: string; name: string; persona: string | null; description: string; isPrebuilt: boolean };
type RunDetail = RunRow & {
  endedAt: string | null;
  /** Where the run's chat opens, when it is the viewer's own (the runs route's chatHref). */
  chatHref: string | null;
  toolCalls: Array<{ tool: string; input: Record<string, unknown> | null; result: unknown; error: string | null; durationMs: number | null }>;
};

const GHOST_ICON = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink";
const SECONDARY = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60";

/**
 * Workspace agents (`tab` "agents") and Run history (`tab` "runs"): one view,
 * because the two share the agents, the drawer a run opens in, and the
 * header toolbar.
 */
export function WorkspaceAgentsView({ tab, header }: { tab: "agents" | "runs"; header: HubHeader }) {
  const router = useRouter();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const viewerZone = useViewerZone();

  const openSlug = sp?.get("agent") ?? null;
  const openRun = sp?.get("run") ?? null;

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    // The address names this view: a bare /agents is Chats now, so closing
    // the drawer of an old ?agent= link must not leave the page.
    if (!next.get("tab")) next.set("tab", tab === "runs" ? "runs" : "workspace");
    const qs = next.toString();
    router.replace(qs ? `/agents?${qs}` : "/agents", { scroll: false });
  }, [router, sp, tab]);

  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [available, setAvailable] = useState<Available[]>([]);
  const [removed, setRemoved] = useState<RemovedAgent[]>([]);
  const [serverZone, setServerZone] = useState<string>("UTC");
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<{ agent: Agent; anchor: { current: HTMLElement | null } } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // The agents whose Run now is running in this tab.
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const [runsVersion, setRunsVersion] = useState(0);
  // The Run history toolbar lives in the page header, so its state is here.
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [surface, setSurface] = useSurfaceState("agents.runs");
  const sort = pick(surface.sortKey, RUN_SORTS, "newest");
  const pageSize = PAGE_SIZES.includes(Number(surface.viewOptions?.pageSize)) ? Number(surface.viewOptions?.pageSize) : 50;
  const activeFilters = (sp?.get("agentSlug") ? 1 : 0) + (sp?.get("status") ? 1 : 0) + (sp?.get("from") || sp?.get("to") ? 1 : 0);

  const load = useCallback(async () => {
    const r = await apiFetch<{ installed: Agent[]; available: Available[]; removed?: RemovedAgent[]; canManage: boolean; serverZone?: string }>("/api/agents", { cache: "no-store" });
    if (!r.ok) { setError(true); return; }
    setError(false);
    setAgents(r.data.installed);
    setAvailable(r.data.available);
    setRemoved(r.data.removed ?? []);
    if (r.data.serverZone) setServerZone(r.data.serverZone);
    setCanManage(r.data.canManage);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  // After Pause, Turn on, Add or Remove: reload the page and tell the AI hub
  // sidebar too, so its Agents badge (agents that are On) does not sit on the
  // old number until the window is refocused. Same pattern as the workflows page.
  const changed = useCallback(() => { void load(); setRunsVersion((v) => v + 1); notifyAiChatsChanged(); }, [load]);

  // A Run now whose answer was cut off: its run ends with agent.changed for
  // that agent (finishRunNow), and only then is Run now offered again.
  const runningUntilChanged = useRef(new Map<string, string>());
  useEffect(() => {
    const onRealtime = (e: Event) => {
      const ev = (e as CustomEvent<{ type?: string; agentId?: string; runNowDone?: boolean } | null>).detail;
      // Only the run's own end: other changes to the agent publish too (review round 9).
      if (ev?.type !== "agent.changed" || !ev.agentId || ev.runNowDone !== true) return;
      const slug = runningUntilChanged.current.get(ev.agentId);
      if (!slug) return;
      runningUntilChanged.current.delete(ev.agentId);
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
      changed();
    };
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    return () => window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime);
  }, [changed]);

  async function setStatus(a: Agent, status: "ENABLED" | "DISABLED") {
    setBusy(a.slug);
    const r = await apiFetch(`/api/agents/${a.slug}`, { method: "PATCH", json: { status } });
    setBusy(null);
    if (!r.ok) { toast("Couldn't update the agent", { tone: "danger", action: { label: "Try again", onClick: () => void setStatus(a, status) } }); return false; }
    toast(status === "ENABLED" ? `${a.name} is on` : `${a.name} is paused`);
    changed();
    return true;
  }
  async function runNow(a: Agent) {
    // Each agent's Run now stays off while its own turn runs, whatever else starts (review round 6).
    setRunning((r) => new Set(r).add(a.slug));
    toast(`${a.name} is running`);
    const r = await apiFetch<{ result: { runId: string; status: string; errorText?: string; waiting?: number; chatHref?: string } }>(`/api/agents/${a.slug}/schedule`, { method: "POST" });
    const done = () =>
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(a.slug);
        return next;
      });
    // The answer began (200) and its end never came, a dropped connection:
    // the run started and goes on in the person's chat. Run now stays off
    // until it ends, never offered again to ask and pay twice (review round 8).
    if (!r.ok && r.status === 200) {
      toast(LEGACY_COPY.runNowStarted(a.name), { action: { label: LEGACY_COPY.openChat, onClick: () => router.push(`/agents?chat=${encodeURIComponent(a.slug)}`) } });
      runningUntilChanged.current.set(a.id, a.slug);
      setTimeout(() => {
        if (runningUntilChanged.current.delete(a.id)) done();
      }, RUN_NOW_MAX_MS);
      return;
    }
    done();
    if (!r.ok) { toast(r.error || "The run didn't start", { tone: "danger" }); return; }
    // It ran as the person who clicked, in their chat with it: what it asked
    // to do waits there for their approval.
    const chatHref = r.data.result.chatHref;
    if ((r.data.result.waiting ?? 0) > 0 && chatHref) toast(LEGACY_COPY.runNowWaiting(a.name), { action: { label: LEGACY_COPY.openChat, onClick: () => router.push(chatHref) } });
    else if (r.data.result.status === "FAILED") toast(`${a.name} ran into a problem`, { tone: "danger", action: { label: "See the run", onClick: () => setParams({ agent: a.slug, run: r.data.result.runId }) } });
    else toast(`${a.name} finished`, { action: { label: "See the run", onClick: () => setParams({ agent: a.slug, run: r.data.result.runId }) } });
    changed();
  }
  async function remove(a: Agent) {
    const ok = await confirm({
      title: `Remove ${a.name}?`,
      description: "It stops running. Its run history is kept.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch(`/api/agents/${a.slug}`, { method: "DELETE" });
    if (!r.ok) { toast("Couldn't remove the agent", { tone: "danger", action: { label: "Try again", onClick: () => void remove(a) } }); return; }
    toast(`${a.name} removed`);
    if (openSlug === a.slug) setParams({ agent: null, run: null });
    changed();
  }
  // The agent's chat is its teammate chat on this page (it used to be an Ask
  // AI chat bound to the agent).
  const openChat = (a: Agent) => router.push(`/agents?chat=${encodeURIComponent(a.slug)}`);

  const columns = useMemo<TableColumn<Agent>[]>(() => [
    { key: "name", label: "Agent", title: true, width: "minmax(240px,1.6fr)", render: (a) => (
      <span className="flex min-w-0 items-center gap-2">
        <EntityTile size="sm" name={a.name} {...NEUTRAL_TILE} />
        <span className="min-w-0 truncate">{a.name}</span>
        {a.persona ? <span className="min-w-0 truncate text-sm font-normal text-ink-2">· {a.persona}</span> : null}
      </span>
    ) },
    { key: "status", label: "Status", width: "130px", render: (a) => <AgentStatusChip agent={a} /> },
    { key: "runsOn", label: "Runs on", width: "minmax(160px,1fr)", render: (a) => {
      // A schedule moved onto a routine names whose it is; a stopped one says why on hover.
      const s = a.schedule;
      if (s?.state === "stopped") return <span title={LEGACY_COPY.stopped(s.reason ?? "")}><StatusChip color={RUN_TONE_COLOR.neutral} label={LEGACY_COPY.stoppedChip} /></span>;
      const who = s?.personName ?? LEGACY_COPY.itsCreator;
      const words = s?.state === "routine"
        ? s.paused
          ? s.isYou ? LEGACY_COPY.routinePausedYou : LEGACY_COPY.routinePausedFor(who)
          : s.isYou ? LEGACY_COPY.routineForYou : LEGACY_COPY.routineFor(who)
        : wordsInZone(runsOnWords(a.scheduleCron, a.autonomousEnabled), scheduleZone(a.scheduleCron, serverZone), viewerZone);
      return <span className="truncate text-sm text-ink-2" title={s?.paused && s.pausedText ? `${words}: ${s.pausedText}` : words}>{words}</span>;
    } },
    { key: "last", label: "Last run", width: "130px", render: (a) => a.lastRunAt && a.lastRunId ? (
      <Link
        href={`/agents?agent=${encodeURIComponent(a.slug)}&run=${encodeURIComponent(a.lastRunId)}`}
        onClick={(e) => e.stopPropagation()}
        className="text-sm text-ink-2 hover:text-ink hover:underline"
      >
        {formatRelative(a.lastRunAt, datePrefs)}
      </Link>
    ) : a.lastRunAt ? <span className="text-sm text-ink-2">{formatRelative(a.lastRunAt, datePrefs)}</span> : <span className="text-sm text-ink-2">Never</span> },
    // The date AND the time, in the viewer's zone: beside a schedule read in
    // another zone the date alone looked like a contradiction (a Sunday next
    // to "Weekdays"). The smart style already answers with the bare time for
    // a run due today, so that day reads "Today, 11:30 PM" rather than the
    // time twice.
    { key: "next", label: "Next run", width: "160px", render: (a) => {
      if (a.schedule?.state === "routine") {
        return a.schedule.paused
          ? <span className="text-sm text-ink-3" title={a.schedule.pausedText ?? undefined}>Not scheduled</span>
          : <span className="text-sm text-ink-3">{LEGACY_COPY.nextInRoutine}</span>;
      }
      if (!(a.nextRunAt && a.status === "ENABLED" && a.autonomousEnabled)) return <span className="text-sm text-ink-3">Not scheduled</span>;
      const day = formatDate(a.nextRunAt, datePrefs, "smart");
      const time = formatDate(a.nextRunAt, datePrefs, "time");
      return <span className="truncate text-sm text-ink-2" title={formatDate(a.nextRunAt, datePrefs, "datetime")}>{day === time ? "Today" : day}, {time}</span>;
    } },
  ], [datePrefs, serverZone, viewerZone]);

  const openAgent = openSlug ? agents?.find((a) => a.slug === openSlug) ?? null : null;
  const openRemoved = openSlug && !openAgent ? removed.find((a) => a.slug === openSlug) ?? null : null;
  const agentMissing = Boolean(openSlug) && agents !== null && !openAgent && !openRemoved;

  return (
    <>
      {header({
        more: [{ label: "Run history", icon: History, onClick: () => setParams({ tab: "runs", agent: null, run: null }) }],
        // A Member on Your agents has nothing for the toolbar row, so it does
        // not render (no empty 44px band above the table).
        toolbar: tab !== "runs" && !canManage ? undefined : {
          ...(tab === "runs" ? {
            filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
            sort: { onClick: () => setSortOpen((o) => !o), label: RUN_SORT_LABEL[sort], active: true },
            left: (
              <div className="relative">
                <Picker
                  open={sortOpen}
                  onClose={() => setSortOpen(false)}
                  ariaLabel="Sort runs"
                  width={200}
                  selected={sort}
                  onSelect={(v) => { setSortOpen(false); setSurface({ sortKey: v }); }}
                  sections={[{ options: RUN_SORTS.map((s) => ({ value: s, label: RUN_SORT_LABEL[s] })) }]}
                />
              </div>
            ),
          } : {}),
          primary: canManage ? { label: "Add agent", icon: Plus, onClick: () => setAddOpen(true) } : undefined,
        },
      })}

      {tab === "runs" ? (
        <RunHistory
          agents={agents ?? []}
          removed={removed}
          filterOpen={filterOpen}
          onCloseFilter={() => setFilterOpen(false)}
          sort={sort}
          pageSize={pageSize}
          onPageSize={(n) => setSurface({ viewOptions: { pageSize: n } })}
          version={runsVersion}
          onOpenRun={(r) => setParams({ agent: r.agentSlug, run: r.id })}
        />
      ) : (
        <div className="px-6 pb-10 pt-2">
          {error ? (
            <div className="flex h-11 items-center gap-2 text-row text-ink-2">
              Couldn&apos;t load agents ·
              <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => void load()}>Try again</button>
            </div>
          ) : agents && agents.length === 0 ? (
            <OsEmptyView
              title="No agents yet"
              hint={canManage ? "An agent is an AI teammate that does a job on a schedule, or when you ask." : "No agents are turned on yet."}
              action={canManage ? { label: "See what agents can do", onClick: () => setAddOpen(true) } : undefined}
            />
          ) : (
            <TableCard
              ariaLabel="Agents"
              columns={columns}
              rows={agents}
              rowKey={(a) => a.id}
              skeletonRows={5}
              highlightKey={openAgent?.id ?? null}
              onRowClick={(a) => setParams({ agent: a.slug, run: null })}
              rowMenu={(a) => (canManage || a.status === "ENABLED") ? (
                <RowMoreButton
                  label={`Actions for ${a.name}`}
                  open={menu?.agent.id === a.id}
                  onClick={(e) => setMenu({ agent: a, anchor: { current: e.currentTarget } })}
                />
              ) : null}
            />
          )}
        </div>
      )}

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${menu.agent.name}`}>
            {menu.agent.status === "ENABLED" ? (
              <MenuItem icon={MessageSquare} label="Open chat" onClick={() => { const a = menu.agent; setMenu(null); openChat(a); }} />
            ) : null}
            {canManage ? (
              <>
                {menu.agent.status === "ENABLED" ? (
                  <>
                    <MenuItem icon={Play} label="Run now" disabled={busy === menu.agent.slug || running.has(menu.agent.slug)} onClick={() => { const a = menu.agent; setMenu(null); void runNow(a); }} />
                    <MenuItem icon={Pause} label="Pause" onClick={() => { const a = menu.agent; setMenu(null); void setStatus(a, "DISABLED"); }} />
                  </>
                ) : (
                  <MenuItem icon={Power} label="Turn on" onClick={() => { const a = menu.agent; setMenu(null); void setStatus(a, "ENABLED"); }} />
                )}
                <MenuSeparator />
                <MenuItem icon={Trash2} label="Remove" destructive onClick={() => { const a = menu.agent; setMenu(null); void remove(a); }} />
              </>
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}

      <AgentDrawer
        slug={openSlug}
        agent={openAgent}
        removedAgent={openRemoved}
        missing={agentMissing}
        serverZone={serverZone}
        viewerZone={viewerZone}
        runId={openRun}
        canManage={canManage}
        busy={busy === openSlug || (openSlug !== null && running.has(openSlug))}
        version={runsVersion}
        onClose={() => setParams({ agent: null, run: null })}
        onRun={(id) => setParams({ run: id })}
        onCloseRun={() => setParams({ run: null })}
        onChanged={changed}
        onSetStatus={(a, s) => setStatus(a, s)}
        onRunNow={(a) => void runNow(a)}
        onOpenChat={openChat}
      />

      <AddAgentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        available={available}
        removed={removed}
        onAdded={changed}
      />
    </>
  );
}

/* ─────────────────────────── the agent drawer ─────────────────────────── */

function AgentDrawer({
  slug, agent, removedAgent, missing, runId, canManage, busy, version, serverZone, viewerZone,
  onClose, onRun, onCloseRun, onChanged, onSetStatus, onRunNow, onOpenChat,
}: {
  slug: string | null;
  agent: Agent | null;
  /** The drawer names a removed agent: its kept run history, and Add back. */
  removedAgent: RemovedAgent | null;
  missing: boolean;
  runId: string | null;
  canManage: boolean;
  busy: boolean;
  version: number;
  serverZone: string;
  viewerZone: string | null;
  onClose: () => void;
  onRun: (id: string) => void;
  onCloseRun: () => void;
  onChanged: () => void;
  onSetStatus: (a: Agent, s: "ENABLED" | "DISABLED") => Promise<boolean | undefined> | void;
  onRunNow: (a: Agent) => void;
  onOpenChat: (a: Agent) => void;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [runsError, setRunsError] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [addingBack, setAddingBack] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const loadRuns = useCallback(async (s: string) => {
    const r = await apiFetch<{ runs: RunRow[] }>(`/api/agents/runs?agentSlug=${encodeURIComponent(s)}&take=10`, { cache: "no-store" });
    if (!r.ok) { setRunsError(true); return; }
    setRunsError(false);
    setRuns(r.data.runs);
  }, []);
  useEffect(() => {
    if (!slug) return;
    const t = setTimeout(() => { setRuns(null); void loadRuns(slug); }, 0);
    return () => clearTimeout(t);
  }, [slug, loadRuns, version]);
  // A different agent starts with its own saved instructions.
  useEffect(() => {
    const t = setTimeout(() => setPrompt(null), 0);
    return () => clearTimeout(t);
  }, [slug]);

  const savedPrompt = agent?.autonomousPrompt ?? "";
  const draft = prompt ?? savedPrompt;
  const dirty = prompt !== null && prompt !== savedPrompt;

  useEffect(() => {
    const t = promptRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 12 * 20 + 16)}px`;
  }, [draft]);

  async function patchSchedule(body: Record<string, unknown>, done: string): Promise<boolean> {
    if (!agent) return false;
    const r = await apiFetch<{ agent: unknown }>(`/api/agents/${agent.slug}/schedule`, { method: "PATCH", json: body });
    if (!r.ok) {
      toast(r.error || "Couldn't save the change", { tone: "danger", action: { label: "Try again", onClick: () => void patchSchedule(body, done) } });
      return false;
    }
    toast(done);
    onChanged();
    return true;
  }

  async function savePrompt(): Promise<boolean> {
    if (!dirty) return true;
    setSavingPrompt(true);
    const ok = await patchSchedule({ autonomousPrompt: (prompt ?? "").trim() || null }, "Instructions saved");
    setSavingPrompt(false);
    if (ok) setPrompt(null);
    return ok;
  }
  // The dirty guard holds one stable save; it always runs the latest one.
  const saveRef = useRef(savePrompt);
  useEffect(() => { saveRef.current = savePrompt; });
  const onGuardSave = useCallback(() => saveRef.current(), []);
  useDirtyGuard(dirty, { onSave: onGuardSave, id: "agent-instructions" });

  async function close() {
    if (dirty) {
      const ok = await confirm({ title: "Discard your changes?", description: "The instructions for this agent have changes you have not saved.", confirmLabel: "Discard", destructive: true });
      if (!ok) return;
      setPrompt(null);
    }
    onClose();
  }

  async function addBack() {
    if (!removedAgent) return;
    setAddingBack(true);
    const r = await apiFetch(`/api/agents/${encodeURIComponent(removedAgent.slug)}/install`, { method: "POST" });
    setAddingBack(false);
    if (!r.ok) { toast(`Couldn't add ${removedAgent.name} back`, { tone: "danger", action: { label: "Try again", onClick: () => void addBack() } }); return; }
    toast(`${removedAgent.name} is back`);
    onChanged();
  }

  function copyLink() {
    if (!slug) return;
    void navigator.clipboard?.writeText(`${window.location.origin}/agents?agent=${encodeURIComponent(slug)}`).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy the link", { tone: "danger" }),
    );
  }

  const runInList = Boolean(runId && runs?.some((r) => r.id === runId));
  const on = agent?.status === "ENABLED";
  const shown = agent ?? removedAgent;
  const zone = agent ? scheduleZone(agent.scheduleCron, serverZone) : null;

  const recentRuns = (agentSlug: string, emptyText: string) => (
    <section aria-label="Recent runs" className="flex flex-col">
      <h3 className="mb-1 text-sm font-medium text-ink-2">Recent runs</h3>
      {runId && runs !== null && !runInList ? (
        <RunDetail id={runId} agentSlug={agentSlug} onClose={onCloseRun} />
      ) : null}
      {runsError ? (
        <div className="flex h-9 items-center gap-2 text-sm text-ink-2">
          Couldn&apos;t load the runs ·
          <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => void loadRuns(agentSlug)}>Try again</button>
        </div>
      ) : runs === null ? (
        <SkeletonRows rows={3} />
      ) : runs.length === 0 ? (
        <p className="flex h-9 items-center text-sm text-ink-2">{emptyText}</p>
      ) : (
        <ul className="flex flex-col">
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => (runId === r.id ? onCloseRun() : onRun(r.id))}
                aria-expanded={runId === r.id}
                className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-hover ${runId === r.id ? "bg-active" : ""}`}
              >
                <RunStatusDot status={r.status} />
                <span className="min-w-0 flex-1 truncate text-ink">{r.summary}</span>
                <span className="shrink-0 text-ink-2" title={formatDate(r.startedAt, datePrefs, "datetime")}>{formatRelative(r.startedAt, datePrefs)}</span>
              </button>
              {runId === r.id ? <RunDetail id={r.id} agentSlug={agentSlug} onClose={onCloseRun} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <Drawer
      open={Boolean(slug)}
      onClose={() => void close()}
      ariaLabel="Agent"
      layerId="agent-drawer"
      // Esc collapses an expanded run first, then closes the drawer; with
      // unsaved instructions it asks, the same as the close button.
      canClose={() => {
        if (runId) { onCloseRun(); return false; }
        if (dirty) { void close(); return false; }
        return true;
      }}
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
            {shown ? <>Agents › <span className="text-ink">{shown.name}</span></> : "Agents"}
          </span>
          {shown ? (
            <button type="button" aria-label="Copy link" title="Copy link" onClick={copyLink} className={GHOST_ICON}>
              <Link2 className="h-4 w-4" strokeWidth={1.5} />
            </button>
          ) : null}
          <button type="button" aria-label="Close" title="Close · Esc" onClick={() => void close()} className={GHOST_ICON}>
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </>
      }
      footer={agent && on ? (
        <div className="flex items-center gap-2 px-4 py-3">
          {canManage ? (
            <button type="button" disabled={busy} onClick={() => onRunNow(agent)} className={SECONDARY}>
              <Play className="h-4 w-4" strokeWidth={1.5} /> Run now
            </button>
          ) : null}
          <button type="button" onClick={() => onOpenChat(agent)} className={SECONDARY}>
            <MessageSquare className="h-4 w-4" strokeWidth={1.5} /> Open chat
          </button>
        </div>
      ) : removedAgent && canManage ? (
        <div className="flex items-center gap-2 px-4 py-3">
          <button type="button" disabled={addingBack} onClick={() => void addBack()} className={SECONDARY}>
            <Plus className="h-4 w-4" strokeWidth={1.5} /> Add back
          </button>
        </div>
      ) : undefined}
    >
      {missing ? (
        <MissingAgent slug={slug} runId={runId} onCloseRun={onCloseRun} />
      ) : removedAgent ? (
        <div className="flex flex-col gap-6 p-4">
          <div className="flex items-center gap-3">
            <EntityTile size="md" name={removedAgent.name} {...NEUTRAL_TILE} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-ink">{removedAgent.name}</h2>
              {removedAgent.persona ? <p className="truncate text-sm text-ink-2">{removedAgent.persona}</p> : null}
            </div>
            <StatusChip color={RUN_TONE_COLOR.neutral} label="Removed" />
          </div>
          <p className="text-base text-ink-2">
            This agent was removed, so it doesn&apos;t run. Its run history is kept.
            {canManage ? " Add it back to turn it on again." : ""}
          </p>
          {recentRuns(removedAgent.slug, "It never ran.")}
        </div>
      ) : !agent ? (
        <div className="p-4"><SkeletonLines lines={5} /></div>
      ) : (
        <div className="flex flex-col gap-6 p-4">
          <div className="flex items-center gap-3">
            <EntityTile size="md" name={agent.name} {...NEUTRAL_TILE} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-ink">{agent.name}</h2>
              {agent.persona ? <p className="truncate text-sm text-ink-2">{agent.persona}</p> : null}
            </div>
            {canManage ? null : <AgentStatusChip agent={agent} />}
          </div>

          <section aria-label="What it does">
            <h3 className="mb-1 text-sm font-medium text-ink-2">What it does</h3>
            <p className="text-base text-ink">{agent.description}</p>
          </section>

          {canManage ? (
            <section className="flex flex-col" aria-label="Settings">
              <FieldRow label="On">
                <Switch checked={on} aria-label={on ? `Pause ${agent.name}` : `Turn on ${agent.name}`} onChange={(next) => void onSetStatus(agent, next ? "ENABLED" : "DISABLED")} />
              </FieldRow>
              {/* A schedule is a routine now: one person it works as, set in
                  the agent's chat (docs/plans/ai-teammates-phase2.md step 2). */}
              <FieldRow label={LEGACY_COPY.scheduleLabel}>
                <ScheduleLine agent={agent} zone={zone} viewerZone={viewerZone} />
              </FieldRow>
              <FieldRow label="What to do each run" top>
                <div className="flex min-w-0 flex-col gap-2">
                  <textarea
                    ref={promptRef}
                    value={draft}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder="What should it do each time it runs?"
                    aria-label="What to do each run"
                    className="block w-full resize-none rounded-md border border-line-strong bg-raised px-2 py-1.5 text-base text-ink outline-none placeholder:text-ink-3 focus:border-brand"
                  />
                  {agent.schedule?.state === "routine" ? <p className="m-0 text-sm text-ink-2">{LEGACY_COPY.promptRunNowOnly}</p> : null}
                  {dirty ? (
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setPrompt(null)} className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
                      <button type="button" disabled={savingPrompt} onClick={() => void savePrompt()} className={SECONDARY}>Save</button>
                    </div>
                  ) : null}
                </div>
              </FieldRow>
            </section>
          ) : (
            // A Member's drawer is the description, the schedule as words
            // and the run history (spec-ai-automation section 2, /agents).
            <section className="flex flex-col" aria-label="Schedule">
              <FieldRow label={LEGACY_COPY.scheduleLabel}>
                <ScheduleLine agent={agent} zone={zone} viewerZone={viewerZone} />
              </FieldRow>
            </section>
          )}

          {recentRuns(agent.slug, on ? "It hasn't run yet." : canManage ? "It hasn't run yet. Turn it on to run it." : "It hasn't run yet.")}
        </div>
      )}
    </Drawer>
  );
}

/**
 * Where an agent's schedule went (legacy-schedules.ts): its creator's
 * routine, or why it stopped, or the old words when it never had one; then a
 * link to the routines in its chat, where anyone can set up their own.
 */
function ScheduleLine({ agent, zone, viewerZone }: { agent: Agent; zone: string | null; viewerZone: string | null }) {
  const s = agent.schedule;
  const words = s?.state === "routine"
    ? s.paused
      ? s.isYou ? LEGACY_COPY.scheduleLinePausedYou(s.pausedText) : LEGACY_COPY.scheduleLinePaused(s.personName ?? LEGACY_COPY.itsCreator, s.pausedText)
      : s.isYou ? LEGACY_COPY.scheduleLineYou : LEGACY_COPY.scheduleLine(s.personName ?? LEGACY_COPY.itsCreator)
    : s?.state === "stopped" ? LEGACY_COPY.stopped(s.reason ?? "")
    : wordsInZone(runsOnWords(agent.scheduleCron, agent.autonomousEnabled), zone, viewerZone);
  const href = s?.routinesHref ?? `/agents?chat=${encodeURIComponent(agent.slug)}&settings=routines`;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-base text-ink">{words}</span>
      <Link href={href} className="w-fit text-sm font-medium text-brand-deep hover:underline">
        {s?.state === "routine" && s.isYou ? LEGACY_COPY.openRoutines : LEGACY_COPY.setUpRoutine}
      </Link>
    </span>
  );
}

/** On, Paused or Needs setup: a pale label, never a disabled button. */
function AgentStatusChip({ agent }: { agent: Pick<Agent, "status" | "autonomousEnabled" | "scheduleCron"> }) {
  const st = agentState(agent);
  return st === "on" ? <StatusChip color={RUN_TONE_COLOR.success} label="On" />
    : st === "needs-setup" ? <StatusChip color={RUN_TONE_COLOR.warning} label="Needs setup" />
    : <StatusChip color={RUN_TONE_COLOR.neutral} label="Paused" />;
}

/** The viewer's zone: their saved preference, else the browser's. */
function useViewerZone(): string | null {
  const prefs = useDatePrefs();
  return useMemo(() => {
    if (prefs.timezone) return prefs.timezone;
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
  }, [prefs.timezone]);
}

function FieldRow({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <div className={`flex min-h-9 gap-3 py-1 ${top ? "items-start" : "items-center"}`}>
      <span className={`w-[120px] shrink-0 text-sm font-medium text-ink-2 ${top ? "pt-1.5" : ""}`}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ─────────────────────────── the run detail ─────────────────────────── */

/**
 * A slug Workspace agents does not hold. A teammate this person may use (their
 * own private one, whose runs its Activity tab links here) is named, with its
 * run and a way to its chat; anything else is gone, as before.
 */
function MissingAgent({ slug, runId, onCloseRun }: { slug: string | null; runId: string | null; onCloseRun: () => void }) {
  const [teammate, setTeammate] = useState<{ name: string } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!slug) {
      const t = setTimeout(() => { if (live) setTeammate(null); }, 0);
      return () => { live = false; clearTimeout(t); };
    }
    void apiFetch<{ teammate: { name: string } }>(`/api/agents/teammates/${encodeURIComponent(slug)}`, { cache: "no-store" }).then((r) => {
      if (live) setTeammate(r.ok && r.data.teammate?.name ? { name: r.data.teammate.name } : null);
    });
    return () => { live = false; };
  }, [slug]);
  if (teammate === undefined) return <div className="p-4"><SkeletonLines lines={3} /></div>;
  if (!teammate || !slug) {
    return (
      <div className="flex flex-col gap-1 p-4">
        <p className="flex min-h-9 items-center text-base text-ink">This agent isn&apos;t here any more.</p>
        <Link href="/agents?tab=workspace" className="text-sm font-medium text-brand-deep hover:underline">See all agents</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="flex min-h-9 items-center text-base text-ink">{TEAMMATE_RUN_DRAWER.isTeammate(teammate.name)}</p>
      <Link href={`/agents?chat=${encodeURIComponent(slug)}`} className="text-sm font-medium text-brand-deep hover:underline">{TEAMMATE_RUN_DRAWER.openChat(teammate.name)}</Link>
      {runId ? <RunDetail id={runId} agentSlug={slug} onClose={onCloseRun} /> : null}
    </div>
  );
}

function RunDetail({ id, agentSlug, onClose }: { id: string; agentSlug: string; onClose: () => void }) {
  const datePrefs = useDatePrefs();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error" | "gone">("loading");
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setState("loading");
    const r = await apiFetch<{ run: RunDetail }>(`/api/agents/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!r.ok) { setState(r.status === 404 ? "gone" : "error"); return; }
    // A run of another agent is not this drawer's to show.
    if (r.data.run.agentSlug !== agentSlug) { setState("gone"); return; }
    setRun(r.data.run);
    setState("ok");
  }, [id, agentSlug]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state]);

  return (
    <div ref={ref} className="my-1 rounded-md border border-line bg-subtle p-3" aria-label="Run detail">
      <div className="flex h-9 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">
          Run{run ? ` · ${formatRelative(run.startedAt, datePrefs)}` : ""}
        </span>
        <button type="button" aria-label="Close the run" title="Close · Esc" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      {state === "loading" ? (
        <SkeletonRows rows={3} />
      ) : state === "gone" ? (
        <p className="flex h-9 items-center text-sm text-ink-2">That run is not available.</p>
      ) : state === "error" || !run ? (
        <div className="flex h-9 items-center gap-2 text-sm text-ink-2">
          Couldn&apos;t load this run ·
          <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => void load()}>Try again</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div><RunStatusChip status={run.status} /></div>
          <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            <span>Trigger: <span className="text-ink">{TRIGGER_LABEL[run.trigger] ?? "From a chat"}</span></span>
            <span aria-hidden>·</span>
            <span title={formatRelative(run.startedAt, datePrefs)}>Started <span className="text-ink">{formatDate(run.startedAt, datePrefs, "date")}, {formatDate(run.startedAt, datePrefs, "time")}</span></span>
            {formatDuration(run.durationMs) ? (
              <>
                <span aria-hidden>·</span>
                <span>Took <span className="tabular-nums text-ink">{formatDuration(run.durationMs)}</span></span>
              </>
            ) : null}
          </div>
          <p className="text-base text-ink">{run.summary}</p>
          {run.detailHidden ? (
            <p className="text-sm text-ink-2">It ran with an admin&apos;s access, so what it found shows only to admins and the person who ran it.</p>
          ) : null}
          {run.status === "FAILED" && run.error ? (
            <div className="flex min-h-9 items-center text-sm text-danger-text">{run.error.slice(0, 300)}</div>
          ) : null}
          {run.toolCalls.length > 0 ? (
            <div>
              <h4 className="mt-1 text-sm font-medium text-ink-2">What it did</h4>
              {run.toolCalls.map((c, i) => (
                <ToolCallRow key={i} name={c.tool} input={c.input} outcome={toolOutcome(c.tool, c.result, c.error)} durationMs={c.durationMs} />
              ))}
            </div>
          ) : null}
          {run.chatHref ? (
            <Link href={run.chatHref} className="text-sm font-medium text-brand-deep hover:underline">Open the chat</Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Add agent ─────────────────────────── */

function AddAgentDialog({ open, onOpenChange, available, removed, onAdded }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: Available[];
  /** Removed agents: every one can be added back, custom ones included. */
  removed: RemovedAgent[];
  onAdded: () => void;
}) {
  const { toast } = useOsToast();
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Available[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The list stays put while the modal is open: an agent that was just added
  // keeps its row, reading "Added", instead of jumping out from under you.
  const rows = useMemo(() => {
    const seen = new Set(available.map((a) => a.slug));
    const back: Available[] = removed
      .filter((r) => !seen.has(r.slug))
      .map((r) => ({ slug: r.slug, name: r.name, persona: r.persona, description: r.description, removed: true }));
    for (const b of back) seen.add(b.slug);
    const all = [...available.map((a) => (removed.some((r) => r.slug === a.slug) ? { ...a, removed: true } : a)), ...back, ...added.filter((a) => !seen.has(a.slug))];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((a) => `${a.name} ${a.persona ?? ""} ${a.description}`.toLowerCase().includes(needle)) : all;
  }, [available, removed, added, q]);
  const addedSlugs = new Set(added.map((a) => a.slug));

  async function add(a: Available) {
    setBusy(a.slug);
    const r = await apiFetch(`/api/agents/${a.slug}/install`, { method: "POST" });
    setBusy(null);
    if (!r.ok) { toast(`Couldn't add ${a.name}`, { tone: "danger", action: { label: "Try again", onClick: () => void add(a) } }); return; }
    if (a.removed) toast(`${a.name} is back`);
    setAdded((prev) => [...prev, a]);
    onAdded();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setQ(""); setAdded([]); } }}>
      <DialogContent
        ref={contentRef}
        // .os-chrome: on the px grid like the rest of the frame (32px Add,
        // 36px rows). Opening focuses the search, or the dialog itself, never
        // the first Add button, whose focus ring read as a second primary.
        className="os-chrome max-w-[560px] outline-none focus:outline-none focus-visible:outline-none"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (searchRef.current) searchRef.current.focus();
          else contentRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">Add an agent</DialogTitle>
          <DialogDescription>Each agent does one job. You can pause or remove it at any time.</DialogDescription>
        </DialogHeader>
        {rows.length + (q ? 1 : 0) > 8 || q ? (
          <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-raised px-3 text-base text-ink">
            <Search className="h-4 w-4 text-ink-2" aria-hidden />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents" aria-label="Search agents" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
          </label>
        ) : null}
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-2">{q ? "No agents match." : "Every agent is already added."}</p>
        ) : (
          <ul className="flex max-h-[60vh] flex-col divide-y divide-line-soft overflow-y-auto">
            {rows.map((a) => (
              <li key={a.slug} className="flex items-center gap-3 py-2.5">
                <EntityTile size="sm" name={a.name} {...NEUTRAL_TILE} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-row font-medium text-ink">{a.name}{a.persona ? <span className="font-normal text-ink-2"> · {a.persona}</span> : null}</div>
                  <div className="line-clamp-1 text-sm text-ink-2">{a.description}</div>
                </div>
                {addedSlugs.has(a.slug) ? (
                  <span className="shrink-0 text-sm text-ink-2">Added</span>
                ) : (
                  <button type="button" disabled={busy === a.slug} onClick={() => void add(a)} className={SECONDARY}>{a.removed ? "Add back" : "Add"}</button>
                )}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">
            {added.length ? "Done" : "Cancel"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
