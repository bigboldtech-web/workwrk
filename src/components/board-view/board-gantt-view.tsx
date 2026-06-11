"use client";

// BoardGanttView — per-board GANTT renderer. 12-week horizontal window
// with greedy lane packing (adapted from the Space-level Gantt, minus
// the per-board swimlane grouping since this is a single board).
// Items with startAt + dueAt render as duration bars; a single date
// renders a one-day marker. Items without any date are listed in a
// footer note. Window nav is local state; clicking a bar opens the
// drawer.
//
// Editing: bars are pointer-draggable. Dragging the body shifts both
// startAt + dueAt by whole days; the left/right edge handles resize
// start or due independently (one-day minimum). A live preview tracks
// the cursor; release PATCHes the changed dates and syncs the canvas
// via onItemChanged. Pointer events (not HTML5 DnD) so resize handles
// and sub-bar precision work cleanly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { STATUS_LOOKUP, type BoardItemRow } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";

const WEEK_COUNT = 12;
const MS_PER_DAY = 86_400_000;

type DragMode = "move" | "resize-start" | "resize-end";
interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  dayDelta: number;
}

interface BoardGanttViewProps {
  initialItems: BoardItemRow[];
  initialFields?: FieldDef[];
  canEdit?: boolean;
  onOpenItem?: (itemId: string) => void;
  /** Called after a drag/resize PATCH succeeds so the canvas syncs
   *  shared item state (same contract as the drawer + calendar). */
  onItemChanged?: (item: BoardItemRow) => void;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x;
}

// Add whole days to a date and format as midnight-UTC ISO — matches the
// drawer DateField + calendar reschedule so a bar lands on the calendar
// day the cursor pointed at, regardless of timezone.
function shiftToIso(d: Date, deltaDays: number): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + deltaDays);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T00:00:00.000Z`;
}

export function BoardGanttView({ initialItems, initialFields, canEdit = false, onOpenItem, onItemChanged }: BoardGanttViewProps) {
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
  const [error, setError] = useState<string | null>(null);

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

  // Lookup updated every render so the (mount-stable) pointer-up handler
  // can resolve the dragging item's real dates without stale closures.
  const spanByIdRef = useRef(new Map<string, { item: BoardItemRow; start: Date; end: Date }>());
  spanByIdRef.current = new Map(spans.map((s) => [s.item.id, s]));

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

  // ── Drag / resize ────────────────────────────────────────────────
  const lanesRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const justDraggedRef = useRef(false);

  const dayWidth = useCallback(() => {
    const w = lanesRef.current?.getBoundingClientRect().width ?? 0;
    return w > 0 ? w / totalDays : 0;
  }, [totalDays]);

  const commitDrag = useCallback(async (state: DragState) => {
    const span = spanByIdRef.current.get(state.id);
    if (!span || state.dayDelta === 0) return;
    const { item, start, end } = span;

    // Clamp so a resize can't invert the bar (min one-day span).
    const spanDays = Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() -
      new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) / MS_PER_DAY);
    let delta = state.dayDelta;
    const patch: { startAt?: string; dueAt?: string } = {};
    const hasStart = !!item.startAt;
    const hasDue = !!item.dueAt;

    if (state.mode === "move") {
      if (hasStart) patch.startAt = shiftToIso(start, delta);
      if (hasDue) patch.dueAt = shiftToIso(end, delta);
      if (!hasStart && !hasDue) patch.dueAt = shiftToIso(end, delta); // metadata-only date → write dueAt
    } else if (state.mode === "resize-start") {
      if (delta > spanDays) delta = spanDays; // keep start ≤ end
      patch.startAt = shiftToIso(start, delta);
    } else {
      if (delta < -spanDays) delta = -spanDays; // keep end ≥ start
      patch.dueAt = shiftToIso(end, delta);
    }
    if (Object.keys(patch).length === 0) return;

    setError(null);
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to reschedule");
        return;
      }
      onItemChanged?.(data.item as BoardItemRow);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reschedule");
    }
  }, [onItemChanged]);

  // Mount-stable window listeners drive the drag; they read dragRef so
  // there are no stale-closure issues.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const dw = dayWidth();
      if (dw <= 0) return;
      const delta = Math.round((e.clientX - cur.startX) / dw);
      if (delta !== cur.dayDelta) {
        const next = { ...cur, dayDelta: delta };
        dragRef.current = next;
        setDrag(next);
      }
    };
    const onUp = () => {
      const cur = dragRef.current;
      if (!cur) return;
      dragRef.current = null;
      setDrag(null);
      if (cur.dayDelta !== 0) {
        justDraggedRef.current = true; // suppress the click that follows
        void commitDrag(cur);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dayWidth, commitDrag]);

  const beginDrag = (e: React.PointerEvent, id: string, mode: DragMode) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const state: DragState = { id, mode, startX: e.clientX, dayDelta: 0 };
    dragRef.current = state;
    setDrag(state);
  };

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
      {error ? (
        <div className="mb-2 px-4 py-2 text-xs text-red-500 bg-red-500/10 rounded-md flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900"><X className="w-3 h-3" /></button>
        </div>
      ) : null}

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
          {canEdit ? "Drag a bar to move it · drag an edge to resize" : "Start + Due dates render as duration bars"}
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
            <div ref={lanesRef} className="relative" style={{ height: chartHeight }}>
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
                // Live preview while dragging this bar.
                let dispStartCol = startCol;
                let dispSpan = spanCols;
                const d = drag && drag.id === item.id ? drag : null;
                if (d) {
                  if (d.mode === "move") dispStartCol = startCol + d.dayDelta;
                  else if (d.mode === "resize-start") { dispStartCol = startCol + d.dayDelta; dispSpan = spanCols - d.dayDelta; }
                  else dispSpan = spanCols + d.dayDelta;
                  if (dispSpan < 1) {
                    if (d.mode === "resize-start") dispStartCol = startCol + spanCols - 1;
                    dispSpan = 1;
                  }
                }
                const leftPct = (dispStartCol / totalDays) * 100;
                const widthPct = (dispSpan / totalDays) * 100;
                const color = (item.status ? STATUS_LOOKUP[item.status]?.color : null) ?? "#94a3b8";
                return (
                  <div
                    key={item.id}
                    className={`absolute ${d ? "opacity-90 ring-2 ring-[var(--os-brand)] rounded" : ""}`}
                    style={{
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      top: 8 + lane * 26,
                      height: 22,
                    }}
                  >
                    {canEdit ? (
                      <div
                        onPointerDown={(e) => beginDrag(e, item.id, "resize-start")}
                        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 rounded-l"
                        aria-hidden
                      />
                    ) : null}
                    <button
                      type="button"
                      onPointerDown={(e) => beginDrag(e, item.id, "move")}
                      onClick={() => {
                        if (justDraggedRef.current) { justDraggedRef.current = false; return; }
                        onOpenItem?.(item.id);
                      }}
                      title={`${item.title} — ${start.toLocaleDateString()}${
                        start.getTime() !== end.getTime() ? ` → ${end.toLocaleDateString()}` : ""
                      }`}
                      className={`w-full h-full px-2 rounded text-[10.5px] font-medium text-white truncate hover:opacity-90 leading-[22px] text-left ${
                        canEdit ? "cursor-grab active:cursor-grabbing" : ""
                      }`}
                      style={{ backgroundColor: color }}
                    >
                      {item.title}
                    </button>
                    {canEdit ? (
                      <div
                        onPointerDown={(e) => beginDrag(e, item.id, "resize-end")}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 rounded-r"
                        aria-hidden
                      />
                    ) : null}
                  </div>
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
