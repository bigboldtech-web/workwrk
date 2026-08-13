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
// live preview tracks the cursor with a prospective-dates tooltip; release
// PATCHes the dates and syncs via onItemChanged. Undated markers open a date
// picker (or drag) to set dueAt. Bars fully off-window leave a lane chevron
// that jumps the window to them.
//
// Backlog: the toolbar "Backlog" toggle docks the ClickUp-style "Tasks" panel
// (Unscheduled | Overdue) on the right; rows drag onto the lanes to schedule
// at the drop day (HTML5 DnD, calendar contract) or one-click "Today".
// Zoom (ganttWeeks) + backlog visibility persist in View.config.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { isDoneStatus, makeStatusLookup, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { StatusGlyph } from "./status-glyph";
import { GanttBacklogPanel } from "./gantt-backlog-panel";
import { ItemContextMenuHost, useItemContextMenu } from "./item-context-menu";

// Zoom steps for the visible window (fewer weeks = zoomed in). ClickUp
// exposes this as the floating +/− stack on the canvas. 4 weeks is the
// day-granularity step: the header switches to per-day weekday+number cells.
// Deliberate omissions vs ClickUp (honest-UI, out of scope): dependency
// arrows between bars, progress % fill on bars, a Day/Week/Month dropdown
// (this weekCount stack is the equivalent), and a show-weekends toggle.
const WEEK_STEPS = [4, 8, 12, 16, 24] as const;
const MS_PER_DAY = 86_400_000;
const ROW_H = 34;      // per-task lane height (matches the left name rows)
const HEAD_H = 44;     // two-tier timeline header (month band + day row)
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
  /** Called after the context menu archives/deletes a task. */
  onItemRemoved?: (id: string) => void;
  /** Time Tracking module gate — hides "Start timer" in the context menu. */
  timeTrackingEnabled?: boolean;
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

function addDays(d: Date, deltaDays: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + deltaDays);
}

