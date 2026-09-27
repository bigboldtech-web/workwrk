// Workload counting (spec-teams-people /team/workload "Counting rules"), the
// ONE implementation the Workload grid renders for both surfaces: the
// cross-List /team/workload page and a List's WORKLOAD view.
//
//   People      an item counts in EVERY assignee's row (the owner plus each
//               of assigneeIds, once each). No assignee: the Unassigned row.
//   Days        startAt and dueAt: spread evenly over the WORKING days of
//               the span in that person's schedule (weekends and holidays
//               out, unless Count weekends, which puts every non-holiday
//               day in). A span with no working day at all spreads over its
//               calendar days, so work scheduled onto a weekend is shown on
//               the weekend rather than lost. Only one of the two dates: that
//               day. Neither: Unscheduled. A span outside the window adds
//               nothing inside it.
//   Tasks mode  load = items touching the day, one per assignee.
//   Hours mode  load = the estimate (Item.metadata.timeEstimate, minutes,
//               the field the task drawer's Estimate writes) split EVENLY
//               across the assignees (the founder-taken recommendation),
//               then across the span's spread days. An item with no
//               estimate counts 0 hours and is flagged as unestimated.
//   Capacity    per working day: weeklyCapacityHours / working days a week
//               of the person's schedule when set, else the schedule's hours
//               a day; 0 on a day off or a holiday (a holiday stays 0 even
//               with Count weekends). Tasks mode: the viewer's dailyTasks.
//               Over capacity is load > capacity, strictly.
//
// Pure: imports only the pure work-schedule helpers. Client safe.

import { holidayOn, isWorkingDay, type WorkSchedule } from "@/lib/work-schedule";

export const UNASSIGNED = "__unassigned__";
const DAY_MS = 86_400_000;

export interface WorkloadItemInput {
  id: string;
  ownerId: string | null;
  assigneeIds?: readonly string[] | null;
  startAt?: Date | string | null;
  dueAt?: Date | string | null;
  /** Minutes (Item.metadata.timeEstimate), or null / 0 for none. */
  estimateMinutes?: number | null;
}

export interface DayCount {
  tasks: number;
  hours: number;
  unestimated: number;
  /** Items touching this day, for the day popover. */
  itemIds: string[];
}

export interface PersonLoad {
  key: string;
  days: DayCount[];
  /** Items with neither date, for the Unscheduled column. */
  unscheduled: string[];
  /** Dated items touching the window. */
  windowItems: string[];
  totalTasks: number;
  totalHours: number;
}

export interface WorkloadWindow {
  /** Local midnight of the first day. */
  from: Date;
  days: number;
  countWeekends: boolean;
}

function localDay(raw: Date | string | null | undefined): Date | null {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Whole local days between two local midnights (DST safe). */
function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Is this date one the person spreads work over? */
export function spreadsOn(schedule: WorkSchedule, day: Date, countWeekends: boolean): boolean {
  if (holidayOn(schedule, day)) return false;
  return countWeekends ? true : isWorkingDay(schedule, day);
}

/** The people an item belongs to: owner first, then the rest, no repeats. */
export function assigneesOf(item: Pick<WorkloadItemInput, "ownerId" | "assigneeIds">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [item.ownerId, ...(item.assigneeIds ?? [])]) {
    if (id && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

export function computeWorkload(
  items: readonly WorkloadItemInput[],
  personIds: readonly string[],
  win: WorkloadWindow,
  scheduleFor: (personKey: string) => WorkSchedule,
): Map<string, PersonLoad> {
  const rows = new Map<string, PersonLoad>();
  const ensure = (key: string): PersonLoad => {
    let r = rows.get(key);
    if (!r) {
      r = {
        key,
        days: Array.from({ length: win.days }, () => ({ tasks: 0, hours: 0, unestimated: 0, itemIds: [] })),
        unscheduled: [],
        windowItems: [],
        totalTasks: 0,
        totalHours: 0,
      };
      rows.set(key, r);
    }
    return r;
  };
  for (const id of personIds) ensure(id);
  const from = new Date(win.from.getFullYear(), win.from.getMonth(), win.from.getDate());

  for (const it of items) {
    const people = assigneesOf(it);
    const keys = people.length ? people : [UNASSIGNED];
    const est = typeof it.estimateMinutes === "number" && Number.isFinite(it.estimateMinutes) && it.estimateMinutes > 0 ? it.estimateMinutes : 0;
    const hoursEach = est / 60 / keys.length;
    let lo = localDay(it.startAt);
    let hi = localDay(it.dueAt);
    if (!lo && !hi) {
      for (const k of keys) ensure(k).unscheduled.push(it.id);
      continue;
    }
    if (!lo) lo = hi;
    if (!hi) hi = lo;
    if (hi!.getTime() < lo!.getTime()) [lo, hi] = [hi, lo];
    const span = dayDiff(lo!, hi!) + 1;
    // Cheap reject: a span wholly outside the window adds nothing.
    if (dayDiff(from, hi!) < 0 || dayDiff(from, lo!) >= win.days) continue;

    for (const k of keys) {
      const schedule = scheduleFor(k);
      const spread: Date[] = [];
      for (let i = 0; i < span; i += 1) {
        const d = addDays(lo!, i);
        if (spreadsOn(schedule, d, win.countWeekends)) spread.push(d);
      }
      const days = spread.length ? spread : Array.from({ length: span }, (_, i) => addDays(lo!, i));
      const perDay = hoursEach / days.length;
      const row = ensure(k);
      let touched = false;
      for (const d of days) {
        const idx = dayDiff(from, d);
        if (idx < 0 || idx >= win.days) continue;
        const cell = row.days[idx];
        cell.tasks += 1;
        cell.hours += perDay;
        if (est === 0) cell.unestimated += 1;
        cell.itemIds.push(it.id);
        touched = true;
      }
      if (touched) row.windowItems.push(it.id);
    }
  }
  for (const r of rows.values()) {
    r.totalTasks = r.days.reduce((s, d) => s + d.tasks, 0);
    r.totalHours = r.days.reduce((s, d) => s + d.hours, 0);
  }
  return rows;
}

export interface CapacityInput {
  schedule: WorkSchedule;
  /** The person's own weekly hours (User.weeklyCapacityHours), null = the schedule's. */
  weeklyCapacityHours?: number | null;
  /** A per-view daily override (a List's WORKLOAD view), wins over both. */
  dailyHoursOverride?: number | null;
}

/** Hours a day on a working day, before the day-off test. */
export function dailyHoursFor(c: CapacityInput): number {
  if (typeof c.dailyHoursOverride === "number" && Number.isFinite(c.dailyHoursOverride) && c.dailyHoursOverride >= 0) return c.dailyHoursOverride;
  if (typeof c.weeklyCapacityHours === "number" && Number.isFinite(c.weeklyCapacityHours) && c.weeklyCapacityHours >= 0) {
    const n = c.schedule.workdays.length;
    return n > 0 ? c.weeklyCapacityHours / n : 0;
  }
  return c.schedule.hoursPerDay;
}

export function capacityOn(
  c: CapacityInput,
  day: Date,
  opts: { mode: "tasks" | "hours"; dailyTasks: number; countWeekends: boolean },
): number {
  if (holidayOn(c.schedule, day)) return 0;
  if (!opts.countWeekends && !isWorkingDay(c.schedule, day)) return 0;
  return opts.mode === "hours" ? dailyHoursFor(c) : opts.dailyTasks;
}

/** Load strictly above capacity; 0 when at or under. */
export function overBy(load: number, capacity: number): number {
  return load > capacity ? load - capacity : 0;
}
