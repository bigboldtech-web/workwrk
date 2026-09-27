import { describe, expect, it } from "vitest";
import { isCron, nextCronRun, parseCron, scheduleForSave, splitScheduleZone, withScheduleZone } from "./cron";

// Local-time dates, because the scheduler reads the server's local clock.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

describe("parseCron", () => {
  it("reads lists, ranges and steps", () => {
    const s = parseCron("*/15 9-11 1,15 * 1-5")!;
    expect([...s.minutes]).toEqual([0, 15, 30, 45]);
    expect([...s.hours]).toEqual([9, 10, 11]);
    expect([...s.days]).toEqual([1, 15]);
    expect(s.months.size).toBe(12);
    expect([...s.weekdays]).toEqual([1, 2, 3, 4, 5]);
  });
  it("treats 7 as Sunday", () => {
    expect([...parseCron("0 9 * * 7")!.weekdays]).toEqual([0]);
  });
  it("rejects anything that is not five valid fields", () => {
    expect(parseCron("daily")).toBeNull();
    expect(parseCron("0 9 * *")).toBeNull();
    expect(parseCron("60 9 * * *")).toBeNull();
    expect(parseCron("0 24 * * *")).toBeNull();
    expect(parseCron("0 9 0 * *")).toBeNull();
    expect(parseCron("0 9 5-1 * *")).toBeNull();
    expect(parseCron("0 9 * * */0")).toBeNull();
    expect(isCron("every 15 minutes")).toBe(false);
    expect(isCron("0 9 * * 1-5")).toBe(true);
  });
});

describe("nextCronRun", () => {
  it("finds the next weekday morning", () => {
    // Friday 2026-09-25 10:00 -> Monday 2026-09-28 09:00
    expect(nextCronRun("0 9 * * 1-5", at(2026, 9, 25, 10))).toEqual(at(2026, 9, 28, 9));
    // Friday 08:59 -> the same day at 09:00
    expect(nextCronRun("0 9 * * 1-5", at(2026, 9, 25, 8, 59))).toEqual(at(2026, 9, 25, 9));
  });
  it("is strictly after the start minute", () => {
    expect(nextCronRun("0 9 * * *", at(2026, 9, 25, 9))).toEqual(at(2026, 9, 26, 9));
  });
  it("rolls over months and years", () => {
    expect(nextCronRun("0 9 1 * *", at(2026, 12, 15))).toEqual(at(2027, 1, 1, 9));
    expect(nextCronRun("30 6 * 2 *", at(2026, 9, 25))).toEqual(at(2027, 2, 1, 6, 30));
  });
  it("matches either day field when both are restricted", () => {
    // the 1st or any Monday: from Tue 2026-09-29, Thu 2026-10-01 comes first
    expect(nextCronRun("0 9 1 * 1", at(2026, 9, 29))).toEqual(at(2026, 10, 1, 9));
  });
  it("returns null for a date that never comes and for non-crons", () => {
    expect(nextCronRun("0 9 31 2 *", at(2026, 1, 1))).toBeNull();
    expect(nextCronRun("hourly", at(2026, 1, 1))).toBeNull();
  });
});

describe("a schedule in a named zone (CRON_TZ=)", () => {
  it("runs at 9:00 on that zone's clock, whatever the server's clock", () => {
    // Friday 25 Sep 2026 10:00 UTC is 15:30 in Kolkata, so the next weekday
    // 9:00 there is Monday 28 Sep, 03:30 UTC.
    const next = nextCronRun("CRON_TZ=Asia/Kolkata 0 9 * * 1-5", new Date("2026-09-25T10:00:00Z"));
    expect(next?.toISOString()).toBe("2026-09-28T03:30:00.000Z");
  });
  it("follows daylight saving in the zone", () => {
    // New York is UTC-4 in September and UTC-5 in December.
    expect(nextCronRun("CRON_TZ=America/New_York 0 9 * * *", new Date("2026-09-25T12:00:00Z"))?.toISOString()).toBe("2026-09-25T13:00:00.000Z");
    expect(nextCronRun("CRON_TZ=America/New_York 0 9 * * *", new Date("2026-12-01T12:00:00Z"))?.toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
  it("is strictly after the start, across a year end", () => {
    expect(nextCronRun("CRON_TZ=UTC 0 9 1 1 *", new Date("2026-12-31T09:00:00Z"))?.toISOString()).toBe("2027-01-01T09:00:00.000Z");
  });
  it("splits and writes the prefix, and refuses a zone Intl does not know", () => {
    expect(splitScheduleZone("CRON_TZ=Asia/Kolkata 0 9 * * 1-5")).toEqual({ zone: "Asia/Kolkata", body: "0 9 * * 1-5" });
    expect(splitScheduleZone("0 9 * * 1-5")).toEqual({ zone: null, body: "0 9 * * 1-5" });
    expect(withScheduleZone("CRON_TZ=UTC 0 9 * * 1", "Europe/London")).toBe("CRON_TZ=Europe/London 0 9 * * 1");
    expect(withScheduleZone("0 9 * * 1", null)).toBe("0 9 * * 1");
    expect(parseCron("CRON_TZ=Not/AZone 0 9 * * 1")).toBeNull();
    expect(isCron("CRON_TZ=Asia/Kolkata 0 9 * * 1")).toBe(true);
  });
});

describe("scheduleForSave", () => {
  it("zones a bare cron and leaves everything else as typed", () => {
    expect(scheduleForSave("0 9 * * 1-5", "Asia/Kolkata")).toBe("CRON_TZ=Asia/Kolkata 0 9 * * 1-5");
    expect(scheduleForSave("CRON_TZ=UTC 0 9 * * 1-5", "Asia/Kolkata")).toBe("CRON_TZ=UTC 0 9 * * 1-5");
    expect(scheduleForSave("every 15 minutes", "Asia/Kolkata")).toBe("every 15 minutes");
    expect(scheduleForSave("0 9 * * 1-5", null)).toBe("0 9 * * 1-5");
  });
});
