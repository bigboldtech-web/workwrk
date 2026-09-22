import { describe, expect, it } from "vitest";
import {
  buildWeekGrid,
  entryDayKey,
  entryMinutes,
  entrySourceLabel,
  isDayKey,
  isInWeek,
  isRunningPunch,
  shiftDayKey,
  sumMinutes,
  weekAcceptsHours,
  weekBlockReason,
  weekDayKeys,
  weekStartKeyOf,
} from "./timesheet-grid";

describe("day keys", () => {
  it("recognises a key and rejects anything else", () => {
    expect(isDayKey("2026-09-07")).toBe(true);
    expect(isDayKey("2026-9-7")).toBe(false);
    expect(isDayKey("")).toBe(false);
    expect(isDayKey(20260907)).toBe(false);
  });

  it("shifts across a month boundary without a zone hop", () => {
    expect(shiftDayKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDayKey("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDayKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("shifts a whole week", () => {
    expect(shiftDayKey("2026-09-07", 7)).toBe("2026-09-14");
    expect(shiftDayKey("2026-09-07", -7)).toBe("2026-08-31");
  });

  it("hands a malformed key straight back rather than inventing a date", () => {
    expect(shiftDayKey("not-a-day", 1)).toBe("not-a-day");
  });
});

describe("weekDayKeys", () => {
  it("gives seven keys in order", () => {
    expect(weekDayKeys("2026-09-07")).toEqual([
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
      "2026-09-11", "2026-09-12", "2026-09-13",
    ]);
  });
});

describe("weekStartKeyOf", () => {
  it("anchors on Monday", () => {
    // 2026-09-07 is a Monday.
    expect(weekStartKeyOf("2026-09-07")).toBe("2026-09-07");
    expect(weekStartKeyOf("2026-09-09")).toBe("2026-09-07");
    expect(weekStartKeyOf("2026-09-13")).toBe("2026-09-07");
  });

  it("sends Sunday BACK to its Monday, never forward", () => {
    // The trap: Sunday is getUTCDay 0, so a naive offset puts it at the
    // start of the week that has not begun yet and an hour logged on
    // Sunday evening lands in next week's payroll row.
    expect(weekStartKeyOf("2026-09-13")).toBe("2026-09-07");
    expect(weekStartKeyOf("2026-09-06")).toBe("2026-08-31");
  });

  it("agrees with isInWeek", () => {
    expect(isInWeek("2026-09-07", "2026-09-13")).toBe(true);
    expect(isInWeek("2026-09-07", "2026-09-14")).toBe(false);
  });
});

describe("entry arithmetic", () => {
  it("reads the day out of an ISO instant or a bare key", () => {
    expect(entryDayKey({ day: "2026-09-09T00:00:00.000Z" })).toBe("2026-09-09");
    expect(entryDayKey({ day: "2026-09-09" })).toBe("2026-09-09");
  });

  it("turns decimal hours into whole minutes", () => {
    expect(entryMinutes({ hours: 1.5 })).toBe(90);
    expect(entryMinutes({ hours: 0.25 })).toBe(15);
    // A running punch has no hours yet, and that is zero rather than NaN.
    expect(entryMinutes({ hours: null })).toBe(0);
    expect(entryMinutes({ hours: -3 })).toBe(0);
  });

  it("sums a list", () => {
    expect(sumMinutes([{ hours: 1.5 }, { hours: 2 }, { hours: null }])).toBe(210);
  });

  it("knows a running punch from a finished one", () => {
    expect(isRunningPunch({ clockedInAt: "2026-09-09T09:00:00Z", clockedOutAt: null })).toBe(true);
    expect(isRunningPunch({ clockedInAt: "2026-09-09T09:00:00Z", clockedOutAt: "2026-09-09T17:00:00Z" })).toBe(false);
    expect(isRunningPunch({ clockedInAt: null, clockedOutAt: null })).toBe(false);
  });
});

describe("buildWeekGrid", () => {
  const entries = [
    { id: "a", day: "2026-09-07T00:00:00.000Z", hours: 2 },
    { id: "b", day: "2026-09-07T00:00:00.000Z", hours: 1.5 },
    { id: "c", day: "2026-09-11T00:00:00.000Z", hours: 8 },
  ];

  it("always renders seven days, including the empty ones", () => {
    const grid = buildWeekGrid("2026-09-07", entries);
    expect(grid.days).toHaveLength(7);
    expect(grid.days.map((d) => d.key)).toEqual(weekDayKeys("2026-09-07"));
    expect(grid.days[0].entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(grid.days[0].minutes).toBe(210);
    expect(grid.days[1].entries).toEqual([]);
    expect(grid.days[1].minutes).toBe(0);
  });

  it("totals the whole week", () => {
    expect(buildWeekGrid("2026-09-07", entries).totalMinutes).toBe(690);
  });

  it("KEEPS an entry from outside the week rather than dropping it", () => {
    // Hours must never disappear from a payroll surface because a row sits
    // one day outside the grid it was rendered into.
    const grid = buildWeekGrid("2026-09-07", [
      ...entries,
      { id: "stray", day: "2026-09-20T00:00:00.000Z", hours: 3 },
    ]);
    expect(grid.days.flatMap((d) => d.entries).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(grid.strays).toHaveLength(1);
    expect(grid.strays[0].key).toBe("2026-09-20");
    expect(grid.strays[0].minutes).toBe(180);
    expect(grid.totalMinutes).toBe(870);
  });

  it("is empty but well formed with no entries at all", () => {
    const grid = buildWeekGrid("2026-09-07", []);
    expect(grid.days).toHaveLength(7);
    expect(grid.strays).toEqual([]);
    expect(grid.totalMinutes).toBe(0);
  });
});

describe("week status", () => {
  it("only a DRAFT week of my own takes hours", () => {
    expect(weekAcceptsHours("DRAFT", true)).toBe(true);
    expect(weekAcceptsHours(null, true)).toBe(true);
    expect(weekAcceptsHours("SUBMITTED", true)).toBe(false);
    expect(weekAcceptsHours("REJECTED", true)).toBe(false);
    expect(weekAcceptsHours("APPROVED", true)).toBe(false);
    expect(weekAcceptsHours("DRAFT", false)).toBe(false);
  });

  it("names the reason the API would refuse with, before the click", () => {
    expect(weekBlockReason("SUBMITTED")).toContain("Retract");
    expect(weekBlockReason("REJECTED")).toContain("Reopen");
    expect(weekBlockReason("APPROVED")).toContain("approver");
    expect(weekBlockReason("DRAFT")).toBeNull();
    expect(weekBlockReason(null)).toBeNull();
  });
});

describe("entrySourceLabel", () => {
  it("uses the four words people recognise", () => {
    expect(entrySourceLabel("TIMER")).toBe("From timer");
    expect(entrySourceLabel("CLOCK")).toBe("Clocked");
    expect(entrySourceLabel("IMPORT")).toBe("Imported");
    expect(entrySourceLabel("WEB")).toBe("Manual");
  });

  it("never shouts an unknown enum member at somebody", () => {
    expect(entrySourceLabel("SOME_NEW_SOURCE")).toBe("Manual");
    expect(entrySourceLabel(null)).toBe("Manual");
    expect(entrySourceLabel(undefined)).toBe("Manual");
  });
});
