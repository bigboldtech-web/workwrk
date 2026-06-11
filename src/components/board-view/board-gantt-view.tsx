"use client";

// BoardGanttView — per-board GANTT renderer. 12-week horizontal window
// with greedy lane packing (adapted from the Space-level Gantt, minus
// the per-board swimlane grouping since this is a single board).
// Items with startAt + dueAt render as duration bars; a single date
// renders a one-day marker. Items without any date are listed in a
// footer note. Window nav is local state; clicking a bar opens the
// drawer.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DEFAULT_STATUS_OPTIONS, type BoardItemRow } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";

const STATUS_LOOKUP: Record<string, { label: string; color: string }> = Object.fromEntries(
  DEFAULT_STATUS_OPTIONS.map((o) => [o.value, { label: o.label, color: o.color }]),
);

const WEEK_COUNT = 12;
const MS_PER_DAY = 86_400_000;

interface BoardGanttViewProps {
  initialItems: BoardItemRow[];
  initialFields?: FieldDef[];
  onOpenItem?: (itemId: string) => void;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x;
}

export function BoardGanttView({ initialItems, initialFields, onOpenItem }: BoardGanttViewProps) {
  const today = new Date();
  // Window anchor — start 2 weeks back from this week so "now" sits
  // about a sixth into the chart, with most space for what's ahead.
  const defaultAnchor = useMemo(() => {
    const w = startOfWeek(today);
    w.setDate(w.getDate() - 14);
    return w;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [anchor, setAnchor] = useState<Date>(defaultAnchor);

  const dateFieldKey = useMemo(
    () => (initialFields ?? []).find((f) => f.type === "DATE" || f.type === "DATETIME")?.key ?? null,
    [initialFields],
  );

  // Resolve each item to a [start, end] span (end inclusive).
  const { spans, undated } = useMemo(() => {
    const out: Array<{ item: BoardItemRow; start: Date; end: Date }> = [];
    let skipped = 0;
    for (const it of initialItems) {
      if (it.archivedAt) continue;
      const due = it.dueAt ? new Date(it.dueAt) : null;
      const start = it.startAt ? new Date(it.startAt) : null;
      let s = start && !Number.isNaN(start.getTime()) ? start : null;
      let e = due && !Number.isNaN(due.getTime()) ? due : null;
      if (!s && !e && dateFieldKey) {
        const raw = it.metadata?.[dateFieldKey];
        if (typeof raw === "string" && raw) {
          const d = new Date(raw);
          if (!Number.isNaN(d.getTime())) e = d;
        }
      }
      if (!s && !e) { skipped += 1; continue; }
      if (!s) s = e!;
      if (!e) e = s;
      if (e.getTime() < s.getTime()) [s, e] = [e, s];
      out.push({ item: it, start: s, end: e });
    }
    return { spans: out, undated: skipped };
  }, [initialItems, dateFieldKey]);

  const totalDays = WEEK_COUNT * 7;
  const windowEnd = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + totalDays);

  // Bars inside the window + greedy first-fit lane packing.
  const { bars, laneCount } = useMemo(() => {
    const visible = spans
      .filter(({ start, end }) => end.getTime() >= anchor.getTime() && start.getTime() < windowEnd.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const lanes: number[] = []; // value = lastEndCol (exclusive)
    const packed = visible.map(({ item, start, end }) => {
      const startDay = Math.max(0, Math.floor((start.getTime() - anchor.getTime()) / MS_PER_DAY));
      const endDay = Math.min(totalDays - 1, Math.floor((end.getTime() - anchor.getTime()) / MS_PER_DAY));
      const startCol = startDay;
      const spanCols = Math.max(1, endDay - startDay + 1);
      let lane = lanes.findIndex((endIdx) => endIdx <= startCol);
      if (lane === -1) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = startCol + spanCols;
      return { item, start, end, startCol, spanCols, lane };
    });
    return { bars: packed, laneCount: Math.max(1, lanes.length) };
  }, [spans, anchor, windowEnd, totalDays]);

  const weeks = Array.from({ length: WEEK_COUNT }, (_, i) =>
    new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i * 7),
  );
  const rangeLabel = `${anchor.toLocaleString("default", { month: "short", day: "numeric" })} — ${
    new Date(windowEnd.getTime() - MS_PER_DAY).toLocaleString("default", { month: "short", day: "numeric", year: "numeric" })
  }`;
  const isCurrentWindow = anchor.getTime() === defaultAnchor.getTime();
  const todayOffsetDays = (startOfWeek(today).getTime() - anchor.getTime()) / MS_PER_DAY + today.getDay();
  const showTodayLine = todayOffsetDays >= 0 && todayOffsetDays < totalDays;
  const chartHeight = laneCount * 26 + 16;

  const shift = (weeksDelta: number) =>
    setAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + weeksDelta * 7));

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <div className="inline-flex items-center rounded-md border border-zinc-200 bg-white">
          <button
            type="button"
            onClick={() => shift(-4)}
            className="inline-flex items-center justify-center h-7 w-7 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 rounded-l-md"
            aria-label="Earlier"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => shift(4)}
            className="inline-flex items-center justify-center h-7 w-7 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 border-l border-zinc-200"
            aria-label="Later"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={isCurrentWindow}
            onClick={() => setAnchor(defaultAnchor)}
            className={`h-7 px-2.5 text-[11px] font-medium border-l border-zinc-200 inline-flex items-center rounded-r-md ${
              isCurrentWindow ? "text-zinc-400 cursor-default" : "text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            Today
          </button>
        </div>
        <h2 className="text-[13px] font-semibold text-zinc-900">{rangeLabel}</h2>
        <div className="flex-1" />
        <span className="text-[10.5px] text-zinc-400 hidden sm:inline">
          Start + Due dates render as duration bars · single dates show as one-day markers
        </span>
      </div>

      {bars.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
          <div className="text-sm font-medium text-zinc-900 mb-1">Nothing on the timeline in this window</div>
          <p className="text-xs text-zinc-500">
            Set Start / Due dates on items (drawer or table) to plot them here.
            {undated > 0 ? ` ${undated} item${undated === 1 ? " has" : "s have"} no dates yet.` : ""}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-x-auto">
          <div className="min-w-[860px]">
            {/* Week header */}
            <div className="grid border-b border-zinc-200 bg-zinc-50" style={{ gridTemplateColumns: `repeat(${WEEK_COUNT}, minmax(72px, 1fr))` }}>
              {weeks.map((w, i) => {
                const isThisWeek = startOfWeek(today).getTime() === w.getTime();
                return (
                  <div
                    key={i}
                    className={`border-l first:border-l-0 border-zinc-100 px-2 py-2 text-[10.5px] font-medium ${
                      isThisWeek ? "text-zinc-900" : "text-zinc-500"
                    }`}
                  >
                    {w.toLocaleString("default", { month: "short", day: "numeric" })}
                  </div>
                );
              })}
            </div>
            {/* Lanes */}
            <div className="relative" style={{ height: chartHeight }}>
              {Array.from({ length: WEEK_COUNT - 1 }, (_, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="absolute top-0 bottom-0 w-px bg-zinc-100"
                  style={{ left: `${((i + 1) / WEEK_COUNT) * 100}%` }}
                />
              ))}
              {showTodayLine ? (
                <span
                  aria-hidden
                  className="absolute top-0 bottom-0 w-px bg-red-400"
                  style={{ left: `${(todayOffsetDays / totalDays) * 100}%` }}
                />
              ) : null}
              {bars.map(({ item, start, end, startCol, spanCols, lane }) => {
                const leftPct = (startCol / totalDays) * 100;
                const widthPct = (spanCols / totalDays) * 100;
                const color = (item.status ? STATUS_LOOKUP[item.status]?.color : null) ?? "#94a3b8";
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenItem?.(item.id)}
                    title={`${item.title} — ${start.toLocaleDateString()}${
                      start.getTime() !== end.getTime() ? ` → ${end.toLocaleDateString()}` : ""
                    }`}
                    className="absolute px-2 py-1 rounded text-[10.5px] font-medium text-white truncate hover:opacity-90 leading-tight text-left"
                    style={{
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      top: 8 + lane * 26,
                      backgroundColor: color,
                    }}
                  >
                    {item.title}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {bars.length > 0 && undated > 0 ? (
        <p className="mt-2 text-[10.5px] text-zinc-400">
          {undated} item{undated === 1 ? "" : "s"} without dates {undated === 1 ? "is" : "are"} not shown — set Start / Due in the drawer.
        </p>
      ) : null}
    </section>
  );
}
