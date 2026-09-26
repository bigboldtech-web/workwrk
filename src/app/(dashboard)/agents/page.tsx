"use client";

// Agents (spec-ai-automation section 2, /agents), on the real endpoints.
//
// Turn on an AI teammate that does a job for you, on a schedule or when you
// ask. Every Member reads; Owners and Admins add, turn on, pause, schedule,
// run and remove (the Apps settings gate, access section 9), and a control a
// viewer cannot use is not rendered.
//
//   /agents                          Your agents
//   /agents?tab=runs                 Run history (&agentSlug= &status= &from= &to=)
//   /agents?agent=<slug>             the agent drawer
//   /agents?agent=<slug>&run=<id>    the drawer with that run expanded
//
// One drawer (520), with the run detail as a section inside it, not a
// second layer: Esc collapses an expanded run first and closes the drawer
// second. The Add agent modal lists the real catalogue (GET /api/agents
// `available`). Sort and page size of the Run history persist per viewer in
// home.work.surface["agents.runs"]; the filters are URL state.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { History, Link2, MessageSquare, Pause, Play, Plus, Power, Search, Trash2, X } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
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
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { SkeletonLines, SkeletonRows } from "@/components/ui/skeleton";
import { SchedulePicker } from "@/components/ai/schedule-picker";
import { ToolCallRow } from "@/components/ai/tool-call-row";
import { RunStatusChip, RunStatusDot } from "@/components/automation/run-status-chip";
import { apiFetch } from "@/lib/api-fetch";
import { agentState, runsOnWords } from "@/lib/agents/schedule-words";
import { toolOutcome } from "@/lib/agents/tool-verbs";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { formatDate, formatRelative } from "@/lib/format/date";
import { formatDuration } from "@/lib/format/duration";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useSurfaceState } from "@/lib/use-surface-state";
import { pick } from "@/lib/surface-prefs";

type Agent = {
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
};
type Available = { slug: string; name: string; persona: string | null; description: string };
type RunRow = {
  id: string;
  agentName: string;
  agentSlug: string;
  trigger: "SCHEDULED" | "MANUAL" | "CHAT";
  status: string;
  startedAt: string;
  durationMs: number | null;
  summary: string;
  sessionId: string | null;
  error: string | null;
};
type RunDetail = RunRow & {
  endedAt: string | null;
  toolCalls: Array<{ tool: string; input: Record<string, unknown> | null; result: unknown; error: string | null; durationMs: number | null }>;
};

const TRIGGER_LABEL: Record<RunRow["trigger"], string> = { SCHEDULED: "Scheduled", MANUAL: "Manual", CHAT: "From a chat" };
const RUN_SORTS = ["newest", "oldest"] as const;
const RUN_SORT_LABEL: Record<(typeof RUN_SORTS)[number], string> = { newest: "Newest first", oldest: "Oldest first" };
const PAGE_SIZES = [25, 50, 100];
const STATUS_FILTERS = [
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed" },
  { key: "running", label: "Running" },
] as const;

const GHOST_ICON = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink";
const SECONDARY = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60";

export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <AgentsInner />
    </Suspense>
  );
}

function AgentsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();

  const tab: "agents" | "runs" = sp?.get("tab") === "runs" ? "runs" : "agents";
  const openSlug = sp?.get("agent") ?? null;
  const openRun = sp?.get("run") ?? null;

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `/agents?${qs}` : "/agents", { scroll: false });
  }, [router, sp]);

  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [available, setAvailable] = useState<Available[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<{ agent: Agent; anchor: { current: HTMLElement | null } } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [runsVersion, setRunsVersion] = useState(0);
  // The Run history toolbar lives in the page header, so its state is here.
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [surface, setSurface] = useSurfaceState("agents.runs");
  const sort = pick(surface.sortKey, RUN_SORTS, "newest");
  const pageSize = PAGE_SIZES.includes(Number(surface.viewOptions?.pageSize)) ? Number(surface.viewOptions?.pageSize) : 50;
  const activeFilters = (sp?.get("agentSlug") ? 1 : 0) + (sp?.get("status") ? 1 : 0) + (sp?.get("from") || sp?.get("to") ? 1 : 0);

  const load = useCallback(async () => {
    const r = await apiFetch<{ installed: Agent[]; available: Available[]; canManage: boolean }>("/api/agents", { cache: "no-store" });
    if (!r.ok) { setError(true); return; }
    setError(false);
    setAgents(r.data.installed);
    setAvailable(r.data.available);
    setCanManage(r.data.canManage);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const changed = useCallback(() => { void load(); setRunsVersion((v) => v + 1); }, [load]);

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
    setBusy(a.slug);
    toast(`${a.name} is running`);
    const r = await apiFetch<{ result: { runId: string; status: string; errorText?: string } }>(`/api/agents/${a.slug}/schedule`, { method: "POST" });
    setBusy(null);
    if (!r.ok) { toast(r.error || "The run didn't start", { tone: "danger" }); return; }
    if (r.data.result.status === "FAILED") toast(`${a.name} ran into a problem`, { tone: "danger", action: { label: "See the run", onClick: () => setParams({ agent: a.slug, run: r.data.result.runId }) } });
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
  const openChat = (a: Agent) => router.push(`/sidekick?agent=${encodeURIComponent(a.slug)}&new=1`);

  const columns = useMemo<TableColumn<Agent>[]>(() => [
    { key: "name", label: "Agent", title: true, width: "minmax(240px,1.6fr)", render: (a) => (
      <span className="flex min-w-0 items-center gap-2">
        <EntityTile size="sm" name={a.name} {...NEUTRAL_TILE} />
        <span className="min-w-0 truncate">{a.name}</span>
        {a.persona ? <span className="min-w-0 truncate text-sm font-normal text-ink-2">· {a.persona}</span> : null}
      </span>
    ) },
    { key: "status", label: "Status", width: "130px", render: (a) => {
      const st = agentState(a);
      return st === "on" ? <StatusChip disabled color={RUN_TONE_COLOR.success} label="On" />
        : st === "needs-setup" ? <StatusChip disabled color={RUN_TONE_COLOR.warning} label="Needs setup" />
        : <StatusChip disabled color={RUN_TONE_COLOR.neutral} label="Paused" />;
    } },
    { key: "runsOn", label: "Runs on", width: "minmax(160px,1fr)", render: (a) => <span className="truncate text-sm text-ink-2">{runsOnWords(a.scheduleCron, a.autonomousEnabled)}</span> },
    { key: "last", label: "Last run", width: "130px", render: (a) => a.lastRunAt && a.lastRunId ? (
      <Link
        href={`/agents?agent=${encodeURIComponent(a.slug)}&run=${encodeURIComponent(a.lastRunId)}`}
        onClick={(e) => e.stopPropagation()}
        className="text-sm text-ink-2 hover:text-ink hover:underline"
      >
        {formatRelative(a.lastRunAt, datePrefs)}
      </Link>
    ) : a.lastRunAt ? <span className="text-sm text-ink-2">{formatRelative(a.lastRunAt, datePrefs)}</span> : <span className="text-sm text-ink-2">Never</span> },
    { key: "next", label: "Next run", width: "140px", render: (a) => a.nextRunAt && a.status === "ENABLED" && a.autonomousEnabled
      ? <span className="text-sm text-ink-2" title={formatDate(a.nextRunAt, datePrefs, "datetime")}>{formatDate(a.nextRunAt, datePrefs, "smart")}</span>
      : <span className="text-sm text-ink-3">Not scheduled</span> },
  ], [datePrefs]);

  const openAgent = openSlug ? agents?.find((a) => a.slug === openSlug) ?? null : null;
  const agentMissing = Boolean(openSlug) && agents !== null && !openAgent;

  return (
    <>
      <OsPageHeader
        title="Agents"
        more={[{ label: "Run history", icon: History, onClick: () => setParams({ tab: "runs", agent: null, run: null }) }]}
        views={
          <>
            <ViewTab label="Your agents" active={tab === "agents"} href="/agents" />
            <ViewTab label="Run history" active={tab === "runs"} href="/agents?tab=runs" />
          </>
        }
        toolbar={{
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
        }}
      />

      {tab === "runs" ? (
        <RunHistory
          agents={agents ?? []}
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
                    <MenuItem icon={Play} label="Run now" disabled={busy === menu.agent.slug} onClick={() => { const a = menu.agent; setMenu(null); void runNow(a); }} />
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
        missing={agentMissing}
        runId={openRun}
        canManage={canManage}
        busy={busy === openSlug}
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
        onAdded={() => void load()}
      />
    </>
  );
}

/* ─────────────────────────── Run history ─────────────────────────── */

function RunHistory({ agents, filterOpen, onCloseFilter, sort, pageSize, onPageSize, version, onOpenRun }: {
  agents: Agent[];
  filterOpen: boolean;
  onCloseFilter: () => void;
  sort: (typeof RUN_SORTS)[number];
  pageSize: number;
  onPageSize: (n: number) => void;
  version: number;
  onOpenRun: (r: RunRow) => void;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const datePrefs = useDatePrefs();

  const agentSlug = sp?.get("agentSlug") ?? null;
  const statuses = useMemo(() => (sp?.get("status") ?? "").split(",").filter(Boolean), [sp]);
  const from = sp?.get("from") ?? null;
  const to = sp?.get("to") ?? null;
  const activeFilters = (agentSlug ? 1 : 0) + (statuses.length ? 1 : 0) + (from || to ? 1 : 0);

  const [filterSearch, setFilterSearch] = useState("");
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [error, setError] = useState(false);

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`/agents?${next.toString()}`, { scroll: false });
  }, [router, sp]);

  const query = useMemo(() => {
    const q = new URLSearchParams({ take: String(pageSize), sort });
    if (agentSlug) q.set("agentSlug", agentSlug);
    if (statuses.length) q.set("status", statuses.join(","));
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return q.toString();
  }, [pageSize, sort, agentSlug, statuses, from, to]);

  const load = useCallback(async (cursor: string | null) => {
    const r = await apiFetch<{ runs: RunRow[]; total: number; nextCursor: string | null; restarted?: boolean }>(`/api/agents/runs?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
    if (!r.ok) { setError(true); return; }
    setError(false);
    if (r.data.restarted) setPages([null]);
    setRows(r.data.runs);
    setTotal(r.data.total);
    setNextCursor(r.data.nextCursor);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => { setPages([null]); void load(null); }, 0);
    return () => clearTimeout(t);
  }, [load, version]);
  useEffect(() => {
    const onFocus = () => void load(null);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const toggleStatus = (key: string, on: boolean) => {
    const next = new Set(statuses);
    if (on) next.add(key); else next.delete(key);
    setParams({ status: [...next].join(",") || null });
  };

  const columns = useMemo<TableColumn<RunRow>[]>(() => [
    { key: "status", label: "Status", width: "140px", render: (r) => <RunStatusChip status={r.status} /> },
    { key: "agent", label: "Agent", title: true, width: "minmax(160px,1fr)", render: (r) => r.agentName },
    { key: "trigger", label: "Trigger", width: "120px", render: (r) => <span className="text-sm text-ink-2">{TRIGGER_LABEL[r.trigger] ?? "From a chat"}</span> },
    { key: "started", label: "Started", width: "130px", render: (r) => <span className="text-sm text-ink-2" title={formatDate(r.startedAt, datePrefs, "datetime")}>{formatRelative(r.startedAt, datePrefs)}</span> },
    { key: "duration", label: "Duration", width: "96px", numeric: true, render: (r) => <span className="text-sm text-ink-2">{formatDuration(r.durationMs) ?? "Running"}</span> },
    { key: "summary", label: "Summary", width: "minmax(220px,2fr)", render: (r) => <span className="truncate text-sm text-ink-2">{r.summary}</span> },
  ], [datePrefs]);

  const pageIndex = pages.length - 1;
  const fieldMatch = (label: string) => label.toLowerCase().includes(filterSearch.toLowerCase());

  return (
    <>
      <div className="os-chrome flex min-h-0 gap-4 px-6 pb-10 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={onCloseFilter}
          objects="runs"
          activeCount={activeFilters}
          onClearAll={() => setParams({ agentSlug: null, status: null, from: null, to: null })}
          search={{ value: filterSearch, onChange: setFilterSearch, placeholder: "Search fields" }}
        >
          {fieldMatch("agent") ? (
            <FilterGroup label="Agent">
              {agents.length === 0 ? <span className="px-2 text-sm text-ink-3">No agents yet</span> : agents.map((a) => (
                <FilterRow key={a.slug} label={a.name} checked={agentSlug === a.slug} onCheckedChange={(on) => setParams({ agentSlug: on ? a.slug : null })} />
              ))}
            </FilterGroup>
          ) : null}
          {fieldMatch("status") ? (
            <FilterGroup label="Status">
              {STATUS_FILTERS.map((s) => (
                <FilterRow key={s.key} label={s.label} checked={statuses.includes(s.key)} onCheckedChange={(on) => toggleStatus(s.key, on)} />
              ))}
            </FilterGroup>
          ) : null}
          {fieldMatch("date range started") ? (
            <FilterGroup label="Started">
              <FilterRow label="Date range" checked={Boolean(from || to)} onCheckedChange={(on) => setParams(on ? { from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10) } : { from: null, to: null })}>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-sm text-ink-2">From <input type="date" value={from ?? ""} onChange={(e) => setParams({ from: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                  <label className="flex items-center gap-2 text-sm text-ink-2">To <input type="date" value={to ?? ""} onChange={(e) => setParams({ to: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                </div>
              </FilterRow>
            </FilterGroup>
          ) : null}
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col">
          {error ? (
            <div className="flex h-11 items-center gap-2 text-row text-ink-2">
              Couldn&apos;t load the run history ·
              <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => void load(pages[pageIndex] ?? null)}>Try again</button>
            </div>
          ) : (
            <TableCard
              ariaLabel="Agent runs"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              skeletonRows={5}
              onRowClick={(r) => onOpenRun(r)}
              empty={activeFilters ? (
                <span className="text-row text-ink-2">No runs match · <button type="button" className="text-brand-deep hover:underline" onClick={() => setParams({ agentSlug: null, status: null, from: null, to: null })}>Clear filters</button></span>
              ) : <span className="text-row text-ink-2">No runs yet</span>}
              footer={rows && rows.length > 0 ? {
                total,
                noun: "records",
                from: pageIndex * pageSize + 1,
                to: pageIndex * pageSize + rows.length,
                onPrev: pageIndex > 0 ? () => { const next = pages.slice(0, -1); setPages(next); void load(next[next.length - 1] ?? null); } : undefined,
                onNext: nextCursor ? () => { setPages([...pages, nextCursor]); void load(nextCursor); } : undefined,
                pageSize,
                pageSizes: PAGE_SIZES,
                onPageSize,
              } : undefined}
            />
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── the agent drawer ─────────────────────────── */

function AgentDrawer({
  slug, agent, missing, runId, canManage, busy, version,
  onClose, onRun, onCloseRun, onChanged, onSetStatus, onRunNow, onOpenChat,
}: {
  slug: string | null;
  agent: Agent | null;
  missing: boolean;
  runId: string | null;
  canManage: boolean;
  busy: boolean;
  version: number;
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

  function copyLink() {
    if (!slug) return;
    void navigator.clipboard?.writeText(`${window.location.origin}/agents?agent=${encodeURIComponent(slug)}`).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy the link", { tone: "danger" }),
    );
  }

  const runInList = Boolean(runId && runs?.some((r) => r.id === runId));
  const on = agent?.status === "ENABLED";

  return (
    <Drawer
      open={Boolean(slug)}
      onClose={() => void close()}
      ariaLabel="Agent"
      layerId="agent-drawer"
      // Esc collapses an expanded run first, then closes the drawer.
      canClose={() => { if (runId) { onCloseRun(); return false; } return !dirty; }}
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">Agents › <span className="text-ink">{agent?.name ?? ""}</span></span>
          {agent ? (
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
      ) : undefined}
    >
      {missing ? (
        <OsEmptyView title="This agent isn't here any more." compact />
      ) : !agent ? (
        <div className="p-4"><SkeletonLines lines={5} /></div>
      ) : (
        <div className="flex flex-col gap-6 p-4">
          <div className="flex items-center gap-3">
            <EntityTile size="md" name={agent.name} {...NEUTRAL_TILE} />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-ink">{agent.name}</h2>
              {agent.persona ? <p className="truncate text-sm text-ink-2">{agent.persona}</p> : null}
            </div>
          </div>

          <section aria-label="What it does">
            <h3 className="mb-1 text-sm font-medium text-ink-2">What it does</h3>
            <p className="text-base text-ink">{agent.description}</p>
          </section>

          <section className="flex flex-col" aria-label="Settings">
            <FieldRow label="On">
              {canManage ? (
                <Switch checked={on} aria-label={on ? `Pause ${agent.name}` : `Turn on ${agent.name}`} onChange={(next) => void onSetStatus(agent, next ? "ENABLED" : "DISABLED")} />
              ) : (
                <span className="text-base text-ink">{on ? "On" : "Paused"}</span>
              )}
            </FieldRow>
            <FieldRow label="Runs by itself">
              {canManage ? (
                <Switch
                  checked={agent.autonomousEnabled}
                  aria-label="Runs by itself"
                  onChange={(next) => void patchSchedule({ autonomousEnabled: next }, next ? `${agent.name} runs on its schedule` : `${agent.name} runs only when you ask`)}
                />
              ) : (
                <span className="text-base text-ink">{agent.autonomousEnabled ? "Yes" : "Only when asked"}</span>
              )}
            </FieldRow>
            {agent.autonomousEnabled || !canManage ? (
              <FieldRow label="Runs on">
                {canManage ? (
                  <SchedulePicker cron={agent.scheduleCron} onChange={(cron) => patchSchedule({ scheduleCron: cron }, "Schedule saved")} />
                ) : (
                  <span className="text-base text-ink">{runsOnWords(agent.scheduleCron, agent.autonomousEnabled)}</span>
                )}
              </FieldRow>
            ) : null}
            <FieldRow label="What to do each run" top>
              {canManage ? (
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
                  {dirty ? (
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setPrompt(null)} className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
                      <button type="button" disabled={savingPrompt} onClick={() => void savePrompt()} className={SECONDARY}>Save</button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <span className={`whitespace-pre-wrap text-base ${savedPrompt ? "text-ink" : "text-ink-3"}`}>{savedPrompt || "Not set"}</span>
              )}
            </FieldRow>
          </section>

          <section aria-label="Recent runs" className="flex flex-col">
            <h3 className="mb-1 text-sm font-medium text-ink-2">Recent runs</h3>
            {runId && runs !== null && !runInList ? (
              <RunDetail id={runId} agentSlug={agent.slug} onClose={onCloseRun} />
            ) : null}
            {runsError ? (
              <div className="flex h-9 items-center gap-2 text-sm text-ink-2">
                Couldn&apos;t load the runs ·
                <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => void loadRuns(agent.slug)}>Try again</button>
              </div>
            ) : runs === null ? (
              <SkeletonRows rows={3} />
            ) : runs.length === 0 ? (
              <p className="flex h-9 items-center text-sm text-ink-2">{on ? "It hasn't run yet." : "It hasn't run yet. Turn it on to run it."}</p>
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
                    {runId === r.id ? <RunDetail id={r.id} agentSlug={agent.slug} onClose={onCloseRun} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
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
            <span title={formatRelative(run.startedAt, datePrefs)}>Started <span className="text-ink">{formatDate(run.startedAt, datePrefs, "datetime")}</span></span>
            {formatDuration(run.durationMs) ? (
              <>
                <span aria-hidden>·</span>
                <span>Took <span className="tabular-nums text-ink">{formatDuration(run.durationMs)}</span></span>
              </>
            ) : null}
          </div>
          <p className="text-base text-ink">{run.summary}</p>
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
          {run.sessionId ? (
            <Link href={`/sidekick?session=${encodeURIComponent(run.sessionId)}`} className="text-sm font-medium text-brand-deep hover:underline">Open the chat</Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Add agent ─────────────────────────── */

function AddAgentDialog({ open, onOpenChange, available, onAdded }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: Available[];
  onAdded: () => void;
}) {
  const { toast } = useOsToast();
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Available[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // The list stays put while the modal is open: an agent that was just added
  // keeps its row, reading "Added", instead of jumping out from under you.
  const rows = useMemo(() => {
    const seen = new Set(available.map((a) => a.slug));
    const all = [...available, ...added.filter((a) => !seen.has(a.slug))];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((a) => `${a.name} ${a.persona ?? ""} ${a.description}`.toLowerCase().includes(needle)) : all;
  }, [available, added, q]);
  const addedSlugs = new Set(added.map((a) => a.slug));

  async function add(a: Available) {
    setBusy(a.slug);
    const r = await apiFetch(`/api/agents/${a.slug}/install`, { method: "POST" });
    setBusy(null);
    if (!r.ok) { toast(`Couldn't add ${a.name}`, { tone: "danger", action: { label: "Try again", onClick: () => void add(a) } }); return; }
    setAdded((prev) => [...prev, a]);
    onAdded();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setQ(""); setAdded([]); } }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add an agent</DialogTitle>
          <DialogDescription>Each agent does one job. You can pause or remove it at any time.</DialogDescription>
        </DialogHeader>
        {available.length + added.length > 8 ? (
          <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-raised px-3 text-base text-ink">
            <Search className="h-4 w-4 text-ink-2" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents" aria-label="Search agents" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
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
                  <button type="button" disabled={busy === a.slug} onClick={() => void add(a)} className={SECONDARY}>Add</button>
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
