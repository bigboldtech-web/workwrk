import { describe, expect, it } from "vitest";
import { isCurrentWeek, parseWeekKey, weekKey, weekOptions, weekRangeLabel, weekStartOf } from "./weeks";

// 2026-09-19 is a Saturday; its week starts Monday 2026-09-14.
const SAT = new Date(2026, 8, 19);
const MON = new Date(2026, 8, 14);
const SUN = new Date(2026, 8, 20);

describe("weekStartOf", () => {
  it("snaps to the Monday on or before the date", () => {
    expect(weekKey(weekStartOf(SAT))).toBe("2026-09-14");
    expect(weekKey(weekStartOf(MON))).toBe("2026-09-14");
  });

  it("puts Sunday at the END of its week, matching the stored periodStart", () => {
    // weekStartFor in src/lib/weekly-review.ts is Monday-based, and the stored
    // rows are keyed on it. A Sunday that snapped forward would create a second
    // review for a week that already has one.
    expect(weekKey(weekStartOf(SUN))).toBe("2026-09-14");
  });

  it("crosses a month and a year boundary", () => {
    expect(weekKey(weekStartOf(new Date(2026, 0, 1)))).toBe("2025-12-29");
    expect(weekKey(weekStartOf(new Date(2026, 2, 1)))).toBe("2026-02-23");
  });
});

describe("weekKey", () => {
  it("is local, not UTC: a late-evening date does not slide to the next day", () => {
    // toISOString().slice(0,10) on a date east of UTC lands on the wrong day,
    // which would key a review to a week its owner never saw.
    const late = new Date(2026, 8, 14, 23, 45);
    expect(weekKey(late)).toBe("2026-09-14");
  });

  it("zero-pads the month and the day", () => {
    expect(weekKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("parseWeekKey", () => {
  it("round-trips a key", () => {
    const d = parseWeekKey("2026-09-14");
    expect(d && weekKey(d)).toBe("2026-09-14");
  });

  it("snaps a mid-week value to its Monday, so a hand-typed link still resolves", () => {
    const d = parseWeekKey("2026-09-17");
    expect(d && weekKey(d)).toBe("2026-09-14");
  });

  it("is null for junk rather than for today", () => {
    expect(parseWeekKey(null)).toBeNull();
    expect(parseWeekKey("")).toBeNull();
    expect(parseWeekKey("last-week")).toBeNull();
    expect(parseWeekKey("2026-9-1")).toBeNull();
  });
});

describe("weekOptions", () => {
  it("gives eight pills, newest first, with the two named ones in front", () => {
    const opts = weekOptions(SAT, 8, "en-GB");
    expect(opts).toHaveLength(8);
    expect(opts[0].label).toBe("This week");
    expect(opts[1].label).toBe("Last week");
    expect(opts[0].key).toBe("2026-09-14");
    expect(opts[1].key).toBe("2026-09-07");
    expect(opts[7].key).toBe("2026-07-27");
  });

  it("labels the older ones by short date, not by a number of weeks ago", () => {
    const opts = weekOptions(SAT, 4, "en-GB");
    expect(opts[2].label).toMatch(/Aug|Sep/);
    expect(opts[2].label).not.toMatch(/week/i);
  });

  it("never returns an empty list, whatever the count says", () => {
    expect(weekOptions(SAT, 0)).toHaveLength(1);
    expect(weekOptions(SAT, -3)).toHaveLength(1);
  });

  it("has no duplicate keys", () => {
    const keys = weekOptions(SAT, 8).map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("isCurrentWeek", () => {
  it("is true only for the week we are in, which is the only one that auto-creates a draft", () => {
    expect(isCurrentWeek("2026-09-14", SAT)).toBe(true);
    expect(isCurrentWeek("2026-09-07", SAT)).toBe(false);
  });
});

describe("weekRangeLabel", () => {
  it("names Monday to Sunday", () => {
    expect(weekRangeLabel(MON, "en-GB")).toMatch(/^14 Sep\w* to 20 Sep\w*$/);
  });
});
