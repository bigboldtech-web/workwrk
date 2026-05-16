// Shared types for the Work Calendar task surface.
// The API returns tasks with optional nested labels/counts depending on
// the caller; keep all fields optional here so views don't have to
// narrow individually.

export interface TaskLabel {
  id: string;
  name: string;
  color: string;
}

export interface TaskLabelOnTask {
  labelId: string;
  label: TaskLabel;
}

export interface TaskAssignee {
  id: string;
  firstName: string;
  lastName: string;
  avatar?: string | null;
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  date: string;
  startAt?: string | null;
  endAt?: string | null;
  allDay?: boolean;
  estimateHours?: number | null;
  hoursSpent?: number | null;
  completedAt?: string | null;
  category?: string | null;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  incompleteReason?: string | null;
  recurringGroupId?: string | null;
  parentTaskId?: string | null;
  externalSource?: string | null;
  externalId?: string | null;
  assignee?: TaskAssignee;
  kra?: { id: string; name: string } | null;
  labels?: TaskLabelOnTask[];
  _count?: { subTasks: number; comments: number };
  // Within-day order for the week-view DnD. Null on tasks that have
  // never been reordered — render those last (using id as the tiebreaker
  // gives a stable secondary order).
  dayPosition?: number | null;
}

export interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
  avatar?: string;
}

export type CalendarView = "day" | "week" | "month" | "list" | "gantt";

/** Elapsed-days computation for Gantt bars and list hover cards.
 *  Returns calendar days (inclusive) between a task's scheduled start and
 *  either its completion or today (for in-flight tasks). Null for tasks
 *  without a meaningful anchor yet.
 */
export function elapsedDays(task: Pick<Task, "date" | "startAt" | "endAt" | "completedAt" | "status">): number | null {
  const anchor = task.startAt ?? task.date;
  if (!anchor) return null;
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const endRef =
    task.status === "COMPLETED" && task.completedAt
      ? new Date(task.completedAt)
      : new Date();
  endRef.setHours(0, 0, 0, 0);
  const diff = Math.round((endRef.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, diff) + 1;
}

/** Scheduled span (calendar days, inclusive) based on startAt/endAt or
 *  falling back to the legacy single-day `date`. */
export function scheduledDays(task: Pick<Task, "date" | "startAt" | "endAt">): number {
  const start = task.startAt ?? task.date;
  const end = task.endAt ?? task.startAt ?? task.date;
  const s = new Date(start); s.setHours(0, 0, 0, 0);
  const e = new Date(end);   e.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)) + 1);
}

export function formatISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
