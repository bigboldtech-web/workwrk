import { describe, expect, it } from "vitest";
import {
  SCHEDULE_LOOKBACK_MS,
  dateArrivesRange,
  dateArrivesWords,
  dueScheduleInstant,
  lastScheduledAt,
  readScheduleWhen,
  scheduleWords,
} from "./schedule";

// Local-time dates: the schedule reads the server's own calendar.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe("readScheduleWhen", () => {
  it("defaults to every day at 09:00 and tolerates junk", () => {
    expect(readScheduleWhen(null)).toEqual({ every: "day", hour: 9, minute: 0, weekday: 1, monthDay: 1 });
    expect(readScheduleWhen({ every: "yearly", at: "25:00", weekday: 9 }).every).toBe("day");
  });
});

describe("lastScheduledAt", () => {
  it("every day: today's time once it has passed, else yesterday's", () => {
    expect(lastScheduledAt({ every: "day", at: "09:00" }, at(2026, 9, 26, 10))).toEqual(at(2026, 9, 26, 9));
    expect(lastScheduledAt({ every: "day", at: "09:00" }, at(2026, 9, 26, 8))).toEqual(at(2026, 9, 25, 9));
  });
  it("every weekday skips the weekend", () => {
    // 2026-09-27 is a Sunday; the last weekday run was Friday the 25th.
    expect(lastScheduledAt({ every: "weekday", at: "09:00" }, at(2026, 9, 27, 12))).toEqual(at(2026, 9, 25, 9));
  });
  it("every week lands on the chosen weekday", () => {
    expect(lastScheduledAt({ every: "week", weekday: 1, at: "08:30" }, at(2026, 9, 26, 12))).toEqual(at(2026, 9, 21, 8, 30));
  });
  it("every month lands on the chosen date", () => {
    expect(lastScheduledAt({ every: "month", monthDay: 1, at: "07:00" }, at(2026, 9, 26, 12))).toEqual(at(2026, 9, 1, 7));
  });
});

describe("dueScheduleInstant", () => {
  it("fires only inside the look-back window", () => {
    const now = at(2026, 9, 26, 9, 5);
    expect(dueScheduleInstant({ every: "day", at: "09:00" }, now, null)).toEqual(at(2026, 9, 26, 9));
    const late = new Date(at(2026, 9, 26, 9).getTime() + SCHEDULE_LOOKBACK_MS + 60_000);
    expect(dueScheduleInstant({ every: "day", at: "09:00" }, late, null)).toBeNull();
  });
  it("never fires for a time before the automation went live", () => {
    const now = at(2026, 9, 26, 9, 30);
    expect(dueScheduleInstant({ every: "day", at: "09:00" }, now, at(2026, 9, 26, 9, 10))).toBeNull();
  });
});

describe("dateArrivesRange", () => {
  it("one day before the due date looks for tasks due a day after the window", () => {
    const now = at(2026, 9, 26, 12);
    const r = dateArrivesRange({ dateField: "dueAt", offsetDays: -1 }, now, null);
    expect(r.offsetMs).toBe(-86_400_000);
    expect(r.to.getTime()).toBe(now.getTime() + 86_400_000 + 1);
    expect(r.from.getTime()).toBe(now.getTime() - SCHEDULE_LOOKBACK_MS + 86_400_000);
  });
  it("starts no earlier than the moment it went live", () => {
    const now = at(2026, 9, 26, 12);
    const live = at(2026, 9, 26, 11, 30);
    expect(dateArrivesRange({ dateField: "dueAt", offsetDays: 0 }, now, live).from).toEqual(live);
  });
});

describe("words", () => {
  it("say the schedule and the date in plain words", () => {
    expect(scheduleWords({ every: "weekday", at: "09:00" })).toBe("Every weekday at 09:00");
    expect(scheduleWords({ every: "week", weekday: 5, at: "16:30" })).toBe("Every Friday at 16:30");
    expect(scheduleWords({ every: "month", monthDay: 2, at: "08:00" })).toBe("On the 2nd of every month at 08:00");
    expect(dateArrivesWords({ dateField: "dueAt", offsetDays: 0 })).toBe("On the due date");
    expect(dateArrivesWords({ dateField: "startAt", offsetDays: -2 })).toBe("2 days before the start date");
  });
});
