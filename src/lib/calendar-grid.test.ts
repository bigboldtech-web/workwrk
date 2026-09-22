import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  monthLabel,
  monthOfKey,
  clockLabel,
  dayOfKey,
  hourLabel,
  instantAt,
  weekdayLabels,
  weekdayOfKey,
  zonedDayKey,
  zonedMinutesOfDay,
  zonedMonthKeys,
  zonedParts,
  zonedWeekKeys,
} from "./calendar-grid";

// 2026-09-22T02:30:00Z is:
//   Asia/Kolkata (+5:30)   Tue 22 Sep 08:00
//   America/New_York (-4)  Mon 21 Sep 22:30
//   UTC                    Tue 22 Sep 02:30
const CROSS = new Date("2026-09-22T02:30:00.000Z");

describe("zonedParts", () => {
  it("reads the calendar day in the zone, not the machine's", () => {
    expect(zonedParts(CROSS, "Asia/Kolkata")).toMatchObject({ year: 2026, month: 9, day: 22, hour: 8, minute: 0, weekday: 2 });
    expect(zonedParts(CROSS, "America/New_York")).toMatchObject({ year: 2026, month: 9, day: 21, hour: 22, minute: 30, weekday: 1 });
    expect(zonedParts(CROSS, "UTC")).toMatchObject({ year: 2026, month: 9, day: 22, hour: 2, minute: 30 });
  });

  it("reads midnight as hour 0 and never as hour 24", () => {
    expect(zonedParts(new Date("2026-09-22T00:00:00.000Z"), "UTC").hour).toBe(0);
  });

  it("falls back to the runtime zone rather than throwing on a bad name", () => {
    expect(() => zonedParts(CROSS, "Not/AZone")).not.toThrow();
  });
});

describe("zonedDayKey and zonedMinutesOfDay", () => {
  it("puts one instant in different columns in different zones", () => {
    expect(zonedDayKey(CROSS, "Asia/Kolkata")).toBe("2026-09-22");
    expect(zonedDayKey(CROSS, "America/New_York")).toBe("2026-09-21");
  });

  it("offsets down the column in the zone", () => {
    expect(zonedMinutesOfDay(CROSS, "Asia/Kolkata")).toBe(8 * 60);
    expect(zonedMinutesOfDay(CROSS, "America/New_York")).toBe(22 * 60 + 30);
  });
});

describe("zonedWeekKeys", () => {
  it("starts on Monday for weekStart 1", () => {
    // 2026-09-22 is a Tuesday.
    expect(zonedWeekKeys(CROSS, 1, "UTC")[0]).toBe("2026-09-21");
    expect(zonedWeekKeys(CROSS, 1, "UTC")).toHaveLength(7);
    expect(zonedWeekKeys(CROSS, 1, "UTC")[6]).toBe("2026-09-27");
  });

  it("starts on Sunday for weekStart 0", () => {
    expect(zonedWeekKeys(CROSS, 0, "UTC")[0]).toBe("2026-09-20");
  });

  it("reads the anchor's own day in the zone, so the week can differ", () => {
    // In New York the anchor is Monday 21 Sep, whose Monday-start week begins
    // on the 21st; in Kolkata it is Tuesday the 22nd, same week.
    expect(zonedWeekKeys(CROSS, 1, "America/New_York")[0]).toBe("2026-09-21");
    expect(zonedWeekKeys(CROSS, 1, "Asia/Kolkata")[0]).toBe("2026-09-21");
    // Sunday-start pulls New York back to the 20th too.
    expect(zonedWeekKeys(CROSS, 0, "America/New_York")[0]).toBe("2026-09-20");
  });

  it("defaults an unusable week start to Monday", () => {
    expect(zonedWeekKeys(CROSS, "nonsense", "UTC")[0]).toBe("2026-09-21");
    expect(zonedWeekKeys(CROSS, 9, "UTC")[0]).toBe("2026-09-21");
  });
});

