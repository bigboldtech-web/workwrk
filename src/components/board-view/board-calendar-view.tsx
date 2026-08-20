"use client";

// BoardCalendarView — per-board CALENDAR renderer. Month grid bucketed
// by Item.dueAt, falling back to the board's first DATE field value in
// metadata for legacy rows (same dual-path rule as the Space-level
// calendar this was adapted from). Month nav is local state — items
// are already client-side, so no URL round-trip is needed. Day-cell
// "+" creates an item due that day; clicking an item opens the drawer;
// dragging a chip onto another day reschedules its dueAt.

import { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { makeStatusLookup, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type { FieldDef } from "@/lib/field-catalog";
import { ItemContextMenuHost, useItemContextMenu } from "./item-context-menu";

interface BoardCalendarViewProps {
  boardId: string;
  /** Active view + its config — used to persist which date field drives the grid. */
  viewId?: string | null;
  viewConfig?: Record<string, unknown>;
  initialItems: BoardItemRow[];
  initialFields?: FieldDef[];
  /** Per-List statuses (backbone #1) — drives the chip dot colors. */
  statuses: StatusOption[];
  canEdit: boolean;
  onOpenItem?: (itemId: string) => void;
  /** Called after a day-cell "+" creates an item, so the parent canvas
   *  can append it to shared state. */
  onItemCreated?: (item: BoardItemRow) => void;
  /** Called after a drag-reschedule PATCH succeeds so the parent canvas
   *  syncs shared item state (same contract as the drawer). */
  onItemChanged?: (item: BoardItemRow) => void;
  /** Called after the context menu archives/deletes a chip's item. */
  onItemRemoved?: (id: string) => void;
  /** Time Tracking module gate — hides "Start timer" in the context menu. */
  timeTrackingEnabled?: boolean;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BoardCalendarView({ boardId, viewId, viewConfig, initialItems, initialFields, statuses, canEdit, onOpenItem, onItemCreated, onItemChanged, onItemRemoved, timeTrackingEnabled }: BoardCalendarViewProps) {
  const now = new Date();
  const statusLookup = useMemo(() => makeStatusLookup(statuses), [statuses]);
  // Right-click on any day chip opens the shared item menu.
  const menu = useItemContextMenu();
  const [month, setMonth] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  const [error, setError] = useState<string | null>(null);
  const [busyDay, setBusyDay] = useState<string | null>(null);
  // Drag-to-reschedule state — id of the chip in flight + hovered cell.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  // The board's DATE/DATETIME custom fields — the choices for which date drives
  // the grid. Auto (default) = Due date, then the first date field (legacy).
  const dateFields = useMemo(
    () => (initialFields ?? []).filter((f) => f.type === "DATE" || f.type === "DATETIME"),
    [initialFields],
  );
  const firstDateFieldKey = dateFields[0]?.key ?? null;
  const rawSel = typeof viewConfig?.dateFieldKey === "string" ? (viewConfig.dateFieldKey as string) : "__auto";
  // Keep only valid selections (config might reference a deleted field).
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

  const resolveDate = useCallback((it: BoardItemRow): Date | null => {
    const parse = (raw: unknown): Date | null => {
      if (!raw) return null;
      const d = new Date(raw as string);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    if (dateSourceLocal === "__due") return parse(it.dueAt);
    if (dateSourceLocal !== "__auto") return parse(it.metadata?.[dateSourceLocal]);
    // Auto: Due date first, then the first DATE field (legacy fallback).
    return parse(it.dueAt) ?? (firstDateFieldKey ? parse(it.metadata?.[firstDateFieldKey]) : null);
  }, [dateSourceLocal, firstDateFieldKey]);

  const buckets = useMemo(() => {
    const map = new Map<string, BoardItemRow[]>();
    for (const it of initialItems) {
      if (it.archivedAt) continue;
      const d = resolveDate(it);
      if (!d) continue;
      const key = dateKey(d);
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return map;
  }, [initialItems, resolveDate]);

  const datedCount = useMemo(
    () => Array.from(buckets.values()).reduce((n, arr) => n + arr.length, 0),
    [buckets],
  );

  const addOnDay = useCallback(async (key: string) => {
    if (!canEdit || busyDay) return;
    setBusyDay(key);
    setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "New item", status: "TO_DO", dueAt: `${key}T00:00:00.000Z` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to add item");
        return;
      }
      onItemCreated?.(data.item as BoardItemRow);
      onOpenItem?.(data.item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add item");
    } finally {
      setBusyDay(null);
    }
  }, [boardId, canEdit, busyDay, onItemCreated, onOpenItem]);

  // Drop handler — PATCH dueAt to the target day, then sync the parent
  // canvas with the server's row (calendar re-buckets from props).
  const rescheduleTo = useCallback(async (itemId: string, dayKey: string) => {
    setDragId(null);
    setDragOverDay(null);
    if (!canEdit) return;
    const current = initialItems.find((it) => it.id === itemId);
    if (!current) return;
    const nextDue = `${dayKey}T00:00:00.000Z`;
    if (current.dueAt && new Date(current.dueAt).toISOString() === nextDue) return;
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dueAt: nextDue }),
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
  }, [canEdit, initialItems, onItemChanged]);

  // 6-week grid starting Sunday. Lead/trail cells carry the adjacent
  // month's real greyed day numbers (ClickUp), but stay inert.
  const { cells, monthLabel, isCurrentMonth } = useMemo(() => {
    const firstDow = new Date(month.y, month.m, 1).getDay();
    const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
    const out: Array<{ key: string; day: number | null; inMonth: boolean }> = [];
    for (let i = 0; i < firstDow; i++) {
      const d = new Date(month.y, month.m, 1 - (firstDow - i));
      out.push({ key: dateKey(d), day: d.getDate(), inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ key: dateKey(new Date(month.y, month.m, d)), day: d, inMonth: true });
    }
    let trail = 0;
    while (out.length % 7 !== 0) {
      trail += 1;
      const d = new Date(month.y, month.m + 1, trail);
      out.push({ key: dateKey(d), day: d.getDate(), inMonth: false });
    }
    return {
      cells: out,
      monthLabel: new Date(month.y, month.m, 1).toLocaleString("default", { month: "long", year: "numeric" }),
      isCurrentMonth: month.y === now.getFullYear() && month.m === now.getMonth(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const todayKey = dateKey(new Date());

  return (
    <section>
      {error ? (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 transition-colors hover:text-red-600"><X className="w-3 h-3" /></button>
        </div>
      ) : null}

      {/* ClickUp toolbar grammar: ghost ‹ › chevrons, month title, then a
          standalone bordered Today button. */}
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Next month"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-900">{monthLabel}</h2>
        <button
          type="button"
          disabled={isCurrentMonth}
          onClick={() => setMonth({ y: now.getFullYear(), m: now.getMonth() })}
          className="inline-flex h-7 items-center rounded-md border border-zinc-200 bg-white px-2.5 text-[12.5px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:text-zinc-400 disabled:hover:bg-white dark:border-zinc-700 dark:bg-transparent dark:text-zinc-300 dark:hover:bg-white/5 dark:disabled:text-zinc-600"
        >
          Today
        </button>
        <div className="flex-1" />
        {dateFields.length > 0 ? (
          <label className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500">
            <span className="hidden sm:inline">Date field</span>
            <select
              value={dateSourceLocal}
              onChange={(e) => persistDateSource(e.target.value)}
              className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-[12.5px] text-zinc-700 transition-colors hover:border-zinc-300 focus:outline-none focus:border-[var(--os-brand)]"
            >
              <option value="__auto">Auto (Due + date fields)</option>
              <option value="__due">Due date</option>
              {dateFields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="text-[11.5px] text-zinc-400 hidden lg:inline">
          {datedCount} dated item{datedCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
        <div className="grid grid-cols-7 border-b border-zinc-200">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2.5 py-1.5 text-[12px] font-medium text-zinc-500">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 [&>div:nth-child(7n)]:border-r-0 [&>div:nth-last-child(-n+7)]:border-b-0">
          {cells.map((cell, idx) => {
            const dayItems = cell.inMonth ? buckets.get(cell.key) ?? [] : [];
            const isToday = cell.key === todayKey;
            const isDropTarget = dragOverDay === cell.key && cell.inMonth;
            const isWeekend = idx % 7 === 0 || idx % 7 === 6;
            return (
              <div
                key={cell.key}
                className={`group min-h-[120px] border-r border-b border-zinc-100 p-1.5 ${
                  isDropTarget
                    ? "bg-[var(--os-brand)]/[0.06] ring-2 ring-inset ring-[var(--os-brand)]/40"
                    : cell.inMonth
                      ? isWeekend ? "bg-zinc-50/40 dark:bg-white/[0.03]" : "bg-white dark:bg-transparent"
                      : "bg-zinc-50/50 dark:bg-white/[0.04]"
                }`}
                onDragOver={(e) => {
                  if (!canEdit || !dragId || !cell.inMonth) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverDay(cell.key);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget === e.target) setDragOverDay(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && cell.inMonth) void rescheduleTo(dragId, cell.key);
                }}
              >
                {cell.day !== null ? (
                  <div className="mb-1.5 flex items-center justify-between">
                    <span
                      className={`text-[12px] tabular-nums leading-5 ${
                        isToday
                          ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--os-brand)] font-semibold text-white"
                          : cell.inMonth
                            ? "font-medium text-zinc-500"
                            : "font-medium text-zinc-300"
                      }`}
                    >
                      {cell.day}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {dayItems.length > 0 ? (
                        <span className="text-[11px] font-medium tabular-nums text-zinc-400">{dayItems.length}</span>
                      ) : null}
                      {canEdit && cell.inMonth ? (
                        <button
                          type="button"
                          disabled={busyDay === cell.key}
                          onClick={() => void addOnDay(cell.key)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50"
                          aria-label={`Add item on day ${cell.day}`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      ) : null}
                    </span>
                  </div>
                ) : null}
                <ul className="space-y-0.5">
                  {dayItems.slice(0, 4).map((it) => {
                    const dot = (it.status ? statusLookup[it.status]?.color : null) ?? "#A1A1AA";
                    return (
                      <li key={it.id}>
                        {/* ClickUp chip: status-tinted wash + saturated left edge. */}
                        <button
                          type="button"
                          draggable={canEdit}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            try { e.dataTransfer.setData("text/plain", it.id); } catch {}
                            setDragId(it.id);
                          }}
                          onDragEnd={() => { setDragId(null); setDragOverDay(null); }}
                          onClick={() => onOpenItem?.(it.id)}
                          onContextMenu={(e) => menu.openItemMenu(e, it)}
                          className={`flex w-full items-center gap-1.5 rounded-[4px] border-l-2 px-1.5 py-[3px] text-left text-[12px] font-medium leading-4 text-zinc-700 transition-[filter] hover:brightness-[0.96] ${
                            canEdit ? "cursor-grab active:cursor-grabbing" : ""
                          } ${dragId === it.id ? "opacity-40" : ""}`}
                          style={{ borderLeftColor: dot, backgroundColor: `${dot}14` }}
                          title={canEdit ? "Drag to another day to reschedule" : undefined}
                        >
                          <span className="truncate">{it.title}</span>
                          {it.owner ? (
                            <Avatar className="ml-auto h-4 w-4 shrink-0">
                              <AvatarImage src={it.owner.avatar ?? undefined} />
                              <AvatarFallback className="text-[7px]">
                                {`${it.owner.firstName?.[0] ?? ""}${it.owner.lastName?.[0] ?? ""}`}
                              </AvatarFallback>
                            </Avatar>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                  {dayItems.length > 4 ? (
                    <li className="px-1.5 pt-0.5 text-[11.5px] font-medium text-zinc-500 hover:text-zinc-700 cursor-default">+ {dayItems.length - 4} more</li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
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
