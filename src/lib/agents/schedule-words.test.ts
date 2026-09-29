import { describe, expect, it } from "vitest";
import { agentState, cronWords, describeSchedule, isValidSchedule, presetFor, runsOnWords, scheduleZone, SCHEDULE_PRESETS, wordsInZone, zoneName } from "./schedule-words";

describe("describeSchedule", () => {
  it("reads the keywords the scheduler understands", () => {
    expect(describeSchedule("hourly", true)).toBe("Every hour");
    expect(describeSchedule("@daily", true)).toBe("Every day at 9:00");
    expect(describeSchedule("weekly", true)).toBe("Every week at 9:00");
    expect(describeSchedule("every 15 minutes", true)).toBe("Every 15 minutes");
    expect(describeSchedule("every 1 hour", true)).toBe("Every hour");
    expect(describeSchedule("every 6 hours", true)).toBe("Every 6 hours");
  });

  it("says Not scheduled when off or empty", () => {
    expect(describeSchedule("daily", false)).toBe("Not scheduled");
    expect(describeSchedule(null, true)).toBe("Not scheduled");
  });

  it("reads the picker's crons in words and shows any other cron as typed", () => {
    expect(describeSchedule("0 9 * * 1", true)).toBe("Mondays at 9:00");
    expect(describeSchedule("0 9 * * 1-5", true)).toBe("Weekdays at 9:00");
    expect(describeSchedule("0 9 1 * *", true)).toBe("The 1st of each month at 9:00");
    expect(describeSchedule("*/5 * * * *", true)).toBe("*/5 * * * *");
    expect(describeSchedule("whenever", true)).toBe("whenever");
  });
});

describe("cronWords", () => {
  it("names every day, weekends, single days and ordinals", () => {
    expect(cronWords("30 14 * * *")).toBe("Every day at 14:30");
    expect(cronWords("0 8 * * 0,6")).toBe("Weekends at 8:00");
    expect(cronWords("0 8 * * 7")).toBe("Sundays at 8:00");
    expect(cronWords("0 9 22 * *")).toBe("The 22nd of each month at 9:00");
    expect(cronWords("0 9 13 * *")).toBe("The 13th of each month at 9:00");
  });
  it("gives up on shapes it cannot say simply", () => {
    expect(cronWords("0 9 1 1 *")).toBeNull();
    expect(cronWords("0 9,17 * * *")).toBeNull();
    expect(cronWords("0 9 1 * 1")).toBeNull();
    expect(cronWords("not a cron")).toBeNull();
  });
});

describe("runsOnWords and agentState", () => {
  it("reads When you ask for an on-demand agent", () => {
    expect(runsOnWords("0 9 * * 1-5", false)).toBe("When you ask");
    expect(runsOnWords("0 9 * * 1-5", true)).toBe("Weekdays at 9:00");
    expect(runsOnWords("", true)).toBe("No schedule set");
  });
  it("is Needs setup only when it runs by itself with no schedule", () => {
    expect(agentState({ status: "ENABLED", autonomousEnabled: true, scheduleCron: null })).toBe("needs-setup");
    expect(agentState({ status: "ENABLED", autonomousEnabled: true, scheduleCron: "daily" })).toBe("on");
    expect(agentState({ status: "ENABLED", autonomousEnabled: false, scheduleCron: null })).toBe("on");
    expect(agentState({ status: "DISABLED", autonomousEnabled: true, scheduleCron: null })).toBe("paused");
  });
});

describe("presetFor", () => {
  it("maps every preset back to itself and the rest to custom", () => {
    for (const p of SCHEDULE_PRESETS) expect(presetFor(p.cron)).toBe(p.key);
    expect(presetFor("0  9 * * 1")).toBe("monday");
    expect(presetFor("daily")).toBe("custom");
    expect(presetFor(null)).toBeNull();
  });
});

describe("isValidSchedule", () => {
  it("accepts what the scheduler reads", () => {
    for (const s of ["hourly", "@daily", "weekly", "every 15 minutes", "every 2 hours", "0 9 * * 1-5", "*/30 * * * *"]) {
      expect(isValidSchedule(s)).toBe(true);
    }
    for (const p of SCHEDULE_PRESETS) expect(isValidSchedule(p.cron)).toBe(true);
  });
  it("refuses a typo instead of running it hourly", () => {
    for (const s of ["", "  ", "sometimes", "every 1 minutes", "0 25 * * *", "0 9 * *", "every 0 hours"]) {
      expect(isValidSchedule(s)).toBe(false);
    }
    expect(isValidSchedule(null)).toBe(false);
  });
});

describe("the zone beside the words", () => {
  it("reads a zoned cron in words and as its preset", () => {
    expect(describeSchedule("CRON_TZ=Asia/Kolkata 0 9 * * 1-5", true)).toBe("Weekdays at 9:00");
    expect(presetFor("CRON_TZ=Asia/Kolkata 0 9 * * 1-5")).toBe("weekday");
    expect(isValidSchedule("CRON_TZ=Asia/Kolkata 0 9 * * 1-5")).toBe(true);
    expect(isValidSchedule("CRON_TZ=Nowhere/Land 0 9 * * 1-5")).toBe(false);
  });
  it("names the zone only when it is not the viewer's", () => {
    expect(wordsInZone("Weekdays at 9:00", "Asia/Kolkata", "America/New_York")).toBe("Weekdays at 9:00, Kolkata time");
    expect(wordsInZone("Weekdays at 9:00", "Asia/Kolkata", "Asia/Kolkata")).toBe("Weekdays at 9:00");
    expect(wordsInZone("Weekdays at 9:00", "Asia/Calcutta", "Asia/Kolkata")).toBe("Weekdays at 9:00");
    expect(wordsInZone("Every hour", "Asia/Kolkata", "America/New_York")).toBe("Every hour");
    expect(wordsInZone("When you ask", "Asia/Kolkata", null)).toBe("When you ask");
  });
  it("falls back to the server's zone for a schedule saved without one", () => {
    expect(scheduleZone("0 9 * * 1-5", "Europe/London")).toBe("Europe/London");
    expect(scheduleZone("CRON_TZ=Asia/Kolkata 0 9 * * 1-5", "Europe/London")).toBe("Asia/Kolkata");
    expect(zoneName("America/New_York")).toBe("New York time");
    expect(zoneName("Etc/UTC")).toBe("UTC");
    expect(zoneName("Asia/Calcutta")).toBe("Kolkata time");
  });
});
