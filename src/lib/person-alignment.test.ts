// The profile's pure halves: which goals the Goals section carries
// (goalInPersonWindow) and whether a person has a score at all
// (composeScore).
//
// Two ways the profile went wrong. It filtered goals on OKR.quarter, a label
// the New goal modal no longer writes, so every goal made today was missing
// from its owner's profile while /okrs listed it. And a member with no
// inputs was stored as a 0, which reads "At risk" on their record from the
// day a welcome kudos triggered a recalculation. The database is mocked:
// neither function touches it.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { goalInPersonWindow } from "@/lib/person-alignment";
import { composeScore } from "@/services/performanceScoreService";

// 2026-09-28 with the default April fiscal year: Q2 FY27 began 1 July.
const ctx = {
  label: null,
  legacyLabels: ["Q3 2026", "Q2 FY27"],
  quarterStart: new Date(Date.UTC(2026, 6, 1)),
  fiscalStart: 4,
};
const created = "2026-09-20T00:00:00Z";

describe("goalInPersonWindow, the default window", () => {
  it("carries a goal made from the New goal modal (no legacy label)", () => {
    expect(goalInPersonWindow({ quarter: null, endDate: "2026-10-31T00:00:00Z", createdAt: created }, "on_track", ctx)).toBe(true);
    expect(goalInPersonWindow({ quarter: "", endDate: null, createdAt: created }, "not_measured", ctx)).toBe(true);
  });

  it("carries an open goal whose due date has passed (it needs attention most)", () => {
    expect(goalInPersonWindow({ quarter: null, endDate: "2026-03-31T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" }, "off_track", ctx)).toBe(true);
  });

  it("carries a goal completed this quarter and drops one completed before it", () => {
    expect(goalInPersonWindow({ quarter: null, endDate: "2026-12-31T00:00:00Z", completedAt: "2026-08-10T00:00:00Z", createdAt: created }, "completed", ctx)).toBe(true);
    expect(goalInPersonWindow({ quarter: null, endDate: "2026-06-30T00:00:00Z", completedAt: "2026-06-20T00:00:00Z", createdAt: "2026-04-01T00:00:00Z" }, "completed", ctx)).toBe(false);
  });

  it("keeps a legacy labelled goal only for the current quarter's label", () => {
    expect(goalInPersonWindow({ quarter: "Q3 2026", endDate: null, createdAt: created }, "on_track", ctx)).toBe(true);
    expect(goalInPersonWindow({ quarter: "Q2 FY27", endDate: null, createdAt: created }, "on_track", ctx)).toBe(true);
    expect(goalInPersonWindow({ quarter: "Q2 2026", endDate: null, createdAt: created }, "on_track", ctx)).toBe(false);
  });
});

describe("goalInPersonWindow, an explicit ?quarter= label", () => {
  const q = { ...ctx, label: "Q3 FY27" };
  it("matches an unlabelled goal by its due date's fiscal quarter", () => {
    expect(goalInPersonWindow({ quarter: null, endDate: "2026-10-31T00:00:00Z", createdAt: created }, "on_track", q)).toBe(true);
    expect(goalInPersonWindow({ quarter: null, endDate: "2026-09-30T00:00:00Z", createdAt: created }, "on_track", q)).toBe(false);
    expect(goalInPersonWindow({ quarter: null, endDate: null, createdAt: created }, "on_track", q)).toBe(false);
  });
  it("matches a legacy labelled goal by its label only", () => {
    expect(goalInPersonWindow({ quarter: "Q3 FY27", endDate: null, createdAt: created }, "on_track", q)).toBe(true);
    expect(goalInPersonWindow({ quarter: "Q3 2026", endDate: "2026-10-31T00:00:00Z", createdAt: created }, "on_track", q)).toBe(false);
  });
});

describe("composeScore", () => {
  const weights = { kpi: 40, manager: 25, peer: 10, self: 5, sopCompliance: 20 };
  const none = { kpiScore: null, managerRating: null, peerRating: null, selfRating: null, sopCompliance: null, okrScore: null, taskScore: null, kudosBonus: 0 };

  it("is no score, never 0, when nothing is measured", () => {
    expect(composeScore(none, weights)).toBeNull();
  });

  it("is no score on kudos alone: the bonus sits on a measured score", () => {
    expect(composeScore({ ...none, kudosBonus: 3 }, weights)).toBeNull();
  });

  it("is no score when every weight in play is 0", () => {
    expect(composeScore({ ...none, kpiScore: 80 }, { ...weights, kpi: 0 })).toBeNull();
  });

  it("weights the inputs that exist and adds the kudos bonus", () => {
    expect(composeScore({ ...none, kpiScore: 80 }, weights)).toBe(80);
    expect(composeScore({ ...none, kpiScore: 80, managerRating: 60 }, weights)).toBe(72);
    expect(composeScore({ ...none, kpiScore: 99, kudosBonus: 5 }, weights)).toBe(100);
  });

  it("keeps a real 0, where something was measured and it was 0", () => {
    expect(composeScore({ ...none, taskScore: 0 }, weights)).toBe(0);
  });
});
