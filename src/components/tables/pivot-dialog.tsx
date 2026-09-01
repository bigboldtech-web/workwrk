"use client";

// PivotDialog — a live pivot builder over the current sheet, matching Rows'
// pivot panel: pick Rows (group by), Columns (pivot into), a Value + aggregation,
// and the result table updates instantly. Read-only analysis for now (no
// persistence); the config lives in local state and the compute is pure.

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plus, X, Table2, BarChart3, LineChart, PieChart, Grid3x3 } from "lucide-react";
import { computePivot, type PivotAgg } from "@/lib/sheet-pivot";
import { PivotChart, type ChartType } from "./pivot-chart";

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
}

const AGGS: { value: PivotAgg; label: string }[] = [
  { value: "sum", label: "SUM" },
  { value: "count", label: "COUNT" },
  { value: "avg", label: "AVERAGE" },
  { value: "min", label: "MIN" },
  { value: "max", label: "MAX" },
];

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "";
  const r = Math.round(n * 1e6) / 1e6;
  return Number.isInteger(r) ? String(r) : String(r);
}

export function PivotDialog({ open, onOpenChange, columns, buildRecords }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[860px] p-0 gap-0">
        {open ? <PivotBody columns={columns} buildRecords={buildRecords} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PivotBody({ columns, buildRecords }: { columns: Col[]; buildRecords: () => Record<string, unknown>[] }) {
  const records = useMemo(() => buildRecords(), [buildRecords]);
  const labelOf = useMemo(() => new Map(columns.map((c) => [c.id, c.label])), [columns]);

  const [rowFields, setRowFields] = useState<string[]>(() => (columns[0] ? [columns[0].id] : []));
  const [colField, setColField] = useState<string>("");
  const [valueField, setValueField] = useState<string>(() => columns[1]?.id ?? columns[0]?.id ?? "");
  const [agg, setAgg] = useState<PivotAgg>("sum");
  const [view, setView] = useState<"table" | "chart">("table");
  const [chartType, setChartType] = useState<ChartType>("bar");

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
      <div className="w-[300px] shrink-0 border-r border-zinc-100 p-5 overflow-y-auto">
        <DialogTitle className="text-[15px] font-semibold inline-flex items-center gap-2">
          <Table2 className="h-4 w-4 text-zinc-500" /> Pivot table
        </DialogTitle>
        <DialogDescription className="mt-1 mb-4 text-[12.5px]">
          Summarise the sheet by grouping and aggregating.
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
            className="w-full h-8 rounded-md border border-zinc-200 px-2 text-[13px] bg-white focus:outline-none focus:border-zinc-400"
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
              className="w-full h-8 rounded-md border border-zinc-200 px-2 text-[13px] bg-white focus:outline-none focus:border-zinc-400"
            >
              {AGGS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            {agg !== "count" ? (
              <select
                value={valueField}
                onChange={(e) => setValueField(e.target.value)}
                className="w-full h-8 rounded-md border border-zinc-200 px-2 text-[13px] bg-white focus:outline-none focus:border-zinc-400"
              >
                {columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            ) : (
              <span className="text-[12px] text-zinc-400 px-0.5">Counts rows in each group.</span>
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
          <div className="h-full flex items-center justify-center text-[13px] text-zinc-400">
            Pick a Row field {agg === "count" ? "" : "and a Value"} to build the pivot.
          </div>
        ) : view === "chart" ? (
          <PivotChart result={result} type={chartType} />
        ) : (
          <table className="text-[13px] border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white text-left font-semibold text-zinc-500 px-3 py-1.5 border-b border-zinc-200">
                  {rowFields.map((f) => labelOf.get(f)).join(" / ")}
                </th>
                {result.columns.map((c) => (
                  <th key={c} className="text-right font-semibold text-zinc-600 px-3 py-1.5 border-b border-zinc-200 whitespace-nowrap">{c}</th>
                ))}
                <th className="text-right font-semibold text-zinc-800 px-3 py-1.5 border-b border-zinc-200 bg-zinc-50">Total</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.key} className="hover:bg-zinc-50">
                  <td className="sticky left-0 bg-white text-zinc-800 px-3 py-1.5 border-b border-zinc-100 whitespace-nowrap">{row.key}</td>
                  {row.cells.map((v, i) => (
                    <td key={i} className="text-right tabular-nums text-zinc-700 px-3 py-1.5 border-b border-zinc-100">{fmt(v)}</td>
                  ))}
                  <td className="text-right tabular-nums font-medium text-zinc-900 px-3 py-1.5 border-b border-zinc-100 bg-zinc-50">{fmt(row.total)}</td>
                </tr>
              ))}
              <tr>
                <td className="sticky left-0 bg-zinc-50 font-semibold text-zinc-800 px-3 py-1.5 border-t border-zinc-200">Grand Total</td>
                {result.columnTotals.map((v, i) => (
                  <td key={i} className="text-right tabular-nums font-semibold text-zinc-800 px-3 py-1.5 border-t border-zinc-200 bg-zinc-50">{fmt(v)}</td>
                ))}
                <td className="text-right tabular-nums font-semibold text-zinc-900 px-3 py-1.5 border-t border-zinc-200 bg-zinc-100">{fmt(result.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Section({ title, children, onAdd, canAdd }: { title: string; children: React.ReactNode; onAdd?: () => void; canAdd?: boolean }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">{title}</span>
        {onAdd ? (
          <button type="button" onClick={onAdd} disabled={!canAdd} className="text-zinc-400 hover:text-zinc-700 disabled:opacity-40" aria-label={`Add ${title} field`}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="text-[12.5px] text-zinc-400 px-0.5">None</div>;
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
      className={`h-8 inline-flex items-center gap-1.5 rounded-md text-[13px] ${iconOnly ? "w-8 justify-center" : "px-2.5"} ${active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
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
        className="flex-1 min-w-0 h-8 rounded-md border border-zinc-200 px-2 text-[13px] bg-white focus:outline-none focus:border-zinc-400"
      >
        {/* keep the current field selectable even though it's excluded from `columns` */}
        <option value={value}>{currentLabel ?? value}</option>
        {columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <button type="button" onClick={onRemove} className="h-7 w-7 rounded hover:bg-zinc-100 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700" aria-label="Remove field">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
