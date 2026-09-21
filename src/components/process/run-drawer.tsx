"use client";

// RunDrawer (spec-process section 3 and section 2 `/process-runs`): the 520
// drawer (resizable 480 to 720, remembered) whose URL is
// /process-runs?run=<id>. Header = the breadcrumb "Run history › {title}",
// a copy-link ghost and ✕. NO expand ⤢: a run has no full page yet, and a
// button that does nothing is the fabricated chrome this refresh removes
// (the named exception in the spec). Body: the SOP name (link), assignee,
// due, status, a 4px progress bar, then the sections and steps in read mode
// with done steps ticked and typed values under each, and the one primary
// "Open run". Polls every 15s while open; "Not up to date" when a poll fails.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Link2, X } from "lucide-react";
import { Drawer, DRAWER_DEFAULT_W, clampDrawerWidth } from "@/components/ui/drawer";
import { StatusChip } from "@/components/ui/chip";
import { SkeletonLines } from "@/components/ui/skeleton";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useOsShell } from "@/components/layout/os/shell-context";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { ChecklistRunner } from "@/components/sops/checklist-runner";
import type { ReadChecklistSection } from "@/components/sops/sop-read-view";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL, type RunStatus } from "@/lib/process-runs";

export interface RunPayload {
  id: string;
  title: string;
  status: RunStatus;
  progress: number;
  steps: { done: number; total: number };
  dueDate: string | null;
  startedAt: string;
  completedAt: string | null;
  shareToken: string | null;
  assignee: PersonRef | null;
  sop: { id: string; title: string };
  sections: ReadChecklistSection[];
  completedSteps: string[];
  stepData: Record<string, { completedAt?: string; completedBy?: string; inputValues?: Record<string, unknown> | null }>;
  canManage: boolean;
  canDelete: boolean;
}

const POLL_MS = 15_000;

export function RunDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { toast } = useOsToast();
  const { prefs, patchPrefs } = useOsShell();
  const fmt = useFormat();
  const [run, setRun] = useState<RunPayload | null>(null);
  const [error, setError] = useState<"notfound" | "failed" | null>(null);
  const [stale, setStale] = useState(false);
  const runIdRef = useRef(runId);
  useEffect(() => { runIdRef.current = runId; }, [runId]);

  const load = useCallback(async (silent = false) => {
    const r = await apiFetch<RunPayload>(`/api/process-runs/${runId}`, { cache: "no-store" });
    if (runIdRef.current !== runId) return;
    if (!r.ok) {
      if (silent) { setStale(true); return; }
      setError(r.status === 404 ? "notfound" : "failed");
      return;
    }
    setError(null);
    setStale(false);
    setRun(r.data);
  }, [runId]);

  useEffect(() => {
    const t = setTimeout(() => { setRun(null); setError(null); void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // The poll: a run is executed on the public page by someone else.
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) void load(true); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const width = clampDrawerWidth(typeof prefs.home.work?.drawerWidth === "number" ? prefs.home.work.drawerWidth : DRAWER_DEFAULT_W);

  const copyLink = () => {
    const url = `${window.location.origin}/process-runs?run=${runId}`;
    void navigator.clipboard.writeText(url).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
  };

  const values: Record<string, Record<string, unknown>> = {};
  if (run) for (const [sid, sd] of Object.entries(run.stepData ?? {})) if (sd?.inputValues) values[sid] = sd.inputValues;

  return (
    <Drawer
      open
      onClose={onClose}
      layerId="run-drawer"
      ariaLabel="Run"
      width={width}
      onWidthChange={(px) => void patchPrefs({ home: { work: { drawerWidth: px } } })}
      header={
        <div className="flex h-12 items-center gap-2 px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
            <Link href="/process-runs" className="hover:text-ink">Run history</Link>
            <span className="mx-1">›</span>
            <span className="text-ink">{run?.title ?? "Run"}</span>
          </span>
          {stale ? <span className="shrink-0 text-xs text-warning-text">Not up to date</span> : null}
          <button type="button" onClick={copyLink} aria-label="Copy link" title="Copy link" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      }
      footer={run && run.shareToken && run.status !== "CANCELLED" ? (
        <div className="flex h-14 items-center justify-end gap-2 border-t border-line bg-raised px-4">
          <a href={`/run/${run.shareToken}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover">
            <ExternalLink className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            {run.status === "COMPLETED" ? "Open run" : "Open run"}
          </a>
        </div>
      ) : undefined}
    >
      {error === "notfound" ? (
        <OsEmptyView compact title="This run is not here anymore" hint="It may have been deleted, or it is not in your scope." />
      ) : error === "failed" ? (
        <OsEmptyView compact variant="error" title="Couldn't load this run" action={{ label: "Retry", onClick: () => void load() }} />
      ) : !run ? (
        <div className="p-4"><SkeletonLines lines={6} /></div>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip color={RUN_STATUS_COLOR[run.status]} label={RUN_STATUS_LABEL[run.status]} disabled />
              <Link href={`/sops/${run.sop.id}`} className="text-sm text-ink-2 hover:text-ink hover:underline">From the SOP: {run.sop.title}</Link>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                {run.assignee ? <><PersonAvatar person={run.assignee} size={20} />{`${run.assignee.firstName ?? ""} ${run.assignee.lastName ?? ""}`.trim() || run.assignee.email}</> : "Anyone with the link"}
              </span>
              {run.dueDate ? <span>Due <span title={fmt.title(run.dueDate)}>{fmt.date(run.dueDate, "date")}</span></span> : null}
              <span>Started <span title={fmt.title(run.startedAt)}>{fmt.date(run.startedAt)}</span></span>
              {run.completedAt ? <span>Completed <span title={fmt.title(run.completedAt)}>{fmt.date(run.completedAt)}</span></span> : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-active"><span className="block h-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, run.progress))}%` }} /></span>
              <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{run.steps.done} of {run.steps.total} steps · {run.progress}%</span>
            </div>
          </div>
          <ChecklistRunner
            sections={run.sections}
            completedSteps={run.completedSteps}
            values={values}
            readOnly
            approvedLine={(stepId) => {
              const sd = run.stepData?.[stepId];
              return sd?.completedAt ? `Approved on ${fmt.date(sd.completedAt, "datetime")}` : null;
            }}
          />
        </div>
      )}
    </Drawer>
  );
}
