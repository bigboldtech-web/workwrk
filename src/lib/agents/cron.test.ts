import { describe, expect, it } from "vitest";
import { isCron, nextCronRun, parseCron } from "./cron";

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
