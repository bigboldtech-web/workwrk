import { describe, expect, it } from "vitest";
import { assigneesOf, capacityOn, computeWorkload, dailyHoursFor, overBy, UNASSIGNED } from "./workload-count";
import { WORK_SCHEDULE_DEFAULTS, type WorkSchedule } from "@/lib/work-schedule";

// Mon 21 Sep 2026 .. Sun 4 Oct 2026 (14 days).
const from = new Date(2026, 8, 21);
const win = { from, days: 14, countWeekends: false };
const org: WorkSchedule = { ...WORK_SCHEDULE_DEFAULTS };
const sched = () => org;
const d = (day: number) => new Date(2026, 8, day, 10);

describe("computeWorkload: days", () => {
  it("spreads a start-to-due span over working days only", () => {
    // Fri 25 to Tue 29: Fri, Mon, Tue are working days.
    const m = computeWorkload([{ id: "a", ownerId: "p", startAt: d(25), dueAt: d(29), estimateMinutes: 180 }], ["p"], win, sched);
    const days = m.get("p")!.days;
    expect(days.map((c) => c.tasks)).toEqual([0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    expect(days[4].hours).toBeCloseTo(1);
    expect(m.get("p")!.totalHours).toBeCloseTo(3);
  });

  it("Count weekends spreads over every day of the span", () => {
    const m = computeWorkload([{ id: "a", ownerId: "p", startAt: d(25), dueAt: d(29), estimateMinutes: 300 }], ["p"], { ...win, countWeekends: true }, sched);
    expect(m.get("p")!.days.slice(4, 9).map((c) => c.tasks)).toEqual([1, 1, 1, 1, 1]);
    expect(m.get("p")!.days[5].hours).toBeCloseTo(1);
  });

  it("a due date alone lands on that day, even a Saturday", () => {
    const m = computeWorkload([{ id: "a", ownerId: "p", dueAt: d(26) }], ["p"], win, sched);
    expect(m.get("p")!.days[5].tasks).toBe(1);
  });

  it("a weekend-only span is shown on the weekend, never lost", () => {
    const m = computeWorkload([{ id: "a", ownerId: "p", startAt: d(26), dueAt: d(27), estimateMinutes: 120 }], ["p"], win, sched);
    expect(m.get("p")!.days.slice(5, 7).map((c) => c.hours)).toEqual([1, 1]);
  });

  it("no dates is Unscheduled and adds nothing to a day", () => {
    const m = computeWorkload([{ id: "a", ownerId: "p" }], ["p"], win, sched);
    expect(m.get("p")!.unscheduled).toEqual(["a"]);
    expect(m.get("p")!.totalTasks).toBe(0);
  });

  it("a span outside the window contributes nothing", () => {
    const m = computeWorkload([{ id: "a", ownerId: "p", startAt: new Date(2026, 7, 1), dueAt: new Date(2026, 7, 5) }], ["p"], win, sched);
    expect(m.get("p")!.totalTasks).toBe(0);
    expect(m.get("p")!.windowItems).toEqual([]);
  });

  it("a span crossing the window edge keeps only its share inside", () => {
    // Thu 17 Sep to Tue 22 Sep, 4 working days (17, 18, 21, 22), 8h.
    const m = computeWorkload([{ id: "a", ownerId: "p", startAt: new Date(2026, 8, 17), dueAt: d(22), estimateMinutes: 480 }], ["p"], win, sched);
    expect(m.get("p")!.totalHours).toBeCloseTo(4);
  });

  it("a holiday takes no spread and no capacity", () => {
    const withHoliday: WorkSchedule = { ...org, holidays: [{ date: "2026-09-23", name: "Founders day" }] };
    const m = computeWorkload([{ id: "a", ownerId: "p", startAt: d(22), dueAt: d(24), estimateMinutes: 120 }], ["p"], win, () => withHoliday);
    expect(m.get("p")!.days.slice(1, 4).map((c) => c.hours)).toEqual([1, 0, 1]);
    expect(capacityOn({ schedule: withHoliday }, d(23), { mode: "hours", dailyTasks: 3, countWeekends: true })).toBe(0);
  });
});

describe("computeWorkload: people", () => {
  it("counts once in every assignee's row and splits the hours", () => {
    const m = computeWorkload([{ id: "a", ownerId: "p", assigneeIds: ["p", "q"], dueAt: d(22), estimateMinutes: 240 }], ["p", "q"], win, sched);
    expect(m.get("p")!.days[1]).toMatchObject({ tasks: 1, hours: 2 });
    expect(m.get("q")!.days[1]).toMatchObject({ tasks: 1, hours: 2 });
  });

  it("no assignee goes to Unassigned", () => {
    const m = computeWorkload([{ id: "a", ownerId: null, dueAt: d(22) }], [], win, sched);
    expect(m.get(UNASSIGNED)!.days[1].tasks).toBe(1);
  });

  it("an item without an estimate is flagged in hours mode", () => {
    const m = computeWorkload([{ id: "a", ownerId: "p", dueAt: d(22), estimateMinutes: null }], ["p"], win, sched);
    expect(m.get("p")!.days[1]).toMatchObject({ tasks: 1, hours: 0, unestimated: 1 });
  });

  it("follows each person's own working days", () => {
    const partTime: WorkSchedule = { ...org, workdays: [1, 3, 5] };
    const m = computeWorkload([{ id: "a", ownerId: "p", startAt: d(21), dueAt: d(25), estimateMinutes: 180 }], ["p"], win, () => partTime);
    expect(m.get("p")!.days.slice(0, 5).map((c) => c.hours)).toEqual([1, 0, 1, 0, 1]);
  });

  it("splits over every assignee even when only some are in view", () => {
    // The viewer sees p only; q is outside their scope. p's share is still half.
    const m = computeWorkload([{ id: "a", ownerId: "p", assigneeIds: ["p"], shareCount: 2, dueAt: d(22), estimateMinutes: 480 }], ["p"], win, sched);
    expect(m.get("p")!.days[1].hours).toBe(4);
    expect(m.has("q")).toBe(false);
  });

  it("a shareCount below the ids passed never inflates a share", () => {
    const m = computeWorkload([{ id: "a", ownerId: "p", assigneeIds: ["q"], shareCount: 1, dueAt: d(22), estimateMinutes: 240 }], ["p", "q"], win, sched);
    expect(m.get("p")!.days[1].hours).toBe(2);
  });

  it("lists overdue open work per person whatever the window", () => {
    const today = new Date(2026, 8, 23);
    const items = [
      { id: "late", ownerId: "p", dueAt: new Date(2026, 7, 3, 10) },
      { id: "edge", ownerId: "p", dueAt: d(22) },
      { id: "today", ownerId: "p", dueAt: d(23) },
      { id: "undated", ownerId: "p" },
      { id: "nobody", ownerId: null, dueAt: d(21) },
    ];
    const m = computeWorkload(items, ["p"], { ...win, today }, sched);
    expect(m.get("p")!.overdue).toEqual(["late", "edge"]);
    expect(m.get("p")!.totalTasks).toBe(2);
    expect(m.get(UNASSIGNED)!.overdue).toEqual(["nobody"]);
    expect(computeWorkload(items, ["p"], win, sched).get("p")!.overdue).toEqual([]);
  });

  it("assigneesOf never repeats the owner", () => {
    expect(assigneesOf({ ownerId: "p", assigneeIds: ["p", "q", "q"] })).toEqual(["p", "q"]);
  });
});

describe("capacity", () => {
  it("weekly hours over the person's working days", () => {
    expect(dailyHoursFor({ schedule: org, weeklyCapacityHours: 20 })).toBe(4);
    expect(dailyHoursFor({ schedule: { ...org, workdays: [1, 2] }, weeklyCapacityHours: 20 })).toBe(10);
  });
  it("falls back to the schedule's hours a day", () => {
    expect(dailyHoursFor({ schedule: { ...org, hoursPerDay: 7.5 } })).toBe(7.5);
    expect(dailyHoursFor({ schedule: org, weeklyCapacityHours: null })).toBe(8);
  });
  it("a per-view daily override wins", () => {
    expect(dailyHoursFor({ schedule: org, weeklyCapacityHours: 20, dailyHoursOverride: 6 })).toBe(6);
  });
  it("is 0 on a day off unless Count weekends", () => {
    expect(capacityOn({ schedule: org }, d(26), { mode: "hours", dailyTasks: 3, countWeekends: false })).toBe(0);
    expect(capacityOn({ schedule: org }, d(26), { mode: "hours", dailyTasks: 3, countWeekends: true })).toBe(8);
    expect(capacityOn({ schedule: org }, d(22), { mode: "tasks", dailyTasks: 3, countWeekends: false })).toBe(3);
  });
  it("over capacity is strictly above", () => {
    expect(overBy(8, 8)).toBe(0);
    expect(overBy(9.5, 8)).toBe(1.5);
  });
});
