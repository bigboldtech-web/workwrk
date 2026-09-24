"use client";

// RelationConfigModal, configures a DataTable relational column:
//   link   → pick the target table
//   lookup → pick a link column on this table + a field in its target table
//   rollup → pick a link column + a target field + an aggregate function
// Pure UI: the page owns the columns + persistence and passes data in.

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Link2, Search, Sigma, Check } from "lucide-react";

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="os-chrome max-w-[560px] gap-0 overflow-hidden border-line bg-raised p-0">
        <div className="flex h-14 items-center border-b border-line px-5">
          <DialogTitle className="inline-flex items-center gap-2 text-lg font-semibold text-ink"><Icon className="h-4 w-4 text-ink-2" /> {title}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">Where this column reads its values from.</DialogDescription>

        <div className="p-5 space-y-4">
          {column.type === "link" ? (
            <Field label="Target table">
              <select value={linkTableId} onChange={(e) => setLinkTableId(e.target.value)} className="w-full h-9 px-2 rounded-md border border-line-strong text-base bg-raised text-ink">
                <option value="">Choose a table</option>
                {allTables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Through link column">
                {linkColumns.length === 0 ? (
                  <p className="text-sm text-warning-text">Add a "Link to another table" column first.</p>
                ) : (
                  <select value={linkColumnId} onChange={(e) => { setLinkColumnId(e.target.value); setFieldId(""); }} className="w-full h-9 px-2 rounded-md border border-line-strong text-base bg-raised text-ink">
                    <option value="">Choose a link column</option>
                    {linkColumns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                )}
              </Field>
              {column.type === "rollup" ? (
                <Field label="Aggregate">
                  <select value={rollupFn} onChange={(e) => setRollupFn(e.target.value)} className="w-full h-9 px-2 rounded-md border border-line-strong text-base bg-raised text-ink">
                    {ROLLUP_FNS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
              ) : null}
              {linkColumnId && !(column.type === "rollup" && rollupFn === "COUNT") ? (
                <Field label={column.type === "lookup" ? "Field to pull" : "Field to aggregate"}>
                  <select value={fieldId} onChange={(e) => setFieldId(e.target.value)} className="w-full h-9 px-2 rounded-md border border-line-strong text-base bg-raised text-ink">
                    <option value="">Choose a column</option>
                    {targetCols.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  {targetCols.length === 0 ? <p className="text-xs text-ink-3 mt-1">The other table's columns appear once the link is set.</p> : null}
                </Field>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-line-soft">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-base text-ink-2 hover:bg-hover">Cancel</button>
          <button type="button" onClick={save} disabled={!canSave} className="h-9 px-4 rounded-lg text-base text-white bg-[var(--os-brand)] inline-flex items-center gap-1.5 disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-ink-2">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
