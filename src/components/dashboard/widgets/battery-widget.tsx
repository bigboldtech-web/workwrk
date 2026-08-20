"use client";

// BatteryWidget — "Workload by Status": one horizontal stacked bar with a
// segment per status (colors from STATUS_LOOKUP; unknown statuses gray)
// and legend rows underneath (dot, label, count, %). The presentational
// bar+legend is exported as StatusDistribution so BoardDashboardView's
// breakdown cards render the exact same chrome.

import { Loader2 } from "lucide-react";
import { DEFAULT_STATUS_OPTIONS } from "@/lib/board-items-shared";
import type { DashWidget } from "../widget-types";
import { useWidgetItems, type WidgetItem } from "./use-widget-items";

/** Gray for statuses outside the known set and for unset status. */
export const UNKNOWN_STATUS_COLOR = "#A1A1AA";

export interface StatusSeg {
  key: string;
  label: string;
  color: string;
  count: number;
}

/** Items → ordered status segments: known statuses first (canonical
 *  order), then unknown/custom statuses (gray, alphabetical), then a
 *  trailing "No status" bucket. Empty buckets drop. */
export function buildStatusSegs(items: WidgetItem[]): StatusSeg[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const key = it.status ?? "__unset__";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const segs: StatusSeg[] = [];
  for (const o of DEFAULT_STATUS_OPTIONS) {
    const n = counts.get(o.value);
    if (n) {
      segs.push({ key: o.value, label: o.label, color: o.color, count: n });
      counts.delete(o.value);
    }
  }
  const unknown = Array.from(counts.entries())
    .filter(([k]) => k !== "__unset__")
    .sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, n] of unknown) {
    segs.push({ key: k, label: k, color: UNKNOWN_STATUS_COLOR, count: n });
  }
  const unset = counts.get("__unset__");
  if (unset) segs.push({ key: "__unset__", label: "No status", color: UNKNOWN_STATUS_COLOR, count: unset });
  return segs;
}

/** Stacked bar + legend rows. Zinc text utilities repaint via the dark
 *  catchalls; segment colors are mid-tone and read on both themes. */
export function StatusDistribution({ segs, total }: { segs: StatusSeg[]; total: number }) {
  if (segs.length === 0 || total === 0) return null;
  return (
    <div>
      <div className="mb-3 flex h-3 w-full overflow-hidden rounded-sm ring-1 ring-black/5">
        {segs.map((s) => (
          <span
            key={s.key}
            style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.count}`}
            aria-hidden
          />
        ))}
      </div>
      <ul className="space-y-1.5">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-[13px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-zinc-600">{s.label}</span>
            <span className="tabular-nums text-zinc-700">{s.count}</span>
            <span className="w-10 shrink-0 text-right tabular-nums text-zinc-400">
              {Math.round((s.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BatteryWidget({ widget }: { widget: DashWidget }) {
  const { items, loading, error } = useWidgetItems(widget.config.source);

  if (loading) {
    return (
      <div className="flex h-full min-h-[72px] items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full min-h-[72px] items-center justify-center text-[13px] text-zinc-400">
        Couldn&apos;t load tasks
      </div>
    );
  }
  const list = items ?? [];
  const segs = buildStatusSegs(list);
  if (list.length === 0 || segs.length === 0) {
    return (
      <div className="flex h-full min-h-[72px] items-center justify-center text-[13px] text-zinc-400">
        No tasks here yet
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto pt-1">
      <StatusDistribution segs={segs} total={list.length} />
    </div>
  );
}
