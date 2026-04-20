"use client";

import { useMemo } from "react";
import type { Task } from "./types";
import { formatISODate, isSameDay, startOfDay } from "./types";

/** Month view — compact grid of days. Multi-day tasks render as pills
 *  that span cells; single-day tasks render as stacked chips. Click a
 *  day to drill into Day view. */
export function MonthView({
  month,
  tasks,
  onOpenTask,
  onPickDay,
}: {
  month: Date;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onPickDay: (date: string) => void;
}) {
  const days = useMemo(() => buildMonthGrid(month), [month]);
  const today = new Date();

  // Bucket tasks by ISO day for fast lookup.
  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const anchor = t.startAt ?? t.date;
      const end = t.endAt ?? t.startAt ?? t.date;
      const s = startOfDay(new Date(anchor));
      const e = startOfDay(new Date(end));
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const key = formatISODate(d);
        const bucket = m.get(key) ?? [];
        bucket.push(t);
        m.set(key, bucket);
      }
    }
    return m;
  }, [tasks]);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="grid grid-cols-7 text-[10px] text-muted border-b border-border bg-surface-2/40">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 py-1.5 font-medium">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 auto-rows-fr">
        {days.map(({ date, inMonth }) => {
          const key = formatISODate(date);
          const list = byDay.get(key) ?? [];
          const isToday = isSameDay(date, today);
          return (
            <button
              key={key}
              onClick={() => onPickDay(key)}
              className={`group min-h-[86px] text-left border-r border-b border-border p-1.5 transition-colors hover:bg-surface-2/50 ${
                inMonth ? "" : "opacity-40"
              }`}
            >
              <div className={`text-[11px] font-medium mb-1 ${isToday ? "text-[#d4ff2e]" : ""}`}>
                {date.getDate()}
              </div>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((t) => {
                  const source = t.externalSource;
                  const cls = source === "GCAL"
                    ? "bg-[rgba(74,158,255,0.14)] text-[#4a9eff]"
                    : source === "MEETING"
                      ? "bg-[rgba(255,153,51,0.14)] text-[#ff9933]"
                      : t.status === "COMPLETED"
                        ? "bg-[rgba(212,255,46,0.08)] text-muted line-through"
                        : "bg-[rgba(212,255,46,0.14)] text-foreground";
                  return (
                    <span
                      key={t.id}
                      onClick={(e) => { e.stopPropagation(); onOpenTask(t); }}
                      className={`block truncate text-[10px] rounded px-1 py-0.5 cursor-pointer ${cls}`}
                    >
                      {t.title}
                    </span>
                  );
                })}
                {list.length > 3 && (
                  <span className="block text-[10px] text-muted">+{list.length - 3} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Build a 6-row Mon-Sun grid that always shows the full weeks around
 *  the target month. Padding days are marked `inMonth: false` so they
 *  render dimmed. */
function buildMonthGrid(month: Date): { date: Date; inMonth: boolean }[] {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  // Align to Monday start. JS getDay(): 0=Sun, 1=Mon ... 6=Sat.
  const offset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, m, 1 - offset);

  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === m });
  }
  return cells;
}
