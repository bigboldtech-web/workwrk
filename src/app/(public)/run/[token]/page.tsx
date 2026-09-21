"use client";

/* /run/[token] (spec-process section 2): run a checklist from a link, on any
 * device, with no sign-in. The token is the credential.
 *
 *   strip     the org logo + name, "Run" at the right (PublicPageFrame)
 *   header    run title 22/600, "From the SOP: {title}", the assignee and
 *             due date on one line, a 4px progress bar "5 of 9 steps · 56%"
 *   body      ChecklistRunner: every tick saves immediately with a 6px
 *             saving dot on the row; a failed save reads "Not saved,
 *             retrying" on the row and retries; typed values save on blur;
 *             file inputs upload through POST /api/upload with the run token
 *   bottom    when every step is done, a sticky bar "All steps done" with
 *             the one blue "Finish run"; after completion "Completed on
 *             {date}" and the steps stay visible read-only
 *
 * Unknown or expired token: the public 404 "This link is no longer available".
 * Cancelled run: "This run was cancelled."
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { PublicPageFrame } from "@/components/process/public-page-frame";
import { ChecklistRunner, type RowState } from "@/components/sops/checklist-runner";
import type { ReadChecklistSection, ReadChecklistStep } from "@/components/sops/sop-read-view";
import { SkeletonLines } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format/date";
import { allRequiredDone, runProgress } from "@/lib/sop-kind";

interface RunData {
  id: string;
  title: string;
  sopTitle: string;
  description: string;
  progress: number;
  status: string;
  dueDate: string | null;
  completedAt: string | null;
  assignee: string | null;
  sections: ReadChecklistSection[];
  completedSteps: string[];
  stepData: Record<string, { completedAt?: string; completedBy?: string; inputValues?: Record<string, unknown> | null }>;
  org: { name: string; logo: string | null } | null;
}

const RETRY_MS = [800, 1600, 3200];

export default function ProcessRunPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<RunData | null>(null);
  const [error, setError] = useState<"gone" | "cancelled" | "failed" | null>(null);
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [finishing, setFinishing] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/run/${token}`, { cache: "no-store" });
      if (res.status === 410) { setError("cancelled"); return; }
      if (res.status === 404) { setError("gone"); return; }
      if (!res.ok) { setError("failed"); return; }
      const json = await res.json();
      const d: RunData = json.data ?? json;
      setData(d);
      const existing: Record<string, Record<string, unknown>> = {};
      for (const [stepId, sd] of Object.entries(d.stepData ?? {})) if (sd?.inputValues) existing[stepId] = sd.inputValues;
      setValues(existing);
      setError(null);
    } catch {
      setError("failed");
    }
  }, [token]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const patch = useCallback(async (body: Record<string, unknown>): Promise<RunData | null> => {
    const res = await fetch(`/api/public/run/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 410) { setError("cancelled"); return null; }
    // 409 = the run is already complete (or not every step is ticked): the
    // answer is the server's state, so reload it rather than retry a write
    // that will never be accepted.
    if (res.status === 409) { await load(); return null; }
    if (!res.ok) throw new Error(`PATCH ${res.status}`);
    const json = await res.json();
    const r = json.data ?? json;
    setData((prev) => (prev ? { ...prev, progress: r.progress ?? prev.progress, completedSteps: r.completedSteps ?? prev.completedSteps, status: r.status ?? prev.status, completedAt: r.completedAt ?? prev.completedAt, stepData: r.stepData ?? prev.stepData } : prev));
    return r;
  }, [token, load]);

  /** A row-level save with retries and the saving dot; never silent. */
  const saveRow = useCallback(async (stepId: string, body: Record<string, unknown>) => {
    setRowState((s) => ({ ...s, [stepId]: "saving" }));
    for (let attempt = 0; ; attempt++) {
      try {
        await patch(body);
        setRowState((s) => ({ ...s, [stepId]: "idle" }));
        return true;
      } catch {
        if (attempt >= RETRY_MS.length) { setRowState((s) => ({ ...s, [stepId]: "failed" })); return false; }
        setRowState((s) => ({ ...s, [stepId]: "retrying" }));
        await new Promise((r) => setTimeout(r, RETRY_MS[attempt]));
      }
    }
  }, [patch]);

  const onToggle = (step: ReadChecklistStep, next: boolean) => {
    void saveRow(step.id, { action: next ? "complete_step" : "uncomplete_step", stepId: step.id, inputValues: valuesRef.current[step.id] ?? null });
  };
  const inputTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const onInput = (stepId: string, inputId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [stepId]: { ...(prev[stepId] ?? {}), [inputId]: value } }));
    if (inputTimers.current[stepId]) clearTimeout(inputTimers.current[stepId]);
    inputTimers.current[stepId] = setTimeout(() => {
      void saveRow(stepId, { action: "input", stepId, inputValues: { ...(valuesRef.current[stepId] ?? {}), [inputId]: value } });
    }, 600);
  };
  const onUpload = async (stepId: string, _inputId: string, file: File): Promise<string | null> => {
    void _inputId;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("runToken", token);
    setRowState((s) => ({ ...s, [stepId]: "saving" }));
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      const j = await res.json();
      setRowState((s) => ({ ...s, [stepId]: "idle" }));
      return typeof j.url === "string" ? j.url : null;
    } catch {
      setRowState((s) => ({ ...s, [stepId]: "failed" }));
      return null;
    }
  };
  const finish = async () => {
    setFinishing(true);
    setFinishFailed(false);
    try { await patch({ action: "complete" }); } catch { setFinishFailed(true); }
    setFinishing(false);
  };

  if (error === "gone" || error === "cancelled") {
    return (
      <PublicPageFrame org={null} label="Run" footer={<>WorkwrK</>}>
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-row text-ink">{error === "cancelled" ? "This run was cancelled." : "This link is no longer available"}</p>
          <p className="text-sm text-ink-2">{error === "cancelled" ? "Ask the person who started it if a new one is needed." : "It may have expired or been turned off."}</p>
        </div>
      </PublicPageFrame>
    );
  }
  if (error === "failed") {
    return (
      <PublicPageFrame org={null} label="Run">
        <div className="flex flex-col items-center gap-2 py-16 text-center" role="alert">
          <p className="text-row text-ink">Couldn&apos;t load this run</p>
          <button type="button" onClick={() => void load()} className="text-base font-medium text-brand-deep hover:underline">Retry</button>
        </div>
      </PublicPageFrame>
    );
  }
  if (!data) {
    return (
      <PublicPageFrame org={null} label="Run">
        <div className="pt-2"><span className="block h-6 w-2/3 rounded bg-skeleton os-skeleton-pulse" /><div className="mt-6"><SkeletonLines lines={6} /></div></div>
      </PublicPageFrame>
    );
  }

  const isComplete = data.status === "COMPLETED";
  const progress = runProgress(data.sections, data.completedSteps);
  const allDone = allRequiredDone(data.sections, data.completedSteps);
  const total = progress.total;

  return (
    <PublicPageFrame org={data.org} label="Run">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-ink">{data.title}</h1>
        <p className="text-sm text-ink-2">From the SOP: {data.sopTitle}</p>
        <p className="text-sm text-ink-2">
          {data.assignee ? `Assigned to ${data.assignee}` : "Anyone with the link"}
          {data.dueDate ? ` · Due ${formatDate(data.dueDate, null, "date")}` : ""}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-active"><span className="block h-full bg-brand" style={{ width: `${progress.pct}%` }} /></span>
          <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{progress.done} of {total} steps · {progress.pct}%</span>
        </div>
        {isComplete ? (
          <p className="inline-flex items-center gap-2 text-sm text-ink"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-success-solid" />Completed{data.completedAt ? ` on ${formatDate(data.completedAt, null, "datetime")}` : ""}</p>
        ) : null}
      </div>

      <div className="mt-6">
        {total === 0 ? (
          <p className="py-8 text-center text-row text-ink-2">This checklist has no steps yet.</p>
        ) : (
          <ChecklistRunner
            sections={data.sections}
            completedSteps={data.completedSteps}
            values={values}
            rowState={rowState}
            readOnly={isComplete}
            onToggle={onToggle}
            onInput={onInput}
            onUpload={onUpload}
            approvedLine={(stepId) => { const sd = data.stepData?.[stepId]; return sd?.completedAt ? `Approved on ${formatDate(sd.completedAt, null, "datetime")}` : null; }}
          />
        )}
      </div>

      {!isComplete && allDone ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised">
          <div className="mx-auto flex h-16 w-full max-w-[720px] items-center gap-3 px-4 sm:px-6">
            <span className="min-w-0 flex-1 truncate text-row font-medium text-ink">{finishFailed ? "Not saved · try again" : "All steps done"}</span>
            <button type="button" onClick={() => void finish()} disabled={finishing} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">Finish run</button>
          </div>
        </div>
      ) : null}
    </PublicPageFrame>
  );
}
