import { describe, expect, it } from "vitest";
import { aiCostCents } from "./ai-cost";

describe("aiCostCents", () => {
  it("prices a million tokens at $3 in and $15 out", () => {
    expect(aiCostCents(1_000_000, 0)).toBe(300);
    expect(aiCostCents(0, 1_000_000)).toBe(1500);
    expect(aiCostCents(1_000_000, 1_000_000)).toBe(1800);
  });

  it("rounds a part of a cent up to one cent", () => {
    // The old formula recorded 13 cents for this turn: 100 times its 0.12 cents, rounded up.
    expect(aiCostCents(200, 40)).toBe(1);
    expect(aiCostCents(1, 0)).toBe(1);
    expect(aiCostCents(10_000, 0)).toBe(3);
    expect(aiCostCents(10_001, 0)).toBe(4);
  });

  it("charges nothing for nothing", () => {
    expect(aiCostCents(0, 0)).toBe(0);
    expect(aiCostCents(-5, Number.NaN)).toBe(0);
    expect(aiCostCents(Number.POSITIVE_INFINITY, 0)).toBe(0);
  });

  it("counts an answer the model cut short by what it read", () => {
    expect(aiCostCents(50_000, 0)).toBe(15);
  });
});
