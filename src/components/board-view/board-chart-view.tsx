"use client";

// BoardChartView — CHART renderer. Aggregates the board's items by a
// chosen axis and renders bar / pie / line / number via recharts.
// Settings persist in View.config: { chartType, groupBy, metric }.
//   chartType: "bar" | "pie" | "line" | "number"
//   groupBy:   "status" | "owner" | "priority" | <choice-field key>
//   metric:    "count" | "sum:<number-field key>"
// Line mode ignores groupBy — it plots items created per week (the
// only time axis every board has).

import { useCallback, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  PRIORITY_OPTIONS,
  type BoardItemRow,
  type StatusOption,
} from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";

const FALLBACK_COLORS = ["#6366F1", "#10B981", "#F59E0B", "#EC4899", "#06B6D4", "#A855F7", "#EF4444", "#71717A"];

type ChartType = "bar" | "pie" | "line" | "number";

interface BoardChartViewProps {
  boardId: string;
  viewId: string | null;
  viewConfig: Record<string, unknown>;
  initialItems: BoardItemRow[];
  initialFields?: FieldDef[];
  statuses: StatusOption[];
  canEdit: boolean;
}

interface Slice { key: string; label: string; color: string; value: number }

export function BoardChartView({ boardId, viewId, viewConfig, initialItems, initialFields, statuses, canEdit }: BoardChartViewProps) {
  const fields = useMemo(() => initialFields ?? [], [initialFields]);
  const [chartType, setChartType] = useState<ChartType>(() => {
    const raw = viewConfig?.chartType;
    return raw === "pie" || raw === "line" || raw === "number" ? raw : "bar";
  });
  const [groupBy, setGroupBy] = useState<string>(() =>
    typeof viewConfig?.groupBy === "string" ? (viewConfig.groupBy as string) : "status",
  );
  const [metric, setMetric] = useState<string>(() =>
    typeof viewConfig?.metric === "string" ? (viewConfig.metric as string) : "count",
  );

  const persist = useCallback((patch: Record<string, unknown>) => {
    if (!viewId) return;
    void fetch(`/api/boards/${boardId}/views/${viewId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { ...(viewConfig ?? {}), chartType, groupBy, metric, ...patch } }),
    }).catch(() => {});
  }, [boardId, viewId, viewConfig, chartType, groupBy, metric]);

  // Group-by axes: built-ins + choice custom fields.
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

  // Metric: count or sum of any numeric field.
  const metricOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [{ key: "count", label: "Item count" }];
    for (const f of fields) {
      if (f.type === "NUMBER" || f.type === "MONEY" || f.type === "PERCENT") {
        opts.push({ key: `sum:${f.key}`, label: `Sum of ${f.label}` });
      }
    }
    return opts;
  }, [fields]);

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

  const slices = useMemo<Slice[]>(() => {
    const buckets = new Map<string, BoardItemRow[]>();
    const push = (k: string, row: BoardItemRow) => {
      const arr = buckets.get(k) ?? [];
      arr.push(row);
      buckets.set(k, arr);
    };
    for (const it of initialItems) {
      if (groupBy === "status") push(it.status ?? "__unset__", it);
      else if (groupBy === "owner") push(it.ownerId ?? "__unset__", it);
      else if (groupBy === "priority") push(it.priority ?? "__unset__", it);
      else {
        const raw = it.metadata?.[groupBy];
        if (Array.isArray(raw)) {
          if (raw.length === 0) push("__unset__", it);
          for (const v of raw) push(String(v), it);
        } else {
          push(raw == null || raw === "" ? "__unset__" : String(raw), it);
        }
      }
    }
    const out: Slice[] = [];
    const take = (key: string, label: string, color: string) => {
      const rows = buckets.get(key);
      if (!rows?.length) return;
      out.push({ key, label, color, value: measure(rows) });
      buckets.delete(key);
    };
    if (groupBy === "status") {
      for (const o of statuses) take(o.value, o.label, o.color);
    } else if (groupBy === "priority") {
      for (const o of PRIORITY_OPTIONS) take(o.value, o.label, o.color);
    } else if (groupBy === "owner") {
      const tuples = Array.from(buckets.entries())
        .filter(([k]) => k !== "__unset__")
        .map(([k, rows]) => {
          const owner = rows[0]?.owner;
          const label = owner ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || "Unknown" : "Unknown";
          return { k, label, rows };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
      tuples.forEach((t, i) => {
        out.push({ key: t.k, label: t.label, color: FALLBACK_COLORS[i % FALLBACK_COLORS.length], value: measure(t.rows) });
        buckets.delete(t.k);
      });
    } else {
      const field = fields.find((f) => f.key === groupBy);
      const choices = field?.options?.choices ?? [];
      choices.forEach((c, i) => take(c.value, c.label, c.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]));
      const leftover = Array.from(buckets.entries()).filter(([k]) => k !== "__unset__");
      leftover.sort((a, b) => a[0].localeCompare(b[0]));
      leftover.forEach(([k, rows], i) => {
        out.push({ key: k, label: k, color: FALLBACK_COLORS[(choices.length + i) % FALLBACK_COLORS.length], value: measure(rows) });
        buckets.delete(k);
      });
    }
    const unset = buckets.get("__unset__");
    if (unset?.length) out.push({ key: "__unset__", label: "Unset", color: "#A1A1AA", value: measure(unset) });
    return out;
  }, [initialItems, groupBy, statuses, fields, measure]);

  // Line mode: items created per ISO week (last 12 weeks).
  const lineData = useMemo(() => {
    const weeks: { label: string; start: Date; value: number }[] = [];
    const now = new Date();
    const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    sunday.setDate(sunday.getDate() - sunday.getDay());
    for (let i = 11; i >= 0; i--) {
      const start = new Date(sunday);
      start.setDate(start.getDate() - i * 7);
      weeks.push({
        label: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        start,
        value: 0,
      });
    }
    for (const it of initialItems) {
      const created = new Date(it.createdAt);
      for (let w = weeks.length - 1; w >= 0; w--) {
        if (created >= weeks[w].start) {
          weeks[w].value += 1;
          break;
        }
      }
    }
    return weeks.map((w) => ({ label: w.label, value: w.value }));
  }, [initialItems]);

  const total = useMemo(() => slices.reduce((a, s) => a + s.value, 0), [slices]);
  const metricLabel = metricOptions.find((m) => m.key === metric)?.label ?? "Item count";
  const axisLabel = axisOptions.find((a) => a.key === groupBy)?.label ?? "Status";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
        <Select
          value={chartType}
          disabled={!canEdit}
          onChange={(v) => { setChartType(v as ChartType); persist({ chartType: v }); }}
          options={[
            { key: "bar", label: "Bar" },
            { key: "pie", label: "Pie" },
            { key: "line", label: "Line · created/week" },
            { key: "number", label: "Number" },
          ]}
        />
        {chartType !== "line" ? (
          <>
            <Select
              value={groupBy}
              disabled={!canEdit}
              onChange={(v) => { setGroupBy(v); persist({ groupBy: v }); }}
              options={axisOptions}
            />
            <Select
              value={metric}
              disabled={!canEdit}
              onChange={(v) => { setMetric(v); persist({ metric: v }); }}
              options={metricOptions}
            />
          </>
        ) : null}
        <span className="ml-auto text-[11px] text-zinc-400">
          {initialItems.length} item{initialItems.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="p-4">
        {initialItems.length === 0 ? (
          <div className="py-16 text-center text-sm text-zinc-500">No items to chart yet.</div>
        ) : chartType === "number" ? (
          <div className="py-10 text-center">
            <div className="text-[42px] font-semibold tabular-nums text-zinc-900 leading-none">
              {Number.isInteger(total) ? total : total.toFixed(2)}
            </div>
            <div className="mt-2 text-[12.5px] text-zinc-500">{metricLabel} · all items</div>
            <div className="mt-6 mx-auto flex h-3 w-full max-w-md rounded-sm overflow-hidden ring-1 ring-black/5">
              {slices.map((s) => (
                <span key={s.key} style={{ width: `${total ? (s.value / total) * 100 : 0}%`, background: s.color }} title={`${s.label}: ${s.value}`} aria-hidden />
              ))}
            </div>
            <div className="mt-3 flex items-center justify-center gap-3 flex-wrap text-[11px] text-zinc-500">
              {slices.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                  {s.label} · {Number.isInteger(s.value) ? s.value : s.value.toFixed(2)}
                </span>
              ))}
            </div>
          </div>
        ) : chartType === "line" ? (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#a1a1aa" }} tickLine={false} axisLine={{ stroke: "#e4e4e7" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#a1a1aa" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e4e4e7" }} />
                <Line type="monotone" dataKey="value" name="Created" stroke="#6366F1" strokeWidth={2} dot={{ r: 2.5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : chartType === "pie" ? (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="45%"
                  outerRadius="80%"
                  paddingAngle={2}
                  label={({ name, value }) => `${name} (${value})`}
                  fontSize={11}
                >
                  {slices.map((s) => (
                    <Cell key={s.key} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e4e4e7" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={slices} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={{ stroke: "#e4e4e7" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#a1a1aa" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e4e4e7" }} cursor={{ fill: "#fafafa" }} />
                <Bar dataKey="value" name={metricLabel} radius={[4, 4, 0, 0]}>
                  {slices.map((s) => (
                    <Cell key={s.key} fill={s.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {chartType === "bar" || chartType === "pie" ? (
          <p className="mt-1 text-center text-[11px] text-zinc-400">
            {metricLabel} by {axisLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Select({
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
