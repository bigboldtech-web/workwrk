import { describe, expect, it } from "vitest";
import { previewKpiScore } from "./kpi-preview-score";

describe("previewKpiScore mirrors the server's scoreKpiRecord", () => {
  it("higher is better, capped at 120", () => {
    expect(previewKpiScore({ target: 100 }, 85)).toBe(85);
    expect(previewKpiScore({ target: 50 }, 72)).toBe(120);
  });
  it("lower is better, from the enum or the legacy flag", () => {
    expect(previewKpiScore({ target: 10, direction: "LOWER" }, 20)).toBe(50);
    expect(previewKpiScore({ target: 10, lowerIsBetter: true }, 0)).toBe(120);
  });
  it("maintain scores the deviation", () => {
    expect(previewKpiScore({ target: 100, direction: "MAINTAIN" }, 90)).toBe(90);
  });
  it("qualitative with no target scores against the 1 to 5 rubric; no baseline is null", () => {
    expect(previewKpiScore({ type: "QUALITATIVE", target: null }, 4)).toBe(80);
    expect(previewKpiScore({ target: null }, 4)).toBeNull();
    expect(previewKpiScore({ target: 100 }, null)).toBeNull();
  });
});
