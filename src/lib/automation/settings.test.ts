import { describe, expect, it } from "vitest";
import { DEFAULT_MONTHLY_LIMIT, monthKey, monthRange, readAutomationSettings, shiftMonth } from "./settings";

describe("readAutomationSettings", () => {
  it("defaults to on with the fixed allowance when nothing is set", () => {
    expect(readAutomationSettings(null)).toEqual({ paused: false, limit: DEFAULT_MONTHLY_LIMIT });
    expect(readAutomationSettings({})).toEqual({ paused: false, limit: DEFAULT_MONTHLY_LIMIT });
  });

  it("reads the pause switch only when it is exactly true", () => {
    expect(readAutomationSettings({ work: { automationsPaused: true } }).paused).toBe(true);
    expect(readAutomationSettings({ work: { automationsPaused: "true" } }).paused).toBe(false);
  });

  it("prefers the new quota, keeps the older automationLimit, ignores junk", () => {
    expect(readAutomationSettings({ work: { automationQuota: 5000 }, automationLimit: 200 }).limit).toBe(5000);
    expect(readAutomationSettings({ automationLimit: 200.7 }).limit).toBe(200);
    expect(readAutomationSettings({ work: { automationQuota: -1 } }).limit).toBe(DEFAULT_MONTHLY_LIMIT);
  });
});

describe("month helpers", () => {
  it("round-trips a month key and refuses malformed ones", () => {
    const r = monthRange("2026-02");
    expect(r && monthKey(r.start)).toBe("2026-02");
    expect(r && monthKey(r.end)).toBe("2026-03");
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("26-01")).toBeNull();
  });

  it("steps across a year boundary", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