// Short date label for the live drag tooltip + drop chip ("Aug 7").
function fmtDay(d: Date): string {
  return d.toLocaleDateString("default", { month: "short", day: "numeric" });
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
  onItemRemoved,
  timeTrackingEnabled,
}: BoardGanttViewProps) {
  const statusLookup = useMemo(() => makeStatusLookup(statuses), [statuses]);
  // Right-click on a name row / bar / marker opens the shared item menu.
  const menu = useItemContextMenu();
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
  // Zoom + backlog visibility persist as view chrome in View.config
  // (ganttWeeks / backlogOpen) — same fire-and-forget contract as
  // dateFieldKey below. Initialized once from the server-provided config;
  // after mount the local state is the source of truth (the prop goes
  // stale after PATCHes since there is no refetch).
  const cfgWeeks =
    typeof viewConfig?.ganttWeeks === "number" && (WEEK_STEPS as readonly number[]).includes(viewConfig.ganttWeeks)
      ? (viewConfig.ganttWeeks as number)
      : 12;
  const [weekCount, setWeekCount] = useState<number>(cfgWeeks);
  const [backlogOpen, setBacklogOpen] = useState<boolean>(viewConfig?.backlogOpen === true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  // Backlog drag-out (HTML5 DnD, same contract as the calendar view):
  // which panel row is in flight + which day column the cursor hovers.
  const [panelDragId, setPanelDragId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<number | null>(null);

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
  // Persist view chrome (dateFieldKey / ganttWeeks / backlogOpen) into
  // View.config via the existing views PATCH. The ref accumulates every key
  // written this session so a later write never drops an earlier one (the
  // viewConfig prop is a mount-time snapshot and goes stale after PATCHes).
  // Fire-and-forget on purpose: config is non-critical view chrome, not user
  // content — matches the original persistDateSource contract.
  const cfgPatchRef = useRef<Record<string, unknown>>({});
  const persistViewConfig = useCallback((patch: Record<string, unknown>) => {
    cfgPatchRef.current = { ...cfgPatchRef.current, ...patch };
    if (viewId) {
      void fetch(`/api/boards/${boardId}/views/${viewId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { ...(viewConfig ?? {}), ...cfgPatchRef.current } }),
      }).catch(() => {});
    }
  }, [boardId, viewId, viewConfig]);
  const persistDateSource = useCallback((next: string) => {
    setDateSourceLocal(next);
    persistViewConfig({ dateFieldKey: next });
  }, [persistViewConfig]);
  const setZoom = useCallback((next: number) => {
    setWeekCount(next);
    persistViewConfig({ ganttWeeks: next });
  }, [persistViewConfig]);
  const toggleBacklog = useCallback(() => {
    const next = !backlogOpen;
    setBacklogOpen(next);
    persistViewConfig({ backlogOpen: next });
  }, [backlogOpen, persistViewConfig]);
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

  // Backlog panel feeds: undated tasks + past-due-still-open tasks. Derived
  // from the same rows memo the lanes use, so counts follow the active
  // filters exactly like the chart does.
  const startOfTodayD = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const unscheduled = rows.filter((r) => !r.start && !r.end).map((r) => r.item);
  const overdueRows = rows
    .filter((r) => r.end && r.end.getTime() < startOfTodayD.getTime() && !isDoneStatus(statuses, r.item.status))
    .map((r) => ({ item: r.item, end: r.end! }));

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

  const totalDays = weekCount * 7;
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
    // Primary button only — right-click opens the context menu, not a drag.
    if (e.button !== 0) return;
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

  const weeks = Array.from({ length: weekCount }, (_, i) =>
    new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i * 7),
  );
  // Consecutive weeks grouped by month for the header's month band.
  const monthBands: Array<{ label: string; span: number }> = [];
  for (const w of weeks) {
    const label = w.toLocaleString("default", { month: "long", year: "numeric" });
    const last = monthBands[monthBands.length - 1];
    if (last && last.label === label) last.span += 1;
    else monthBands.push({ label, span: 1 });
  }
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

      {/* ClickUp toolbar grammar: standalone Today pill first, then ghost
          chevrons; period lives in the timeline header, so the range label
          stays quiet. */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          disabled={isCurrentWindow}
          onClick={() => setAnchor(defaultAnchor)}
          className="h-7 px-3 rounded-md border border-zinc-200 bg-white text-[11.5px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300 disabled:hover:bg-white dark:border-zinc-700 dark:bg-transparent dark:text-zinc-300 dark:hover:bg-white/5 dark:disabled:text-zinc-600 dark:disabled:hover:bg-transparent inline-flex items-center"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => shift(-4)}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
          aria-label="Earlier"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => shift(4)}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
          aria-label="Later"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <h2 className="text-[12px] font-medium text-zinc-500">{rangeLabel}</h2>
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
        {/* Backlog toggle — opens the ClickUp-style "Tasks" side panel.
            Neutral pressed state (Monday-clean, no accent fill). */}
        <button
          type="button"
          onClick={toggleBacklog}
          className={`h-7 rounded-md border px-3 text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors ${
            backlogOpen
              ? "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-white/10 dark:text-zinc-100"
              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-300 dark:hover:bg-white/5"
          }`}
        >
          Backlog
          {unscheduled.length + overdueRows.length > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-100 px-1 text-[10px] font-semibold tabular-nums text-zinc-500">
              {unscheduled.length + overdueRows.length}
            </span>
          ) : null}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
          <div className="text-sm font-medium text-zinc-900 mb-1">No tasks yet</div>
          <p className="text-xs text-zinc-500">Add a task below and it shows up here, ready to schedule.</p>
        </div>
      ) : (
        <div className="flex items-stretch overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {/* Chart scroll container — sticky Name column + zoom stack pin to
              THIS box, so the open backlog panel sits outside the scroll. */}
          <div className="relative min-w-0 flex-1 overflow-x-auto">
          {/* ClickUp's floating zoom stack (fewer weeks = zoom in). */}
          <div className="absolute right-2 z-30 flex flex-col rounded-md border border-zinc-200 bg-white shadow-sm overflow-hidden dark:border-zinc-700 dark:bg-zinc-900" style={{ top: HEAD_H + 8 }}>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={weekCount === WEEK_STEPS[0]}
              onClick={() => setZoom(WEEK_STEPS[Math.max(0, WEEK_STEPS.indexOf(weekCount as typeof WEEK_STEPS[number]) - 1)])}
              className="h-6 w-6 inline-flex items-center justify-center text-zinc-500 hover:bg-zinc-50 disabled:text-zinc-300"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              disabled={weekCount === WEEK_STEPS[WEEK_STEPS.length - 1]}
              onClick={() => setZoom(WEEK_STEPS[Math.min(WEEK_STEPS.length - 1, WEEK_STEPS.indexOf(weekCount as typeof WEEK_STEPS[number]) + 1)])}
              className="h-6 w-6 inline-flex items-center justify-center text-zinc-500 hover:bg-zinc-50 disabled:text-zinc-300 border-t border-zinc-100"
            >
              <Minus className="w-3 h-3" />
            </button>
          </div>
          <div className="flex" style={{ minWidth: NAME_W + 720 }}>
            {/* Left Name column (sticky) */}
            <div className="shrink-0 sticky left-0 z-20 bg-white border-r border-zinc-200" style={{ width: NAME_W }}>
              <div className="flex items-center px-3 border-b border-zinc-200 bg-white text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500" style={{ height: HEAD_H }}>
                Name
              </div>
              {rows.map(({ item, start, end }) => {
                const current = item.status ? statusLookup[item.status] ?? null : null;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 px-3 border-b border-zinc-100 hover:bg-zinc-50"
                    style={{ height: ROW_H }}
                    onContextMenu={(e) => menu.openItemMenu(e, item)}
                  >
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
              {/* Two-tier header: month band over per-week day numbers. */}
              <div className="border-b border-zinc-200 bg-white" style={{ height: HEAD_H }}>
                <div
                  className="grid h-[18px]"
                  style={{ gridTemplateColumns: `repeat(${weekCount}, minmax(60px, 1fr))` }}
                >
                  {monthBands.map((band, i) => (
                    <div
                      key={`${band.label}-${i}`}
                      className="px-2 flex items-center text-[10.5px] font-medium text-zinc-500 truncate"
                      style={{ gridColumn: `span ${band.span}` }}
                    >
                      {band.label}
                    </div>
                  ))}
                </div>
                {weekCount === 4 ? (
                  // Day-granularity zoom step: per-day weekday letter + number
                  // cells (ClickUp's "S 26  M 27" row at tighter zoom).
                  <div
                    className="grid h-[26px]"
                    style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(24px, 1fr))` }}
                  >
                    {Array.from({ length: totalDays }, (_, i) => {
                      const d = addDays(anchor, i);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      return (
                        <div
                          key={i}
                          className={`border-l first:border-l-0 border-zinc-100 flex items-center justify-center gap-0.5 text-[10px] ${
                            isWeekend ? "bg-zinc-50 dark:bg-white/[0.03]" : ""
                          }`}
                        >
                          <span className="text-zinc-400">{"SMTWTFS"[d.getDay()]}</span>
                          {i === todayCol ? (
                            <span className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full bg-[#E2445C] text-white text-[9.5px] font-semibold">
                              {d.getDate()}
                            </span>
                          ) : (
                            <span className="text-zinc-500 tabular-nums">{d.getDate()}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className="grid h-[26px]"
                    style={{ gridTemplateColumns: `repeat(${weekCount}, minmax(60px, 1fr))` }}
                  >
                    {weeks.map((w, i) => {
                      const isThisWeek = startOfWeek(today).getTime() === w.getTime();
                      return (
                        <div key={i} className="border-l first:border-l-0 border-zinc-100 px-2 flex items-center text-[10.5px]">
                          {isThisWeek ? (
                            <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[#E2445C] text-white text-[10px] font-semibold">
                              {w.getDate()}
                            </span>
                          ) : (
                            <span className="text-zinc-400">{w.getDate()}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* Lanes — also the drop target for backlog drag-out (HTML5
                  DnD, same reschedule contract as the calendar grid). */}
              <div
                ref={lanesRef}
                className="relative"
                style={{ height: chartHeight }}
                onDragOver={(e) => {
                  if (!panelDragId || !canEdit) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = lanesRef.current?.getBoundingClientRect();
                  if (!rect || rect.width <= 0) return;
                  const day = Math.min(totalDays - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * totalDays)));
                  setDropDay(day);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget === e.target) setDropDay(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (panelDragId && dropDay !== null) void scheduleDate(panelDragId, shiftToIso(anchor, dropDay).slice(0, 10));
                  setPanelDragId(null);
                  setDropDay(null);
                }}
              >
                {/* Drop indicator: brand day line + prospective-date chip. */}
                {panelDragId && dropDay !== null ? (
                  <>
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-[var(--os-brand)]"
                      style={{ left: `${((dropDay + 0.5) / totalDays) * 100}%` }}
                    />
                    <span
                      className="pointer-events-none absolute top-1 z-20 -translate-x-1/2 rounded-[5px] bg-[var(--os-brand)] px-1.5 py-0.5 text-[10px] font-medium text-white"
                      style={{ left: `${((dropDay + 0.5) / totalDays) * 100}%` }}
                    >
                      {fmtDay(addDays(anchor, dropDay))}
                    </span>
                  </>
                ) : null}
                {/* Weekend shading (behind gridlines/bars) */}
                {Array.from({ length: weekCount }, (_, i) => (
                  <span key={`wknd-${i}`} aria-hidden>
                    <span
                      className="absolute top-0 bottom-0 bg-zinc-50 dark:bg-white/[0.03] pointer-events-none"
                      style={{ left: `${((i * 7) / totalDays) * 100}%`, width: `${(1 / totalDays) * 100}%` }}
                    />
                    <span
                      className="absolute top-0 bottom-0 bg-zinc-50 dark:bg-white/[0.03] pointer-events-none"
                      style={{ left: `${((i * 7 + 6) / totalDays) * 100}%`, width: `${(1 / totalDays) * 100}%` }}
                    />
                  </span>
                ))}
                {/* Week gridlines */}
                {Array.from({ length: weekCount - 1 }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className="absolute top-0 bottom-0 w-px bg-zinc-100"
                    style={{ left: `${((i + 1) / weekCount) * 100}%` }}
                  />
                ))}
                {/* Row separators */}
                {rows.map((_, i) => (
                  <span key={`sep-${i}`} aria-hidden className="absolute left-0 right-0 h-px bg-zinc-100" style={{ top: (i + 1) * ROW_H }} />
                ))}
                {/* Today line — rose, centered in the day column, dot on top. */}
                {todayInWindow ? (
                  <>
                    <span aria-hidden className="absolute top-0 bottom-0 w-px bg-[#E2445C]" style={{ left: `${((todayCol + 0.5) / totalDays) * 100}%` }} />
                    <span aria-hidden className="absolute w-[5px] h-[5px] rounded-full bg-[#E2445C] -translate-x-1/2" style={{ left: `${((todayCol + 0.5) / totalDays) * 100}%`, top: -2 }} />
                  </>
                ) : null}

                {rows.map(({ item, start, end }, rowIndex) => {
                  const color = (item.status ? statusLookup[item.status]?.color : null) ?? "#94a3b8";
                  const top = rowIndex * ROW_H + (ROW_H - 24) / 2;

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
                        onContextMenu={(e) => menu.openItemMenu(e, item)}
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
                      >
                        {/* Live target-day tooltip while dragging to schedule. */}
                        {d ? (
                          <span className="absolute -top-[22px] left-0 z-30 whitespace-nowrap rounded-[5px] bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white pointer-events-none dark:bg-zinc-100 dark:text-zinc-900">
                            {fmtDay(addDays(startOfTodayD, d.dayDelta))}
                          </span>
                        ) : null}
                      </button>
                    );
                  }

                  // Dated → a duration bar, clipped to the window. Bars fully
                  // outside the window leave an edge chevron in the lane that
                  // jumps the window to the bar (ClickUp's off-screen affordance).
                  const s = start!;
                  const e = end!;
                  if (e.getTime() < anchor.getTime() || s.getTime() >= windowEnd.getTime()) {
                    const isLeft = e.getTime() < anchor.getTime();
                    return (
                      <button
                        key={item.id}
                        type="button"
                        title={`${item.title} — jump to bar`}
                        onClick={() => {
                          const w = startOfWeek(s);
                          w.setDate(w.getDate() - 7);
                          setAnchor(w);
                        }}
                        onContextMenu={(e) => menu.openItemMenu(e, item)}
                        className={`absolute z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-white/10 ${
                          isLeft ? "left-1" : "right-1"
                        }`}
                        style={{ top: rowIndex * ROW_H + (ROW_H - 20) / 2 }}
                      >
                        {isLeft ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </button>
                    );
                  }
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
                  // ClickUp spills short bars' names to the right of the bar.
                  const spillLabel = dispSpan <= 2;
                  // Live prospective dates while dragging — same clamp math as
                  // commitDrag so the tooltip always matches what release writes.
                  let tipStart: Date | null = null;
                  let tipEnd: Date | null = null;
                  if (d) {
                    const spanDays = Math.round(
                      (new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime() -
                        new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime()) / MS_PER_DAY,
                    );
                    let delta = d.dayDelta;
                    if (d.mode === "resize-start" && delta > spanDays) delta = spanDays;
                    if (d.mode === "resize-end" && delta < -spanDays) delta = -spanDays;
                    tipStart = d.mode === "resize-end" ? addDays(s, 0) : addDays(s, delta);
                    tipEnd = d.mode === "resize-start" ? addDays(e, 0) : addDays(e, delta);
                  }
                  return (
                    <div
                      key={item.id}
                      className={`group absolute ${d ? "opacity-90 ring-2 ring-[var(--os-brand)] rounded-[6px]" : ""}`}
                      style={{ left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, top, height: 24 }}
                      onContextMenu={(e) => menu.openItemMenu(e, item)}
                    >
                      {tipStart && tipEnd ? (
                        <span className="absolute -top-[22px] left-0 z-30 whitespace-nowrap rounded-[5px] bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white pointer-events-none dark:bg-zinc-100 dark:text-zinc-900">
                          {fmtDay(tipStart)}
                          {tipEnd.getTime() !== tipStart.getTime() ? ` → ${fmtDay(tipEnd)}` : ""}
                        </span>
                      ) : null}
                      {canEdit ? (
                        <div
                          onPointerDown={(e) => beginDrag(e, item.id, "resize-start")}
                          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 rounded-l-[6px] bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"
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
                        className={`w-full h-full px-2 rounded-[6px] text-[11px] font-medium text-white truncate hover:brightness-95 leading-[24px] text-left ${
                          canEdit ? "cursor-grab active:cursor-grabbing" : ""
                        }`}
                        style={{ backgroundColor: color }}
                      >
                        {spillLabel ? null : item.title}
                      </button>
                      {spillLabel ? (
                        <span className="absolute left-full top-0 ml-1.5 text-[11px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap leading-[24px] pointer-events-none">
                          {item.title}
                        </span>
                      ) : null}
                      {canEdit ? (
                        <div
                          onPointerDown={(e) => beginDrag(e, item.id, "resize-end")}
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 rounded-r-[6px] bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"
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
          {backlogOpen ? (
            <GanttBacklogPanel
              unscheduled={unscheduled}
              overdue={overdueRows}
              statuses={statuses}
              canEdit={canEdit}
              onOpenItem={onOpenItem}
              onScheduleToday={(id) => void scheduleDate(id, shiftToIso(startOfTodayD, 0).slice(0, 10))}
              onDragStart={setPanelDragId}
              onDragEnd={() => { setPanelDragId(null); setDropDay(null); }}
              onClose={toggleBacklog}
            />
          ) : null}
        </div>
      )}
      <ItemContextMenuHost
        menu={menu}
        boardId={boardId}
        canEdit={canEdit}
        timeTrackingEnabled={timeTrackingEnabled}
        onOpenItem={onOpenItem}
        onItemCreated={onItemCreated}
        onItemRemoved={onItemRemoved}
      />
    </section>
  );
}
