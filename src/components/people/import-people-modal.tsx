"use client";

// Import people (spec-teams-people section 3): PeopleImport is the one flow
// (Upload, then Review, then the result), and ImportPeopleModal is the
// Directory's 960 ui/dialog wrapper around it, whose footer carries the one
// primary [Import {N} people]. Settings > Data > Import renders the same
// PeopleImport inline in Phase 8. Every row becomes an INVITATION (POST
// /api/people/bulk-import): a file never sets anyone's access, and nobody
// gets a shared password. Owner and Admin only.

import { useRef, useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { rowsFromCsv, type ImportRow } from "@/lib/people/people-csv";
import { ToneChip } from "./person-bits";

type RowOutcome = { row: number; email: string; status: "ready" | "error" | "member" | "invited"; message?: string };
type Summary = { total: number; ready: number; errors: number; members: number; invited: number; created?: number };

export interface PeopleImportState {
  rows: ImportRow[];
  staged: { summary: Summary; rows: RowOutcome[] } | null;
  result: Summary | null;
  busy: boolean;
  error: string | null;
}

const STATUS_CHIP: Record<RowOutcome["status"], { tone: "success" | "danger" | "neutral"; label: string }> = {
  ready: { tone: "success", label: "Ready" },
  error: { tone: "danger", label: "Error" },
  member: { tone: "neutral", label: "Already a member" },
  invited: { tone: "neutral", label: "Already invited" },
};

export function usePeopleImport() {
  const [state, setState] = useState<PeopleImportState>({ rows: [], staged: null, result: null, busy: false, error: null });
  async function stage(file: File) {
    setState((s) => ({ ...s, busy: true, error: null, staged: null, result: null }));
    const text = await file.text();
    const { rows, missing, ignoredColumns } = rowsFromCsv(text);
    if (missing.length) {
      setState((s) => ({ ...s, busy: false, error: `The file needs columns for ${missing.map((m) => (m === "firstName" ? "First name" : m === "lastName" ? "Last name" : "Email")).join(", ")}.` }));
      return;
    }
    if (rows.length === 0) { setState((s) => ({ ...s, busy: false, error: "The file has no rows under its header." })); return; }
    if (rows.length > 1000) { setState((s) => ({ ...s, busy: false, error: `Up to 1,000 people per file. This one has ${rows.length}.` })); return; }
    const r = await apiFetch<{ summary: Summary; rows: RowOutcome[] }>("/api/people/bulk-import", { method: "POST", json: { rows, dryRun: true } });
    if (!r.ok) { setState((s) => ({ ...s, busy: false, error: r.error || "Couldn't read the file" })); return; }
    setState({ rows, staged: r.data, result: null, busy: false, error: ignoredColumns.length ? `Ignored ${ignoredColumns.join(", ")}: a file never sets access. Everyone joins as a Member.` : null });
  }
  async function commit() {
    setState((s) => ({ ...s, busy: true, error: null }));
    const r = await apiFetch<{ summary: Summary }>("/api/people/bulk-import", { method: "POST", json: { rows: state.rows, dryRun: false } });
    if (!r.ok) { setState((s) => ({ ...s, busy: false, error: r.error || "The import failed. Nothing was sent." })); return false; }
    setState((s) => ({ ...s, busy: false, result: r.data.summary }));
    return true;
  }
  function reset() { setState({ rows: [], staged: null, result: null, busy: false, error: null }); }
  return { state, stage, commit, reset };
}

export function PeopleImport({ flow }: { flow: ReturnType<typeof usePeopleImport> }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const { state } = flow;
  if (state.result) {
    return (
      <div className="flex flex-col gap-2 py-2">
        <p className="text-row text-ink">Invited {state.result.created ?? state.result.ready} {(state.result.created ?? state.result.ready) === 1 ? "person" : "people"}. They join when they accept the email.</p>
        <p className="text-sm text-ink-2">{state.result.errors + state.result.members + state.result.invited} rows were skipped.</p>
        <Link href="/settings/data?tab=import" className="text-sm text-brand-deep hover:underline">See import history</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {!state.staged ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void flow.stage(f); }}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center ${drag ? "border-brand bg-brand-soft" : "border-line-strong bg-subtle"}`}
        >
          <Upload className="h-5 w-5 text-ink-2" aria-hidden />
          <p className="text-row text-ink">Drop a CSV here, or</p>
          <button type="button" onClick={() => input.current?.click()} disabled={state.busy} className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover">Choose file</button>
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void flow.stage(f); e.target.value = ""; }} />
          <p className="text-sm text-ink-2">
            Columns: First name, Last name, Email, and optionally Job title, Department, Office, Reports to (their email), Phone.{" "}
            <a href="/api/people/bulk-import" download className="text-brand-deep hover:underline">Download template</a>
          </p>
        </div>
      ) : (
        <>
          <p className="text-row text-ink">
            {state.staged.summary.ready} ready · {state.staged.summary.errors} with errors · {state.staged.summary.members + state.staged.summary.invited} already members or invited
          </p>
          <div className="max-h-[46vh] overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-[var(--os-table-head-bg)] text-ink-2">
                <tr className="h-9">
                  <th className="w-12 px-3 text-start font-medium">Row</th>
                  <th className="px-3 text-start font-medium">Name</th>
                  <th className="px-3 text-start font-medium">Email</th>
                  <th className="px-3 text-start font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {state.staged.rows.map((o) => {
                  const src = flow.state.rows[o.row - 1];
                  const chip = STATUS_CHIP[o.status];
                  return (
                    <tr key={o.row} className="h-11">
                      <td className="px-3 tabular-nums text-ink-2">{o.row}</td>
                      <td className="px-3 text-ink">{`${src?.firstName ?? ""} ${src?.lastName ?? ""}`.trim()}</td>
                      <td className="px-3 text-ink">{o.email}</td>
                      <td className="px-3"><span className="flex items-center gap-2"><ToneChip tone={chip.tone} label={chip.label} />{o.message && o.status !== "ready" ? <span className="text-ink-2">{o.message}</span> : null}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-ink-2">
            {state.staged.summary.ready} rows will be invited, {state.staged.summary.total - state.staged.summary.ready} skipped.{" "}
            <button type="button" className="text-brand-deep hover:underline" onClick={flow.reset}>Choose another file</button>
          </p>
        </>
      )}
      {state.error ? <p role="alert" className="text-sm text-danger-text">{state.error}</p> : null}
    </div>
  );
}

export function ImportPeopleModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const flow = usePeopleImport();
  const ready = flow.state.staged?.summary.ready ?? 0;
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !flow.state.busy) onClose(); }}>
      <DialogContent className="max-w-[960px]">
        <DialogHeader>
          <DialogTitle>Import people</DialogTitle>
          <DialogDescription>Each row gets an invitation email. Nobody joins until they accept, and everyone joins as a Member.</DialogDescription>
        </DialogHeader>
        <PeopleImport flow={flow} />
        <DialogFooter>
          {flow.state.result ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={flow.state.busy}>Cancel</Button>
              <Button disabled={ready === 0 || flow.state.busy} onClick={() => void flow.commit().then((ok) => { if (ok) onImported(); })}>
                {ready > 0 ? `Import ${ready} ${ready === 1 ? "person" : "people"}` : "Import"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
