"use client";

/* /automation/logs: exactly what an automation did, and why it failed
 * (spec-ai-automation /automation/logs). Every Member reads it.
 *
 *   GET  /api/automation/runs   ?status= ?workflowId= ?severity= ?record=  (each a comma list)
 *        ?days= | ?from= ?to=  ?sort=newest|oldest  ?take=  ?cursor=
 *        -> { runs, total, nextCursor, restarted }
 *   GET  /api/automation/runs/[id]         the drawer (steps, payloads, retry)
 *   POST /api/automation/runs/[id]/retry   Retry failed steps
 *
 * Every filter, the sort and the page are in the URL, so each entry point
 * (Health's legend, a workflow's View logs, the builder's Recent runs)
 * arrives filtered and a filtered view is shareable. Per viewer, in
 * home.work.surface["automation.logs"]: the columns, the page size and the
 * default sort. ?runId= opens the run drawer; Esc closes it through the
 * shell's LayerStack.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, ChevronRight, Gauge, Link2, RotateCcw, X } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { Drawer } from "@/components/ui/drawer";
import { JsonBlock } from "@/components/ui/json-block";
import { Picker } from "@/components/ui/picker";
import { ViewTab } from "@/components/ui/view-tabs";
import { SkeletonLines } from "@/components/ui/skeleton";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { RunStatusChip, RunStatusDot } from "@/components/automation/run-status-chip";
import { BTN, InlineRow, NeutralChip } from "@/components/automation/automation-ui";
import { apiFetch } from "@/lib/api-fetch";
import { LOG_PAGE_SIZES, LOG_VIEWS, LOG_VIEW_LABEL, RECORD_LABEL, RECORD_TYPES, parseRunStatuses, viewForStatuses } from "@/lib/automation/run-query";
import { ALERT_LABEL, ALERT_LEVELS } from "@/lib/automation/workflow-list";
import { formatDate, formatRelative } from "@/lib/format/date";
import { formatDuration } from "@/lib/format/duration";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useSurfaceState } from "@/lib/use-surface-state";
import { pick } from "@/lib/surface-prefs";
import { AUTOMATION_TEAMMATE_COPY } from "@/lib/agents/teammate-copy";

interface RunRecord { type: string; id: string; name: string; url: string | null }

interface RunRow {
  id: string;
  workflowId: string;
  workflow: { id: string; name: string } | null;
  triggerEventKey: string;
  triggerName: string;
  status: string;
  severity: string;
  recordType: string | null;
  recordId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  record: RunRecord | null;
}

interface RunStep {
  id: string;
  order: number;
  stepType: "TRIGGER" | "CONDITION" | "ACTION";
  stepKey: string;
  stepName: string;
  status: string;
  inputJson: unknown;
  outputJson: unknown;
  errorMessage: string | null;
  durationMs: number | null;
}

interface RunDetail extends Omit<RunRow, "workflow"> {
  workflow: { id: string; name: string; status: string; severity: string };
  steps: RunStep[];
  triggerPayload: unknown;
  detailHidden: boolean;
  retry: { can: boolean; blockedBy: string[] };
}

const COLUMN_KEYS = ["when", "record", "started", "took", "error"] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const COLUMN_LABEL: Record<ColumnKey, string> = { when: "When", record: "Record", started: "Started", took: "Took", error: "Error" };
const SORTS = ["newest", "oldest"] as const;
const SORT_LABEL: Record<(typeof SORTS)[number], string> = { newest: "Newest first", oldest: "Oldest first" };
const STEP_TYPE_LABEL: Record<RunStep["stepType"], string> = { TRIGGER: "Trigger", CONDITION: "Check", ACTION: "Action" };


/** A teammate step's answer, or what came after it, hidden from this viewer (runs/[id] route, hideTeammateAnswers). */
function answerHiddenIn(output: unknown): boolean {
  return Boolean(output) && typeof output === "object" && !Array.isArray(output) && (output as Record<string, unknown>).answerHidden === true;
}

