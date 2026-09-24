import { describe, expect, it } from "vitest";
import { dailySummaryInstalled, dailySummaryMessage, notifyEachResponse } from "./daily-summary";

describe("dailySummaryMessage", () => {
  it("counts in words, singular and plural", () => {
    expect(dailySummaryMessage("Leads", 1)).toEqual({ title: "Daily summary: Leads", message: "1 new response in the last 24 hours." });
    expect(dailySummaryMessage("Leads", 1200).message).toBe("1,200 new responses in the last 24 hours.");
  });
  it("names an unnamed form", () => {
    expect(dailySummaryMessage("  ", 2).title).toBe("Daily summary: Untitled form");
  });
});

describe("dailySummaryInstalled", () => {
  it("is off until the cron row's flag is set", () => {
    expect(dailySummaryInstalled({})).toBe(false);
    expect(dailySummaryInstalled({ FORM_DAILY_SUMMARY_CRON: "" })).toBe(false);
    expect(dailySummaryInstalled({ FORM_DAILY_SUMMARY_CRON: "off" })).toBe(false);
    expect(dailySummaryInstalled({ FORM_DAILY_SUMMARY_CRON: "on" })).toBe(true);
    expect(dailySummaryInstalled({ FORM_DAILY_SUMMARY_CRON: " TRUE " })).toBe(true);
  });
});

describe("notifyEachResponse", () => {
  const people = ["u1"];
  it("never goes quiet while the summary's cron is not installed", () => {
    expect(notifyEachResponse({ notifyUserIds: people, dailySummary: true }, false)).toBe(true);
  });
  it("hands over to the summary once it is installed", () => {
    expect(notifyEachResponse({ notifyUserIds: people, dailySummary: true }, true)).toBe(false);
    expect(notifyEachResponse({ notifyUserIds: people, dailySummary: false }, true)).toBe(true);
  });
  it("tells nobody when the list is empty", () => {
    expect(notifyEachResponse({ notifyUserIds: [], dailySummary: false }, false)).toBe(false);
  });
});
