import { describe, expect, it } from "vitest";
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_EVENT_KIND_LABEL,
  normaliseEventKind,
  resolveEventEnd,
  resolveEventTitle,
} from "./calendar-event";

describe("normaliseEventKind", () => {
  it("takes the three words in any casing", () => {
    expect(normaliseEventKind("EVENT")).toBe("EVENT");
    expect(normaliseEventKind("focus")).toBe("FOCUS");
    expect(normaliseEventKind(" ooo ")).toBe("OOO");
  });

  it("answers EVENT for anything it does not know, rather than throwing", () => {
    // A row a future release wrote with a fourth kind still renders on
    // today's calendar as an ordinary block.
    expect(normaliseEventKind("HOLIDAY")).toBe("EVENT");
    expect(normaliseEventKind(null)).toBe("EVENT");
    expect(normaliseEventKind(undefined)).toBe("EVENT");
    expect(normaliseEventKind(7)).toBe("EVENT");
  });

  it("has a label for every kind", () => {
    for (const k of CALENDAR_EVENT_KINDS) {
      expect(CALENDAR_EVENT_KIND_LABEL[k]).toBeTruthy();
    }
  });
});

describe("resolveEventEnd", () => {
  const start = new Date("2026-09-22T09:00:00.000Z");

  it("keeps an end that is after the start", () => {
    const end = new Date("2026-09-22T10:30:00.000Z");
    expect(resolveEventEnd(start, end, false).toISOString()).toBe(end.toISOString());
  });

  it("gives a backwards or equal range 30 minutes instead of refusing it", () => {
    expect(resolveEventEnd(start, start, false).toISOString()).toBe("2026-09-22T09:30:00.000Z");
    expect(resolveEventEnd(start, new Date("2026-09-22T08:00:00.000Z"), false).toISOString())
      .toBe("2026-09-22T09:30:00.000Z");
    expect(resolveEventEnd(start, null, false).toISOString()).toBe("2026-09-22T09:30:00.000Z");
  });

  it("ends an all-day event a minute before the same time tomorrow, so it never bleeds a column", () => {
    const end = resolveEventEnd(start, null, true);
    expect(end.toISOString()).toBe("2026-09-23T08:59:00.000Z");
    expect(end.getTime() - start.getTime()).toBeLessThan(24 * 3_600_000);
  });

  it("ignores a sent end on an all-day event", () => {
    const end = resolveEventEnd(start, new Date("2026-10-01T00:00:00.000Z"), true);
    expect(end.toISOString()).toBe("2026-09-23T08:59:00.000Z");
  });
});

describe("resolveEventTitle", () => {
  it("keeps a real title and trims it", () => {
    expect(resolveEventTitle("  Standup  ", "EVENT")).toBe("Standup");
  });

  it("names the kind rather than saving an empty title", () => {
    expect(resolveEventTitle("", "FOCUS")).toBe("Focus time");
    expect(resolveEventTitle("   ", "OOO")).toBe("Out of office");
    expect(resolveEventTitle(null, "EVENT")).toBe("Event");
    expect(resolveEventTitle(42, "EVENT")).toBe("Event");
  });

  it("caps a very long title rather than writing it whole", () => {
    expect(resolveEventTitle("x".repeat(500), "EVENT")).toHaveLength(300);
  });
});
