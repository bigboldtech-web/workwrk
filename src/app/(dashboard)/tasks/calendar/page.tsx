"use client";

/* Tasks · Calendar — full-bleed month grid.
 *
 * Dedicated calendar surface (not just a tab). Week starts Monday.
 * Each cell shows up to 3 task pills (colored by status) and a "+N more"
 * spillover. Click a day to add. Drag a pill to reschedule.
 *
 * GET   /api/tasks?startDate=…&endDate=…
 * POST  /api/tasks { title, date, allDay }
 * PATCH /api/tasks { id, date }   (drag-drop reschedule)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type ApiStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED";
type ApiTask = {
  id: string;
  title: string;
  date: string;
  status: ApiStatus;
  priority: ApiPrio;
  assignee?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const MS_DAY = 86_400_000;
const STATUS_COLOR: Record<ApiStatus, string> = {
  PLANNED: "var(--os-c-indigo)", IN_PROGRESS: "var(--os-c-orange)", COMPLETED: "var(--os-c-green)",
};

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Mon-start grid: returns 42 days covering the month's full weeks.
function gridDays(month: Date): Date[] {
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7; // 0=Mon … 6=Sun
  const start = new Date(first); start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * MS_DAY));
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function TaskCalendarPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [dayDrawer, setDayDrawer] = useState<Date | null>(null);
  const [draft, setDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const from = isoDate(new Date(startOfMonth(month).getTime() - 14 * MS_DAY));
      const to = isoDate(new Date(endOfMonth(month).getTime() + 14 * MS_DAY));
      const res = await fetch(`/api/tasks?startDate=${from}&endDate=${to}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiTask[] = Array.isArray(data) ? data : (data.data ?? []);
      setTasks(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [month]);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("tasks");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const byDay = useMemo(() => {
    const m = new Map<string, ApiTask[]>();
    for (const t of tasks ?? []) {
      const k = new Date(t.date).toISOString().slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [tasks]);

  const days = useMemo(() => gridDays(month), [month]);
  const today = new Date();

  async function addOnDay(date: Date, title: string) {
    if (!title.trim()) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), date: date.toISOString(), allDay: true }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      setDraft("");
      void load();
    } catch { toast("Couldn't add"); }
  }

  async function reschedule(id: string, day: Date) {
    setTasks((prev) => prev?.map((t) => t.id === id ? { ...t, date: day.toISOString() } : t) ?? prev);
    try {
      const res = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, date: day.toISOString() }) });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch { toast("Couldn't move"); void load(); }
  }

  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const monthCount = (tasks ?? []).filter((t) => {
    const d = new Date(t.date);
    return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
  }).length;

  return (
    <div className="tcal">
      <header className="tcal__head">
        <div className="tcal__head-l">
          <div className="tcal__icon"><CalendarDays /></div>
          <div>
            <h1 className="tcal__title">{monthLabel}</h1>
            <div className="tcal__sub">{monthCount} task{monthCount === 1 ? "" : "s"} this month</div>
          </div>
        </div>
        <div className="tcal__nav">
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></button>
          <button type="button" onClick={() => setMonth(startOfMonth(new Date()))} className="tcal__nav-today">Today</button>
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></button>
        </div>
      </header>

      {loadError ? (
        <div className="tcal__error">Couldn&apos;t load: {loadError}</div>
      ) : (
        <div className="tcal__grid">
          <div className="tcal__row tcal__row--days">
            {WEEKDAYS.map((d) => <div key={d} className="tcal__weekday">{d}</div>)}
          </div>
          {Array.from({ length: 6 }, (_, w) => (
            <div key={w} className="tcal__row">
              {days.slice(w * 7, w * 7 + 7).map((d) => {
                const inMonth = d.getMonth() === month.getMonth();
                const isToday = sameDay(d, today);
                const items = byDay.get(d.toISOString().slice(0, 10)) ?? [];
                const visible = items.slice(0, 3);
                const more = items.length - visible.length;
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => setDayDrawer(d)}
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={(e) => { e.preventDefault(); if (dragId) void reschedule(dragId, d); setDragId(null); }}
                    className={`tcal__cell ${inMonth ? "" : "is-other"} ${isToday ? "is-today" : ""}`}
                  >
                    <div className="tcal__cell-date">
                      <span className="tcal__cell-num">{d.getDate()}</span>
                      {isToday ? <span className="tcal__cell-today">today</span> : null}
                    </div>
                    <div className="tcal__cell-pills">
                      {visible.map((t) => (
                        <span
                          key={t.id}
                          className="tcal__pill"
                          style={{ background: STATUS_COLOR[t.status], opacity: t.status === "COMPLETED" ? 0.55 : 1 }}
                          draggable
                          onDragStart={(e) => { e.stopPropagation(); setDragId(t.id); }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t.title}
                        </span>
                      ))}
                      {more > 0 && <span className="tcal__pill-more">+{more} more</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {dayDrawer ? (
        <div className="tcal__drawer" onClick={() => setDayDrawer(null)}>
          <div className="tcal__drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="tcal__drawer-head">
              <div>
                <strong>{dayDrawer.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</strong>
                <div style={{ fontSize: 12, color: "var(--os-ink-3)" }}>{(byDay.get(dayDrawer.toISOString().slice(0, 10)) ?? []).length} task(s)</div>
              </div>
              <button type="button" onClick={() => setDayDrawer(null)} aria-label="Close">✕</button>
            </div>
            <div className="tcal__drawer-list">
              {(byDay.get(dayDrawer.toISOString().slice(0, 10)) ?? []).map((t) => (
                <div key={t.id} className="tcal__drawer-item">
                  <span className="tcal__drawer-dot" style={{ background: STATUS_COLOR[t.status] }} />
                  <span>{t.title}</span>
                  {t.assignee && <span className="tcal__drawer-who">{t.assignee.firstName} {t.assignee.lastName}</span>}
                </div>
              ))}
              {(byDay.get(dayDrawer.toISOString().slice(0, 10)) ?? []).length === 0 && (
                <div style={{ padding: 12, color: "var(--os-ink-3)", fontStyle: "italic", fontSize: 12 }}>No tasks on this day.</div>
              )}
            </div>
            <div className="tcal__drawer-add">
              <Plus />
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { void addOnDay(dayDrawer, draft); setDayDrawer(null); } }}
                placeholder={`Add task to ${dayDrawer.toLocaleDateString("en-US", { month: "short", day: "numeric" })}…`}
                autoFocus
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
