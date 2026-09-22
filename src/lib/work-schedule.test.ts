import { describe, expect, it } from "vitest";
import {
  capacityForDay,
  dayKeyLocal,
  expectedWeekHours,
  holidayOn,
  isWorkingDay,
  parseWorkSchedule,
  workingDaysBetween,
  WORK_SCHEDULE_DEFAULTS,
  type WorkSchedule,
} from "./work-schedule";

/** Local midnight, so every assertion below is zone-independent. */
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("parseWorkSchedule", () => {
  it("answers the defaults for anything that is not an object", () => {
    expect(parseWorkSchedule(null)).toEqual(WORK_SCHEDULE_DEFAULTS);
    expect(parseWorkSchedule("nope")).toEqual(WORK_SCHEDULE_DEFAULTS);
    expect(parseWorkSchedule(undefined)).toEqual(WORK_SCHEDULE_DEFAULTS);
  });

  it("defaults PER FIELD, so a partial row keeps the rest", () => {
    expect(parseWorkSchedule({ hoursPerDay: 7.5 })).toEqual({
      workdays: [1, 2, 3, 4, 5],
      hoursPerDay: 7.5,
      timezone: null,
      holidays: [],
    });
  });

  it("drops weekdays outside 0..6, de-duplicates and sorts", () => {
    expect(parseWorkSchedule({ workdays: [5, 1, 1, 9, -2, 0] }).workdays).toEqual([0, 1, 5]);
  });

  it("keeps an empty workdays list rather than rewriting it", () => {
    // "We work no fixed days" is a real answer for a shift business.
    expect(parseWorkSchedule({ workdays: [] }).workdays).toEqual([]);
  });

  it("refuses an hours value outside 0..24 and rounds to two places", () => {
    expect(parseWorkSchedule({ hoursPerDay: 0 }).hoursPerDay).toBe(8);
    expect(parseWorkSchedule({ hoursPerDay: 25 }).hoursPerDay).toBe(8);
    expect(parseWorkSchedule({ hoursPerDay: "7.456" }).hoursPerDay).toBe(7.46);
  });

  it("keeps only well formed holidays, de-duplicated by date and sorted", () => {
    const parsed = parseWorkSchedule({
      holidays: [
        { date: "2026-12-26", name: "Boxing Day" },
        { date: "2026-12-25", name: "Christmas Day" },
        { date: "2026-12-25", name: "Duplicate" },
        { date: "nonsense", name: "Bad" },
        { date: "2026-01-01" },
        "not an object",
      ],
    });
    expect(parsed.holidays).toEqual([
      { date: "2026-01-01", name: "Holiday" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-26", name: "Boxing Day" },
    ]);
  });

  it("treats a blank timezone as null", () => {
    expect(parseWorkSchedule({ timezone: "   " }).timezone).toBeNull();
    expect(parseWorkSchedule({ timezone: "Europe/London" }).timezone).toBe("Europe/London");
  });
});

describe("isWorkingDay and holidayOn", () => {
  const sunToThu: WorkSchedule = {
    workdays: [0, 1, 2, 3, 4],
    hoursPerDay: 8,
    timezone: null,
    holidays: [{ date: "2026-09-21", name: "Founders Day" }],
  };

  it("follows the organization's own week, not Monday to Friday", () => {
    expect(isWorkingDay(sunToThu, d(2026, 9, 20))).toBe(true);  // Sunday
    expect(isWorkingDay(sunToThu, d(2026, 9, 25))).toBe(false); // Friday
    expect(isWorkingDay(sunToThu, d(2026, 9, 26))).toBe(false); // Saturday
  });

  it("takes a holiday out of the working week", () => {
    // Monday 21 Sep 2026 is a workday in this schedule, but it is the holiday.
    expect(isWorkingDay(sunToThu, d(2026, 9, 21))).toBe(false);
    expect(holidayOn(sunToThu, d(2026, 9, 21))?.name).toBe("Founders Day");
    expect(holidayOn(sunToThu, d(2026, 9, 22))).toBeNull();
  });

  it("names a local date without a zone hop", () => {
    expect(dayKeyLocal(d(2026, 1, 5))).toBe("2026-01-05");
  });
});

describe("capacityForDay", () => {
  it("is zero on a non working day and on a holiday", () => {
    const s = parseWorkSchedule({ holidays: [{ date: "2026-12-25", name: "Christmas Day" }] });
    expect(capacityForDay(s, d(2026, 9, 26))).toBe(0); // Saturday
    expect(capacityForDay(s, d(2026, 12, 25))).toBe(0); // Friday, but a holiday
    expect(capacityForDay(s, d(2026, 9, 25))).toBe(8);
  });

  it("takes a per person override on a working day only", () => {
    const s = WORK_SCHEDULE_DEFAULTS;
    expect(capacityForDay(s, d(2026, 9, 25), 6)).toBe(6);
    expect(capacityForDay(s, d(2026, 9, 26), 6)).toBe(0);
  });
});

describe("workingDaysBetween and expectedWeekHours", () => {
  it("counts both ends inclusively and nothing when the range is backwards", () => {
    const s = WORK_SCHEDULE_DEFAULTS;
    expect(workingDaysBetween(s, d(2026, 9, 21), d(2026, 9, 27))).toBe(5);
    expect(workingDaysBetween(s, d(2026, 9, 27), d(2026, 9, 21))).toBe(0);
  });

  it("gives a plain week 40 hours", () => {
    expect(expectedWeekHours(WORK_SCHEDULE_DEFAULTS, d(2026, 9, 21))).toBe(40);
  });

  it("shrinks the week by a holiday inside it", () => {
    const s = parseWorkSchedule({ holidays: [{ date: "2026-09-23", name: "Founders Day" }] });
    expect(expectedWeekHours(s, d(2026, 9, 21))).toBe(32);
  });

  it("ignores a holiday that falls on a day already not worked", () => {
    const s = parseWorkSchedule({ holidays: [{ date: "2026-09-26", name: "Saturday party" }] });
    expect(expectedWeekHours(s, d(2026, 9, 21))).toBe(40);
  });

  it("handles a half day company at 7.5 hours", () => {
    const s = parseWorkSchedule({ hoursPerDay: 7.5 });
    expect(expectedWeekHours(s, d(2026, 9, 21))).toBe(37.5);
  });

  it("is zero for an organization that works no fixed days", () => {
    const s = parseWorkSchedule({ workdays: [] });
    expect(expectedWeekHours(s, d(2026, 9, 21))).toBe(0);
  });
});

/**
 * PUT /api/organization/work-schedule parses the body OVER the record that
 * is already there, because parseWorkSchedule fills an absent key with the
 * DEFAULT: a client that sent only `holidays` used to silently reset a
 * four-day week to Monday-to-Friday and a 7.5 hour day to eight. This is the
 * shape of that merge, tested where the parsing rule lives.
 */
describe("a partial body merged over the saved calendar", () => {
  const current = parseWorkSchedule({
    workdays: [1, 2, 3, 4],
    hoursPerDay: 7.5,
    timezone: "Europe/London",
    holidays: [{ date: "2026-09-23", name: "Founders Day" }],
  });

  const merge = (body: Record<string, unknown>) => parseWorkSchedule({
    workdays: body.workdays === undefined ? current.workdays : body.workdays,
    hoursPerDay: body.hoursPerDay === undefined ? current.hoursPerDay : body.hoursPerDay,
    timezone: body.timezone === undefined ? current.timezone : body.timezone,
    holidays: body.holidays === undefined ? current.holidays : body.holidays,
  });

  it("leaves the workweek alone when only holidays are sent", () => {
    const next = merge({ holidays: [{ date: "2026-12-25", name: "Christmas" }] });
    expect(next.workdays).toEqual([1, 2, 3, 4]);
    expect(next.hoursPerDay).toBe(7.5);
    expect(next.timezone).toBe("Europe/London");
    expect(next.holidays.map((h) => h.date)).toEqual(["2026-12-25"]);
  });

  it("leaves the holidays alone when only the workweek is sent", () => {
    const next = merge({ workdays: [1, 2, 3, 4, 5] });
    expect(next.workdays).toEqual([1, 2, 3, 4, 5]);
    expect(next.holidays.map((h) => h.date)).toEqual(["2026-09-23"]);
  });

  it("still writes a real change to every field when every field is sent", () => {
    const next = merge({ workdays: [0, 6], hoursPerDay: 4, timezone: "UTC", holidays: [] });
    expect(next).toEqual({ workdays: [0, 6], hoursPerDay: 4, timezone: "UTC", holidays: [] });
  });
});
