"use client";

/* Tasks · Gantt — horizontal timeline.
 *
 * Rows: every task (sorted by start date).
 * Columns: days in the visible window (default 60 days, today centered).
 * Bars: scheduled span from start to end, colored by status, with a
 *       priority dot at the left edge. Today's vertical guide line.
 * Group toggle: by status / by assignee.
 *
 * GET   /api/tasks?startDate=…&endDate=…
 * PATCH /api/tasks { id, date }   (drag the whole bar to reschedule)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GanttChart, ChevronLeft, ChevronRight } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type ApiStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED";
type ApiTask = {
  id: string;
  title: string;
  date: string;
  startAt?: string | null;
  endAt?: string | null;
  status: ApiStatus;
  priority: ApiPrio;
  estimateHours?: number | null;
  assignee?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const MS_DAY = 86_400_000;
const COL_W = 28; // px per day
const ROW_H = 32;

const STATUS_COLOR: Record<ApiStatus, string> = {
  PLANNED: "var(--os-c-indigo)", IN_PROGRESS: "var(--os-c-orange)", COMPLETED: "var(--os-c-green)",
};
const PRIO_COLOR: Record<ApiPrio, string> = {
  URGENT: "var(--os-c-red)", HIGH: "var(--os-c-orange)",
  NORMAL: "var(--os-c-blue)", LOW: "var(--os-c-darkgray)",
};

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function taskSpan(t: ApiTask): { start: Date; end: Date } {
  const start = t.startAt ? new Date(t.startAt) : new Date(t.date);
  let end: Date;
  if (t.endAt) end = new Date(t.endAt);
  else if (t.estimateHours && t.estimateHours > 8) end = new Date(start.getTime() + Math.ceil(t.estimateHours / 8) * MS_DAY);
  else end = new Date(start.getTime() + MS_DAY);
  return { start: startOfDay(start), end: startOfDay(end) };
}

type GroupBy = "status" | "assignee";

export default function GanttPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<Date>(() => startOfDay(new Date(Date.now() - 14 * MS_DAY)));
  const [windowDays, setWindowDays] = useState<number>(60);
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const from = new Date(windowStart.getTime() - 30 * MS_DAY).toISOString().slice(0, 10);
      const to = new Date(windowStart.getTime() + (windowDays + 30) * MS_DAY).toISOString().slice(0, 10);
      const res = await fetch(`/api/tasks?startDate=${from}&endDate=${to}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiTask[] = Array.isArray(data) ? data : (data.data ?? []);
      setTasks(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [windowStart, windowDays]);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("tasks");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const days = useMemo(() => Array.from({ length: windowDays }, (_, i) => new Date(windowStart.getTime() + i * MS_DAY)), [windowStart, windowDays]);
  const today0 = startOfDay(new Date()).getTime();
  const todayOffset = Math.floor((today0 - windowStart.getTime()) / MS_DAY);

  const sorted = useMemo(() => {
    return [...(tasks ?? [])].sort((a, b) => taskSpan(a).start.getTime() - taskSpan(b).start.getTime());
  }, [tasks]);

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; title: string; color: string; items: ApiTask[] }>();
    for (const t of sorted) {
      if (groupBy === "status") {
        const key = t.status;
        const title = key === "PLANNED" ? "Planned" : key === "IN_PROGRESS" ? "In progress" : "Done";
        if (!map.has(key)) map.set(key, { id: key, title, color: STATUS_COLOR[t.status], items: [] });
        map.get(key)!.items.push(t);
      } else {
        const key = t.assignee?.id ?? "__none";
        const title = t.assignee ? `${t.assignee.firstName ?? ""} ${t.assignee.lastName ?? ""}`.trim() || "Unknown" : "Unassigned";
        if (!map.has(key)) map.set(key, { id: key, title, color: "var(--os-c-indigo)", items: [] });
        map.get(key)!.items.push(t);
      }
    }
    return Array.from(map.values());
  }, [sorted, groupBy]);

  async function rescheduleTask(t: ApiTask, daysShift: number) {
    const newDate = new Date(new Date(t.date).getTime() + daysShift * MS_DAY).toISOString();
    setTasks((prev) => prev?.map((x) => x.id === t.id ? { ...x, date: newDate } : x) ?? prev);
    try {
      const res = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, date: newDate }) });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch { toast("Couldn't reschedule"); void load(); }
  }

  const totalWidth = windowDays * COL_W;
  const monthHeaders = useMemo(() => {
    const headers: { label: string; offset: number; days: number }[] = [];
    let cursor = 0;
    while (cursor < windowDays) {
      const d = days[cursor];
      const monthStart = cursor;
      let span = 0;
      while (cursor < windowDays && days[cursor].getMonth() === d.getMonth() && days[cursor].getFullYear() === d.getFullYear()) {
        cursor += 1; span += 1;
      }
      headers.push({ label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }), offset: monthStart, days: span });
    }
    return headers;
  }, [days, windowDays]);

  return (
    <div className="gantt">
      <header className="gantt__head">
        <div className="gantt__head-l">
          <div className="gantt__icon"><GanttChart /></div>
          <div>
            <h1 className="gantt__title">Gantt</h1>
            <div className="gantt__sub">
              {tasks === null ? "Loading…" : `${sorted.length} task${sorted.length === 1 ? "" : "s"} in window · ${windowDays}-day view`}
            </div>
          </div>
        </div>
        <div className="gantt__controls">
          <div className="gantt__group">
            <span>Group:</span>
            <button type="button" className={groupBy === "status" ? "is-active" : ""} onClick={() => setGroupBy("status")}>Status</button>
            <button type="button" className={groupBy === "assignee" ? "is-active" : ""} onClick={() => setGroupBy("assignee")}>Assignee</button>
          </div>
          <div className="gantt__nav">
            <button type="button" onClick={() => setWindowStart(new Date(windowStart.getTime() - 14 * MS_DAY))}><ChevronLeft /></button>
            <button type="button" onClick={() => setWindowStart(startOfDay(new Date(Date.now() - 14 * MS_DAY)))} className="gantt__nav-today">Today</button>
            <button type="button" onClick={() => setWindowStart(new Date(windowStart.getTime() + 14 * MS_DAY))}><ChevronRight /></button>
          </div>
        </div>
      </header>

      {loadError ? (
        <div className="gantt__error">Couldn&apos;t load: {loadError}</div>
      ) : (
        <div className="gantt__viewport">
          <aside className="gantt__rail">
            <div className="gantt__rail-head">&nbsp;</div>
            {groups.flatMap((g) => [
              <div key={`g-${g.id}`} className="gantt__rail-group" style={{ borderLeftColor: g.color }}>
                {g.title} <span>{g.items.length}</span>
              </div>,
              ...g.items.map((t) => (
                <div key={t.id} className="gantt__rail-row" title={t.title}>
                  <span className="gantt__rail-prio" style={{ background: PRIO_COLOR[t.priority] }} />
                  <span className="gantt__rail-name">{t.title}</span>
                </div>
              )),
            ])}
          </aside>
          <div className="gantt__scroll">
            <div className="gantt__canvas" style={{ width: totalWidth }}>
              {/* month headers */}
              <div className="gantt__months">
                {monthHeaders.map((m) => (
                  <div key={m.offset} className="gantt__month" style={{ left: m.offset * COL_W, width: m.days * COL_W }}>{m.label}</div>
                ))}
              </div>
              {/* day grid */}
              <div className="gantt__days">
                {days.map((d, i) => {
                  const dow = (d.getDay() + 6) % 7;
                  const isWeekend = dow === 5 || dow === 6;
                  return (
                    <div key={i} className={`gantt__day ${isWeekend ? "is-weekend" : ""}`} style={{ left: i * COL_W }}>
                      <span>{d.getDate()}</span>
                    </div>
                  );
                })}
              </div>
              {/* today line */}
              {todayOffset >= 0 && todayOffset < windowDays && (
                <div className="gantt__today-line" style={{ left: todayOffset * COL_W + COL_W / 2 }}>
                  <span>Today</span>
                </div>
              )}
              {/* group rows + bars */}
              <div className="gantt__rows">
                {groups.flatMap((g) => [
                  <div key={`g-${g.id}`} className="gantt__group-row" style={{ height: ROW_H }} />,
                  ...g.items.map((t) => {
                    const { start, end } = taskSpan(t);
                    const startOffset = Math.max(0, Math.floor((start.getTime() - windowStart.getTime()) / MS_DAY));
                    const endOffset = Math.min(windowDays, Math.ceil((end.getTime() - windowStart.getTime()) / MS_DAY));
                    const visibleSpan = Math.max(1, endOffset - startOffset);
                    const offscreen = end.getTime() < windowStart.getTime() || start.getTime() > windowStart.getTime() + windowDays * MS_DAY;
                    return (
                      <div key={t.id} className="gantt__bar-row" style={{ height: ROW_H }}>
                        {!offscreen && (
                          <div
                            className="gantt__bar"
                            style={{
                              left: startOffset * COL_W,
                              width: visibleSpan * COL_W - 2,
                              background: STATUS_COLOR[t.status],
                              opacity: t.status === "COMPLETED" ? 0.55 : 1,
                            }}
                            title={`${t.title} · ${start.toLocaleDateString()} → ${end.toLocaleDateString()}`}
                            onDoubleClick={() => void rescheduleTask(t, -1)}
                          >
                            <span className="gantt__bar-label">{t.title}</span>
                          </div>
                        )}
                      </div>
                    );
                  }),
                ])}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
