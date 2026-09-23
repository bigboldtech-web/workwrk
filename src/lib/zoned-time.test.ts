import { describe, expect, it } from "vitest";
import {
  endOfZonedDay,
  needsZoneSuffix,
  zoneAbbreviation,
  zoneOffsetMinutes,
  zonedDateKey,
  zonedHhmm,
  zonedWallClockToUtc,
} from "./zoned-time";

describe("zoneOffsetMinutes", () => {
  it("reads a fixed-offset zone", () => {
    expect(zoneOffsetMinutes("Asia/Kolkata", new Date("2026-09-12T00:00:00Z"))).toBe(330);
    expect(zoneOffsetMinutes("UTC", new Date("2026-09-12T00:00:00Z"))).toBe(0);
  });

  it("follows daylight saving", () => {
    expect(zoneOffsetMinutes("Europe/London", new Date("2026-07-01T12:00:00Z"))).toBe(60);
    expect(zoneOffsetMinutes("Europe/London", new Date("2026-01-01T12:00:00Z"))).toBe(0);
  });

  it("does not read midnight as hour 24", () => {
    // The Node 20 hour12:false trap: a zone whose local time is exactly
    // midnight must measure as its real offset, not as 24 hours away.
    expect(zoneOffsetMinutes("Asia/Kolkata", new Date("2026-09-11T18:30:00Z"))).toBe(330);
  });

  it("degrades to UTC on an unknown zone instead of throwing", () => {
    expect(zoneOffsetMinutes("Mars/Olympus", new Date())).toBe(0);
    expect(zoneOffsetMinutes(null, new Date())).toBe(0);
  });
});

describe("zonedWallClockToUtc", () => {
  it("turns a local reading into the instant it names", () => {
    expect(zonedWallClockToUtc("2026-09-12", "09:00", "Asia/Kolkata")?.toISOString())
      .toBe("2026-09-12T03:30:00.000Z");
    expect(zonedWallClockToUtc("2026-09-12", "09:00", "UTC")?.toISOString())
      .toBe("2026-09-12T09:00:00.000Z");
  });

  it("uses the offset in force on that day, not today's", () => {
    // London is +01:00 in July and +00:00 in January.
    expect(zonedWallClockToUtc("2026-07-01", "12:00", "Europe/London")?.toISOString())
      .toBe("2026-07-01T11:00:00.000Z");
    expect(zonedWallClockToUtc("2026-01-15", "12:00", "Europe/London")?.toISOString())
      .toBe("2026-01-15T12:00:00.000Z");
  });

  it("rejects a malformed reading rather than inventing one", () => {
    expect(zonedWallClockToUtc("not-a-date", "09:00", "UTC")).toBeNull();
    expect(zonedWallClockToUtc("2026-09-12", "9am", "UTC")).toBeNull();
    expect(zonedWallClockToUtc("2026-09-12", "25:00", "UTC")).toBeNull();
    expect(zonedWallClockToUtc("2026-13-12", "09:00", "UTC")).toBeNull();
  });
});

describe("endOfZonedDay", () => {
  it("is the last millisecond of the author's day, not of the UTC day", () => {
    // 30 November in Kolkata ends at 18:29:59.999 UTC.
    expect(endOfZonedDay("2026-11-30", "Asia/Kolkata")?.toISOString())
      .toBe("2026-11-30T18:29:59.999Z");
    expect(endOfZonedDay("2026-11-30", "UTC")?.toISOString())
      .toBe("2026-11-30T23:59:59.999Z");
  });

  it("is later than the naive UTC end for a zone behind UTC", () => {
    const la = endOfZonedDay("2026-11-30", "America/Los_Angeles")!;
    expect(la.toISOString()).toBe("2026-12-01T07:59:59.999Z");
  });
});

describe("zonedDateKey and zonedHhmm", () => {
  it("round-trips a reading through its instant", () => {
    const utc = zonedWallClockToUtc("2026-09-12", "09:00", "Asia/Kolkata")!;
    expect(zonedDateKey(utc, "Asia/Kolkata")).toBe("2026-09-12");
    expect(zonedHhmm(utc, "Asia/Kolkata")).toBe("09:00");
  });

  it("reads the same instant as a different day in two zones", () => {
    const instant = new Date("2026-09-11T20:00:00Z");
    expect(zonedDateKey(instant, "UTC")).toBe("2026-09-11");
    expect(zonedDateKey(instant, "Asia/Kolkata")).toBe("2026-09-12");
  });

  it("prints midnight as 00:00", () => {
    expect(zonedHhmm(new Date("2026-09-11T18:30:00Z"), "Asia/Kolkata")).toBe("00:00");
  });
});

describe("zoneAbbreviation and needsZoneSuffix", () => {
  it("names a zone", () => {
    expect(zoneAbbreviation("Asia/Kolkata", new Date("2026-09-12T00:00:00Z")).length).toBeGreaterThan(0);
    expect(zoneAbbreviation(null, new Date())).toBe("");
    expect(zoneAbbreviation("Mars/Olympus", new Date())).toBe("");
  });

  it("only asks for a suffix when the two zones disagree", () => {
    expect(needsZoneSuffix("Asia/Kolkata", "Europe/London")).toBe(true);
    expect(needsZoneSuffix("Asia/Kolkata", "Asia/Kolkata")).toBe(false);
    expect(needsZoneSuffix(null, "Asia/Kolkata")).toBe(false);
    expect(needsZoneSuffix("Asia/Kolkata", null)).toBe(false);
  });
});
