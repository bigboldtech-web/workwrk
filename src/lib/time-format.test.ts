import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  formatHm,
  hoursToHm,
  minutesToHours,
  parseHoursInput,
  utcDayFromKey,
  utcDayKey,
  dayKeyInZone,
  dayStartInZone,
} from "./time-format";

describe("parseHoursInput", () => {
  it("reads the colon form", () => {
    expect(parseHoursInput("1:30")).toBe(90);
    expect(parseHoursInput("0:05")).toBe(5);
    expect(parseHoursInput(":30")).toBe(30);
    expect(parseHoursInput("12:00")).toBe(720);
  });

  it("reads decimal hours with either separator", () => {
    expect(parseHoursInput("1.5")).toBe(90);
    expect(parseHoursInput("1,5")).toBe(90);
    expect(parseHoursInput("2")).toBe(120);
    expect(parseHoursInput("0")).toBe(0);
  });

  it("reads the unit forms", () => {
    expect(parseHoursInput("90m")).toBe(90);
    expect(parseHoursInput("1h")).toBe(60);
    expect(parseHoursInput("1h30m")).toBe(90);
    expect(parseHoursInput("1h 30")).toBe(90);
    expect(parseHoursInput("1.5h")).toBe(90);
  });

  it("returns null for what it cannot read", () => {
    expect(parseHoursInput("")).toBeNull();
    expect(parseHoursInput("   ")).toBeNull();
    expect(parseHoursInput("abc")).toBeNull();
    expect(parseHoursInput("-1")).toBeNull();
    expect(parseHoursInput("1:99")).toBeNull();
    expect(parseHoursInput("1:2:3")).toBeNull();
  });

  it("round trips through formatHm", () => {
    for (const s of ["1:30", "0:05", "12:00", "0:00"]) {
      expect(formatHm(parseHoursInput(s) as number)).toBe(s);
    }
  });
});

describe("formatHm", () => {
  it("pads the minutes and never shows a negative", () => {
    expect(formatHm(0)).toBe("0:00");
    expect(formatHm(5)).toBe("0:05");
    expect(formatHm(90)).toBe("1:30");
    expect(formatHm(2310)).toBe("38:30");
    expect(formatHm(-30)).toBe("0:00");
    expect(formatHm(Number.NaN)).toBe("0:00");
  });
});

describe("hoursToHm and minutesToHours", () => {
  it("turns the stored decimal into h:mm", () => {
    expect(hoursToHm(1.5)).toBe("1:30");
    expect(hoursToHm(0)).toBe("0:00");
    expect(hoursToHm(null)).toBe("0:00");
    expect(hoursToHm(undefined)).toBe("0:00");
    expect(hoursToHm(7.75)).toBe("7:45");
  });

  it("turns minutes back into two-place hours", () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(45)).toBe(0.75);
    expect(minutesToHours(0)).toBe(0);
    expect(minutesToHours(-5)).toBe(0);
  });

  it("does not drift over a round trip of awkward values", () => {
    // 1:20 is the case that makes a naive decimal round trip lose a minute.
    expect(hoursToHm(minutesToHours(80))).toBe("1:20");
    expect(hoursToHm(minutesToHours(100))).toBe("1:40");
  });
});

describe("formatElapsed", () => {
  it("renders a running clock", () => {
    expect(formatElapsed(0)).toBe("0:00:00");
    expect(formatElapsed(8_047_000)).toBe("2:14:07");
    expect(formatElapsed(-1)).toBe("0:00:00");
  });
});

describe("utcDayKey and utcDayFromKey", () => {
  it("keys a UTC midnight instant by its calendar date", () => {
    expect(utcDayKey(new Date(Date.UTC(2026, 8, 7)))).toBe("2026-09-07");
    expect(utcDayKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01-01");
  });

  it("reads a key back to the same instant", () => {
    const d = utcDayFromKey("2026-09-07");
    expect(d?.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("refuses a key that is not a real day", () => {
    expect(utcDayFromKey("2026-13-01")).toBeNull();
    expect(utcDayFromKey("2026-02-31")).toBeNull();
    expect(utcDayFromKey("not-a-date")).toBeNull();
    expect(utcDayFromKey("")).toBeNull();
    expect(utcDayFromKey("2026-9-7")).toBeNull();
  });

  it("round trips", () => {
    const key = "2026-12-31";
    expect(utcDayKey(utcDayFromKey(key) as Date)).toBe(key);
  });
});

/**
 * The bug these two exist to end: a punch at 20:19 in New York is 00:19 UTC,
 * so the day column recorded TOMORROW and the Clock page's "Today" card
 * listed last night's sessions under today's heading with a total no single
 * day can hold (audit T-7, TC-4).
 */
describe("dayKeyInZone", () => {
  const lateEveningNewYork = new Date("2026-09-22T00:19:00.000Z");

  it("reads an instant as the calendar day it is IN THAT ZONE", () => {
    expect(dayKeyInZone(lateEveningNewYork, "America/New_York")).toBe("2026-09-21");
    expect(dayKeyInZone(lateEveningNewYork, "UTC")).toBe("2026-09-22");
    expect(dayKeyInZone(lateEveningNewYork, "Asia/Kolkata")).toBe("2026-09-22");
  });

  it("crosses the date line the right way", () => {
    const morningUtc = new Date("2026-09-22T09:00:00.000Z");
    expect(dayKeyInZone(morningUtc, "Pacific/Auckland")).toBe("2026-09-22");
    expect(dayKeyInZone(morningUtc, "Pacific/Honolulu")).toBe("2026-09-21");
  });

  it("falls back to UTC rather than refusing, for an absent or unknown zone", () => {
    expect(dayKeyInZone(lateEveningNewYork, null)).toBe("2026-09-22");
    expect(dayKeyInZone(lateEveningNewYork, undefined)).toBe("2026-09-22");
    expect(dayKeyInZone(lateEveningNewYork, "Not/AZone")).toBe("2026-09-22");
    expect(dayKeyInZone(lateEveningNewYork, "")).toBe("2026-09-22");
  });
});

describe("dayStartInZone", () => {
  it("returns the UTC midnight instant the day column stores", () => {
    const d = dayStartInZone(new Date("2026-09-22T00:19:00.000Z"), "America/New_York");
    expect(d.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("agrees with dayKeyInZone for every zone it is given", () => {
    const at = new Date("2026-03-01T23:30:00.000Z");
    for (const zone of ["UTC", "America/New_York", "Asia/Kolkata", "Australia/Sydney"]) {
      expect(utcDayKey(dayStartInZone(at, zone))).toBe(dayKeyInZone(at, zone));
    }
  });
});
