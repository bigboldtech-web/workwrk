import { describe, expect, it } from "vitest";
import { EMPTY_ALIGNMENT_FILTER, kraWeightTotal, matchesAlignmentFilter, reviewUrgency, weeklyReviewChip } from "./alignment-rows";

const row = (over: Partial<Parameters<typeof matchesAlignmentFilter>[0]> = {}) => ({
  via: "solid" as const, direct: true, activeKras: [{ weightage: 60 }, { weightage: 40 }], kpiPct: 90, sopPct: 40, mandatoryPending: 0,
  weekly: { status: null, managerStatus: null }, ...over,
});

describe("alignment rows", () => {
  it("names this week's review for the manager", () => {
    expect(weeklyReviewChip({ status: null, managerStatus: null }).label).toBe("Not started");
    expect(weeklyReviewChip({ status: "SUBMITTED", managerStatus: "PENDING" })).toEqual({ label: "Awaiting you", tone: "warning" });
    expect(weeklyReviewChip({ status: "ACKNOWLEDGED", managerStatus: "CHANGES_REQUESTED" }).tone).toBe("danger");
    expect(weeklyReviewChip({ status: "ACKNOWLEDGED", managerStatus: "APPROVED" }).label).toBe("Approved");
  });
  it("sorts the most urgent first", () => {
    expect(reviewUrgency({ status: "SUBMITTED", managerStatus: "PENDING" })).toBeLessThan(reviewUrgency({ status: null, managerStatus: null }));
    expect(reviewUrgency({ status: "ACKNOWLEDGED", managerStatus: "APPROVED" })).toBe(4);
  });
  it("sums weights and filters", () => {
    expect(kraWeightTotal([{ weightage: 33.4 }, { weightage: 33.3 }, { weightage: 33.3 }])).toBe(100);
    expect(matchesAlignmentFilter(row(), EMPTY_ALIGNMENT_FILTER)).toBe(true);
    expect(matchesAlignmentFilter(row(), { ...EMPTY_ALIGNMENT_FILTER, weightsOff: true })).toBe(false);
    expect(matchesAlignmentFilter(row(), { ...EMPTY_ALIGNMENT_FILTER, sopBands: ["low"] })).toBe(true);
    expect(matchesAlignmentFilter(row(), { ...EMPTY_ALIGNMENT_FILTER, kpiBands: ["low"] })).toBe(false);
    expect(matchesAlignmentFilter(row({ direct: false }), { ...EMPTY_ALIGNMENT_FILTER, directOnly: true })).toBe(false);
    expect(matchesAlignmentFilter(row({ via: "dotted" }), { ...EMPTY_ALIGNMENT_FILTER, via: ["solid"] })).toBe(false);
  });
});
