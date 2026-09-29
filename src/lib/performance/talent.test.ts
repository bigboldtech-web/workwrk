import { describe, expect, it } from "vitest";
import { ATTENTION_BOXES, BOX_KEYS, GRID_ROWS, TOP_BOXES, actionLabel, boxDescription, boxLabel, talentPeriodList } from "./talent";

describe("the nine boxes", () => {
  it("has a fixed label and a long description for every box", () => {
    for (const k of BOX_KEYS) {
      expect(boxLabel(k)).not.toBe(k);
      expect(boxDescription(k)).toMatch(/performance, (low|medium|high) potential$/);
    }
    expect(boxLabel("3-3")).toBe("Stars");
    expect(boxDescription("3-1")).toBe("High performance, low potential");
  });
  it("lays the grid out with high potential on top and high performance on the right", () => {
    expect(GRID_ROWS[0][2]).toBe("3-3");
    expect(GRID_ROWS[2][0]).toBe("1-1");
    expect(new Set(GRID_ROWS.flat()).size).toBe(9);
  });
  it("marks top talent and needs attention", () => {
    expect(TOP_BOXES).toContain("2-3");
    expect(ATTENTION_BOXES).toEqual(["1-1"]);
  });
  it("names the stored plan word", () => {
    expect(actionLabel("PIP")).toBe("Performance plan");
  });
});

describe("talentPeriodList", () => {
  it("puts the current quarter first and bounds the list", () => {
    const list = talentPeriodList({
      currentQuarter: "Q3 2026",
      yearQuarters: ["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"],
      used: [{ period: "2026-05", lastUsed: 5, count: 3 }, { period: "Q2 2026", lastUsed: 9, count: 7 }],
      cycleNames: [{ name: "2025 annual appraisal", endedAt: 1 }],
    });
    expect(list.map((p) => p.key)).toEqual(["Q3 2026", "Q2 2026", "Q1 2026", "2026-05", "2025 annual appraisal", "Q4 2026"]);
    expect(list.find((p) => p.key === "Q2 2026")?.count).toBe(7);
  });
});
