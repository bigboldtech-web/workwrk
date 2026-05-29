"use client";

/* Tasks · Calendar — full-bleed month grid.
 *
 * Month nav in the header. Stat strip showing this-month breakdown.
 * Each cell shows up to 3 task pills colored by status, with a small
 * priority flame for P0/P1. Click a day → drawer with all tasks +
 * inline add. Drag a pill to reschedule.
 *
 *  GET   /api/tasks?startDate=…&endDate=…
 *  POST  /api/tasks { title, date, allDay }
 *  PATCH /api/tasks { id, date }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, Flame,
  CheckSquare, Activity, AlertOctagon, Hourglass,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";
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
const STATUS_LABEL: Record<ApiStatus, string> = {
  PLANNED: "Planned", IN_PROGRESS: "In progress", COMPLETED: "Completed",
};

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Mon-start grid: 42 days covering the month's full weeks.
function gridDays(month: Date): Date[] {
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * MS_DAY));
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?";
}

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
    // Sort each day by priority then title
    const prioRank: Record<ApiPrio, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    for (const [, arr] of m) arr.sort((a, b) => prioRank[a.priority] - prioRank[b.priority] || a.title.localeCompare(b.title));
    return m;
  }, [tasks]);

  const days = useMemo(() => gridDays(month), [month]);
  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  // Stats for the visible month
  const stats = useMemo(() => {
    const monthTasks = (tasks ?? []).filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
    });
    return {
      total: monthTasks.length,
      planned: monthTasks.filter((t) => t.status === "PLANNED").length,
      inProgress: monthTasks.filter((t) => t.status === "IN_PROGRESS").length,
      completed: monthTasks.filter((t) => t.status === "COMPLETED").length,
      late: monthTasks.filter((t) => t.status !== "COMPLETED" && new Date(t.date).getTime() < today0).length,
    };
  }, [tasks, month, today0]);

  async function addOnDay(date: Date, title: string) {
    if (!title.trim()) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), date: date.toISOString(), allDay: true }),
      });
      if (!res.ok) throw new Error();
      setDraft("");
      void load();
    } catch { toast("Couldn't add"); }
  }

  async function reschedule(id: string, day: Date) {
    setTasks((prev) => prev?.map((t) => t.id === id ? { ...t, date: day.toISOString() } : t) ?? prev);
    try {
      const res = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, date: day.toISOString() }) });
      if (!res.ok) throw new Error();
    } catch { toast("Couldn't move"); void load(); }
  }

  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <>
      <OsTitleBar
        title="Task calendar"
        Icon={CalendarDays}
        iconGradient={GRAD.pinkPurple}
        description={tasks === null ? "Loading…" : `${monthLabel} · ${stats.total} task${stats.total === 1 ? "" : "s"} this month`}
        people={[PEOPLE.bb, PEOPLE.sc]}
        morePeople={3}
        actions={
          <div className="tcal__head-actions">
            <div className="tcal__nav">
              <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft /></button>
              <span className="tcal__nav-label">{monthLabel}</span>
              <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight /></button>
            </div>
            <button type="button" onClick={() => setMonth(startOfMonth(new Date()))} className="tcal__today">Today</button>
          </div>
        }
      />

      {loadError ? (
        <div className="tcal__loading">Couldn&apos;t load: {loadError}</div>
      ) : (
        <div className="tcal">
          {/* Stat strip */}
          {stats.total > 0 && (
            <div className="tcal__stats">
              <Stat Icon={Hourglass} label="Planned" value={stats.planned} color="var(--os-c-indigo)" />
              <Stat Icon={Activity} label="In progress" value={stats.inProgress} color="var(--os-c-orange)" />
              <Stat Icon={CheckSquare} label="Completed" value={stats.completed} color="var(--os-c-green)" />
              <Stat Icon={AlertOctagon} label="Late" value={stats.late} color="var(--os-c-red)" highlight={stats.late > 0} />
            </div>
          )}

          {/* Calendar grid */}
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
                        {isToday ? <span className="tcal__cell-today">Today</span> : null}
                      </div>
                      <div className="tcal__cell-pills">
                        {visible.map((t) => (
                          <span
                            key={t.id}
                            className={`tcal__pill ${t.status === "COMPLETED" ? "is-done" : ""}`}
                            style={{ background: STATUS_COLOR[t.status] }}
                            draggable
                            onDragStart={(e) => { e.stopPropagation(); setDragId(t.id); }}
                            onClick={(e) => e.stopPropagation()}
                            title={t.title}
                          >
                            {(t.priority === "URGENT" || t.priority === "HIGH") && (
                              <Flame className="tcal__pill-flame" />
                            )}
                            <span className="tcal__pill-text">{t.title}</span>
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
        </div>
      )}

      {/* Day drawer */}
      {dayDrawer && (
        <div className="tcal__drawer" onClick={() => setDayDrawer(null)}>
          <aside className="tcal__drawer-panel" onClick={(e) => e.stopPropagation()}>
            <header className="tcal__drawer-head">
              <div>
                <strong>{dayDrawer.toLocaleDateString("en-US", { weekday: "long" })}</strong>
                <span>{dayDrawer.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {(byDay.get(isoDate(dayDrawer)) ?? []).length} task(s)</span>
              </div>
              <button type="button" onClick={() => setDayDrawer(null)} aria-label="Close"><X /></button>
            </header>
            <div className="tcal__drawer-body">
              {(byDay.get(isoDate(dayDrawer)) ?? []).map((t) => (
                <div key={t.id} className="tcal__drawer-item">
                  <span className="tcal__drawer-dot" style={{ background: STATUS_COLOR[t.status] }} />
                  <div className="tcal__drawer-item-body">
                    <div className="tcal__drawer-item-title">{t.title}</div>
                    <div className="tcal__drawer-item-meta">
                      <span>{STATUS_LABEL[t.status]}</span>
                      {(t.priority === "URGENT" || t.priority === "HIGH") && (
                        <span className={`tcal__drawer-prio tcal__drawer-prio--${t.priority.toLowerCase()}`}>
                          <Flame /> {t.priority === "URGENT" ? "P0" : "P1"}
                        </span>
                      )}
                      {t.assignee && (
                        <span className="tcal__drawer-who">
                          <span className="tcal__drawer-av" style={{ background: avColor(t.assignee.id) }}>
                            {initials(t.assignee.firstName, t.assignee.lastName)}
                          </span>
                          {`${t.assignee.firstName ?? ""} ${t.assignee.lastName ?? ""}`.trim()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {(byDay.get(isoDate(dayDrawer)) ?? []).length === 0 && (
                <div className="tcal__drawer-empty">No tasks on this day yet.</div>
              )}
            </div>
            <footer className="tcal__drawer-add">
              <Plus />
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { void addOnDay(dayDrawer, draft); setDayDrawer(null); } }}
                placeholder={`Add task to ${dayDrawer.toLocaleDateString("en-US", { month: "short", day: "numeric" })}…`}
                autoFocus
              />
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}

function Stat({ Icon, label, value, color, highlight }: { Icon: typeof Activity; label: string; value: number; color: string; highlight?: boolean }) {
  return (
    <div className={`tcal-stat ${highlight ? "is-highlight" : ""}`} style={{ ["--stat-color" as string]: color }}>
      <span className="tcal-stat__icon"><Icon /></span>
      <div className="tcal-stat__body">
        <div className="tcal-stat__value">{value}</div>
        <div className="tcal-stat__label">{label}</div>
      </div>
    </div>
  );
}
