import { describe, expect, it } from "vitest";
import { formatPeriodLabel } from "./kpi-utils";

describe("formatPeriodLabel", () => {
  it("reads a month key as a month", () => {
    expect(formatPeriodLabel("2026-09")).toBe("Sep 2026");
    expect(formatPeriodLabel("2026-01")).toBe("Jan 2026");
    expect(formatPeriodLabel("2025-12")).toBe("Dec 2025");
  });
  it("returns anything else unchanged", () => {
    expect(formatPeriodLabel("2026-13")).toBe("2026-13");
    expect(formatPeriodLabel("Q3 2026")).toBe("Q3 2026");
    expect(formatPeriodLabel("")).toBe("");
  });
});
