"use client";

// BoardTimelineView: the TIMELINE renderer. The lighter sibling of Gantt:
// a read-only 12-week horizontal strip with one swimlane per status
// (board order), bars spanning startAt to dueAt. Items without any date
// collect in an "Unscheduled" list below the strip. For drag/resize
// editing, use the Gantt view; this one is for reading the plan.
//
// A bar narrower than about a week (every one-day personal task) cannot
// hold its title, so the title is printed beside the bar in ink instead of
// being clipped to one letter inside it. Colours and greys are tokens.

import { useMemo } from "react";
import { CalendarRange } from "lucide-react";
import {
  type BoardItemRow,
  type StatusOption,
} from "@/lib/board-items-shared";
import { ItemContextMenuHost, useItemContextMenu } from "./item-context-menu";

const WEEK_COUNT = 12;
const MS_PER_DAY = 86_400_000;
/** Bars narrower than this print their title beside the bar. */
const SPILL_COLS = 6;
/** Days of row a spilled title reserves (about 220px at the 860px minimum). */
const LABEL_COLS = 22;

interface BoardTimelineViewProps {
  boardId?: string;
  initialItems: BoardItemRow[];
  statuses: StatusOption[];
  canEdit?: boolean;
  onOpenItem?: (itemId: string) => void;
  /** Canvas sync after the context menu duplicates an item. */
  onItemCreated?: (item: BoardItemRow) => void;
  /** Canvas sync after the context menu archives/deletes an item. */
  onItemRemoved?: (id: string) => void;
  timeTrackingEnabled?: boolean;
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

export function BoardTimelineView({ boardId, initialItems, statuses, canEdit = false, onOpenItem, onItemCreated, onItemRemoved, timeTrackingEnabled }: BoardTimelineViewProps) {
  // Right-click on any bar / unscheduled chip opens the shared item menu.
  const menu = useItemContextMenu();
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
      orderedLanes.push({ key: k, label: k === "__unset__" ? "Unset" : k, color: "var(--os-ink-3)", placed });
    }
    return { lanes: orderedLanes, unscheduled: noDate };
  }, [initialItems, statuses, windowStart, windowEnd, totalDays]);

  // Pack each lane's bars into sub-rows so overlapping spans stack. A bar
  // that prints its title beside it (under SPILL_COLS wide) reserves
  // LABEL_COLS of the row for the label, so the next bar never lands on it.
  const packedLanes = useMemo(
    () =>
      lanes.map((lane) => {
        const rows: { item: BoardItemRow; startCol: number; spanCols: number; sub: number }[] = [];
        const subEnds: number[] = []; // last occupied col per sub-row
        const sorted = [...lane.placed].sort((a, b) => a.startCol - b.startCol);
        for (const p of sorted) {
          const occupied = p.spanCols < SPILL_COLS ? Math.max(p.spanCols, LABEL_COLS) : p.spanCols;
          let sub = subEnds.findIndex((end) => end < p.startCol);
          if (sub === -1) {
            sub = subEnds.length;
            subEnds.push(p.startCol + occupied - 1);
          } else {
            subEnds[sub] = p.startCol + occupied - 1;
          }
          rows.push({ ...p, sub });
        }
        return { ...lane, rows, subCount: Math.max(1, subEnds.length) };
      }),
    [lanes],
  );

  if (initialItems.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-raised px-8 py-14 text-center">
        <CalendarRange className="mx-auto mb-3 h-8 w-8 text-ink-4" strokeWidth={1.5} aria-hidden />
        <p className="text-base text-ink-2">No items yet. Schedule work with start and due dates to see the timeline.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised">
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          {/* Week header */}
          <div className="grid border-b border-line" style={{ gridTemplateColumns: `160px repeat(${WEEK_COUNT}, 1fr)` }}>
            <div className="px-3 py-2 text-micro uppercase tracking-[0.06em] text-ink-2">Status</div>
            {weeks.map((w, i) => (
              <div
                key={i}
                className={`border-s border-line-soft px-1.5 py-2 text-xs tabular-nums ${
                  w.isCurrent ? "bg-brand-soft font-medium text-brand-deep" : "text-ink-3"
                }`}
              >
                {w.label}
              </div>
            ))}
          </div>

          {packedLanes.length === 0 ? (
            <div className="px-4 py-10 text-center text-base text-ink-2">
              Nothing scheduled in this 12-week window.
            </div>
          ) : (
            packedLanes.map((lane) => (
              <div
                key={lane.key}
                className="grid border-b border-line-soft last:border-b-0"
                style={{ gridTemplateColumns: `160px 1fr` }}
              >
                <div className="flex items-start px-3 py-2">
                  <span
                    className="mt-0.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-ink"
                    style={{ background: `color-mix(in srgb, ${lane.color} 14%, var(--os-surface))` }}
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: lane.color }} aria-hidden />
                    {lane.label}
                  </span>
                </div>
                <div className="relative border-s border-line-soft" style={{ height: 10 + lane.subCount * 26 }}>
                  {/* Week gridlines */}
                  {weeks.map((_, i) =>
                    i > 0 ? (
                      <span
                        key={i}
                        className="absolute bottom-0 top-0 w-px bg-line-soft"
                        style={{ left: `${(i / WEEK_COUNT) * 100}%` }}
                        aria-hidden
                      />
                    ) : null,
                  )}
                  {lane.rows.map((r) => {
                    // Under ~6 days the bar is too narrow for a word at 1440,
                    // so the title sits beside it; the packer already gave
                    // short bars their own sub-row, so labels never overlap.
                    const spill = r.spanCols < SPILL_COLS;
                    return (
                      <div
                        key={r.item.id}
                        className="absolute flex items-center"
                        style={{
                          left: `calc(${(r.startCol / totalDays) * 100}% + 2px)`,
                          width: spill ? undefined : `calc(${(r.spanCols / totalDays) * 100}% - 4px)`,
                          top: 6 + r.sub * 26,
                          height: 20,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => onOpenItem?.(r.item.id)}
                          onContextMenu={(e) => menu.openItemMenu(e, r.item)}
                          className={`flex h-5 items-center rounded text-start text-xs font-medium hover:brightness-95 ${spill ? "gap-1.5 px-0" : "w-full truncate px-1.5 text-ink-inv"}`}
                          style={spill ? undefined : { background: lane.color }}
                          title={r.item.title}
                        >
                          {spill ? (
                            <>
                              <span
                                className="inline-block h-5 shrink-0 rounded"
                                style={{ width: `max(8px, calc(${(r.spanCols / totalDays) * 100}% - 4px))`, minWidth: 8, background: lane.color }}
                                aria-hidden
                              />
                              <span className="max-w-[220px] truncate text-ink">{r.item.title}</span>
                            </>
                          ) : (
                            r.item.title
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {unscheduled.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2">
          <span className="text-micro uppercase tracking-[0.06em] text-ink-2">
            Unscheduled ({unscheduled.length})
          </span>
          {unscheduled.slice(0, 8).map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onOpenItem?.(it.id)}
              onContextMenu={(e) => menu.openItemMenu(e, it)}
              className="inline-flex h-6 max-w-[200px] items-center overflow-hidden rounded-md border border-line px-2 text-xs text-ink-2 hover:bg-hover hover:text-ink"
              title={it.title}
            >
              <span className="truncate">{it.title}</span>
            </button>
          ))}
          {unscheduled.length > 8 ? (
            <span className="text-xs text-ink-3">+{unscheduled.length - 8} more</span>
          ) : null}
        </div>
      ) : null}
      <ItemContextMenuHost
        menu={menu}
        boardId={boardId}
        canEdit={canEdit}
        timeTrackingEnabled={timeTrackingEnabled}
        onOpenItem={onOpenItem}
        onItemCreated={onItemCreated}
        onItemRemoved={onItemRemoved}
      />
    </div>
  );
}