describe("addDaysToKey", () => {
  it("crosses a month and a year", () => {
    expect(addDaysToKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysToKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("does calendar arithmetic, so a DST week is still seven days", () => {
    // 2026-03-29 is the European spring change; the key walk is unaffected.
    const keys = Array.from({ length: 7 }, (_, i) => addDaysToKey("2026-03-27", i));
    expect(keys).toEqual([
      "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30",
      "2026-03-31", "2026-04-01", "2026-04-02",
    ]);
  });
});

describe("dayOfKey and weekdayOfKey", () => {
  it("reads the number and the weekday out of a key", () => {
    expect(dayOfKey("2026-09-22")).toBe(22);
    expect(weekdayOfKey("2026-09-22")).toBe(2);
    expect(weekdayOfKey("2026-09-20")).toBe(0);
  });
});

describe("instantAt", () => {
  it("lands on the wall clock time in the zone", () => {
    const d = instantAt("2026-09-22", 9 * 60 + 30, "Asia/Kolkata");
    expect(zonedParts(d, "Asia/Kolkata")).toMatchObject({ day: 22, hour: 9, minute: 30 });
  });

  it("works for a negative offset", () => {
    const d = instantAt("2026-09-22", 9 * 60, "America/New_York");
    expect(zonedParts(d, "America/New_York")).toMatchObject({ day: 22, hour: 9, minute: 0 });
    expect(d.toISOString()).toBe("2026-09-22T13:00:00.000Z");
  });

  it("works across a DST change", () => {
    const before = instantAt("2026-03-07", 9 * 60, "America/New_York");
    const after = instantAt("2026-03-09", 9 * 60, "America/New_York");
    expect(zonedParts(before, "America/New_York")).toMatchObject({ hour: 9, minute: 0 });
    expect(zonedParts(after, "America/New_York")).toMatchObject({ hour: 9, minute: 0 });
  });

  it("handles midnight and the last minute of a day", () => {
    const mid = instantAt("2026-09-22", 0, "Asia/Kolkata");
    expect(zonedParts(mid, "Asia/Kolkata")).toMatchObject({ day: 22, hour: 0, minute: 0 });
    const late = instantAt("2026-09-22", 23 * 60 + 45, "Asia/Kolkata");
    expect(zonedParts(late, "Asia/Kolkata")).toMatchObject({ day: 22, hour: 23, minute: 45 });
  });
});

describe("hourLabel and clockLabel", () => {
  it("honours timeFormat", () => {
    expect(hourLabel(7, "24h")).toBe("07:00");
    expect(hourLabel(7, "12h")).toBe("7 am");
    expect(hourLabel(19, "12h")).toBe("7 pm");
    expect(hourLabel(0, "24h")).toBe("00:00");
    expect(hourLabel(12, "12h")).toBe("12 pm");
    // Nothing stored reads as 12h, which is the registry default.
    expect(hourLabel(19, null)).toBe("7 pm");
  });

  it("formats a block time in the zone and the format", () => {
    expect(clockLabel(CROSS, "Asia/Kolkata", "24h")).toBe("08:00");
    expect(clockLabel(CROSS, "Asia/Kolkata", "12h")).toBe("8:00 AM");
    expect(clockLabel(CROSS, "America/New_York", "24h")).toBe("22:30");
    expect(clockLabel(CROSS, "America/New_York", "12h")).toBe("10:30 PM");
  });
});

describe("weekdayLabels", () => {
  it("runs from the week start", () => {
    expect(weekdayLabels(1)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayLabels(0)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(weekdayLabels(undefined)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

describe("zonedMonthKeys", () => {
  const monthKeys = (iso: string, weekStart: number, zone?: string) =>
    zonedMonthKeys(new Date(iso), weekStart, zone);

  it("covers the whole month in whole weeks, starting on the week start", () => {
    // September 2026: the 1st is a Tuesday, 30 days.
    const keys = monthKeys("2026-09-15T12:00:00.000Z", 1);
    expect(keys.length % 7).toBe(0);
    expect(keys[0]).toBe("2026-08-31"); // the Monday before the 1st
    expect(keys).toContain("2026-09-01");
    expect(keys).toContain("2026-09-30");
    expect(keys[keys.length - 1]).toBe("2026-10-04"); // through the Sunday
  });

  it("moves the lead days when the week starts on Sunday", () => {
    const keys = monthKeys("2026-09-15T12:00:00.000Z", 0);
    expect(keys[0]).toBe("2026-08-30");
    expect(keys.length % 7).toBe(0);
  });

  it("is as tall as the month needs and never padded to six rows", () => {
    // February 2027 has 28 days and starts on a Monday: four rows exactly.
    const keys = monthKeys("2027-02-10T12:00:00.000Z", 1);
    expect(keys.length).toBe(28);
    expect(keys[0]).toBe("2027-02-01");
    expect(keys[27]).toBe("2027-02-28");
  });

  it("reads the month in the VIEWER'S zone, not the server's", () => {
    // 23:30 UTC on 30 September is already 1 October in Kolkata, so the two
    // viewers are looking at two different months at the same instant.
    const instant = "2026-09-30T23:30:00.000Z";
    expect(monthKeys(instant, 1, "UTC")).toContain("2026-09-15");
    expect(monthKeys(instant, 1, "Asia/Kolkata")).toContain("2026-10-15");
  });

  it("gets the day count right for a leap February", () => {
    const keys = monthKeys("2028-02-10T12:00:00.000Z", 1);
    expect(keys).toContain("2028-02-29");
  });
});

describe("monthOfKey and monthLabel", () => {
  it("reads the month out of a key", () => {
    expect(monthOfKey("2026-09-01")).toBe(9);
    expect(monthOfKey("2026-12-31")).toBe(12);
  });

  it("names the month in the viewer's zone", () => {
    const instant = new Date("2026-09-30T23:30:00.000Z");
    expect(monthLabel(instant, "UTC", "en-US")).toBe("September 2026");
    expect(monthLabel(instant, "Asia/Kolkata", "en-US")).toBe("October 2026");
  });
});
