import { describe, expect, it } from "vitest";
import {
  isReviewDraft,
  bandOf,
  cleanManagerAssessment,
  cleanSelfRatings,
  compositeScore,
  cycleTransitionBlocked,
  defaultCycleName,
  defaultCyclePeriod,
  isOutcome,
  managerMayWrite,
  managerRatingFrom,
  performanceLevel,
  ratingsTo100,
  reviewStatusOf,
  scaleWords,
  selfReviewGap,
  stepsPassed,
  subjectMayWrite,
} from "./review-cycle";

const FIVE = [
  { label: "Exceptional", min: 90, max: 100 },
  { label: "Strong", min: 75, max: 89 },
  { label: "On track", min: 60, max: 74 },
  { label: "Needs focus", min: 40, max: 59 },
  { label: "At risk", min: 0, max: 39 },
];

describe("cycle transitions", () => {
  it("allows only the named moves", () => {
    expect(cycleTransitionBlocked("ACTIVE", "IN_CALIBRATION")).toBeNull();
    expect(cycleTransitionBlocked("DRAFT", "CANCELLED")).toBeNull();
    expect(cycleTransitionBlocked("ACTIVE", "CANCELLED")).toBeNull();
  });
  it("never completes, reopens or revives by hand", () => {
    expect(cycleTransitionBlocked("IN_CALIBRATION", "COMPLETED")).toMatch(/finaliz/);
    expect(cycleTransitionBlocked("COMPLETED", "ACTIVE")).not.toBeNull();
    expect(cycleTransitionBlocked("CANCELLED", "ACTIVE")).not.toBeNull();
    expect(cycleTransitionBlocked("DRAFT", "ACTIVE")).toMatch(/Launch/);
    expect(cycleTransitionBlocked("IN_CALIBRATION", "CANCELLED")).not.toBeNull();
    expect(cycleTransitionBlocked("DRAFT", "IN_CALIBRATION")).not.toBeNull();
  });
});

describe("who may write", () => {
  it("freezes a submitted self review", () => {
    expect(subjectMayWrite("ACTIVE", "PENDING")).toBe(true);
    expect(subjectMayWrite("ACTIVE", "SELF_ASSESSMENT")).toBe(false);
    expect(subjectMayWrite("IN_CALIBRATION", "PENDING")).toBe(false);
  });
  it("lets a late manager still submit during calibration, never edit a submitted one", () => {
    expect(managerMayWrite("ACTIVE", "MANAGER_REVIEW")).toBe(true);
    expect(managerMayWrite("IN_CALIBRATION", "SELF_ASSESSMENT")).toBe(true);
    expect(managerMayWrite("IN_CALIBRATION", "MANAGER_REVIEW")).toBe(false);
    expect(managerMayWrite("COMPLETED", "PENDING")).toBe(false);
    expect(managerMayWrite("ACTIVE", "COMPLETED")).toBe(false);
  });
});

describe("words and steps", () => {
  it("reads five settings words or falls back to the built-in five", () => {
    expect(scaleWords(["a", "b", "c", "d", "e"])).toEqual({ words: ["a", "b", "c", "d", "e"], fromSettings: true });
    expect(scaleWords(["a", "b"]).fromSettings).toBe(false);
    expect(scaleWords(undefined).words).toEqual(["Below", "Developing", "Meets", "Exceeds", "Outstanding"]);
    expect(scaleWords(["a", "", "c", "d", "e"]).fromSettings).toBe(false);
  });
  it("names each review state", () => {
    expect(reviewStatusOf({ status: "PENDING" }).label).toBe("Not started");
    expect(reviewStatusOf({ status: "MANAGER_REVIEW", calibratedScore: 80 }).label).toBe("Calibrated");
    expect(reviewStatusOf({ status: "COMPLETED" }).tone).toBe("success");
  });
  it("counts the steps passed", () => {
    expect(stepsPassed("DRAFT")).toBe(0);
    expect(stepsPassed("ACTIVE", { total: 4, selfDone: 4, managerDone: 1 })).toBe(1);
    expect(stepsPassed("ACTIVE", { total: 4, selfDone: 4, managerDone: 4 })).toBe(2);
    expect(stepsPassed("IN_CALIBRATION")).toBe(2);
    expect(stepsPassed("COMPLETED")).toBe(4);
  });
  it("knows all five outcomes, exit included", () => {
    expect(isOutcome("EXIT_RECOMMENDATION")).toBe(true);
    expect(isOutcome("FIRE")).toBe(false);
  });
});

