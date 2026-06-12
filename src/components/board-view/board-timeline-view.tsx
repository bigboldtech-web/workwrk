"use client";

// BoardTimelineView — TIMELINE renderer. The lighter sibling of Gantt:
// a read-only 12-week horizontal strip with one swimlane per status
// (board order), bars spanning startAt→dueAt. Items without any date
// collect in an "Unscheduled" list below the strip. For drag/resize
// editing, use the Gantt view — this one is for reading the plan.

import { useMemo } from "react";
import { CalendarRange } from "lucide-react";
import {
  type BoardItemRow,
  type StatusOption,
} from "@/lib/board-items-shared";

const WEEK_COUNT = 12;
const MS_PER_DAY = 86_400_000;

interface BoardTimelineViewProps {
  initialItems: BoardItemRow[];
  statuses: StatusOption[];
  onOpenItem?: (itemId: string) => void;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function BoardTimelineView({ initialItems, statuses, onOpenItem }: BoardTimelineViewProps) {
  // Window: 2 weeks back from this week's Sunday, 10 forward.
  const windowStart = useMemo(() => {
    const s = startOfWeek(new Date());
    s.setDate(s.getDate() - 14);
    return s;
  }, []);
  const totalDays = WEEK_COUNT * 7;
  const windowEnd = useMemo(
    () => new Date(windowStart.getTime() + totalDays * MS_PER_DAY),
    [windowStart, totalDays],
  );

  const weeks = useMemo(() => {
    const out: { label: string; isCurrent: boolean }[] = [];
    const todayStart = startOfWeek(new Date()).getTime();
    for (let w = 0; w < WEEK_COUNT; w++) {
      const start = new Date(windowStart.getTime() + w * 7 * MS_PER_DAY);
      out.push({
        label: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        isCurrent: start.getTime() === todayStart,
      });
    }
    return out;
  }, [windowStart]);

  // Lanes: one per board status (order preserved) + Unset; only lanes
  // with scheduled items render. Items render where their date span
  // intersects the window.
  const { lanes, unscheduled } = useMemo(() => {
    type Placed = { item: BoardItemRow; startCol: number; spanCols: number };
    const byStatus = new Map<string, Placed[]>();
    const noDate: BoardItemRow[] = [];
    for (const it of initialItems) {
      const due = toDate(it.dueAt);
      const start = toDate(it.startAt) ?? due;
      if (!start || !due) {
        noDate.push(it);
        continue;
      }
      const from = start < due ? start : due;
      const to = due > start ? due : start;
      if (to < windowStart || from > windowEnd) continue; // outside window
      const startCol = Math.max(0, Math.floor((from.getTime() - windowStart.getTime()) / MS_PER_DAY));
      const endCol = Math.min(totalDays - 1, Math.floor((to.getTime() - windowStart.getTime()) / MS_PER_DAY));
      const key = it.status ?? "__unset__";
      const arr = byStatus.get(key) ?? [];
      arr.push({ item: it, startCol, spanCols: Math.max(1, endCol - startCol + 1) });
      byStatus.set(key, arr);
    }
    const orderedLanes: { key: string; label: string; color: string; placed: Placed[] }[] = [];
    for (const o of statuses) {
      const placed = byStatus.get(o.value);
      if (placed?.length) {
        orderedLanes.push({ key: o.value, label: o.label, color: o.color, placed });
        byStatus.delete(o.value);
      }
    }
    for (const [k, placed] of byStatus) {
      orderedLanes.push({ key: k, label: k === "__unset__" ? "Unset" : k, color: "#A1A1AA", placed });
    }
    return { lanes: orderedLanes, unscheduled: noDate };
  }, [initialItems, statuses, windowStart, windowEnd, totalDays]);

  // Pack each lane's bars into sub-rows so overlapping spans stack.
  const packedLanes = useMemo(
    () =>
      lanes.map((lane) => {
        const rows: { item: BoardItemRow; startCol: number; spanCols: number; sub: number }[] = [];
        const subEnds: number[] = []; // last occupied col per sub-row
        const sorted = [...lane.placed].sort((a, b) => a.startCol - b.startCol);
        for (const p of sorted) {
          let sub = subEnds.findIndex((end) => end < p.startCol);
          if (sub === -1) {
            sub = subEnds.length;
            subEnds.push(p.startCol + p.spanCols - 1);
          } else {
            subEnds[sub] = p.startCol + p.spanCols - 1;
          }
          rows.push({ ...p, sub });
        }
        return { ...lane, rows, subCount: Math.max(1, subEnds.length) };
      }),
    [lanes],
  );

  if (initialItems.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
        <CalendarRange className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
        <p className="text-[12.5px] text-zinc-500">No items yet — schedule work with start/due dates to see the timeline.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          {/* Week header */}
          <div className="grid border-b border-zinc-200" style={{ gridTemplateColumns: `160px repeat(${WEEK_COUNT}, 1fr)` }}>
            <div className="px-3 py-2 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Status</div>
            {weeks.map((w, i) => (
              <div
                key={i}
                className={`px-1.5 py-2 text-[10.5px] tabular-nums border-l border-zinc-100 ${
                  w.isCurrent ? "bg-violet-50/50 font-semibold text-violet-700" : "text-zinc-400"
                }`}
              >
                {w.label}
              </div>
            ))}
          </div>

          {packedLanes.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12.5px] text-zinc-500">
              Nothing scheduled in this 12-week window.
            </div>
          ) : (
            packedLanes.map((lane) => (
              <div
                key={lane.key}
                className="grid border-b border-zinc-100 last:border-b-0"
                style={{ gridTemplateColumns: `160px 1fr` }}
              >
                <div className="px-3 py-2 flex items-start">
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium mt-0.5"
                    style={{ background: `${lane.color}22`, color: lane.color }}
                  >
                    {lane.label}
                  </span>
                </div>
                <div className="relative border-l border-zinc-100" style={{ height: 10 + lane.subCount * 26 }}>
                  {/* Week gridlines */}
                  {weeks.map((_, i) =>
                    i > 0 ? (
                      <span
                        key={i}
                        className="absolute top-0 bottom-0 w-px bg-zinc-100"
                        style={{ left: `${(i / WEEK_COUNT) * 100}%` }}
                        aria-hidden
                      />
                    ) : null,
                  )}
                  {lane.rows.map((r) => (
                    <button
                      key={r.item.id}
                      type="button"
                      onClick={() => onOpenItem?.(r.item.id)}
                      className="absolute rounded text-left text-[10.5px] font-medium text-white px-1.5 truncate hover:brightness-95"
                      style={{
                        left: `calc(${(r.startCol / totalDays) * 100}% + 2px)`,
                        width: `calc(${(r.spanCols / totalDays) * 100}% - 4px)`,
                        top: 6 + r.sub * 26,
                        height: 20,
                        lineHeight: "20px",
                        background: lane.color,
                      }}
                      title={r.item.title}
                    >
                      {r.item.title}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {unscheduled.length > 0 ? (
        <div className="px-3 py-2 border-t border-zinc-100 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-zinc-400 uppercase tracking-wide font-medium">
            Unscheduled ({unscheduled.length})
          </span>
          {unscheduled.slice(0, 8).map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onOpenItem?.(it.id)}
              className="inline-flex items-center h-6 px-2 rounded-md border border-zinc-200 text-[11.5px] text-zinc-600 hover:bg-zinc-50 max-w-[200px] truncate"
              title={it.title}
            >
              {it.title}
            </button>
          ))}
          {unscheduled.length > 8 ? (
            <span className="text-[11px] text-zinc-400">+{unscheduled.length - 8} more</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
