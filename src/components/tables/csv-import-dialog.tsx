"use client";

// CsvImportDialog (spec-tables-forms section 3): bringing a CSV into a table,
// in place, for any Member. 960 wide, 90vh max (design 4.5). Opened by the
// /tables "New table" split ("From a CSV..."), the /tables "..." row, the hub
// "+" "Import a CSV..." row (event `workwrk:os:new:tables-import-csv`), the
// `?import=1` latch on /tables, and the sheet's File > Import a CSV.
//
//   1. Choose a file (drop it on the zone, or pick it).
//   2. The preview: the first 20 rows, a "First row is a header" switch, and
//      one row per CSV column naming where it goes: a new column (name and
//      type) or, when appending, an existing column, or Skip.
//   3. Create a new table, or Append to this table (only when opened on a
//      table), with one summary line before the write.
//
// The write is POST /api/tables (explicit columns, no seeded rows) and then
// POST /api/tables/[id]/import with the plan, so what the preview shows is
// exactly what is written. Appending fills the table's blank tail first (a
// new table's 1,000 seeded rows), then appends.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FileUp, Type, Upload } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { COLUMN_TYPE_ICON } from "@/components/tables/column-type-picker";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Dots } from "@/components/ui/dots";
import { useOsToast } from "@/components/layout/os/toast";
import { notifyTablesChanged } from "@/components/layout/os/sidebar-refresh";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import {
  CSV_IMPORT_MAX_ROWS, CSV_IMPORT_TYPES, CSV_PREVIEW_ROWS, defaultPlan, planSummary, planToBody, readCsv,
  tableNameFromFile, type CsvColumnPlan, type TargetColumn,
} from "@/lib/csv-import";
import { columnLetter } from "@/lib/sheet-engine-host";
// The toast's "Open table" is resolved when it is clicked, in the section
// the person is in then (src/lib/nav/object-href.ts).
import { objectHrefNow } from "@/components/layout/os/use-object-href";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** The import body: one entry per CSV column, in order (planToBody's shape). */
type ImportColumns = ReturnType<typeof planToBody>;

/**
 * Where a header picker opens, given the room inside the dialog body's
 * VISIBLE area (all in px, measured from the body's visible top edge).
 * Below the trigger when it fits, above it when only that fits, and "grow"
 * when neither does: the body is then given a floor tall enough to hold it.
 * A short CSV makes a short body, and a popover cut off by the body's own
 * scroll box hid the rest of the list with nothing saying it went on.
 */
export function popoverPlacement(p: { popHeight: number; anchorTop: number; anchorBottom: number; visibleHeight: number }): "bottom" | "top" | "grow" {
  if (p.anchorBottom + p.popHeight <= p.visibleHeight) return "bottom";
  if (p.anchorTop - p.popHeight >= 0) return "top";
  return "grow";
}

/**
 * How tall a header picker gets, from the Picker's anatomy: 36px rows, 26px
 * section labels, the list capped at 280, a 40px search row once there are 6
 * or more rows, and 4px padding plus a 1px line on each side. An estimate on
 * purpose, as the Picker's own pinned mode does: measuring after mount costs
 * a frame the person sees.
 */
export function pickerHeight(options: number, sectionLabels: number): number {
  return Math.min(280, options * 36 + sectionLabels * 26) + (options >= 6 ? 40 : 0) + 10;
}

/**
 * The footer's one line before the write. `madeName` is the table an earlier
 * attempt of this same import already created (its rows failed): the retry
 * writes into that table, so the line must not promise a new one.
 */
export function importSummaryLine(p: {
  mode: "append" | "create";
  rows: number;
  newColumns: number;
  skipped: number;
  tableName?: string | null;
  newName: string;
  madeName?: string | null;
}): string {
  const rowsText = `${p.rows.toLocaleString()} row${p.rows === 1 ? "" : "s"}`;
  // "1 row goes", "2 rows go". The create line's subject is compound ("rows
  // and columns"), so it keeps "go" at any count.
  const verb = p.rows === 1 ? "goes" : "go";
  if (p.mode === "create" && p.madeName) return `${rowsText} ${verb} into ${p.madeName}, the table this import already created.`;
  if (p.mode === "create") return `${rowsText} and ${p.newColumns} column${p.newColumns === 1 ? "" : "s"} go into a new table named ${p.newName.trim() || "Imported table"}.`;
  return `${rowsText} ${verb} into ${p.tableName || "this table"}${p.newColumns ? `, with ${p.newColumns} new column${p.newColumns === 1 ? "" : "s"}` : ""}${p.skipped ? `, ${p.skipped} skipped` : ""}.`;
}

export function CsvImportDialog({
  open, onClose, table, spaceId, onDone,
}: {
  open: boolean;
  onClose: () => void;
  /** Opened on a table: offers "Append to this table" (the default). */
  table?: { id: string; name: string; columns: TargetColumn[] } | null;
  /** A new table lands in this Space (the Space page's own import). */
  spaceId?: string | null;
  /** After a write: the table written to, and whether it is new. */
  onDone?: (result: { tableId: string; created: boolean; rows: number }) => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mode, setMode] = useState<"append" | "create">(table ? "append" : "create");
  const [newName, setNewName] = useState("");
  const [plan, setPlan] = useState<CsvColumnPlan[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The one open header picker ("where it goes" or a new column's type). It
  // renders as an absolute child of the dialog body at the trigger's spot,
  // outside the preview's scroll box (which would clip it) and never in a
  // portal (Radix keeps focus inside the dialog; memory rule for pickers in a
  // centred dialog).
  // `top` and `bottom` are the trigger's edges in the body's content
  // coordinates; the popover hangs below `bottom` or sits above `top`.
  const [pick, setPick] = useState<{ kind: "where" | "type"; col: number; left: number; top: number; bottom: number; side: "bottom" | "top" } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const chooseAnotherRef = useRef<HTMLButtonElement>(null);
  const openPick = (kind: "where" | "type", col: number, el: HTMLElement) => {
    const host = bodyRef.current;
    if (!host) return;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    // Keep the popover inside the body's width: past the right edge it would
    // widen the scroll box and the search field's focus would slide the
    // whole preview sideways.
    const width = kind === "where" ? 240 : 220;
    const left = Math.max(8, Math.min(r.left - h.left, host.clientWidth - width - 8));
    // The whole list must show inside the body's scroll box: a short CSV
    // makes a short body, and the list was cut off after "New column" with
    // nothing saying it went on. Below the trigger when it fits, above when
    // only that fits; otherwise the body gets a floor tall enough for it,
    // capped so the dialog stays inside its 90vh (past the cap the effect
    // below scrolls the list into view). The floor stays until the file
    // changes, so the dialog does not jump each time a picker opens.
    const options = kind === "where" ? 2 + (target?.length ?? 0) : CSV_IMPORT_TYPES.length;
    const popHeight = pickerHeight(options, kind === "where" && target?.length ? 1 : 0) + 8;
    const top = r.top - h.top;
    const bottom = r.bottom - h.top;
    const place = popoverPlacement({ popHeight, anchorTop: top, anchorBottom: bottom, visibleHeight: host.clientHeight });
    if (place === "grow") {
      const chrome = host.parentElement ? host.parentElement.offsetHeight - host.offsetHeight : 0;
      const cap = Math.floor(window.innerHeight * 0.9) - chrome;
      host.style.minHeight = `${Math.max(host.offsetHeight, Math.min(bottom + host.scrollTop + popHeight + 8, cap))}px`;
    }
    setPick({ kind, col, left: left + host.scrollLeft, top: top + host.scrollTop, bottom: bottom + host.scrollTop, side: place === "top" ? "top" : "bottom" });
  };
  useEffect(() => {
    if (!pick) return;
    popRef.current?.querySelector<HTMLElement>(":scope > [role=presentation]")?.scrollIntoView({ block: "nearest" });
  }, [pick]);

  const parsed = useMemo(() => (text === null ? null : readCsv(text, hasHeader)), [text, hasHeader]);
  const target = mode === "append" && table ? table.columns : null;
  const whereLabel = (p: CsvColumnPlan | undefined): string => {
    if (p?.kind === "skip") return "Skip this column";
    if (p?.kind === "existing") {
      const ci = target ? target.findIndex((c) => c.id === p.target) : -1;
      if (ci >= 0 && target) return `Into ${target[ci].label.trim() || columnLetter(ci)}`;
    }
    return "New column";
  };

  // The plan is re-derived whenever the file, the header switch or the mode
  // changes; a person's edits to it live until then.
  const [planKey, setPlanKey] = useState("");
  const key = `${fileName}|${hasHeader}|${mode}`;
  if (parsed && planKey !== key) {
    setPlanKey(key);
    setPlan(defaultPlan(parsed, target));
  }

  // The table an earlier Import of this file created before its rows failed.
  // A retry writes into it (with the column ids it was made with) rather than
  // making a second table and leaving the first empty. While it is set, the
  // plan that made it is locked: a changed plan would not match its columns.
  const [made, setMade] = useState<{ id: string; name: string; body: ImportColumns } | null>(null);
  const locked = !!made && mode === "create";

  function reset() {
    setMade(null); setPick(null);
    if (bodyRef.current) bodyRef.current.style.minHeight = "";
    setFileName(null); setText(null); setPlan(null); setPlanKey(""); setError(null); setBusy(false);
    setMode(table ? "append" : "create"); setHasHeader(true); setNewName("");
  }
  function close() { if (busy) return; reset(); onClose(); }

  async function takeFile(f: File | null | undefined) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { setError("That file is over 10 MB. Split it and import the parts."); return; }
    const t = await f.text().catch(() => null);
    if (t === null) { setError("We could not read that file."); return; }
    if (!t.trim()) { setError("That file is empty."); return; }
    setFileName(f.name);
    setNewName(tableNameFromFile(f.name));
    setText(t);
  }

  // Choosing a file unmounts the drop zone that held focus; hand focus to the
  // next control rather than letting it fall back to the dialog itself (which
  // then drew its focus ring round the whole 960 panel).
  const hasFile = !!parsed;
  useEffect(() => {
    if (hasFile) chooseAnotherRef.current?.focus({ preventScroll: true });
  }, [hasFile]);

  const summary = parsed && plan ? planSummary(parsed, plan) : null;
  const tooMany = !!parsed && parsed.rows.length > CSV_IMPORT_MAX_ROWS;

  async function runImport() {
    if (!parsed || !plan || !text || busy || tooMany) return;
    setBusy(true);
    setError(null);
    let tableId = table?.id ?? null;
    let body = planToBody(plan);
    let created = false;
    let madeName: string | null = null;
    if (mode === "create" && made) {
      tableId = made.id;
      body = made.body;
      created = true;
      madeName = made.name;
    } else if (mode === "create") {
      // The new table gets exactly the CSV's columns (named and typed as the
      // preview shows) and no seeded rows, then the rows are written into them.
      const cols = plan.map((p, i) => (p.kind === "new" ? { id: `c${i}${Math.random().toString(36).slice(2, 7)}`, label: p.label.trim() || `Column ${i + 1}`, type: p.type } : null));
      const kept = cols.filter((c): c is NonNullable<typeof c> => !!c);
      if (kept.length === 0) { setBusy(false); setError("Choose at least one column to import."); return; }
      const name = newName.trim() || tableNameFromFile(fileName ?? "");
      const r = await apiFetch<{ id: string }>("/api/tables", {
        method: "POST",
        json: { name, columns: kept, ...(spaceId ? { spaceId } : {}) },
      });
      if (!r.ok) { setBusy(false); setError(r.error || "We could not create the table."); return; }
      tableId = r.data.id;
      created = true;
      madeName = name;
      body = cols.map((c) => (c ? { target: c.id } : { skip: true }));
    }
    if (!tableId) { setBusy(false); return; }
    const imp = await apiFetch<{ rowsCreated: number }>(`/api/tables/${tableId}/import`, {
      method: "POST",
      json: { csv: text, hasHeader, columns: body },
    });
    setBusy(false);
    if (!imp.ok) {
      // A new table that got no rows is still a table the person can open;
      // say so rather than leaving an orphan nobody mentions.
      setError(created ? `The table ${madeName ?? ""} was created but its rows did not import: ${imp.error || "the server did not answer"}. Import again to add them to it.` : imp.error || "We could not import the rows.");
      if (created && tableId) {
        setMade({ id: tableId, name: madeName ?? "", body });
        notifyTablesChanged();
      }
      return;
    }
    notifyTablesChanged();
    const rows = imp.data.rowsCreated ?? parsed.rows.length;
    const id = tableId;
    toast(`Imported ${rows.toLocaleString()} row${rows === 1 ? "" : "s"}${made && mode === "create" ? ` into ${made.name}` : ""}`, created ? { tone: "success", action: { label: "Open table", onClick: () => router.push(objectHrefNow("table", id)) } } : { tone: "success" });
    onDone?.({ tableId: id, created, rows });
    reset();
    onClose();
  }

  const setOne = (i: number, next: CsvColumnPlan) => setPlan((p) => (p ? p.map((x, j) => (j === i ? next : x)) : p));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="os-chrome flex max-h-[90vh] max-w-[960px] flex-col gap-0 overflow-hidden border-line bg-raised p-0">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-5">
          <DialogTitle className="text-lg font-semibold text-ink">Import a CSV</DialogTitle>
        </div>
        <DialogDescription className="sr-only">Choose a CSV file, check the preview, and bring its rows into a table.</DialogDescription>

        <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!parsed ? (
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void takeFile(e.dataTransfer.files?.[0]); }}
              className={cn(
                "flex h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center",
                dragOver ? "border-brand bg-brand-soft" : "border-line-strong bg-[var(--os-surface-1)] hover:bg-hover",
              )}
            >
              <FileUp className="h-6 w-6 text-ink-2" strokeWidth={1.5} aria-hidden />
              <span className="text-base font-medium text-ink">Drop a CSV file here, or choose one</span>
              <span className="text-sm text-ink-2">Up to {CSV_IMPORT_MAX_ROWS.toLocaleString()} rows. The first row can be the column names.</span>
              <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="inline-flex min-w-0 items-center gap-2 text-base text-ink">
                  <Upload className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                  <span className="truncate font-medium">{fileName}</span>
                  <button ref={chooseAnotherRef} type="button" onClick={() => reset()} className="shrink-0 rounded-sm text-sm font-medium text-brand-deep hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">Choose another</button>
                </span>
                <label className="inline-flex items-center gap-2 text-base text-ink">
                  <Switch checked={hasHeader} onChange={setHasHeader} disabled={locked} aria-label="First row is a header" />
                  First row is a header
                </label>
              </div>

              {table ? (
                <fieldset className="flex flex-wrap gap-2" aria-label="Where the rows go">
                  {(["append", "create"] as const).map((m) => (
                    <label key={m} className={cn("inline-flex h-9 items-center gap-2 rounded-md border px-3 text-base", locked ? "cursor-default" : "cursor-pointer", mode === m ? "border-brand bg-brand-soft text-ink" : cn("border-line-strong text-ink-2", locked ? "opacity-50" : "hover:bg-hover"))}>
                      <input type="radio" name="csv-mode" className="sr-only" checked={mode === m} disabled={locked} onChange={() => setMode(m)} />
                      {m === "append" ? `Append to ${table.name || "this table"}` : "Create a new table"}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {mode === "create" ? (
                <label className="flex max-w-[480px] flex-col gap-1 text-sm font-medium text-ink-2">
                  Table name
                  <input value={locked && made ? made.name : newName} readOnly={locked} onChange={(e) => setNewName(e.target.value)} className="h-9 rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink read-only:bg-[var(--os-surface-1)] read-only:text-ink-2 focus:outline-none focus-visible:border-brand" />
                </label>
              ) : null}

              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-max min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[var(--os-table-head-bg)]">
                      {parsed.headers.map((h, i) => {
                        const p = plan?.[i];
                        return (
                          <th key={i} className="min-w-[180px] border-b border-e border-line p-2 text-start align-top font-normal">
                            <div className="flex flex-col gap-1.5">
                              <span className="text-xs font-medium text-ink-3">{columnLetter(i)} · {h}</span>
                              <button
                                type="button"
                                aria-label={`Where ${h} goes`}
                                aria-haspopup="listbox"
                                aria-expanded={pick?.kind === "where" && pick.col === i}
                                disabled={locked}
                                onClick={(e) => openPick("where", i, e.currentTarget)}
                                className="flex h-8 w-full items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2 text-start text-sm text-ink hover:bg-hover disabled:cursor-default disabled:bg-[var(--os-surface-1)] disabled:text-ink-2 disabled:opacity-60"
                              >
                                <span className="min-w-0 flex-1 truncate">{whereLabel(p)}</span>
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-hidden />
                              </button>
                              {p?.kind === "new" ? (
                                <div className="flex gap-1.5">
                                  <input aria-label={`Name for ${h}`} value={p.label} readOnly={locked} onChange={(e) => setOne(i, { ...p, label: e.target.value })} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink read-only:bg-[var(--os-surface-1)] read-only:text-ink-2" />
                                  <button
                                    type="button"
                                    aria-label={`Type for ${h}: ${typeLabel(p.type)}`}
                                    aria-haspopup="listbox"
                                    aria-expanded={pick?.kind === "type" && pick.col === i}
                                    disabled={locked}
                                    onClick={(e) => openPick("type", i, e.currentTarget)}
                                    title={typeLabel(p.type)}
                                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-line-strong bg-raised px-1.5 text-sm text-ink hover:bg-hover disabled:cursor-default disabled:bg-[var(--os-surface-1)] disabled:opacity-60"
                                  >
                                    <TypeGlyph type={p.type} />
                                    <ChevronDown className="h-3.5 w-3.5 text-ink-2" aria-hidden />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, CSV_PREVIEW_ROWS).map((r, ri) => (
                      <tr key={ri}>
                        {parsed.headers.map((_, ci) => (
                          <td key={ci} className={cn("h-8 max-w-[240px] truncate border-b border-e border-line-soft px-2 text-ink", plan?.[ci]?.kind === "skip" && "text-ink-4 line-through")}>{r[ci] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.rows.length > CSV_PREVIEW_ROWS ? (
                <p className="m-0 text-sm text-ink-2">Showing the first {CSV_PREVIEW_ROWS} of {parsed.rows.length.toLocaleString()} rows.</p>
              ) : null}
            </div>
          )}
          {error ? <p className="m-0 mt-3 text-sm text-danger-text" role="alert">{error}</p> : null}
          {pick && plan && parsed ? (
            <span ref={popRef} className="absolute z-[70] h-0 w-0" style={{ left: pick.left, top: pick.side === "top" ? pick.top : pick.bottom }}>
              {pick.kind === "where" ? (
                <Picker
                  open
                  onClose={() => setPick(null)}
                  ariaLabel={`Where ${parsed.headers[pick.col] ?? "this column"} goes`}
                  width={240}
                  side={pick.side}
                  selected={(() => { const p = plan[pick.col]; return p?.kind === "existing" ? `col:${p.target}` : p?.kind === "skip" ? "skip" : "new"; })()}
                  sections={[
                    { options: [{ value: "new", label: "New column" }] },
                    ...(target?.length ? [{ label: `Into ${table?.name || "this table"}`, options: target.map((c, ci) => ({ value: `col:${c.id}`, label: `Into ${c.label.trim() || columnLetter(ci)}` })) }] : []),
                    { options: [{ value: "skip", label: "Skip this column" }] },
                  ]}
                  onSelect={(v) => {
                    const i = pick.col;
                    const h = parsed.headers[i] ?? "";
                    if (v === "skip") setOne(i, { kind: "skip" });
                    else if (v === "new") setOne(i, { kind: "new", label: h, type: "short_text" });
                    else setOne(i, { kind: "existing", target: v.slice(4) });
                    setPick(null);
                  }}
                />
              ) : (
                <Picker
                  open
                  onClose={() => setPick(null)}
                  ariaLabel="Column type"
                  width={220}
                  side={pick.side}
                  selected={(() => { const p = plan[pick.col]; return p?.kind === "new" ? p.type : null; })()}
                  sections={[{ options: CSV_IMPORT_TYPES.map((t) => ({ value: t.value, label: t.label, glyph: <TypeGlyph type={t.value} /> })) }]}
                  onSelect={(v) => {
                    const p = plan[pick.col];
                    if (p?.kind === "new") setOne(pick.col, { ...p, type: v as typeof p.type });
                    setPick(null);
                  }}
                />
              )}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p className="m-0 min-w-0 truncate text-sm text-ink-2">
            {tooMany
              ? `This file has ${parsed!.rows.length.toLocaleString()} rows. Import up to ${CSV_IMPORT_MAX_ROWS.toLocaleString()} at a time.`
              : summary
                ? importSummaryLine({ mode, ...summary, tableName: table?.name, newName, madeName: locked ? made?.name : null })
                : "Nothing is written until you choose Import."}
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={close} disabled={busy} className="h-9 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover">Cancel</button>
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={!parsed || busy || tooMany || (summary?.rows ?? 0) === 0}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-ink-inv hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-active disabled:text-ink-4"
            >
              {busy ? <Dots variant="pending" /> : null}
              Import
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The glyph the grid's column menu shows for a type (ColumnTypePicker's set). */
function TypeGlyph({ type }: { type: string }) {
  const Icon = COLUMN_TYPE_ICON[type] ?? Type;
  return <Icon className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />;
}

function typeLabel(type: string): string {
  return CSV_IMPORT_TYPES.find((t) => t.value === type)?.label ?? "Text";
}
