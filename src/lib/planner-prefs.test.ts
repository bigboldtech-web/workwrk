import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEK_START,
  PLANNER_DEFAULTS,
  PLANNER_SOURCES,
  TIMESHEETS_DEFAULTS,
  daysBackToWeekStart,
  plannerDisplay,
  resolvePlannerWeekStart,
  timesheetsDisplay,
  weekdayOrder,
} from "./planner-prefs";

describe("plannerDisplay", () => {
  it("returns the spec's defaults when nothing is stored", () => {
    for (const stored of [undefined, null, {}]) {
      expect(plannerDisplay(stored)).toEqual(PLANNER_DEFAULTS);
    }
  });

  it("defaults PER FIELD, so a namespace with one key keeps the rest", () => {
    // This is the whole reason the module exists: getEffectivePreferences
    // replaces the namespace object wholesale on a shallow merge.
    const out = plannerDisplay({ view: "month" });
    expect(out.view).toBe("month");
    expect(out.showWeekends).toBe(true);
    expect(out.showReminders).toBe(true);
    expect(out.highlightWorkHours).toBe(true);
    expect(out.showUnscheduled).toBe(false);
    expect(out.sources).toEqual([...PLANNER_SOURCES]);
  });

  it("honours every stored switch", () => {
    expect(
      plannerDisplay({
        view: "people",
        showWeekends: false,
        showDeclined: true,
        showReminders: false,
        highlightWorkHours: false,
        showUnscheduled: true,
      }),
    ).toEqual({
      view: "people",
      sources: [...PLANNER_SOURCES],
      showWeekends: false,
      showDeclined: true,
      showReminders: false,
      highlightWorkHours: false,
      showUnscheduled: true,
    });
  });

  it("falls back on a view it does not know", () => {
    expect(plannerDisplay({ view: "gantt" }).view).toBe("week");
    expect(plannerDisplay({ view: 3 }).view).toBe("week");
  });

  it("drops sources it does not know rather than filtering by them", () => {
    expect(plannerDisplay({ sources: ["task", "nope", 7, "meeting"] }).sources).toEqual(["task", "meeting"]);
  });

  it("honours an empty source list: a person really did clear them all", () => {
    expect(plannerDisplay({ sources: [] }).sources).toEqual([]);
  });

  it("ignores a non-boolean switch instead of coercing it", () => {
    expect(plannerDisplay({ showWeekends: "false" }).showWeekends).toBe(true);
    expect(plannerDisplay({ showUnscheduled: 1 }).showUnscheduled).toBe(false);
  });
});

describe("timesheetsDisplay", () => {
  it("has both switches on by default", () => {
    expect(timesheetsDisplay(undefined)).toEqual(TIMESHEETS_DEFAULTS);
    expect(timesheetsDisplay({})).toEqual({ showNotes: true, showSource: true });
  });

  it("defaults per field", () => {
    expect(timesheetsDisplay({ showNotes: false })).toEqual({ showNotes: false, showSource: true });
  });
});

describe("resolvePlannerWeekStart", () => {
  it("defaults to Monday", () => {
    expect(DEFAULT_WEEK_START).toBe(1);
    for (const v of [undefined, null, "1", Number.NaN, -1, 7, 1.5 + 6]) {
      expect(resolvePlannerWeekStart(v)).toBe(1);
    }
  });

  it("takes any real day index", () => {
    for (let d = 0; d <= 6; d++) expect(resolvePlannerWeekStart(d)).toBe(d);
  });

  it("truncates a float inside the range rather than rejecting it", () => {
    expect(resolvePlannerWeekStart(3.7)).toBe(3);
  });
});

describe("weekdayOrder", () => {
  it("starts on Monday by default", () => {
    expect(weekdayOrder(undefined)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("starts on Sunday when asked", () => {
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("supports an org that works Sunday to Thursday, starting Saturday", () => {
    expect(weekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it("always returns seven distinct days", () => {
    for (let d = 0; d <= 6; d++) {
      const order = weekdayOrder(d);
      expect(order).toHaveLength(7);
      expect(new Set(order).size).toBe(7);
    }
  });
});

describe("daysBackToWeekStart", () => {
  it("is zero on the start day itself", () => {
    expect(daysBackToWeekStart(1, 1)).toBe(0);
    expect(daysBackToWeekStart(0, 0)).toBe(0);
  });

  it("walks back to a Monday start", () => {
    expect(daysBackToWeekStart(0, 1)).toBe(6); // Sunday is the 7th day
    expect(daysBackToWeekStart(3, 1)).toBe(2); // Wednesday
    expect(daysBackToWeekStart(6, 1)).toBe(5); // Saturday
  });

  it("walks back to a Sunday start", () => {
    expect(daysBackToWeekStart(0, 0)).toBe(0);
    expect(daysBackToWeekStart(6, 0)).toBe(6);
  });

  it("never answers outside 0..6", () => {
    for (let day = 0; day <= 6; day++) {
      for (let start = 0; start <= 6; start++) {
        const n = daysBackToWeekStart(day, start);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(6);
      }
    }
  });
});
