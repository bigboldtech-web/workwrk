"use client";

// RelationConfigModal — configures a DataTable relational column:
//   link   → pick the target table
//   lookup → pick a link column on this table + a field in its target table
//   rollup → pick a link column + a target field + an aggregate function
// Pure UI: the page owns the columns + persistence and passes data in.

import { useState } from "react";
import { X, Link2, Search, Sigma, Check } from "lucide-react";

export interface RelCol {
  id: string;
  type: string;
  label: string;
  linkTableId?: string;
  linkColumnId?: string;
  lookupColumnId?: string;
  rollupColumnId?: string;
  rollupFn?: string;
}
type LiteCol = { id: string; label: string; type: string };

const ROLLUP_FNS = ["SUM", "AVG", "MIN", "MAX", "COUNT", "CONCAT"] as const;

export function RelationConfigModal({
  column,
  tableColumns,
  allTables,
  columnsByTable,
  onSave,
  onClose,
}: {
  column: RelCol;
  tableColumns: RelCol[];
  allTables: { id: string; name: string }[];
  /** target table id → its columns (for lookup/rollup field pickers) */
  columnsByTable: Record<string, LiteCol[]>;
  onSave: (patch: Partial<RelCol>) => void;
  onClose: () => void;
}) {
  const [linkTableId, setLinkTableId] = useState(column.linkTableId ?? "");
  const [linkColumnId, setLinkColumnId] = useState(column.linkColumnId ?? "");
  const [fieldId, setFieldId] = useState(column.lookupColumnId ?? column.rollupColumnId ?? "");
  const [rollupFn, setRollupFn] = useState(column.rollupFn ?? "SUM");

  const linkColumns = tableColumns.filter((c) => c.type === "link" && c.id !== column.id);
  const chosenLink = linkColumns.find((c) => c.id === linkColumnId);
  const targetTableId = column.type === "link" ? linkTableId : chosenLink?.linkTableId;
  const targetCols = targetTableId ? (columnsByTable[targetTableId] ?? []) : [];

  const Icon = column.type === "link" ? Link2 : column.type === "lookup" ? Search : Sigma;
  const title = column.type === "link" ? "Link to table" : column.type === "lookup" ? "Lookup field" : "Rollup";

  const canSave = column.type === "link"
    ? !!linkTableId
    : !!linkColumnId && (column.type === "lookup" ? !!fieldId : !!fieldId && !!rollupFn) || (column.type === "rollup" && rollupFn === "COUNT" && !!linkColumnId);

  const save = () => {
    if (column.type === "link") { onSave({ linkTableId }); return; }
    if (column.type === "lookup") { onSave({ linkColumnId, lookupColumnId: fieldId }); return; }
    onSave({ linkColumnId, rollupColumnId: rollupFn === "COUNT" ? undefined : fieldId, rollupFn: rollupFn as RelCol["rollupFn"] });
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-[420px] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100">
          <h3 className="inline-flex items-center gap-2 text-[15px] font-semibold text-zinc-900"><Icon className="w-4 h-4 text-zinc-500" /> {title}</h3>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-full bg-zinc-100 hover:bg-zinc-200 inline-flex items-center justify-center text-zinc-500"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {column.type === "link" ? (
            <Field label="Target table">
              <select value={linkTableId} onChange={(e) => setLinkTableId(e.target.value)} className="w-full h-9 px-2 rounded-lg border border-zinc-200 text-[13px] bg-white">
                <option value="">Select a table…</option>
                {allTables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Through link column">
                {linkColumns.length === 0 ? (
                  <p className="text-[12px] text-amber-600">Add a “Link to table” column first.</p>
                ) : (
                  <select value={linkColumnId} onChange={(e) => { setLinkColumnId(e.target.value); setFieldId(""); }} className="w-full h-9 px-2 rounded-lg border border-zinc-200 text-[13px] bg-white">
                    <option value="">Select a link column…</option>
                    {linkColumns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                )}
              </Field>
              {column.type === "rollup" ? (
                <Field label="Aggregate">
                  <select value={rollupFn} onChange={(e) => setRollupFn(e.target.value)} className="w-full h-9 px-2 rounded-lg border border-zinc-200 text-[13px] bg-white">
                    {ROLLUP_FNS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
              ) : null}
              {linkColumnId && !(column.type === "rollup" && rollupFn === "COUNT") ? (
                <Field label={column.type === "lookup" ? "Field to pull" : "Field to aggregate"}>
                  <select value={fieldId} onChange={(e) => setFieldId(e.target.value)} className="w-full h-9 px-2 rounded-lg border border-zinc-200 text-[13px] bg-white">
                    <option value="">Select a field…</option>
                    {targetCols.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  {targetCols.length === 0 ? <p className="text-[11px] text-zinc-400 mt-1">Target table’s fields load once the link is set.</p> : null}
                </Field>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-zinc-100">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] text-zinc-600 hover:bg-zinc-100">Cancel</button>
          <button type="button" onClick={save} disabled={!canSave} className="h-9 px-4 rounded-lg text-[13px] text-white bg-[var(--os-brand)] inline-flex items-center gap-1.5 disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-medium text-zinc-600">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
