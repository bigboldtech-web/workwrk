"use client";

// PivotDialog: a live pivot builder over the current sheet: pick Rows (group
// by), Columns (pivot into), a Value and its aggregation, and the result
// updates instantly (spec-tables-forms section 2 /tables/[id], Pivot).
//
// The CONFIGURATION persists per person per table: the page passes the last
// one in (`initialConfig`, read from home.work.surface["table:{id}"].pivot)
// and is told every change (`onConfigChange`, which it writes debounced). The
// RESULT is never stored: it is derived from the rows every time, and the one
// way to keep it is "Insert as a new table", which writes it to a real table.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plus, X, Table2, BarChart3, LineChart, PieChart, Grid3x3 } from "lucide-react";
import { computePivot, type PivotAgg, type PivotResult } from "@/lib/sheet-pivot";
import { PivotChart, type ChartType } from "./pivot-chart";
import type { PivotConfig } from "@/lib/tables-prefs";
import { Dots } from "@/components/ui/dots";

interface Col {
  id: string;
  label: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  columns: Col[];
  /** Resolves the sheet into records (formula cells already evaluated). Called
   *  once when the dialog opens. */
  buildRecords: () => Record<string, unknown>[];
  /** The last configuration this person used on this table. */
  initialConfig?: PivotConfig | null;
  onConfigChange?: (config: PivotConfig) => void;
  /** Write the result to a new table; resolves when it exists. */
  onInsertAsTable?: (result: { headers: string[]; rows: (string | number)[][] }) => Promise<void>;
}

const AGGS: { value: PivotAgg; label: string }[] = [
  { value: "sum", label: "SUM" },
  { value: "count", label: "COUNT" },
  { value: "avg", label: "AVERAGE" },
  { value: "min", label: "MIN" },
  { value: "max", label: "MAX" },
];

/** The pivot result as a plain header row plus body rows, for "Insert as a new
 *  table". With no Columns field computePivot still hands back one cell per
 *  row (its single "__all__" bucket) but no column heading for it, and that
 *  cell always equals the row Total, so it is dropped here. Keeping it gave
 *  every body row one value more than there were headers. */
export function pivotToTable(
  result: Pick<PivotResult, "columns" | "rows" | "columnTotals" | "grandTotal">,
  groupLabel: string,
): { headers: string[]; rows: (string | number)[][] } {
  const pivoted = result.columns.length > 0;
  const num = (v: number) => (Number.isFinite(v) ? v : "");
  const headers = [groupLabel || "Group", ...(pivoted ? result.columns.map(String) : []), "Total"];
  const rows = result.rows.map((r) => [r.key, ...(pivoted ? r.cells.map(num) : []), num(r.total)] as (string | number)[]);
  rows.push(["Grand Total", ...(pivoted ? result.columnTotals.map(num) : []), num(result.grandTotal)]);
  return { headers, rows };
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "";
  const r = Math.round(n * 1e6) / 1e6;
  return Number.isInteger(r) ? String(r) : String(r);
}