function runSummary(r: { status: string; errorMessage: string | null; steps?: RunStep[] }): string {
  const actions = (r.steps ?? []).filter((s) => s.stepType === "ACTION");
  const ok = actions.filter((s) => s.status === "SUCCESS").length;
  if (r.status === "SKIPPED") return "The conditions did not match, so nothing ran.";
  if (r.status === "RUNNING") return "Still running.";
  if (r.status === "SUCCESS") return actions.length ? `All ${actions.length} action${actions.length === 1 ? "" : "s"} ran.` : "It ran.";
  if (r.status === "PARTIAL") return `${ok} of ${actions.length} actions ran. ${r.errorMessage ?? ""}`.trim();
  return r.errorMessage ?? "It failed.";
}

/* ─────────────────────────── the run drawer ─────────────────────────── */

/**
 * `known`: the run is a row on this page, so the drawer opens at once while it
 * loads. A deep link to any other id waits for the answer, and a run that is
 * not in this workspace never opens the drawer at all: `onMissing` hands the
 * page its 44px sentence instead (spec: "the drawer does not open").
 */
function RunDrawer({ runId, known, onClose, onRetried, onMissing }: { runId: string | null; known: boolean; onClose: () => void; onRetried: () => void; onMissing: (id: string) => void }) {
  const { toast } = useOsToast();
  const datePrefs = useDatePrefs();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [retrying, setRetrying] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    const r = await apiFetch<{ run: RunDetail }>(`/api/automation/runs/${id}`, { cache: "no-store" });
    if (!r.ok) {
      setState(r.status === 404 ? "missing" : "error");
      if (r.status === 404) onMissing(id);
      return;
    }
    setRun(r.data.run);
    setState("ready");
  }, [onMissing]);

  useEffect(() => {
    if (!runId) return;
    const t = setTimeout(() => { setRun(null); setState("loading"); setOpenStep(null); void load(runId); }, 0);
    return () => clearTimeout(t);
  }, [runId, load]);

  // A running run refetches every 10 seconds while the drawer is open, and
  // stops the moment it finishes.
  useEffect(() => {
    if (!runId || run?.status !== "RUNNING") return;
    const t = setInterval(() => void load(runId), 10_000);
    return () => clearInterval(t);
  }, [runId, run?.status, load]);

  const retry = async () => {
    if (!run) return;
    setRetrying(true);
    const r = await apiFetch<{ recovered?: boolean; status?: string | null }>(`/api/automation/runs/${run.id}/retry`, { method: "POST", json: {} });
    setRetrying(false);
    if (!r.ok) {
      toast(r.error || "The retry didn't run", { tone: "danger" });
      return;
    }
    // The answer says whether every step worked; a step refused again says why in the run.
    if (r.data.recovered) toast("Retried. Every step worked.");
    else toast("Retried, but some steps still failed. Each one says why.", { tone: "danger" });
    void load(run.id);
    onRetried();
  };

  const copyLink = () => {
    if (!run) return;
    const url = `${window.location.origin}/automation/logs?runId=${run.id}`;
    void navigator.clipboard?.writeText(url).then(() => toast("Link copied")).catch(() => toast("Couldn't copy the link", { tone: "danger" }));
  };

  const started = run ? run.startedAt ?? run.createdAt : null;

  return (
    <Drawer
      open={Boolean(runId) && state !== "missing" && (known || state !== "loading")}
      onClose={onClose}
      ariaLabel="Run"
      layerId="automation-run-drawer"
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
            {run ? <><span className="text-ink">{run.workflow.name}</span> › Run</> : "Run"}
          </span>
          {run ? (
            <button type="button" aria-label="Copy link" title="Copy link" onClick={copyLink} className={BTN.icon}>
              <Link2 className="size-4" strokeWidth={1.5} />
            </button>
          ) : null}
          <button type="button" aria-label="Close" title="Close · Esc" onClick={onClose} className={BTN.icon}>
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </>
      }
      footer={run && (run.status === "FAILED" || run.status === "PARTIAL") ? (
        run.retry.can ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            <button type="button" onClick={() => void retry()} disabled={retrying} className={BTN.secondary}>
              <RotateCcw className="size-4" aria-hidden /> {retrying ? "Retrying" : "Retry failed steps"}
            </button>
          </div>
        ) : run.retry.blockedBy.length > 0 ? (
          <div className="border-t border-line px-4 py-3 text-sm text-warning-text">
            {run.retry.blockedBy.join(", ")} cannot be repeated safely (it could do the same thing twice), so this run cannot be retried.
          </div>
        ) : null
      ) : null}
    >
      <div className="os-chrome flex flex-col gap-4 p-4">
        {state === "error" ? (
          <InlineRow action={{ label: "Try again", onClick: () => runId && void load(runId) }}>Couldn&apos;t load this run</InlineRow>
        ) : !run ? (
          <SkeletonLines lines={6} />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <RunStatusChip status={run.status} />
              <p className="m-0 text-row text-ink">{runSummary(run)}</p>
            </div>
            <dl className="m-0 grid grid-cols-[110px_1fr] gap-y-1 text-sm">
              <dt className="flex h-9 items-center text-ink-2">Automation</dt>
              <dd className="m-0 flex h-9 items-center"><Link href={`/automation/workflows/${run.workflow.id}`} className="truncate text-ink hover:underline">{run.workflow.name}</Link></dd>
              <dt className="flex h-9 items-center text-ink-2">Trigger</dt>
              <dd className="m-0 flex h-9 items-center truncate text-ink">{run.triggerName}</dd>
              <dt className="flex h-9 items-center text-ink-2">Record</dt>
              <dd className="m-0 flex h-9 items-center">
                {run.record ? (run.record.url ? <Link href={run.record.url} className="truncate text-ink hover:underline">{run.record.name}</Link> : <span className="truncate">{run.record.name}</span>) : <span className="text-ink-3">Not available</span>}
              </dd>
              <dt className="flex h-9 items-center text-ink-2">Started</dt>
              <dd className="m-0 flex h-9 items-center text-ink" title={started ? formatRelative(started, datePrefs) : undefined}>{started ? formatDate(started, datePrefs, "datetime") : "Not started"}</dd>
              <dt className="flex h-9 items-center text-ink-2">Took</dt>
              <dd className="m-0 flex h-9 items-center tabular-nums text-ink">{formatDuration(run.durationMs) ?? (run.status === "RUNNING" ? "Still running" : "Not recorded")}</dd>
            </dl>

            <section aria-labelledby="steps-title" className="flex flex-col">
              <h3 id="steps-title" className="m-0 mb-1 text-sm font-semibold text-ink">Steps</h3>
              {run.detailHidden ? (
                <p className="m-0 mb-2 text-sm text-ink-2">
                  {run.recordType === "task"
                    ? "This run is about a task in a List you cannot open, so what went in and came back is not shown."
                    : "What went in and came back is about a person, so it is shown only to whoever made this automation and to Owners and Admins."}
                </p>
              ) : null}
              {run.steps.map((s) => {
                const open = openStep === s.id;
                const hasDetail = !run.detailHidden && s.stepType !== "TRIGGER";
                return (
                  <div key={s.id} className="border-b border-line-soft last:border-b-0">
                    <button
                      type="button"
                      disabled={!hasDetail}
                      aria-expanded={hasDetail ? open : undefined}
                      onClick={() => setOpenStep(open ? null : s.id)}
                      className="flex h-9 w-full items-center gap-2 rounded-md px-1 text-start text-sm hover:bg-hover disabled:hover:bg-transparent"
                    >
                      {/* The chevron says the row opens; a row with nothing to show has none. */}
                      {hasDetail ? (
                        <ChevronRight className={`size-4 shrink-0 text-ink-2 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
                      ) : (
                        <span className="size-4 shrink-0" aria-hidden />
                      )}
                      <NeutralChip className="h-5 px-1">{STEP_TYPE_LABEL[s.stepType]}</NeutralChip>
                      <span className="min-w-0 flex-1 truncate text-ink">{s.stepName}</span>
                      <span className="shrink-0 tabular-nums text-ink-2">{formatDuration(s.durationMs) ?? ""}</span>
                      <RunStatusDot status={s.status} />
                    </button>
                    {s.errorMessage ? <p className="m-0 mb-1 ps-1 text-sm text-danger-text">{s.errorMessage}</p> : null}
                    {open && hasDetail ? (
                      <div className="mb-2 flex flex-col gap-2 ps-1">
                        <JsonBlock label="What went in" value={s.inputJson} defaultOpen />
                        {answerHiddenIn(s.outputJson) ? (
                          <p className="m-0 text-sm text-ink-2">{AUTOMATION_TEAMMATE_COPY.answerHidden}</p>
                        ) : (
                          <JsonBlock label="What came back" value={s.outputJson} defaultOpen />
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>

            {!run.detailHidden ? <JsonBlock label="The event" value={run.triggerPayload} /> : null}
          </>
        )}
      </div>
    </Drawer>
  );
}

/* ─────────────────────────── the page ─────────────────────────── */

function LogsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const datePrefs = useDatePrefs();

  const statuses = useMemo(() => parseRunStatuses(sp?.get("status")).statuses, [sp]);
  const view = viewForStatuses(statuses);
  // Several statuses at once (Health's "See all failures" sends failed and
  // partly done) light no pill, so they count as a filter and show as ticks
  // in the Status group below.
  const statusIsFilter = statuses.length > 0 && view === "all";
  const workflowIds = useMemo(() => (sp?.get("workflowId") ?? "").split(",").filter(Boolean), [sp]);
  const severities = useMemo(() => (sp?.get("severity") ?? "").split(",").filter(Boolean).map((s) => s.toUpperCase()), [sp]);
  const records = useMemo(() => (sp?.get("record") ?? "").split(",").filter(Boolean), [sp]);
  const days = sp?.get("days") ?? null;
  const from = sp?.get("from") ?? null;
  const to = sp?.get("to") ?? null;
  const cursor = sp?.get("cursor") ?? null;
  const runId = sp?.get("runId") ?? null;

  const [surface, setSurface] = useSurfaceState("automation.logs");
  const urlSort = sp?.get("sort");
  const sort = pick(urlSort ?? surface.sortKey, SORTS, "newest");
  const pageSize = (LOG_PAGE_SIZES as readonly number[]).includes(Number(surface.viewOptions?.pageSize)) ? Number(surface.viewOptions?.pageSize) : 50;
  const columns = useMemo<ColumnKey[]>(() => {
    const stored = surface.columns?.filter((c): c is ColumnKey => (COLUMN_KEYS as readonly string[]).includes(c));
    return stored && stored.length ? stored : [...COLUMN_KEYS];
  }, [surface.columns]);

  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  // A ?runId= that is not in this workspace: the page says so, the drawer stays shut.
  const [missingRunId, setMissingRunId] = useState<string | null>(null);
  const onMissing = useCallback((id: string) => setMissingRunId(id), []);
  // The cursors of the pages before this one, so Previous works on a keyset.
  const history = useRef<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);

  const setParams = useCallback((patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!keepPage && !("cursor" in patch)) {
      next.delete("cursor");
      history.current = [];
      setPageIndex(0);
    }
    const qs = next.toString();
    router.replace(qs ? `/automation/logs?${qs}` : "/automation/logs", { scroll: false });
  }, [router, sp]);

  const activeFilters = (statusIsFilter ? 1 : 0) + (workflowIds.length ? 1 : 0) + (severities.length ? 1 : 0) + (records.length ? 1 : 0) + (days || from || to ? 1 : 0);

  const query = useMemo(() => {
    const q = new URLSearchParams({ sort, take: String(pageSize) });
    if (statuses.length) q.set("status", statuses.join(","));
    if (workflowIds.length) q.set("workflowId", workflowIds.join(","));
    if (severities.length) q.set("severity", severities.join(","));
    if (records.length) q.set("record", records.join(","));
    if (from || to) {
      if (from) q.set("from", from);
      if (to) q.set("to", to);
    } else if (days) q.set("days", days);
    if (cursor) q.set("cursor", cursor);
    return q.toString();
  }, [sort, pageSize, statuses, workflowIds, severities, records, from, to, days, cursor]);

  const load = useCallback(async () => {
    const r = await apiFetch<{ runs: RunRow[]; total: number; nextCursor: string | null; restarted?: boolean }>(`/api/automation/runs?${query}`, { cache: "no-store" });
    if (!r.ok) {
      setError(r.error || "Couldn't load runs");
      setRows((prev) => prev ?? []);
      return;
    }
    setError(null);
    if (r.data.restarted) {
      history.current = [];
      setPageIndex(0);
    }
    setRows(r.data.runs);
    setTotal(r.data.total);
    setNextCursor(r.data.nextCursor);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // The Automation filter lists every automation, archived ones included
  // (their runs are kept).
  useEffect(() => {
    let alive = true;
    void apiFetch<{ workflows: Array<{ id: string; name: string }> }>("/api/automation/workflows?includeArchived=1&take=100&sort=name", { cache: "no-store" }).then((r) => {
      if (alive && r.ok) setWorkflows(r.data.workflows.map((w) => ({ id: w.id, name: w.name })));
    });
    return () => {
      alive = false;
    };
  }, []);

  const tableColumns = useMemo<TableColumn<RunRow>[]>(() => {
    const all: Array<TableColumn<RunRow> & { k?: ColumnKey }> = [
      { key: "status", label: "Status", width: "130px", render: (r) => <RunStatusChip status={r.status} /> },
      {
        key: "automation",
        label: "Automation",
        title: true,
        width: "minmax(200px,1.6fr)",
        render: (r) => r.workflow
          ? <Link href={`/automation/workflows/${r.workflow.id}`} onClick={(e) => e.stopPropagation()} className="truncate hover:underline">{r.workflow.name}</Link>
          : <span className="text-ink-3">Removed</span>,
      },
      { key: "when", k: "when", label: "When", width: "minmax(210px,1.4fr)", render: (r) => <span className="truncate text-ink-2" title={r.triggerName}>{r.triggerName}</span> },
      {
        key: "record",
        k: "record",
        label: "Record",
        width: "minmax(120px,0.9fr)",
        render: (r) => r.record
          ? (r.record.url ? <Link href={r.record.url} onClick={(e) => e.stopPropagation()} className="truncate text-ink hover:underline">{r.record.name}</Link> : <span className="truncate">{r.record.name}</span>)
          : <span className="text-ink-3">Not available</span>,
      },
      {
        key: "started",
        k: "started",
        label: "Started",
        width: "140px",
        render: (r) => {
          const at = r.startedAt ?? r.createdAt;
          return <span className="whitespace-nowrap text-ink-2" title={formatRelative(at, datePrefs)}>{formatDate(at, datePrefs, "datetime")}</span>;
        },
      },
      { key: "took", k: "took", label: "Took", width: "104px", numeric: true, render: (r) => <span className="whitespace-nowrap text-ink-2">{formatDuration(r.durationMs) ?? (r.status === "RUNNING" ? "Running" : "Not recorded")}</span> },
      { key: "error", k: "error", label: "Error", width: "minmax(100px,0.7fr)", render: (r) => r.errorMessage ? <span className="truncate text-ink-2" title={r.errorMessage}>{r.errorMessage.split("\n")[0]}</span> : null },
    ];
    return all.filter((c) => !c.k || columns.includes(c.k));
  }, [columns, datePrefs]);

  const fieldMatch = (label: string) => label.toLowerCase().includes(filterSearch.trim().toLowerCase());
  const clearFilters = () => setParams({ workflowId: null, severity: null, record: null, days: null, from: null, to: null, status: null });
  const toggleList = (key: string, list: string[], value: string, on: boolean) => {
    const next = new Set(list);
    if (on) next.add(value);
    else next.delete(value);
    setParams({ [key]: [...next].join(",") || null });
  };
  // The Status group speaks in view words (failed, partial), the URL's own vocabulary.
  const statusWords = statuses.map((s) => viewForStatuses([s]));

  const menu = [
    ...COLUMN_KEYS.map((k) => ({
      label: COLUMN_LABEL[k],
      checked: columns.includes(k),
      keepOpen: true,
      onClick: () => {
        const next = columns.includes(k) ? columns.filter((c) => c !== k) : COLUMN_KEYS.filter((c) => c === k || columns.includes(c));
        setSurface({ columns: next.length ? next : [...COLUMN_KEYS] });
      },
    })),
    { separator: true as const },
    { label: "Health", icon: Activity, href: days ? `/automation/health?days=${days}` : "/automation/health" },
    { label: "Usage", icon: Gauge, href: "/automation/usage" },
  ];

  const nothingAtAll = rows !== null && !error && total === 0 && statuses.length === 0 && activeFilters === 0 && !cursor;
  const offsetFrom = pageIndex * pageSize;

  return (
    <>
      <OsPageHeader
        title="Logs"
        views={
          <>
            {LOG_VIEWS.map((v) => (
              <ViewTab key={v} label={LOG_VIEW_LABEL[v]} active={view === v && (v !== "all" || statuses.length === 0)} onClick={() => setParams({ status: v === "all" ? null : v })} />
            ))}
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: SORT_LABEL[sort], active: sort !== "newest" },
          left: (
            <div className="relative">
              <Picker
                open={sortOpen}
                onClose={() => setSortOpen(false)}
                ariaLabel="Sort runs"
                width={200}
                selected={sort}
                onSelect={(v) => {
                  setSortOpen(false);
                  setSurface({ sortKey: v });
                  setParams({ sort: v === "newest" ? null : v });
                }}
                sections={[{ options: SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] })) }]}
              />
            </div>
          ),
          menu,
        }}
      />

      <div className="px-6 pb-10 pt-2">
        {nothingAtAll ? (
          <OsEmptyView title="Nothing has run yet" action={{ label: "See your workflows", href: "/automation/workflows" }} />
        ) : (
          <div className="os-chrome flex min-h-0 gap-4">
            <FilterPanel
              open={filterOpen}
              onClose={() => setFilterOpen(false)}
              objects="runs"
              activeCount={activeFilters}
              onClearAll={() => setParams({ workflowId: null, severity: null, record: null, days: null, from: null, to: null, ...(statusIsFilter ? { status: null } : {}) })}
              search={{ value: filterSearch, onChange: setFilterSearch, placeholder: "Search fields" }}
            >
              {fieldMatch("status") ? (
                <FilterGroup label="Status">
                  {LOG_VIEWS.filter((v) => v !== "all").map((v) => (
                    <FilterRow key={v} label={LOG_VIEW_LABEL[v]} checked={statusWords.includes(v)} onCheckedChange={(on) => toggleList("status", statusWords, v, on)} />
                  ))}
                </FilterGroup>
              ) : null}
              {fieldMatch("automation") ? (
                <FilterGroup label="Automation">
                  {workflows.length === 0 ? <span className="px-2 text-sm text-ink-3">No automations yet</span> : workflows.map((w) => (
                    <FilterRow key={w.id} label={w.name} checked={workflowIds.includes(w.id)} onCheckedChange={(on) => toggleList("workflowId", workflowIds, w.id, on)} />
                  ))}
                </FilterGroup>
              ) : null}
              {fieldMatch("date range started") ? (
                <FilterGroup label="Date range">
                  {["7", "30", "90"].map((d) => (
                    <FilterRow key={d} label={`Last ${d} days`} checked={days === d && !from && !to} onCheckedChange={(on) => setParams({ days: on ? d : null, from: null, to: null })} />
                  ))}
                  <FilterRow label="Between dates" checked={Boolean(from || to)} onCheckedChange={(on) => setParams(on ? { from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10), days: null } : { from: null, to: null })}>
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 text-sm text-ink-2">From <input type="date" value={from ?? ""} onChange={(e) => setParams({ from: e.target.value || null, days: null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                      <label className="flex items-center gap-2 text-sm text-ink-2">To <input type="date" value={to ?? ""} onChange={(e) => setParams({ to: e.target.value || null, days: null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                    </div>
                  </FilterRow>
                </FilterGroup>
              ) : null}
              {fieldMatch("record type") ? (
                <FilterGroup label="Record type">
                  {RECORD_TYPES.map((t) => (
                    <FilterRow key={t} label={RECORD_LABEL[t] ?? t} checked={records.includes(t)} onCheckedChange={(on) => toggleList("record", records, t, on)} />
                  ))}
                </FilterGroup>
              ) : null}
              {fieldMatch("alert level") ? (
                <FilterGroup label="Alert level">
                  {ALERT_LEVELS.map((a) => (
                    <FilterRow key={a} label={ALERT_LABEL[a]} checked={severities.includes(a)} onCheckedChange={(on) => toggleList("severity", severities, a, on)} />
                  ))}
                </FilterGroup>
              ) : null}
            </FilterPanel>

            <div className="flex min-w-0 flex-1 flex-col">
              {runId && missingRunId === runId ? (
                <InlineRow action={{ label: "Dismiss", onClick: () => setParams({ runId: null }, true) }}>That run is not in this workspace</InlineRow>
              ) : null}
              {error && (rows ?? []).length === 0 ? (
                <InlineRow action={{ label: "Try again", onClick: () => void load() }}>{error.startsWith("Invalid") ? "That link has a filter this page does not know" : "Couldn't load runs"}</InlineRow>
              ) : (
                <TableCard
                  ariaLabel="Automation runs"
                  columns={tableColumns}
                  rows={rows}
                  rowKey={(r) => r.id}
                  skeletonRows={10}
                  highlightKey={runId}
                  onRowClick={(r) => setParams({ runId: r.id }, true)}
                  empty={
                    <span>
                      No runs match ·{" "}
                      <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button>
                    </span>
                  }
                  footer={rows && total > 0 ? {
                    total,
                    noun: "records",
                    from: offsetFrom + 1,
                    to: offsetFrom + rows.length,
                    onPrev: pageIndex > 0 ? () => {
                      const prev = history.current.pop() ?? null;
                      setPageIndex((i) => Math.max(0, i - 1));
                      setParams({ cursor: prev }, true);
                    } : undefined,
                    onNext: nextCursor ? () => {
                      history.current.push(cursor ?? "");
                      setPageIndex((i) => i + 1);
                      setParams({ cursor: nextCursor }, true);
                    } : undefined,
                    pageSize,
                    pageSizes: [...LOG_PAGE_SIZES],
                    onPageSize: (n) => { setSurface({ viewOptions: { pageSize: n } }); setParams({ cursor: null }); },
                  } : undefined}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <RunDrawer
        runId={runId}
        known={Boolean(runId && rows?.some((r) => r.id === runId))}
        onClose={() => setParams({ runId: null }, true)}
        onRetried={() => void load()}
        onMissing={onMissing}
      />
    </>
  );
}

export default function AutomationLogsPage() {
  return (
    <Suspense fallback={null}>
      <LogsInner />
    </Suspense>
  );
}
