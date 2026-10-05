"use client";

// PeopleImport (spec-teams-people section 3, T7): the ONE import-people
// flow, in four steps shown as quad-steps dots:
//
//   1 Upload    Choose file or drop a CSV; Download template.
//   2 Map       each column of the file against a field, auto-mapped by its
//               header; an access-level or password column is shown as
//               ignored and can never be mapped (a file never sets access).
//   3 Review    the dry run's staging report: "12 ready · 3 with errors ·
//               2 already members or invited", a per-row status, and the line
//               "{N} rows will be invited, {N} skipped".
//   4 Import    the result: who was invited, how many were skipped.
//
// It renders NO primary button: its host (ImportPeopleModal, or Settings >
// Data > Import in Phase 8) owns the one blue button and reads `flow.step`
// to label it. Every row becomes an Invitation (POST /api/people/bulk-import):
// nobody gets a shared password, and everyone joins as a Member.

import { useRef, useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { Picker } from "@/components/ui/picker";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { apiFetch } from "@/lib/api-fetch";
import {
  IMPORT_FIELDS, IMPORT_FIELD_LABEL, isIgnoredHeader, mapHeaders, parseCsv, rowsFromTable,
  type ImportField, type ImportRow,
} from "@/lib/people/people-csv";
import { ToneChip } from "./person-bits";

export type ImportStep = "upload" | "map" | "review" | "done";
const STEP_INDEX: Record<ImportStep, number> = { upload: 0, map: 1, review: 2, done: 4 };
const STEP_WORD: Record<ImportStep, string> = { upload: "Upload", map: "Map columns", review: "Review", done: "Import" };

type RowOutcome = { row: number; email: string; status: "ready" | "error" | "member" | "invited"; message?: string };
type Summary = {
  total: number;
  ready: number;
  errors: number;
  members: number;
  invited: number;
  created?: number;
  /** Seats free before this import (people and open invitations count). */
  seatsFree?: number;
  /** Set when the ready rows do not fit: the plan sentence. Nothing can be imported. */
  seatProblem?: string;
};

/** Whether the staged rows can be imported: some are ready, and they fit in the seats. */
export function importable(summary: Summary | null | undefined): number {
  if (!summary || summary.seatProblem) return 0;
  return summary.ready;
}

export interface PeopleImportState {
  step: ImportStep;
  fileName: string | null;
  table: string[][];
  mapping: Array<ImportField | null>;
  rows: ImportRow[];
  staged: { summary: Summary; rows: RowOutcome[] } | null;
  result: Summary | null;
  busy: boolean;
  error: string | null;
}

const EMPTY: PeopleImportState = { step: "upload", fileName: null, table: [], mapping: [], rows: [], staged: null, result: null, busy: false, error: null };

const STATUS_CHIP: Record<RowOutcome["status"], { tone: "success" | "danger" | "neutral"; label: string }> = {
  ready: { tone: "success", label: "Ready" },
  error: { tone: "danger", label: "Error" },
  member: { tone: "neutral", label: "Already a member" },
  invited: { tone: "neutral", label: "Already invited" },
};

export function usePeopleImport() {
  const [state, setState] = useState<PeopleImportState>(EMPTY);

  async function readFile(file: File) {
    setState({ ...EMPTY, busy: true, fileName: file.name });
    const text = await file.text();
    const table = parseCsv(text);
    if (table.length < 2) { setState({ ...EMPTY, fileName: file.name, error: table.length ? "The file has no rows under its header." : "The file is empty." }); return; }
    if (table.length - 1 > 1000) { setState({ ...EMPTY, fileName: file.name, error: `Up to 1,000 people per file. This one has ${table.length - 1}.` }); return; }
    setState({ ...EMPTY, step: "map", fileName: file.name, table, mapping: mapHeaders(table[0]).mapping });
  }

  function setMapping(index: number, field: ImportField | null) {
    setState((s) => {
      const mapping = [...s.mapping];
      // One column per field: choosing a field elsewhere frees it here.
      if (field) for (let i = 0; i < mapping.length; i += 1) if (mapping[i] === field) mapping[i] = null;
      mapping[index] = field;
      return { ...s, mapping, error: null };
    });
  }

  const missing = state.table.length ? rowsFromTable(state.table, state.mapping).missing : [];

  /** Map → Review: build the rows and run the dry run. */
  async function stage() {
    const { rows, missing: miss } = rowsFromTable(state.table, state.mapping);
    if (miss.length) { setState((s) => ({ ...s, error: `Map a column to ${miss.map((m) => IMPORT_FIELD_LABEL[m]).join(", ")} first.` })); return; }
    setState((s) => ({ ...s, busy: true, error: null }));
    const r = await apiFetch<{ summary: Summary; rows: RowOutcome[] }>("/api/people/bulk-import", { method: "POST", json: { rows, dryRun: true } });
    if (!r.ok) { setState((s) => ({ ...s, busy: false, error: r.error || "Couldn't check the file" })); return; }
    setState((s) => ({ ...s, busy: false, step: "review", rows, staged: r.data }));
  }

  /** Review → Import. Nothing is sent when the request fails. */
  async function commit() {
    setState((s) => ({ ...s, busy: true, error: null }));
    const r = await apiFetch<{ summary: Summary }>("/api/people/bulk-import", { method: "POST", json: { rows: state.rows, dryRun: false } });
    if (!r.ok) { setState((s) => ({ ...s, busy: false, error: r.error || "The import failed. Nobody was invited." })); return false; }
    setState((s) => ({ ...s, busy: false, step: "done", result: r.data.summary }));
    return true;
  }

  function back() {
    setState((s) => (s.step === "review" ? { ...s, step: "map", staged: null, error: null } : s.step === "map" ? EMPTY : s));
  }
  function reset() { setState(EMPTY); }

  return { state, readFile, setMapping, missing, stage, commit, back, reset };
}

export type PeopleImportFlow = ReturnType<typeof usePeopleImport>;

export function PeopleImport({ flow, container = "modal" }: { flow: PeopleImportFlow; container?: "modal" | "page" }) {
  const { state } = flow;
  return (
    <div className={`flex flex-col gap-4 ${container === "page" ? "max-w-[960px]" : ""}`}>
      <div className="flex items-center gap-3">
        <Dots variant="quad-steps" done={STEP_INDEX[state.step]} total={4} label={`Step ${Math.min(4, STEP_INDEX[state.step] + 1)} of 4`} />
        <span className="text-sm font-medium text-ink">{STEP_WORD[state.step]}</span>
        {state.fileName && state.step !== "upload" ? <span className="truncate text-sm text-ink-2">{state.fileName}</span> : null}
      </div>
      {state.step === "upload" ? <UploadStep flow={flow} /> : null}
      {state.step === "map" ? <MapStep flow={flow} /> : null}
      {state.step === "review" && state.staged ? <ReviewStep flow={flow} container={container} /> : null}
      {state.step === "done" && state.result ? (
        <div className="flex flex-col gap-2 py-2">
          <p className="text-row text-ink">
            Invited {state.result.created ?? state.result.ready} {(state.result.created ?? state.result.ready) === 1 ? "person" : "people"}. They join when they accept the email.
          </p>
          <p className="text-sm text-ink-2">{state.result.errors + state.result.members + state.result.invited} rows were skipped.</p>
          {/* The people invited wait under Members until they accept (an
              import history page arrives with Settings > Data, Phase 8). */}
          <Link href="/settings/members#pending-invites" className="text-sm text-brand-deep hover:underline">See pending invitations</Link>
        </div>
      ) : null}
      {state.error ? <p role="alert" className="text-sm text-danger-text">{state.error}</p> : null}
    </div>
  );
}

function UploadStep({ flow }: { flow: PeopleImportFlow }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void flow.readFile(f); }}
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center ${drag ? "border-brand bg-brand-soft" : "border-line-strong bg-subtle"}`}
    >
      <Upload className="h-5 w-5 text-ink-2" aria-hidden />
      <p className="text-row text-ink">Drop a CSV here, or</p>
      <button type="button" onClick={() => input.current?.click()} disabled={flow.state.busy} className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover">Choose file</button>
      <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void flow.readFile(f); e.target.value = ""; }} />
      <p className="text-sm text-ink-2">
        Columns: First name, Last name, Email, and optionally Job title, Department, Office, Reports to (their email), Phone.{" "}
        <a href="/api/people/bulk-import" download className="text-brand-deep hover:underline">Download template</a>
      </p>
    </div>
  );
}

function MapStep({ flow }: { flow: PeopleImportFlow }) {
  const { state } = flow;
  const [open, setOpen] = useState<number | null>(null);
  const headers = state.table[0] ?? [];
  const sample = state.table[1] ?? [];
  return (
    <>
      <p className="text-sm text-ink-2">
        {`${state.table.length - 1} ${state.table.length - 1 === 1 ? "row" : "rows"}. `}Check which field each column fills. Job title, department and office are matched by name; Reports to by the manager&apos;s email.
      </p>
      <div className="max-h-[46vh] overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--os-table-head-bg)] text-ink-2">
            <tr className="h-9">
              <th className="px-3 text-start font-medium">Column in your file</th>
              <th className="px-3 text-start font-medium">First row</th>
              <th className="w-[220px] px-3 text-start font-medium">Imports as</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {headers.map((h, i) => {
              const ignored = isIgnoredHeader(h);
              const f = state.mapping[i] ?? null;
              return (
                <tr key={i} className="h-11">
                  <td className="px-3 font-medium text-ink">{h || `Column ${i + 1}`}</td>
                  <td className="max-w-[220px] truncate px-3 text-ink-2">{sample[i] ?? ""}</td>
                  <td className="relative px-3">
                    {ignored ? (
                      <span className="text-ink-2">Ignored: a file never sets access</span>
                    ) : (
                      <>
                        <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-haspopup="listbox" aria-expanded={open === i}
                          className="inline-flex h-8 w-full items-center rounded-md border border-line bg-raised px-2.5 text-start text-sm text-ink hover:bg-hover">
                          {f ? IMPORT_FIELD_LABEL[f] : <span className="text-ink-3">Don&apos;t import</span>}
                        </button>
                        <Picker
                          open={open === i}
                          onClose={() => setOpen(null)}
                          ariaLabel={`Import ${h || `column ${i + 1}`} as`}
                          selected={f ?? "__skip__"}
                          sections={[{ options: [{ value: "__skip__", label: "Don't import" }, ...IMPORT_FIELDS.map((x) => ({ value: x, label: IMPORT_FIELD_LABEL[x] }))] }]}
                          onSelect={(v) => { setOpen(null); flow.setMapping(i, v === "__skip__" ? null : (v as ImportField)); }}
                          className="absolute end-3 top-10 z-50"
                        />
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {flow.missing.length ? (
        <p className="text-sm text-ink-2">Still needed: {flow.missing.map((m) => IMPORT_FIELD_LABEL[m]).join(", ")}.</p>
      ) : null}
      <p className="text-sm text-ink-2"><button type="button" className="text-brand-deep hover:underline" onClick={flow.reset}>Choose another file</button></p>
    </>
  );
}

type StagedRow = RowOutcome;

function ReviewStep({ flow, container }: { flow: PeopleImportFlow; container: "modal" | "page" }) {
  const staged = flow.state.staged!;
  const s = staged.summary;
  const columns: TableColumn<StagedRow>[] = [
    { key: "row", label: "Row", width: "64px", numeric: true, render: (o) => <span className="text-ink-2">{o.row}</span> },
    {
      key: "name",
      label: "Name",
      width: "minmax(160px,1fr)",
      title: true,
      render: (o) => { const src = flow.state.rows[o.row - 1]; return `${src?.firstName ?? ""} ${src?.lastName ?? ""}`.trim(); },
    },
    { key: "email", label: "Email", width: "minmax(200px,1.2fr)", render: (o) => o.email },
    {
      key: "status",
      label: "Status",
      width: "minmax(200px,1.2fr)",
      render: (o) => {
        const chip = STATUS_CHIP[o.status];
        return (
          <span className="flex min-w-0 items-center gap-2">
            <ToneChip tone={chip.tone} label={chip.label} />
            {o.message && o.status !== "ready" && o.message !== chip.label ? <span className="truncate text-ink-2" title={o.message}>{o.message}</span> : null}
          </span>
        );
      },
    },
  ];
  return (
    <>
      <p className="text-row text-ink">{s.ready} ready · {s.errors} with errors · {s.members + s.invited} already members or invited</p>
      {s.seatProblem ? <p role="alert" className="text-row text-danger-text">{s.seatProblem}</p> : null}
      <div className="max-h-[46vh] overflow-y-auto">
        <TableCard
          columns={columns}
          rows={staged.rows}
          rowKey={(o) => String(o.row)}
          ariaLabel="Rows to import"
          footer={{
            total: s.total,
            noun: "rows",
            from: s.total ? 1 : 0,
            to: staged.rows.length,
            extra: s.seatProblem
              ? <span>· nothing can be imported until there are seats for the {s.ready} ready {s.ready === 1 ? "row" : "rows"}</span>
              : <span>· {s.ready} {s.ready === 1 ? "row" : "rows"} will be invited, {s.total - s.ready} skipped</span>,
          }}
        />
      </div>
      {/* The dialog's footer carries Back; the inline page (Settings > Data,
          Phase 8) has no footer, so it keeps its own way back. */}
      {container === "page" ? (
        <p className="text-sm text-ink-2"><button type="button" className="text-brand-deep hover:underline" onClick={flow.back}>Back to the columns</button></p>
      ) : null}
    </>
  );
}