export function PivotDialog({ open, onOpenChange, columns, buildRecords, initialConfig, onConfigChange, onInsertAsTable }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="os-chrome max-w-[960px] gap-0 border-line bg-raised p-0">
        {open ? <PivotBody columns={columns} buildRecords={buildRecords} initialConfig={initialConfig ?? null} onConfigChange={onConfigChange} onInsertAsTable={onInsertAsTable} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PivotBody({ columns, buildRecords, initialConfig, onConfigChange, onInsertAsTable }: {
  columns: Col[];
  buildRecords: () => Record<string, unknown>[];
  initialConfig: PivotConfig | null;
  onConfigChange?: (config: PivotConfig) => void;
  onInsertAsTable?: Props["onInsertAsTable"];
}) {
  const records = useMemo(() => buildRecords(), [buildRecords]);
  const labelOf = useMemo(() => new Map(columns.map((c) => [c.id, c.label])), [columns]);

  const init = initialConfig;
  const [rowFields, setRowFields] = useState<string[]>(() => (init && init.rowFields.length ? init.rowFields : columns[0] ? [columns[0].id] : []));
  const [colField, setColField] = useState<string>(() => init?.colField ?? "");
  const [valueField, setValueField] = useState<string>(() => init?.valueField || columns[1]?.id || columns[0]?.id || "");
  const [agg, setAgg] = useState<PivotAgg>(() => (init?.agg as PivotAgg | undefined) ?? "sum");
  const [view, setView] = useState<"table" | "chart">(() => init?.view ?? "table");
  const [chartType, setChartType] = useState<ChartType>(() => (init?.chartType as ChartType | undefined) ?? "bar");
  const [inserting, setInserting] = useState(false);

  // Tell the page about every change after the first render (the initial
  // state is either the stored config or the defaults, neither of which is
  // a choice the person just made).
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    onConfigChange?.({ rowFields, colField, valueField, agg, view, chartType });
  }, [rowFields, colField, valueField, agg, view, chartType, onConfigChange]);

  const result = useMemo(
    () =>
      computePivot(records, {
        rowFields: rowFields.filter(Boolean),
        colField: colField || null,
        valueField: agg === "count" ? null : valueField || null,
        agg,
      }),
    [records, rowFields, colField, valueField, agg],
  );

  const available = (exclude: string[]) => columns.filter((c) => !exclude.includes(c.id));

  return (
    <div className="flex max-h-[80vh] min-h-[420px]">
      {/* Config panel */}
      <div className="w-[300px] shrink-0 border-e border-line-soft p-5 overflow-y-auto">
        <DialogTitle className="text-base font-semibold inline-flex items-center gap-2">
          <Table2 className="h-4 w-4 text-ink-2" /> Pivot table
        </DialogTitle>
        <DialogDescription className="mt-1 mb-4 text-xs">
          Summarise the table by grouping and aggregating.
        </DialogDescription>

        {/* Rows */}
        <Section
          title="Rows"
          onAdd={() => {
            const next = available(rowFields)[0];
            if (next) setRowFields((p) => [...p, next.id]);
          }}
          canAdd={available(rowFields).length > 0}
        >
          {rowFields.length === 0 ? <Empty /> : rowFields.map((f, i) => (
            <FieldRow
              key={i}
              value={f}
              columns={available(rowFields.filter((_, x) => x !== i))}
              currentLabel={labelOf.get(f)}
              onChange={(v) => setRowFields((p) => p.map((x, y) => (y === i ? v : x)))}
              onRemove={() => setRowFields((p) => p.filter((_, y) => y !== i))}
            />
          ))}
        </Section>

        {/* Columns */}
        <Section title="Columns">
          <select
            value={colField}
            onChange={(e) => setColField(e.target.value)}
            className="w-full h-8 rounded-md border border-line px-2 text-sm bg-raised focus:outline-none focus:border-brand"
          >
            <option value="">None</option>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Section>

        {/* Values */}
        <Section title="Values">
          <div className="flex flex-col gap-1.5">
            <select
              value={agg}
              onChange={(e) => setAgg(e.target.value as PivotAgg)}
              className="w-full h-8 rounded-md border border-line px-2 text-sm bg-raised focus:outline-none focus:border-brand"
            >
              {AGGS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            {agg !== "count" ? (
              <select
                value={valueField}
                onChange={(e) => setValueField(e.target.value)}
                className="w-full h-8 rounded-md border border-line px-2 text-sm bg-raised focus:outline-none focus:border-brand"
              >
                {columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            ) : (
              <span className="text-xs text-ink-3 px-0.5">Counts rows in each group.</span>
            )}
          </div>
        </Section>
      </div>

      {/* Result */}
      <div className="flex-1 min-w-0 overflow-auto p-5">
        {!result.empty ? (
          <div className="flex items-center gap-1 mb-3">
            <ViewBtn active={view === "table"} onClick={() => setView("table")} icon={Grid3x3} label="Table" />
            <ViewBtn active={view === "chart"} onClick={() => setView("chart")} icon={BarChart3} label="Chart" />
            {view === "chart" ? (
              <span className="ml-3 inline-flex items-center gap-0.5">
                <ViewBtn active={chartType === "bar"} onClick={() => setChartType("bar")} icon={BarChart3} label="Bar" iconOnly />
                <ViewBtn active={chartType === "line"} onClick={() => setChartType("line")} icon={LineChart} label="Line" iconOnly />
                <ViewBtn active={chartType === "pie"} onClick={() => setChartType("pie")} icon={PieChart} label="Pie" iconOnly />
              </span>
            ) : null}
          </div>
        ) : null}
        {result.empty ? (
          <div className="h-full flex items-center justify-center text-sm text-ink-3">
            Pick a Row field {agg === "count" ? "" : "and a Value"} to build the pivot.
          </div>
        ) : view === "chart" ? (
          <PivotChart result={result} type={chartType} />
        ) : (
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th className="sticky start-0 bg-raised text-start font-semibold text-ink-2 px-3 py-1.5 border-b border-line">
                  {rowFields.map((f) => labelOf.get(f)).join(" / ")}
                </th>
                {result.columns.map((c) => (
                  <th key={c} className="text-end font-semibold text-ink-2 px-3 py-1.5 border-b border-line whitespace-nowrap">{c}</th>
                ))}
                <th className="text-end font-semibold text-ink px-3 py-1.5 border-b border-line bg-[var(--os-surface-1)]">Total</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.key} className="hover:bg-hover">
                  <td className="sticky start-0 bg-raised text-ink px-3 py-1.5 border-b border-line-soft whitespace-nowrap">{row.key}</td>
                  {/* With no Columns field the lone cell has no heading and repeats the Total, so it is not drawn. */}
                  {result.columns.length > 0 && row.cells.map((v, i) => (
                    <td key={i} className="text-end tabular-nums text-ink px-3 py-1.5 border-b border-line-soft">{fmt(v)}</td>
                  ))}
                  <td className="text-end tabular-nums font-medium text-ink px-3 py-1.5 border-b border-line-soft bg-[var(--os-surface-1)]">{fmt(row.total)}</td>
                </tr>
              ))}
              <tr>
                <td className="sticky start-0 bg-[var(--os-surface-1)] font-semibold text-ink px-3 py-1.5 border-t border-line">Grand Total</td>
                {result.columns.length > 0 && result.columnTotals.map((v, i) => (
                  <td key={i} className="text-end tabular-nums font-semibold text-ink px-3 py-1.5 border-t border-line bg-[var(--os-surface-1)]">{fmt(v)}</td>
                ))}
                <td className="text-end tabular-nums font-semibold text-ink px-3 py-1.5 border-t border-line bg-active">{fmt(result.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {!result.empty && onInsertAsTable ? (
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-3">
            <span className="text-sm text-ink-2">The result is worked out from the rows each time. Keep a copy as its own table:</span>
            <button
              type="button"
              disabled={inserting}
              onClick={async () => {
                setInserting(true);
                const data = pivotToTable(result, rowFields.map((f) => labelOf.get(f) ?? f).join(" / "));
                try { await onInsertAsTable(data); } finally { setInserting(false); }
              }}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:opacity-50"
            >
              {inserting ? <Dots variant="pending" /> : <Table2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
              Insert as a new table
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children, onAdd, canAdd }: { title: string; children: React.ReactNode; onAdd?: () => void; canAdd?: boolean }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-micro uppercase tracking-wide text-ink-2 font-semibold">{title}</span>
        {onAdd ? (
          <button type="button" onClick={onAdd} disabled={!canAdd} className="text-ink-3 hover:text-ink disabled:opacity-40" aria-label={`Add ${title} field`}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-ink-3 px-0.5">None</div>;
}

function ViewBtn({ active, onClick, icon: Icon, label, iconOnly }: {
  active: boolean;
  onClick: () => void;
  icon: typeof Table2;
  label: string;
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`h-8 inline-flex items-center gap-1.5 rounded-md text-sm ${iconOnly ? "w-8 justify-center" : "px-2.5"} ${active ? "bg-active text-ink" : "text-ink-2 hover:bg-hover"}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {iconOnly ? null : label}
    </button>
  );
}

function FieldRow({ value, columns, currentLabel, onChange, onRemove }: {
  value: string;
  columns: Col[];
  currentLabel?: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 h-8 rounded-md border border-line px-2 text-sm bg-raised focus:outline-none focus:border-brand"
      >
        {/* keep the current field selectable even though it's excluded from `columns` */}
        <option value={value}>{currentLabel ?? value}</option>
        {columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <button type="button" onClick={onRemove} className="h-7 w-7 rounded hover:bg-hover inline-flex items-center justify-center text-ink-3 hover:text-ink" aria-label="Remove field">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
