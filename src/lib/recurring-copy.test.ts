import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/board-items", () => ({ createBoardItem: async () => ({}), updateBoardItem: async () => ({}) }));

const { copyMatches } = await import("./recurring-tasks");

// Pen test 2026-11-28, V-42, the step 6 review: a series whose rule changes
// zone must neither copy an occurrence twice nor skip one.

const copy = (dueAt: string, key: string, zone?: string) => ({
  dueAt: new Date(dueAt),
  startAt: null,
  metadata: { recurrenceSourceId: "a1", recurrenceKey: key, ...(zone ? { recurrenceZone: zone } : {}) },
});

describe("copyMatches", () => {
  it("east of UTC: the old copy of the same instant, keyed on the server's clock, still counts", () => {
    // Berlin midnight on 28 Nov is 27 Nov 23:00 UTC; the old key read "2026-11-27".
    const old = copy("2026-11-27T23:00:00Z", "2026-11-27");
    expect(copyMatches(old, "2026-11-28", "Europe/Berlin")).toBe(true);
  });

  it("west of UTC: the next occurrence is not taken for the old copy of the one before", () => {
    // 17:00 in Los Angeles on 27 Nov is 28 Nov 01:00 UTC; the old key read "2026-11-28".
    const old = copy("2026-11-28T01:00:00Z", "2026-11-28");
    expect(copyMatches(old, "2026-11-28", "America/Los_Angeles")).toBe(false);
    expect(copyMatches(old, "2026-11-27", "America/Los_Angeles")).toBe(true);
  });

  it("a copy keyed in the rule's own zone answers by its key, even after someone moved it", () => {
    const moved = copy("2026-12-09T09:00:00Z", "2026-12-07", "Europe/Berlin");
    expect(copyMatches(moved, "2026-12-07", "Europe/Berlin")).toBe(true);
    expect(copyMatches(moved, "2026-12-09", "Europe/Berlin")).toBe(false);
  });

  it("guard: a rule without a zone and its copies compare by key, exactly as before", () => {
    const legacy = copy("2026-12-09T09:00:00Z", "2026-12-07");
    expect(copyMatches(legacy, "2026-12-07", null)).toBe(true);
    expect(copyMatches(legacy, "2026-12-09", null)).toBe(false);
  });
});
