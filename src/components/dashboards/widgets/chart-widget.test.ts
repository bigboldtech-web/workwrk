import { describe, expect, it, vi } from "vitest";

// The chart module is a client component; only its pure helpers are under
// test here, so the shell-bound locale hook is stubbed out rather than
// pulling the whole shell context into a node test.
vi.mock("@/lib/format/use-date-prefs", () => ({ useDatePrefs: () => ({ language: "en" }) }));

import { donutSegments, segmentGap } from "./chart-widget";

describe("donut separators", () => {
  it("draws no gap on a ring of one segment", () => {
    // The 100% ring: a stroke here draws a notch at 3 o'clock.
    expect(segmentGap(1)).toBe(0);
    expect(segmentGap(0)).toBe(0);
  });

  it("keeps the 2px gap between two or more segments", () => {
    expect(segmentGap(2)).toBe(2);
    expect(segmentGap(6)).toBe(2);
  });

  it("an empty bucket never brings the separator back", () => {
    const segs = donutSegments([
      { key: "todo", count: 5 },
      { key: "done", count: 0 },
    ]);
    expect(segs.map((s) => s.key)).toEqual(["todo"]);
    expect(segmentGap(segs.length)).toBe(0);
  });
});
