"use client";

/* /automation/logs — the execution log.
 *
 *  GET  /api/automation/runs?workflowId=&status=&take=   → run table
 *  GET  /api/automation/runs/[id]                        → drawer detail (steps)
 *  GET  /api/automation/workflows                        → workflow filter select
 *  GET  /api/automation/actions                          → safeToRetry map
 *  POST /api/automation/runs/[id]/retry                  → manual retry
 *
 * Row click opens a right-side drawer with every step's input/output
 * JSON. Retry appears only when the server would accept it (FAILED/
 * PARTIAL run whose failed action steps are all retry-safe) — the API
 * re-validates regardless. Deep links: ?workflowId= pre-filters,
 * ?runId= opens the drawer directly (builder run-history links here).
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, RotateCcw, ScrollText, X } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { AutomationHeader, RUN_STATUS_COLORS, StatusPill, relTime } from "../shared";

interface ApiRunRow {
  id: string;
  workflowId: string;
  workflow: { id: string; name: string } | null;
  triggerEventKey: string;
  status: string;
  severity: string;
  recordType: string | null;
  recordId: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

interface ApiStep {
  id: string;
  order: number;
  stepType: string;
  stepKey: string;
  stepName: string | null;
  status: string;
  inputJson: unknown;
  outputJson: unknown;
  errorMessage: string | null;
  durationMs: number | null;
}

interface ApiRunDetail extends ApiRunRow {
  triggerPayload: unknown;
  steps: ApiStep[];
}

interface ApiWorkflowOption {
  id: string;
  name: string;
}

const RUN_STATUSES = ["SUCCESS", "FAILED", "PARTIAL", "SKIPPED", "RUNNING"] as const;

const GRID =
  "grid grid-cols-[96px_minmax(160px,1.4fr)_minmax(130px,1fr)_minmax(120px,1fr)_90px_70px_minmax(140px,1.6fr)] items-center gap-2";

const SELECT =
  "h-7 rounded-md border border-zinc-200 bg-white px-2 text-[12px] text-zinc-700 outline-none focus:border-zinc-400";

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text === "{}" || text === "null") return null;
  return (
    <div className="mt-1.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </div>
      <pre className="mt-0.5 max-h-48 overflow-auto rounded-md border border-zinc-100 bg-zinc-50 p-2 text-[11px] leading-relaxed text-zinc-700">
        {text}
      </pre>
    </div>
  );
}

function RunDrawer({
  runId,
  safeToRetry,
  onClose,
  onRetried,
}: {
  runId: string;
  safeToRetry: Map<string, boolean>;
  onClose: () => void;
  onRetried: () => void;
}) {
  const { toast } = useOsToast();
  const [run, setRun] = useState<ApiRunDetail | null>(null);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/automation/runs/${runId}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRun(data.run ?? null);
      if (!data.run) setError(true);
    } catch {
      setError(true);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const failedActionSteps = run
    ? run.steps.filter((s) => s.stepType === "ACTION" && s.status === "FAILED")
    : [];
  const hasUnsafeFailure = failedActionSteps.some((s) => safeToRetry.get(s.stepKey) !== true);
  const retryEligible =
    run !== null &&
    (run.status === "FAILED" || run.status === "PARTIAL") &&
    failedActionSteps.length > 0 &&
    !hasUnsafeFailure;

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/automation/runs/${runId}/retry`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Couldn't retry the run");
        return;
      }
      toast(data?.recovered ? "Run recovered — all steps succeeded" : "Retried — some steps still failing");
      await load();
      onRetried();
    } catch {
      toast("Couldn't retry the run");
    } finally {
      setRetrying(false);
    }
  }, [runId, toast, load, onRetried]);

  return (
    <>
      <div className="fixed inset-0 z-[110] bg-black/20" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-[120] flex w-full max-w-[520px] flex-col border-l border-zinc-200 bg-white shadow-2xl"
        role="dialog"
        aria-label="Run detail"
      >
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
          <span className="text-[13px] font-semibold text-zinc-900">Run detail</span>
          {run ? (
            <StatusPill
              color={RUN_STATUS_COLORS[run.status] ?? "#A1A1AA"}
              label={run.status.toLowerCase()}
            />
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {retryEligible ? (
              <button
                type="button"
                onClick={() => void retry()}
                disabled={retrying}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {retrying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Retry failed steps
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close run detail"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="text-[12.5px] text-zinc-500">Couldn&apos;t load this run.</p>
          ) : run === null ? (
            <div className="flex items-center gap-2 text-[12.5px] text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[12.5px]">
                <dt className="text-zinc-400">Workflow</dt>
                <dd className="truncate">
                  <Link
                    href={`/automation/workflows/${run.workflowId}`}
                    className="font-medium text-zinc-900 hover:text-[#0073EA]"
                  >
                    {run.workflow?.name ?? "Deleted workflow"}
                  </Link>
                </dd>
                <dt className="text-zinc-400">Trigger</dt>
                <dd className="truncate text-zinc-700">{run.triggerEventKey}</dd>
                <dt className="text-zinc-400">Record</dt>
                <dd className="truncate text-zinc-700">
                  {run.recordType ? `${run.recordType} · ${run.recordId ?? "?"}` : "—"}
                </dd>
                <dt className="text-zinc-400">Started</dt>
                <dd className="tabular-nums text-zinc-700">{relTime(run.createdAt)}</dd>
                <dt className="text-zinc-400">Duration</dt>
                <dd className="tabular-nums text-zinc-700">{fmtDuration(run.durationMs)}</dd>
                {run.errorMessage ? (
                  <>
                    <dt className="text-zinc-400">Error</dt>
                    <dd className="text-[#E2445C]">{run.errorMessage}</dd>
                  </>
                ) : null}
              </dl>

              {hasUnsafeFailure && (run.status === "FAILED" || run.status === "PARTIAL") ? (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-700">
                  This run can&apos;t be retried: a failed action isn&apos;t safe to re-run (it
                  could cause duplicate side effects).
                </p>
              ) : null}

              <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Steps
              </div>
              <div className="mt-1.5 space-y-2">
                {run.steps.length === 0 ? (
                  <p className="text-[12px] text-zinc-400">This run recorded no steps.</p>
                ) : (
                  run.steps.map((step) => (
                    <div key={step.id} className="rounded-lg border border-zinc-200 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-[16px] items-center rounded border border-zinc-200 bg-zinc-50 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-zinc-500">
                          {step.stepType}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-zinc-900">
                          {step.stepName ?? step.stepKey}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                          {fmtDuration(step.durationMs)}
                        </span>
                        <StatusPill
                          color={RUN_STATUS_COLORS[step.status] ?? "#A1A1AA"}
                          label={step.status.toLowerCase()}
                        />
                      </div>
                      {step.errorMessage ? (
                        <p className="mt-1.5 text-[11.5px] text-[#E2445C]">{step.errorMessage}</p>
                      ) : null}
                      <JsonBlock label="Input" value={step.inputJson} />
                      <JsonBlock label="Output" value={step.outputJson} />
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4">
                <JsonBlock label="Trigger payload" value={run.triggerPayload} />
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function AutomationLogsInner() {
  const searchParams = useSearchParams();
  const { toast } = useOsToast();

  const [runs, setRuns] = useState<ApiRunRow[] | null>(null);
  const [workflows, setWorkflows] = useState<ApiWorkflowOption[]>([]);
  const [safeToRetry, setSafeToRetry] = useState<Map<string, boolean>>(new Map());

  const [workflowFilter, setWorkflowFilter] = useState(
    () => searchParams.get("workflowId") ?? "",
  );
  const [statusFilter, setStatusFilter] = useState("");
  const [openRunId, setOpenRunId] = useState<string | null>(() => searchParams.get("runId"));

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ take: "100" });
      if (workflowFilter) params.set("workflowId", workflowFilter);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/automation/runs?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch {
      setRuns([]);
      toast("Couldn't load the execution log");
    }
  }, [workflowFilter, statusFilter, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Filter + retry-safety lookups (once).
  useEffect(() => {
    let alive = true;
    fetch("/api/automation/workflows?includeArchived=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.workflows)) {
          setWorkflows(d.workflows.map((w: { id: string; name: string }) => ({ id: w.id, name: w.name })));
        }
      })
      .catch(() => {});
    fetch("/api/automation/actions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.actions)) {
          setSafeToRetry(
            new Map(
              (d.actions as Array<{ key: string; safeToRetry: boolean }>).map((a) => [
                a.key,
                a.safeToRetry,
              ]),
            ),
          );
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex h-full flex-col bg-white">
      <AutomationHeader
        Icon={ScrollText}
        title="Logs"
        meta={runs !== null ? <span className="tabular-nums">{runs.length} runs</span> : undefined}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={workflowFilter}
              onChange={(e) => setWorkflowFilter(e.target.value)}
              aria-label="Filter by workflow"
              className={`${SELECT} max-w-[200px]`}
            >
              <option value="">All workflows</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
              className={SELECT}
            >
              <option value="">All statuses</option>
              {RUN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {runs === null ? (
          <div className="flex items-center gap-2 p-6 text-[13px] text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center pt-20">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-zinc-50">
              <ScrollText className="h-5 w-5 text-zinc-500" />
            </span>
            <h2 className="mt-4 text-[16px] font-semibold text-zinc-900">No runs logged</h2>
            <p className="mt-1 max-w-sm text-center text-[13px] text-zinc-500">
              {workflowFilter || statusFilter
                ? "Nothing matches these filters."
                : "Every automation run lands here with its steps, inputs, and outputs."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4 py-2">
            <div className="min-w-[920px]">
              <div
                className={`${GRID} h-7 border-b border-zinc-100 px-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400`}
              >
                <span>Status</span>
                <span>Workflow</span>
                <span>Trigger</span>
                <span>Record</span>
                <span>Started</span>
                <span>Duration</span>
                <span>Error</span>
              </div>
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setOpenRunId(run.id)}
                  className={`${GRID} h-7 w-full border-b border-zinc-100 px-2 text-left text-[12.5px] text-zinc-600 hover:bg-zinc-50`}
                >
                  <span>
                    <StatusPill
                      color={RUN_STATUS_COLORS[run.status] ?? "#A1A1AA"}
                      label={run.status.toLowerCase()}
                    />
                  </span>
                  <span className="truncate font-medium text-zinc-900">
                    {run.workflow?.name ?? "Deleted workflow"}
                  </span>
                  <span className="truncate text-zinc-500">{run.triggerEventKey}</span>
                  <span className="truncate text-zinc-500">
                    {run.recordType ? `${run.recordType} · ${(run.recordId ?? "").slice(0, 8)}` : "—"}
                  </span>
                  <span className="tabular-nums text-zinc-500">{relTime(run.createdAt)}</span>
                  <span className="tabular-nums text-zinc-500">{fmtDuration(run.durationMs)}</span>
                  <span className="truncate text-zinc-500" title={run.errorMessage ?? undefined}>
                    {run.errorMessage ?? ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {openRunId ? (
        <RunDrawer
          runId={openRunId}
          safeToRetry={safeToRetry}
          onClose={() => setOpenRunId(null)}
          onRetried={() => void load()}
        />
      ) : null}
    </div>
  );
}

export default function AutomationLogsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center gap-2 bg-white p-6 text-[13px] text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      }
    >
      <AutomationLogsInner />
    </Suspense>
  );
}
