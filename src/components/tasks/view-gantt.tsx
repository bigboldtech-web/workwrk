"use client";

import { useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Task } from "./types";
import { elapsedDays, formatISODate, isSameDay, scheduledDays, startOfDay } from "./types";

const DAY_WIDTH = 36;
const ROW_HEIGHT = 40;

/** Gantt — horizontal swimlanes per assignee, horizontal bars per task.
 *
 *  The visual encoding is what makes this the manager lens:
 *    · dashed gray   = scheduled span (startAt → endAt)
 *    · solid green   = actual elapsed (startAt → completedAt OR today)
 *    · red overflow  = elapsed past the scheduled endAt
 *    · pulsing edge  = still open past its scheduled end
 *
 *  Sub-tasks are rolled up into the parent's bar — this view renders
 *  top-level tasks only. */
export function GanttView({
  from,
  to,
  tasks,
  onOpenTask,
}: {
  from: Date;
  to: Date;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}) {
  const days = useMemo(() => buildDayRange(from, to), [from, to]);
  const today = new Date();

  const swimlanes = useMemo(() => {
    // Group top-level tasks by assignee. Exclude Google Calendar events —
    // they're overlay events, not work units, and don't map onto the
    // "how long did it take" visualization.
    const map = new Map<string, { assignee: { id: string; name: string; avatar?: string | null }; tasks: Task[] }>();
    for (const t of tasks) {
      if (t.parentTaskId) continue;
      // External calendar events and meetings aren't work units.
      if (t.externalSource === "GCAL" || t.externalSource === "MEETING") continue;
      if (!t.assignee) continue;
      const key = t.assignee.id;
      const existing = map.get(key) ?? {
        assignee: {
          id: t.assignee.id,
          name: `${t.assignee.firstName} ${t.assignee.lastName}`,
          avatar: t.assignee.avatar,
        },
        tasks: [],
      };
      existing.tasks.push(t);
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => a.assignee.name.localeCompare(b.assignee.name));
  }, [tasks]);

  if (swimlanes.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
        No tasks in this range. Gantt shows what each person is scheduled for and how long it took.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="flex">
        {/* Left column: assignees + task titles */}
        <div className="w-56 shrink-0 border-r border-border">
          <div className="h-8 border-b border-border px-3 flex items-center text-[10px] text-muted font-medium uppercase">
            Person / Task
          </div>
          {swimlanes.map((lane) => (
            <div key={lane.assignee.id}>
              <div className="h-8 px-3 flex items-center gap-2 border-b border-border bg-surface-2/40">
                <Avatar className="h-5 w-5">
                  {lane.assignee.avatar ? <AvatarImage src={lane.assignee.avatar} alt="" /> : null}
                  <AvatarFallback className="text-[9px]">
                    {lane.assignee.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium truncate">{lane.assignee.name}</span>
                <span className="ml-auto text-[10px] text-muted">{lane.tasks.length}</span>
              </div>
              {lane.tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onOpenTask(t)}
                  className="w-full h-10 px-3 flex items-center text-left border-b border-border text-xs truncate hover:bg-surface-2/50"
                >
                  {t.title}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Right column: scrolling timeline */}
        <div className="flex-1 overflow-x-auto">
          <div style={{ width: days.length * DAY_WIDTH }}>
            {/* Date header */}
            <div className="h-8 border-b border-border flex bg-surface-2/40">
              {days.map((d) => (
                <div
                  key={formatISODate(d)}
                  className={`shrink-0 flex flex-col items-center justify-center text-[10px] border-r border-border ${
                    isSameDay(d, today) ? "text-[#d4ff2e] font-semibold" : "text-muted"
                  }`}
                  style={{ width: DAY_WIDTH }}
                >
                  <span>{d.getDate()}</span>
                  <span className="text-[9px] opacity-70">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                </div>
              ))}
            </div>

            {/* Rows */}
            {swimlanes.map((lane) => (
              <div key={lane.assignee.id}>
                <div className="h-8 border-b border-border bg-surface-2/40" />
                {lane.tasks.map((t) => (
                  <GanttRow key={t.id} task={t} days={days} today={today} onOpen={() => onOpenTask(t)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GanttRow({ task, days, today, onOpen }: { task: Task; days: Date[]; today: Date; onOpen: () => void }) {
  const rangeStart = days[0];
  const anchor = task.startAt ?? task.date;
  if (!anchor) return <div className="h-10 border-b border-border" />;
  const sched = scheduledDays(task);

  const startDay = startOfDay(new Date(anchor));
  const fromOffset = Math.floor((startDay.getTime() - startOfDay(rangeStart).getTime()) / (24 * 60 * 60 * 1000));
  const scheduledX = Math.max(0, fromOffset) * DAY_WIDTH;
  const scheduledW = Math.max(DAY_WIDTH * 0.6, sched * DAY_WIDTH - 2);

  // Actual bar width: from start to completedAt (if done) or to today (if in-flight).
  const elapsed = elapsedDays(task) ?? 1;
  const actualW = Math.max(DAY_WIDTH * 0.6, elapsed * DAY_WIDTH - 2);
  const overflowW = Math.max(0, actualW - scheduledW);
  const solidW = Math.min(actualW, scheduledW);

  const stillOpen = task.status !== "COMPLETED";
  const lateByDays = Math.max(0, elapsed - sched);
  const title =
    `${task.title}\n` +
    `Scheduled: ${sched} day${sched !== 1 ? "s" : ""}\n` +
    `Elapsed: ${elapsed} day${elapsed !== 1 ? "s" : ""}${lateByDays > 0 ? ` (${lateByDays} late)` : ""}` +
    `${task.estimateHours ? `\nEstimated: ${task.estimateHours}h` : ""}` +
    `${task.hoursSpent ? ` · actual ${task.hoursSpent}h` : ""}`;

  // Today marker offset (for in-flight visualization).
  const todayStart = startOfDay(today).getTime();
  const todayOffset = Math.floor((todayStart - startOfDay(rangeStart).getTime()) / (24 * 60 * 60 * 1000));
  const todayX = todayOffset * DAY_WIDTH + DAY_WIDTH / 2;

  return (
    <button onClick={onOpen} className="relative block w-full h-10 border-b border-border hover:bg-surface-2/40" title={title}>
      {/* Today vertical line */}
      {todayOffset >= 0 && todayOffset < days.length && (
        <div
          aria-hidden
          className="absolute top-0 bottom-0 w-px bg-[rgba(212,255,46,0.4)] pointer-events-none"
          style={{ left: todayX }}
        />
      )}

      {/* Scheduled (dashed) */}
      <div
        className="absolute top-1.5 h-7 rounded border border-dashed border-border/80"
        style={{ left: scheduledX, width: scheduledW }}
      />

      {/* Solid actual portion (clamped to scheduled width) */}
      <div
        className={`absolute top-2 h-5 rounded ${
          task.status === "COMPLETED" ? "bg-[rgba(212,255,46,0.75)]" : "bg-[rgba(212,255,46,0.45)]"
        } ${stillOpen && lateByDays > 0 ? "animate-pulse" : ""}`}
        style={{ left: scheduledX, width: solidW }}
      />

      {/* Red overflow if elapsed past scheduled end */}
      {overflowW > 0 && (
        <div
          className="absolute top-2 h-5 rounded-r bg-[rgba(255,107,107,0.55)]"
          style={{ left: scheduledX + scheduledW, width: overflowW }}
        />
      )}
    </button>
  );
}

function buildDayRange(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const start = startOfDay(from);
  const end = startOfDay(to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  return days;
}
