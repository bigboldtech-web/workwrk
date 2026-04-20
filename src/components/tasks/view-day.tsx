"use client";

import { useMemo } from "react";
import { CheckCircle2, Circle, Play } from "lucide-react";
import type { Task } from "./types";
import { formatISODate, isSameDay } from "./types";

const HOUR_START = 6;   // 06:00
const HOUR_END = 22;    // 22:00 (exclusive — last row is 21:30–22:00)
const SLOT_MINUTES = 30;
const SLOT_PX = 24;     // height of one 30-min slot

function statusIcon(status: string) {
  if (status === "COMPLETED") return <CheckCircle2 size={12} className="text-[#d4ff2e]" />;
  if (status === "IN_PROGRESS") return <Play size={12} className="text-amber-400" />;
  return <Circle size={12} className="text-muted" />;
}

function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function formatHour(h: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display} ${period}`;
}

/** Day view — hour grid with 30-min slots. Timed tasks render as
 *  positioned blocks; all-day tasks stack in a top strip so they're
 *  visible without scrolling. */
export function DayView({
  date,
  tasks,
  onOpenTask,
  onNewTaskAt,
}: {
  date: Date;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onNewTaskAt: (date: string, hhmm?: string) => void;
}) {
  const dayKey = formatISODate(date);

  const { timed, allDay } = useMemo(() => {
    const timed: Task[] = [];
    const allDay: Task[] = [];
    for (const t of tasks) {
      // A task shows on this day if it's scheduled for it (date match) OR its
      // span overlaps it. Timed = has real startAt AND not marked allDay.
      const taskDate = new Date(t.startAt ?? t.date);
      if (!isSameDay(taskDate, date)) {
        // Multi-day task that overlaps: show as all-day pill for continuity.
        if (t.startAt && t.endAt) {
          const s = new Date(t.startAt); s.setHours(0, 0, 0, 0);
          const e = new Date(t.endAt);   e.setHours(0, 0, 0, 0);
          const d = new Date(date);      d.setHours(0, 0, 0, 0);
          if (d >= s && d <= e) allDay.push(t);
        }
        continue;
      }
      if (!t.allDay && t.startAt) timed.push(t);
      else allDay.push(t);
    }
    return { timed, allDay };
  }, [tasks, date]);

  const rows = (HOUR_END - HOUR_START) * 2; // 30-min slots

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* All-day strip */}
      {allDay.length > 0 && (
        <div className="border-b border-border p-2 space-y-1 bg-surface-2/40">
          {allDay.map((t) => {
            const source = t.externalSource;
            const cls = source === "GCAL"
              ? "bg-[rgba(74,158,255,0.10)] hover:bg-[rgba(74,158,255,0.18)]"
              : source === "MEETING"
                ? "bg-[rgba(255,153,51,0.10)] hover:bg-[rgba(255,153,51,0.18)]"
                : "bg-[rgba(212,255,46,0.08)] hover:bg-[rgba(212,255,46,0.14)]";
            const badgeText = source === "GCAL" ? "GCal" : source === "MEETING" ? "Meeting" : null;
            const badgeCls = source === "GCAL"
              ? "bg-[rgba(74,158,255,0.25)] text-[#4a9eff]"
              : "bg-[rgba(255,153,51,0.25)] text-[#ff9933]";
            return (
              <button
                key={t.id}
                onClick={() => onOpenTask(t)}
                className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded-md text-xs transition-colors ${cls}`}
                title={source === "GCAL" ? "From Google Calendar — read-only" : source === "MEETING" ? "Meeting — open in Meetings" : undefined}
              >
                {statusIcon(t.status)}
                <span className="truncate flex-1">{t.title}</span>
                {badgeText && <span className={`text-[9px] px-1 rounded ${badgeCls}`}>{badgeText}</span>}
                {t.assignee && <span className="text-[10px] text-muted">{t.assignee.firstName}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Hour grid */}
      <div className="relative flex">
        {/* Hour gutter */}
        <div className="w-14 shrink-0 border-r border-border text-[10px] text-muted">
          {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i).map((h) => (
            <div key={h} style={{ height: SLOT_PX * 2 }} className="flex items-start justify-end pr-1.5 pt-0.5">
              {formatHour(h)}
            </div>
          ))}
        </div>

        {/* Slot grid */}
        <div className="flex-1 relative" style={{ height: rows * SLOT_PX }}>
          {/* Background slots (click to create) */}
          {Array.from({ length: rows }, (_, i) => {
            const totalMin = HOUR_START * 60 + i * SLOT_MINUTES;
            const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
            const mm = String(totalMin % 60).padStart(2, "0");
            const isHour = i % 2 === 0;
            return (
              <button
                key={i}
                onClick={() => onNewTaskAt(dayKey, `${hh}:${mm}`)}
                className={`absolute inset-x-0 hover:bg-surface-2/60 transition-colors ${isHour ? "border-t" : "border-t border-dashed"} border-border/60`}
                style={{ top: i * SLOT_PX, height: SLOT_PX }}
                aria-label={`Create task at ${hh}:${mm}`}
              />
            );
          })}

          {/* Positioned task blocks */}
          {timed.map((t) => {
            if (!t.startAt) return null;
            const start = new Date(t.startAt);
            const end = t.endAt ? new Date(t.endAt) : new Date(start.getTime() + 30 * 60 * 1000);
            const top = ((minutesFromMidnight(start) - HOUR_START * 60) / SLOT_MINUTES) * SLOT_PX;
            const height = Math.max(SLOT_PX - 2, ((end.getTime() - start.getTime()) / 60000 / SLOT_MINUTES) * SLOT_PX - 2);
            const hidden = top + height < 0 || top > rows * SLOT_PX;
            if (hidden) return null;
            const source = t.externalSource;
            const cls = source === "GCAL"
              ? "bg-[rgba(74,158,255,0.14)] border-[rgba(74,158,255,0.35)] hover:bg-[rgba(74,158,255,0.22)]"
              : source === "MEETING"
                ? "bg-[rgba(255,153,51,0.14)] border-[rgba(255,153,51,0.35)] hover:bg-[rgba(255,153,51,0.22)]"
                : "bg-[rgba(212,255,46,0.14)] border-[rgba(212,255,46,0.35)] hover:bg-[rgba(212,255,46,0.2)]";
            const badgeText = source === "GCAL" ? "GCal" : source === "MEETING" ? "Meeting" : null;
            const badgeCls = source === "GCAL"
              ? "bg-[rgba(74,158,255,0.25)] text-[#4a9eff]"
              : "bg-[rgba(255,153,51,0.25)] text-[#ff9933]";
            return (
              <button
                key={t.id}
                onClick={() => onOpenTask(t)}
                className={`absolute left-1 right-1 rounded-md px-2 py-1 text-left transition-colors overflow-hidden border ${cls}`}
                style={{ top: Math.max(0, top), height }}
                title={source === "GCAL" ? "From Google Calendar — read-only" : source === "MEETING" ? "Meeting — open in Meetings" : undefined}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  {statusIcon(t.status)}
                  <span className="truncate">{t.title}</span>
                  {badgeText && <span className={`ml-auto text-[9px] px-1 rounded ${badgeCls}`}>{badgeText}</span>}
                </div>
                {height > SLOT_PX * 1.2 && t.assignee && (
                  <div className="text-[10px] text-muted mt-0.5">{t.assignee.firstName} {t.assignee.lastName}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
