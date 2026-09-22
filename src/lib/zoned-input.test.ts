import { describe, expect, it } from "vitest";
import { zonedInputToIso, zonedInputValue } from "./zoned-input";

describe("zonedInputValue", () => {
  it("reads an instant in the viewer's zone, not the machine's", () => {
    // 2026-09-25T10:00Z is 06:00 in New York (EDT) and 15:30 in Kolkata.
    expect(zonedInputValue("2026-09-25T10:00:00.000Z", "America/New_York")).toBe("2026-09-25T06:00");
    expect(zonedInputValue("2026-09-25T10:00:00.000Z", "Asia/Kolkata")).toBe("2026-09-25T15:30");
    expect(zonedInputValue("2026-09-25T10:00:00.000Z", "UTC")).toBe("2026-09-25T10:00");
  });

  it("crosses a date boundary correctly", () => {
    // 03:00Z on the 26th is still the 25th in New York.
    expect(zonedInputValue("2026-09-26T03:00:00.000Z", "America/New_York")).toBe("2026-09-25T23:00");
    // ... and already the 26th in Tokyo.
    expect(zonedInputValue("2026-09-26T03:00:00.000Z", "Asia/Tokyo")).toBe("2026-09-26T12:00");
  });

  it("handles midnight without printing hour 24", () => {
    expect(zonedInputValue("2026-09-25T00:00:00.000Z", "UTC")).toBe("2026-09-25T00:00");
  });

  it("falls back to the machine zone with no preference, and never throws", () => {
    expect(zonedInputValue("2026-09-25T10:00:00.000Z", null)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(zonedInputValue("2026-09-25T10:00:00.000Z", "Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("is empty for an unreadable instant rather than printing NaN", () => {
    expect(zonedInputValue("nope", "UTC")).toBe("");
  });
});

describe("zonedInputToIso", () => {
  it("reads the typed wall clock as the viewer's zone", () => {
    expect(zonedInputToIso("2026-09-25T06:00", "America/New_York")).toBe("2026-09-25T10:00:00.000Z");
    expect(zonedInputToIso("2026-09-25T15:30", "Asia/Kolkata")).toBe("2026-09-25T10:00:00.000Z");
    expect(zonedInputToIso("2026-09-25T10:00", "UTC")).toBe("2026-09-25T10:00:00.000Z");
  });

  it("round-trips through zonedInputValue in every zone", () => {
    const instant = "2026-09-25T10:00:00.000Z";
    for (const tz of ["UTC", "America/New_York", "Asia/Kolkata", "Australia/Sydney", "Pacific/Chatham"]) {
      expect(zonedInputToIso(zonedInputValue(instant, tz), tz)).toBe(instant);
    }
  });

  it("survives a daylight-saving change, which is what the second pass is for", () => {
    // US clocks go forward on 2026-03-08. A 10:00 meeting on the 9th is EDT
    // (UTC-4); one on the 1st is EST (UTC-5). A single-pass solver anchors
    // both on the offset of the naive UTC reading and puts one of them an
    // hour out.
    expect(zonedInputToIso("2026-03-01T10:00", "America/New_York")).toBe("2026-03-01T15:00:00.000Z");
    expect(zonedInputToIso("2026-03-09T10:00", "America/New_York")).toBe("2026-03-09T14:00:00.000Z");
    // And back again in the autumn.
    expect(zonedInputToIso("2026-11-02T10:00", "America/New_York")).toBe("2026-11-02T15:00:00.000Z");
  });

  it("handles a half-hour and a three-quarter-hour zone", () => {
    expect(zonedInputToIso("2026-09-25T15:30", "Asia/Kolkata")).toBe("2026-09-25T10:00:00.000Z");
    // Nepal is UTC+5:45.
    expect(zonedInputToIso("2026-09-25T15:45", "Asia/Kathmandu")).toBe("2026-09-25T10:00:00.000Z");
  });

  it("is null for anything it cannot read, never an Invalid Date", () => {
    expect(zonedInputToIso("", "UTC")).toBeNull();
    expect(zonedInputToIso("2026-13-01T10:00", "UTC")).toBeNull();
    expect(zonedInputToIso("2026-09-25T99:00", "UTC")).toBeNull();
    expect(zonedInputToIso("25/09/2026 10:00", "UTC")).toBeNull();
  });

  it("accepts the seconds some browsers append", () => {
    expect(zonedInputToIso("2026-09-25T10:00:00", "UTC")).toBe("2026-09-25T10:00:00.000Z");
  });
});
