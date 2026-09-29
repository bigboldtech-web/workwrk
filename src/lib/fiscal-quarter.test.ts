import { describe, expect, it } from "vitest";
import { fiscalQuarterOf, fiscalQuarterStart, goalQuarterLabel, normalizeFiscalStart } from "./fiscal-quarter";

describe("fiscal quarter", () => {
  it("reads a number or the legacy MM-01 string", () => {
    expect(normalizeFiscalStart(1)).toBe(1);
    expect(normalizeFiscalStart("07-01")).toBe(7);
    expect(normalizeFiscalStart("junk")).toBe(4);
    expect(normalizeFiscalStart(13)).toBe(4);
  });
  it("calendar years print the year", () => {
    expect(goalQuarterLabel("2026-09-30T00:00:00Z", 1)).toBe("Q3 2026");
    expect(goalQuarterLabel("2026-01-01T00:00:00Z", 1)).toBe("Q1 2026");
  });
  it("April years print the FY they end in", () => {
    expect(fiscalQuarterOf(new Date("2026-04-15T00:00:00Z"), 4)).toEqual({ quarter: 1, yearLabel: "FY27" });
    expect(goalQuarterLabel("2026-09-30T00:00:00Z", 4)).toBe("Q2 FY27");
    expect(goalQuarterLabel("2027-03-31T00:00:00Z", "04-01")).toBe("Q4 FY27");
  });
  it("no due date, no label", () => {
    expect(goalQuarterLabel(null, 4)).toBeNull();
  });
});

describe("fiscalQuarterStart", () => {
  it("finds the quarter's first day across year ends", () => {
    expect(fiscalQuarterStart(new Date("2027-02-10T00:00:00Z"), 4).toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(fiscalQuarterStart(new Date("2026-05-10T00:00:00Z"), 4).toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(fiscalQuarterStart(new Date("2027-01-10T00:00:00Z"), 11).toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(fiscalQuarterStart(new Date("2026-09-10T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-07-01");
  });
});
