"use client";

// BoardPivotView — PIVOT renderer. Two-axis cross-tab: rows × columns
// with an aggregate per cell (count, or sum of a numeric field) plus
// row/column totals. Axes are status / owner / priority / any choice
// field. Settings persist in View.config { rowAxis, colAxis, metric }.

import { useCallback, useMemo, useState } from "react";
import { Grid3X3 } from "lucide-react";
import {
  PRIORITY_OPTIONS,
  type BoardItemRow,
  type StatusOption,
} from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";

interface BoardPivotViewProps {
  boardId: string;
  viewId: string | null;
  viewConfig: Record<string, unknown>;
  initialItems: BoardItemRow[];
  initialFields?: FieldDef[];
  statuses: StatusOption[];
  canEdit: boolean;
}

interface AxisBucket { key: string; label: string; color: string | null }

export function BoardPivotView({ boardId, viewId, viewConfig, initialItems, initialFields, statuses, canEdit }: BoardPivotViewProps) {
  const fields = useMemo(() => initialFields ?? [], [initialFields]);
  const [rowAxis, setRowAxis] = useState<string>(() =>
    typeof viewConfig?.rowAxis === "string" ? (viewConfig.rowAxis as string) : "status",
  );
  const [colAxis, setColAxis] = useState<string>(() =>
    typeof viewConfig?.colAxis === "string" ? (viewConfig.colAxis as string) : "owner",
  );
  const [metric, setMetric] = useState<string>(() =>
    typeof viewConfig?.metric === "string" ? (viewConfig.metric as string) : "count",
  );

  const persist = useCallback((patch: Record<string, unknown>) => {
    if (!viewId) return;
    void fetch(`/api/boards/${boardId}/views/${viewId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { ...(viewConfig ?? {}), rowAxis, colAxis, metric, ...patch } }),
    }).catch(() => {});
  }, [boardId, viewId, viewConfig, rowAxis, colAxis, metric]);

  const axisOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [
      { key: "status", label: "Status" },
      { key: "owner", label: "Owner" },
      { key: "priority", label: "Priority" },
    ];
    for (const f of fields) {
      if (f.type === "DROPDOWN" || f.type === "MULTI_SELECT" || f.type === "LABELS" || f.type === "TSHIRT_SIZE") {
        opts.push({ key: f.key, label: f.label });
      }
    }
    return opts;
  }, [fields]);

  const metricOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [{ key: "count", label: "Item count" }];
    for (const f of fields) {
      if (f.type === "NUMBER" || f.type === "MONEY" || f.type === "PERCENT") {
        opts.push({ key: `sum:${f.key}`, label: `Sum of ${f.label}` });
      }
    }
    return opts;
  }, [fields]);

  // Key extraction per axis — multi-valued fields contribute the item
  // to each of its values (standard pivot semantics).
  const keysFor = useCallback((it: BoardItemRow, axis: string): string[] => {
    if (axis === "status") return [it.status ?? "__unset__"];
    if (axis === "owner") return [it.ownerId ?? "__unset__"];
    if (axis === "priority") return [it.priority ?? "__unset__"];
    const raw = it.metadata?.[axis];
    if (Array.isArray(raw)) return raw.length ? raw.map(String) : ["__unset__"];
    return [raw == null || raw === "" ? "__unset__" : String(raw)];
  }, []);

  // Ordered bucket list per axis (statuses/priority keep canonical
  // order; owners alphabetical; choice fields keep choice order).
  const bucketsFor = useCallback((axis: string, presentKeys: Set<string>): AxisBucket[] => {
    const out: AxisBucket[] = [];
    const used = new Set<string>();
    const add = (key: string, label: string, color: string | null) => {
      if (!presentKeys.has(key) || used.has(key)) return;
      out.push({ key, label, color });
      used.add(key);
    };
    if (axis === "status") {
      for (const o of statuses) add(o.value, o.label, o.color);
    } else if (axis === "priority") {
      for (const o of PRIORITY_OPTIONS) add(o.value, o.label, o.color);
    } else if (axis === "owner") {
      const names = new Map<string, string>();
      for (const it of initialItems) {
        if (it.ownerId && it.owner) {
          names.set(it.ownerId, `${it.owner.firstName ?? ""} ${it.owner.lastName ?? ""}`.trim() || "Unknown");
        }
      }
      Array.from(names.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .forEach(([k, label]) => add(k, label, null));
    } else {
      const field = fields.find((f) => f.key === axis);
      for (const c of field?.options?.choices ?? []) add(c.value, c.label, c.color ?? null);
    }
    // Leftovers (custom values) then Unset last.
    Array.from(presentKeys)
      .filter((k) => !used.has(k) && k !== "__unset__")
      .sort()
      .forEach((k) => add(k, k, null));
    add("__unset__", "Unset", null);
    return out;
  }, [statuses, fields, initialItems]);

  const measure = useCallback((rows: BoardItemRow[]): number => {
    if (metric.startsWith("sum:")) {
      const key = metric.slice(4);
      return rows.reduce((acc, r) => {
        const v = r.metadata?.[key];
        return acc + (typeof v === "number" ? v : 0);
      }, 0);
    }
    return rows.length;
  }, [metric]);

  const pivot = useMemo(() => {
    const cellRows = new Map<string, BoardItemRow[]>(); // "row␟col" → items
    const rowKeys = new Set<string>();
    const colKeys = new Set<string>();
    for (const it of initialItems) {
      for (const rk of keysFor(it, rowAxis)) {
        for (const ck of keysFor(it, colAxis)) {
          rowKeys.add(rk);
          colKeys.add(ck);
          const cellKey = `${rk}␟${ck}`;
          const arr = cellRows.get(cellKey) ?? [];
          arr.push(it);
          cellRows.set(cellKey, arr);
        }
      }
    }
    const rows = bucketsFor(rowAxis, rowKeys);
    const cols = bucketsFor(colAxis, colKeys);
    const cell = (rk: string, ck: string) => measure(cellRows.get(`${rk}␟${ck}`) ?? []);
    const rowTotal = (rk: string) => cols.reduce((a, c) => a + cell(rk, c.key), 0);
    const colTotal = (ck: string) => rows.reduce((a, r) => a + cell(r.key, ck), 0);
    const grand = rows.reduce((a, r) => a + rowTotal(r.key), 0);
    return { rows, cols, cell, rowTotal, colTotal, grand };
  }, [initialItems, rowAxis, colAxis, keysFor, bucketsFor, measure]);

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

  if (initialItems.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
        <Grid3X3 className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
        <p className="text-[12.5px] text-zinc-500">No items to pivot yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-2 flex-wrap text-[11.5px] text-zinc-500">
        <span>Rows</span>
        <AxisSelect value={rowAxis} options={axisOptions} disabled={!canEdit} onChange={(v) => { setRowAxis(v); persist({ rowAxis: v }); }} />
        <span>Columns</span>
        <AxisSelect value={colAxis} options={axisOptions} disabled={!canEdit} onChange={(v) => { setColAxis(v); persist({ colAxis: v }); }} />
        <span>Value</span>
        <AxisSelect value={metric} options={metricOptions} disabled={!canEdit} onChange={(v) => { setMetric(v); persist({ metric: v }); }} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200">
              <th className="px-4 py-2 font-medium" />
              {pivot.cols.map((c) => (
                <th key={c.key} className="px-3 py-2 font-medium whitespace-nowrap">
                  {c.color ? (
                    <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                      {c.label}
                    </span>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
              <th className="px-3 py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {pivot.rows.map((r) => (
              <tr key={r.key} className="border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/60">
                <td className="px-4 py-2 whitespace-nowrap">
                  {r.color ? (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium"
                      style={{ background: `${r.color}22`, color: r.color }}
                    >
                      {r.label}
                    </span>
                  ) : (
                    <span className="text-[12.5px] text-zinc-700">{r.label}</span>
                  )}
                </td>
                {pivot.cols.map((c) => {
                  const v = pivot.cell(r.key, c.key);
                  return (
                    <td key={c.key} className={`px-3 py-2 tabular-nums ${v === 0 ? "text-zinc-300" : "text-zinc-800"}`}>
                      {v === 0 ? "·" : fmt(v)}
                    </td>
                  );
                })}
                <td className="px-3 py-2 tabular-nums text-right font-medium text-zinc-900">{fmt(pivot.rowTotal(r.key))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-zinc-50/80 text-[12px]">
              <td className="px-4 py-2 font-medium text-zinc-500">Total</td>
              {pivot.cols.map((c) => (
                <td key={c.key} className="px-3 py-2 tabular-nums font-medium text-zinc-900">{fmt(pivot.colTotal(c.key))}</td>
              ))}
              <td className="px-3 py-2 tabular-nums text-right font-semibold text-zinc-900">{fmt(pivot.grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function AxisSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: { key: string; label: string }[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded-md border border-zinc-200 bg-white px-1.5 text-[11.5px] text-zinc-700 outline-none hover:bg-zinc-50 focus:border-zinc-400 disabled:opacity-60"
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>{o.label}</option>
      ))}
    </select>
  );
}