describe("form bodies", () => {
  it("drops ratings outside 1 to 5 and caps text", () => {
    const c = cleanSelfRatings({ kraRatings: [{ kraId: "k1", rating: 7 }, { kraId: "k2", rating: 3, achievements: "x".repeat(20_000) }, { rating: 2 }], reflection: { wentWell: 5 } });
    expect(c.kraRatings).toHaveLength(2);
    expect(c.kraRatings[0].rating).toBeNull();
    expect(c.kraRatings[1].achievements).toHaveLength(10_000);
    expect(c.reflection.wentWell).toBe("");
  });
  it("names the gap before a self review can be sent", () => {
    const c = cleanSelfRatings({ kraRatings: [{ kraId: "k1", rating: 4 }] });
    expect(selfReviewGap(c, ["k1"])).toBeNull();
    expect(selfReviewGap(c, ["k1", "k2"])).toMatch(/1 left/);
  });
  it("keeps only the five behaviours and a real outcome", () => {
    const m = cleanManagerAssessment({ behavioral: { quality: 5, charm: 5, growth: 9 }, recommendation: "EXIT_RECOMMENDATION" });
    expect(m.behavioral).toEqual({ quality: 5 });
    expect(m.recommendation).toBe("EXIT_RECOMMENDATION");
    expect(managerRatingFrom({ quality: 4, reliability: 5 })).toBe(90);
    expect(managerRatingFrom({})).toBeNull();
  });
});

describe("golden scoring", () => {
  it("weights the parts that have data and never marks a missing part as zero", () => {
    const w = { kpi: 40, sopCompliance: 20, behavioral: 30, peer: 10 };
    expect(compositeScore({ kpi: 80, sopCompliance: 90, behavioral: 70, peer: 60 }, w)).toBe(77);
    // No peer feedback: 80*40 + 90*20 + 70*30 over 90.
    expect(compositeScore({ kpi: 80, sopCompliance: 90, behavioral: 70, peer: null }, w)).toBe(79);
    expect(compositeScore({ kpi: null, sopCompliance: null, behavioral: null, peer: null }, w)).toBeNull();
  });
  it("finds the band and the 9-box level", () => {
    expect(bandOf(92, FIVE)?.label).toBe("Exceptional");
    expect(bandOf(74.5, FIVE)?.label).toBe("On track");
    expect(performanceLevel(92, FIVE)).toBe(3);
    expect(performanceLevel(80, FIVE)).toBe(3);
    expect(performanceLevel(65, FIVE)).toBe(2);
    expect(performanceLevel(45, FIVE)).toBe(1);
    expect(performanceLevel(10, FIVE)).toBe(1);
    expect(performanceLevel(null, FIVE)).toBeNull();
    const three = [{ label: "High", min: 70, max: 100 }, { label: "Mid", min: 40, max: 69 }, { label: "Low", min: 0, max: 39 }];
    expect([performanceLevel(80, three), performanceLevel(50, three), performanceLevel(10, three)]).toEqual([3, 2, 1]);
  });
  it("turns 1 to 5 ratings into 0 to 100", () => {
    expect(ratingsTo100([5, 4, null, 9])).toBe(90);
    expect(ratingsTo100([])).toBeNull();
  });
});

describe("new cycle defaults", () => {
  it("fills the period from the type", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    expect(defaultCyclePeriod("QUARTERLY", now)).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(defaultCyclePeriod("MONTHLY_PULSE", now)).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(defaultCyclePeriod("ANNUAL", now).end).toBe("2026-12-31");
    expect(defaultCycleName("QUARTERLY", now)).toBe("Q3 2026 review");
  });
});

describe("isReviewDraft, a save never erases a draft with nothing", () => {
  it("accepts a draft object", () => {
    expect(isReviewDraft({ kraRatings: [], reflection: {} })).toBe(true);
    expect(isReviewDraft({})).toBe(true);
  });
  it("rejects a missing, unparsed or wrong-shaped body", () => {
    expect(isReviewDraft(undefined)).toBe(false);
    expect(isReviewDraft(null)).toBe(false);
    expect(isReviewDraft("garbage")).toBe(false);
    expect(isReviewDraft([])).toBe(false);
    expect(isReviewDraft(3)).toBe(false);
  });
});
