"use client";

// BoardGanttView — per-board GANTT renderer, ClickUp-style.
//
// Layout: a sticky left Name column lists EVERY task (one row each), and a
// right 12-week timeline shows each task on its own lane. Tasks with dates
// render as duration bars; tasks with NO date render as a small "schedule"
// marker parked on today's column so the board is never an empty timeline
// (ClickUp parity — you add tasks in List, they show here immediately and you
// drag/click to schedule them). A bottom "+ Add Task" row appends new tasks.
//
// Editing: bars are pointer-draggable — dragging the body shifts start+due by
// whole days; the left/right edges resize independently (one-day minimum). A
// live preview tracks the cursor; release PATCHes the dates and syncs via
// onItemChanged. Undated markers open a date picker (or drag) to set dueAt.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { makeStatusLookup, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { StatusGlyph } from "./status-glyph";

const WEEK_COUNT = 12;
const MS_PER_DAY = 86_400_000;
const ROW_H = 34;      // per-task lane height (matches the left name rows)
const HEAD_H = 34;     // week-header / name-header height
const NAME_W = 240;    // left Name column width

type DragMode = "move" | "resize-start" | "resize-end";
interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  dayDelta: number;
}

interface BoardGanttViewProps {
  /** Needed to append new tasks from the bottom "+ Add Task" row. */
  boardId?: string;
  /** Active view + config — persists which date field feeds undated tasks. */
  viewId?: string | null;
  viewConfig?: Record<string, unknown>;
  initialItems: BoardItemRow[];
  initialFields?: FieldDef[];
  /** Per-List statuses (backbone #1) — drives the bar colors + status glyph. */
  statuses: StatusOption[];
  canEdit?: boolean;
  onOpenItem?: (itemId: string) => void;
  /** Called after a drag/resize/schedule PATCH succeeds so the canvas syncs
   *  shared item state (same contract as the drawer + calendar). */
  onItemChanged?: (item: BoardItemRow) => void;
  /** Called after the bottom add-row creates a task so the canvas appends it. */
  onItemCreated?: (item: BoardItemRow) => void;
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

export function BoardGanttView({
  boardId,
  viewId,
  viewConfig,
  initialItems,
  initialFields,
  statuses,
  canEdit = false,
  onOpenItem,
  onItemChanged,
  onItemCreated,
}: BoardGanttViewProps) {
  const statusLookup = useMemo(() => makeStatusLookup(statuses), [statuses]);
  const firstStatus = statuses[0]?.value ?? "TO_DO";
  const today = new Date();
  // Window anchor — start 2 weeks back from this week so "now" sits about a
  // sixth into the chart, with most space for what's ahead.
  const defaultAnchor = useMemo(() => {
    const w = startOfWeek(today);
    w.setDate(w.getDate() - 14);
    return w;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [anchor, setAnchor] = useState<Date>(defaultAnchor);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  // DATE/DATETIME fields — the fallback source for undated tasks. Auto (default)
  // uses the first; the picker lets you choose a specific one (or Due-only).
  const dateFields = useMemo(
    () => (initialFields ?? []).filter((f) => f.type === "DATE" || f.type === "DATETIME"),
    [initialFields],
  );
  const firstDateFieldKey = dateFields[0]?.key ?? null;
  const rawSel = typeof viewConfig?.dateFieldKey === "string" ? (viewConfig.dateFieldKey as string) : "__auto";
  const dateSource = rawSel === "__auto" || rawSel === "__due" || dateFields.some((f) => f.key === rawSel) ? rawSel : "__auto";
  const [dateSourceLocal, setDateSourceLocal] = useState(dateSource);
  const persistDateSource = useCallback((next: string) => {
    setDateSourceLocal(next);
    if (viewId) {
      void fetch(`/api/boards/${boardId}/views/${viewId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { ...(viewConfig ?? {}), dateFieldKey: next } }),
      }).catch(() => {});
    }
  }, [boardId, viewId, viewConfig]);
  // Which field feeds undated tasks: none for Due-only, else the chosen/first field.
  const fallbackFieldKey = dateSourceLocal === "__due" ? null : dateSourceLocal === "__auto" ? firstDateFieldKey : dateSourceLocal;

  // Resolve EVERY non-archived item to a lane row: dated rows carry a
  // [start, end] span; undated rows carry start=end=null so they render as a
  // schedule marker instead of a bar. Order mirrors the List view (position).
  const rows = useMemo(() => {
    const out: Array<{ item: BoardItemRow; start: Date | null; end: Date | null }> = [];
    for (const it of initialItems) {
      if (it.archivedAt) continue;
      const due = it.dueAt ? new Date(it.dueAt) : null;
      const start = it.startAt ? new Date(it.startAt) : null;
      let s = start && !Number.isNaN(start.getTime()) ? start : null;
      let e = due && !Number.isNaN(due.getTime()) ? due : null;
      if (!s && !e && fallbackFieldKey) {
        const raw = it.metadata?.[fallbackFieldKey];
        if (typeof raw === "string" && raw) {
          const d = new Date(raw);
          if (!Number.isNaN(d.getTime())) e = d;
        }
      }
      if (s || e) {
        if (!s) s = e!;
        if (!e) e = s;
        if (e.getTime() < s.getTime()) [s, e] = [e, s];
      }
      out.push({ item: it, start: s, end: e });
    }
    return out;
  }, [initialItems, fallbackFieldKey]);

  const undatedCount = useMemo(() => rows.filter((r) => !r.start && !r.end).length, [rows]);

  // Lookup updated every render so the (mount-stable) pointer-up handler can
  // resolve the dragging item's real dates without stale closures. Undated
  // rows anchor to today so a drag maps to a concrete day → dueAt.
  const spanByIdRef = useRef(new Map<string, { item: BoardItemRow; start: Date; end: Date }>());
  spanByIdRef.current = new Map(
    rows.map((r) => {
      const anchorDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      return [r.item.id, { item: r.item, start: r.start ?? anchorDay, end: r.end ?? anchorDay }];
    }),
  );

  const totalDays = WEEK_COUNT * 7;
  const windowEnd = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + totalDays);
  const todayCol = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - anchor.getTime()) / MS_PER_DAY,
  );
  const todayInWindow = todayCol >= 0 && todayCol < totalDays;

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

    const spanDays = Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() -
      new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) / MS_PER_DAY);
    let delta = state.dayDelta;
    const patch: { startAt?: string; dueAt?: string } = {};
    const hasStart = !!item.startAt;
    const hasDue = !!item.dueAt;

    if (state.mode === "move") {
      if (hasStart) patch.startAt = shiftToIso(start, delta);
      if (hasDue) patch.dueAt = shiftToIso(end, delta);
      if (!hasStart && !hasDue) patch.dueAt = shiftToIso(end, delta); // undated / metadata-only → write dueAt
    } else if (state.mode === "resize-start") {
      if (delta > spanDays) delta = spanDays;
      patch.startAt = shiftToIso(start, delta);
    } else {
      if (delta < -spanDays) delta = -spanDays;
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
        justDraggedRef.current = true;
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

  // Set a due date on an undated task from a native date input.
  const scheduleDate = useCallback(async (id: string, value: string) => {
    if (!value) return;
    setError(null);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dueAt: `${value}T00:00:00.000Z` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? "Failed to set date"); return; }
      onItemChanged?.(data.item as BoardItemRow);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set date");
    }
  }, [onItemChanged]);

  const addTask = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || !boardId) { setNewTitle(""); return; }
    setAdding(true);
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, status: firstStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? "Failed to add task"); return; }
      if (data?.item) onItemCreated?.(data.item as BoardItemRow);
      setNewTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add task");
    } finally {
      setAdding(false);
    }
  }, [newTitle, boardId, firstStatus, onItemCreated]);

  const weeks = Array.from({ length: WEEK_COUNT }, (_, i) =>
    new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i * 7),
  );
  const rangeLabel = `${anchor.toLocaleString("default", { month: "short", day: "numeric" })} — ${
    new Date(windowEnd.getTime() - MS_PER_DAY).toLocaleString("default", { month: "short", day: "numeric", year: "numeric" })
  }`;
  const isCurrentWindow = anchor.getTime() === defaultAnchor.getTime();
  const chartHeight = Math.max(rows.length, 1) * ROW_H;

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
        {dateFields.length > 0 ? (
          <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span className="hidden sm:inline">Date field</span>
            <select
              value={dateSourceLocal}
              onChange={(e) => persistDateSource(e.target.value)}
              className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-[11.5px] text-zinc-700 focus:outline-none focus:border-[var(--os-brand)]"
            >
              <option value="__auto">Auto (Start/Due + date fields)</option>
              <option value="__due">Start / Due only</option>
              {dateFields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="text-[10.5px] text-zinc-400 hidden lg:inline">
          {undatedCount > 0
            ? `${undatedCount} unscheduled · drag or click a marker to schedule`
            : canEdit ? "Drag a bar to move it · drag an edge to resize" : "Start + Due dates render as duration bars"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
          <div className="text-sm font-medium text-zinc-900 mb-1">No tasks yet</div>
          <p className="text-xs text-zinc-500">Add a task below and it shows up here, ready to schedule.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-x-auto">
          <div className="flex" style={{ minWidth: NAME_W + 720 }}>
            {/* Left Name column (sticky) */}
            <div className="shrink-0 sticky left-0 z-20 bg-white border-r border-zinc-200" style={{ width: NAME_W }}>
              <div className="flex items-center h-[34px] px-3 border-b border-zinc-200 bg-zinc-50 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500">
                Name
              </div>
              {rows.map(({ item, start, end }) => {
                const current = item.status ? statusLookup[item.status] ?? null : null;
                return (
                  <div key={item.id} className="flex items-center gap-2 px-3 border-b border-zinc-100" style={{ height: ROW_H }}>
                    <StatusGlyph current={current} statuses={statuses} />
                    <button
                      type="button"
                      onClick={() => onOpenItem?.(item.id)}
                      className="flex-1 min-w-0 text-left text-[12.5px] font-medium text-zinc-800 truncate hover:text-[var(--os-brand)]"
                      title={item.title}
                    >
                      {item.title}
                    </button>
                    {!start && !end && canEdit ? (
                      <label className="relative inline-flex items-center justify-center w-5 h-5 rounded text-zinc-300 hover:text-[var(--os-brand)] hover:bg-zinc-100 cursor-pointer shrink-0" title="Set due date">
                        <CalendarPlus className="w-3.5 h-3.5" />
                        <input
                          type="date"
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          onChange={(e) => scheduleDate(item.id, e.target.value)}
                        />
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Right timeline */}
            <div className="flex-1 min-w-[720px]">
              {/* Week header */}
              <div
                className="grid border-b border-zinc-200 bg-zinc-50"
                style={{ height: HEAD_H, gridTemplateColumns: `repeat(${WEEK_COUNT}, minmax(60px, 1fr))` }}
              >
                {weeks.map((w, i) => {
                  const isThisWeek = startOfWeek(today).getTime() === w.getTime();
                  return (
                    <div
                      key={i}
                      className={`border-l first:border-l-0 border-zinc-100 px-2 flex items-center text-[10.5px] font-medium ${
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
                {/* Week gridlines */}
                {Array.from({ length: WEEK_COUNT - 1 }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className="absolute top-0 bottom-0 w-px bg-zinc-100"
                    style={{ left: `${((i + 1) / WEEK_COUNT) * 100}%` }}
                  />
                ))}
                {/* Row separators */}
                {rows.map((_, i) => (
                  <span key={`sep-${i}`} aria-hidden className="absolute left-0 right-0 h-px bg-zinc-100" style={{ top: (i + 1) * ROW_H }} />
                ))}
                {/* Today line */}
                {todayInWindow ? (
                  <span aria-hidden className="absolute top-0 bottom-0 w-px bg-red-400" style={{ left: `${(todayCol / totalDays) * 100}%` }} />
                ) : null}

                {rows.map(({ item, start, end }, rowIndex) => {
                  const color = (item.status ? statusLookup[item.status]?.color : null) ?? "#94a3b8";
                  const top = rowIndex * ROW_H + (ROW_H - 22) / 2;

                  // Undated → a schedule marker parked on today (draggable / clickable).
                  if (!start && !end) {
                    if (!todayInWindow) return null;
                    const d = drag && drag.id === item.id ? drag : null;
                    const markerCol = todayCol + (d ? d.dayDelta : 0);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onPointerDown={(e) => beginDrag(e, item.id, "move")}
                        onClick={() => {
                          if (justDraggedRef.current) { justDraggedRef.current = false; return; }
                          onOpenItem?.(item.id);
                        }}
                        title={`${item.title} — unscheduled${canEdit ? " · drag to schedule" : ""}`}
                        className={`absolute rounded-full border border-dashed border-zinc-400 bg-white ${
                          canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                        } ${d ? "ring-2 ring-[var(--os-brand)]" : ""}`}
                        style={{
                          left: `calc(${(markerCol / totalDays) * 100}% - 7px)`,
                          top: top + 4,
                          width: 14,
                          height: 14,
                          backgroundColor: `${color}33`,
                        }}
                      />
                    );
                  }

                  // Dated → a duration bar, clipped to the window.
                  const s = start!;
                  const e = end!;
                  if (e.getTime() < anchor.getTime() || s.getTime() >= windowEnd.getTime()) return null;
                  const startDay = Math.max(0, Math.floor((s.getTime() - anchor.getTime()) / MS_PER_DAY));
                  const endDay = Math.min(totalDays - 1, Math.floor((e.getTime() - anchor.getTime()) / MS_PER_DAY));
                  const startCol = startDay;
                  const spanCols = Math.max(1, endDay - startDay + 1);

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
                  return (
                    <div
                      key={item.id}
                      className={`absolute ${d ? "opacity-90 ring-2 ring-[var(--os-brand)] rounded" : ""}`}
                      style={{ left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, top, height: 22 }}
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
                        title={`${item.title} — ${s.toLocaleDateString()}${
                          s.getTime() !== e.getTime() ? ` → ${e.toLocaleDateString()}` : ""
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

          {/* Bottom add-task row */}
          {canEdit && boardId ? (
            <div className="flex items-center gap-2 h-[34px] px-3 border-t border-zinc-200" style={{ width: NAME_W }}>
              <Plus className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void addTask(); }}
                onBlur={() => { if (newTitle.trim()) void addTask(); }}
                disabled={adding}
                placeholder="Add Task"
                className="flex-1 min-w-0 bg-transparent text-[12.5px] text-zinc-800 placeholder:text-zinc-400 focus:outline-none"
              />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
