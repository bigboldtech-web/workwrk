"use client";

// ChartWidget — pie or bar of the source's items grouped by
// config.chartBy (status / assignee / priority). Rendering reuses the
// recharts approach from board-chart-view (same lib, no new deps).
// Colors match the rest of the app: STATUS_LOOKUP status colors,
// PRIORITY_OPTIONS flag colors, and the per-person djb2 hue that
// PersonAvatar uses, so a person's slice matches their avatar.
// Dark mode: axis ticks/grid use currentColor off a zinc wrapper the
// dark catchalls repaint; the recharts tooltip + pie-slice stroke get
// dark overrides in os.css (".recharts-default-tooltip" block).

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { PRIORITY_OPTIONS } from "@/lib/board-items-shared";
import type { ChartBy, ChartKind, DashWidget } from "../widget-types";
import { buildStatusSegs, UNKNOWN_STATUS_COLOR } from "./battery-widget";
import { useWidgetItems, type WidgetItem } from "./use-widget-items";

interface Slice { key: string; label: string; color: string; value: number }

const CHART_BYS: Array<{ value: ChartBy; label: string }> = [
  { value: "status",   label: "By status" },
  { value: "assignee", label: "By assignee" },
  { value: "priority", label: "By priority" },
];

const CHART_KINDS: Array<{ value: ChartKind; label: string }> = [
  { value: "pie", label: "Pie" },
  { value: "bar", label: "Bar" },
];

const LEGEND_CAP = 8;

// Stable per-person hue (djb2) — same formula as PersonAvatar /
// OwnerBadge so chart slices match avatar colors. Mid-tone (55% 55%)
// reads on both light and dark.
function hueFor(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  return `hsl(${Math.abs(h) % 360} 55% 55%)`;
}

function buildSlices(items: WidgetItem[], by: ChartBy): Slice[] {
  if (by === "status") {
    return buildStatusSegs(items).map((s) => ({ key: s.key, label: s.label, color: s.color, value: s.count }));
  }
  if (by === "priority") {
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.priority ?? "__unset__", (counts.get(it.priority ?? "__unset__") ?? 0) + 1);
    const out: Slice[] = [];
    for (const p of PRIORITY_OPTIONS) {
      const n = counts.get(p.value);
      if (n) out.push({ key: p.value, label: p.label, color: p.color, value: n });
    }
    const unset = counts.get("__unset__");
    if (unset) out.push({ key: "__unset__", label: "No priority", color: UNKNOWN_STATUS_COLOR, value: unset });
    return out;
  }
  // assignee
  const byOwner = new Map<string, { owner: NonNullable<WidgetItem["owner"]>; n: number }>();
  let unassigned = 0;
  for (const it of items) {
    if (!it.owner) { unassigned += 1; continue; }
    const entry = byOwner.get(it.owner.id) ?? { owner: it.owner, n: 0 };
    entry.n += 1;
    byOwner.set(it.owner.id, entry);
  }
  const out: Slice[] = Array.from(byOwner.values())
    .map(({ owner, n }) => ({
      key: owner.id,
      label: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || "Unknown",
      color: hueFor(owner.id),
      value: n,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (unassigned) out.push({ key: "__unset__", label: "Unassigned", color: UNKNOWN_STATUS_COLOR, value: unassigned });
  return out;
}

// Light tooltip chrome (matches board-chart-view); dark repaint comes
// from the os.css ".recharts-default-tooltip" override.
const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #e4e4e7",
} as const;

export function ChartWidget({
  widget,
  editMode,
  onConfigChange,
}: {
  widget: DashWidget;
  editMode: boolean;
  onConfigChange: (patch: Partial<DashWidget["config"]>) => void;
}) {
  const { items, loading, error } = useWidgetItems(widget.config.source);
  const chartBy = widget.config.chartBy ?? "status";
  const chartKind = widget.config.chartKind ?? "pie";
  const list = useMemo(() => items ?? [], [items]);
  const slices = useMemo(() => buildSlices(list, chartBy), [list, chartBy]);

  const body = loading ? (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />
    </div>
  ) : error ? (
    <div className="flex min-h-0 flex-1 items-center justify-center text-[12px] text-zinc-400">
      Couldn&apos;t load tasks
    </div>
  ) : slices.length === 0 ? (
    <div className="flex min-h-0 flex-1 items-center justify-center text-[12px] text-zinc-400">
      No tasks here yet
    </div>
  ) : chartKind === "bar" ? (
    // currentColor ticks/grid inherit the wrapper's zinc, which the dark
    // catchalls repaint — the chart stays readable on both themes.
    <div className="min-h-0 flex-1 text-zinc-400">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={slices} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.12} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "currentColor", fillOpacity: 0.06 }} />
          <Bar dataKey="value" name="Tasks" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {slices.map((s) => (
              <Cell key={s.key} fill={s.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  ) : (
    <>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* No mount animation: grid cards resize while hydrating, which
                can abort recharts' pie animation and leave zero sectors. */}
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius="48%" outerRadius="88%" paddingAngle={2} isAnimationActive={false}>
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-1 text-[11px] text-zinc-500">
        {slices.slice(0, LEGEND_CAP).map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label} · {s.value}
          </span>
        ))}
        {slices.length > LEGEND_CAP ? <span className="text-zinc-400">+{slices.length - LEGEND_CAP} more</span> : null}
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-[120px] flex-col">
      {editMode ? (
        <div className="mb-1.5 flex shrink-0 items-center gap-1.5">
          <select
            value={chartBy}
            onChange={(e) => onConfigChange({ chartBy: e.target.value as ChartBy })}
            aria-label="Group by"
            className="h-6 rounded-md border border-zinc-200 bg-white px-1.5 text-[11.5px] text-zinc-600 outline-none focus:border-zinc-300"
          >
            {CHART_BYS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={chartKind}
            onChange={(e) => onConfigChange({ chartKind: e.target.value as ChartKind })}
            aria-label="Chart type"
            className="h-6 rounded-md border border-zinc-200 bg-white px-1.5 text-[11.5px] text-zinc-600 outline-none focus:border-zinc-300"
          >
            {CHART_KINDS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      ) : null}
      {body}
    </div>
  );
}
