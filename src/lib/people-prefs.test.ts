import { describe, expect, it } from "vitest";
import {
  ALIGNMENT_SURFACE_DEFAULTS,
  GOALS_SURFACE_DEFAULTS,
  KPI_REVIEWS_SURFACE_DEFAULTS,
  KRA_KPI_SURFACE_DEFAULTS,
  WORKLOAD_DEFAULTS,
  alignmentSurfacePrefs,
  goalsGroupExpanded,
  goalsSurfacePrefs,
  kpiReviewsSurfacePrefs,
  kraKpiSurfacePrefs,
  weeklyReviewScope,
  workloadPrefs,
} from "./people-prefs";

describe("people-prefs: defaults, one per field", () => {
  it("reads every default from an empty or absent home", () => {
    for (const home of [undefined, null, {}, { work: {} }, { work: { workload: "x" } }]) {
      expect(workloadPrefs(home)).toEqual(WORKLOAD_DEFAULTS);
      expect(goalsSurfacePrefs(home)).toEqual(GOALS_SURFACE_DEFAULTS);
      expect(kraKpiSurfacePrefs(home)).toEqual(KRA_KPI_SURFACE_DEFAULTS);
      expect(alignmentSurfacePrefs(home)).toEqual(ALIGNMENT_SURFACE_DEFAULTS);
      expect(kpiReviewsSurfacePrefs(home)).toEqual(KPI_REVIEWS_SURFACE_DEFAULTS);
    }
  });

  it("states the spec defaults exactly", () => {
    expect(WORKLOAD_DEFAULTS).toEqual({ mode: "tasks", windowDays: 14, countWeekends: false, showAllPeople: false, dailyTasks: 3 });
    expect(GOALS_SURFACE_DEFAULTS).toEqual({ showCompleted: false, showEffort: true });
    expect(KRA_KPI_SURFACE_DEFAULTS).toEqual({ showEmptyTitles: true });
    expect(ALIGNMENT_SURFACE_DEFAULTS).toEqual({ showKraNames: false, showDirectIcs: true });
    expect(KPI_REVIEWS_SURFACE_DEFAULTS).toEqual({ showDescriptions: false });
  });

  it("a namespace stored with only some keys keeps the defaults of the rest", () => {
    expect(workloadPrefs({ work: { workload: { mode: "hours" } } })).toEqual({ ...WORKLOAD_DEFAULTS, mode: "hours" });
    expect(goalsSurfacePrefs({ goals: { showCompleted: true } })).toEqual({ showCompleted: true, showEffort: true });
    expect(alignmentSurfacePrefs({ alignment: { showDirectIcs: false } })).toEqual({ showKraNames: false, showDirectIcs: false });
  });

  it("an out-of-range stored value falls back rather than reaching the grid", () => {
    expect(workloadPrefs({ work: { workload: { windowDays: 10, dailyTasks: 0, mode: "points" } } })).toEqual(WORKLOAD_DEFAULTS);
    expect(workloadPrefs({ work: { workload: { dailyTasks: 2.5 } } }).dailyTasks).toBe(3);
  });
});

describe("goalsGroupExpanded", () => {
  it("is always open on /okrs and its goal pages", () => {
    expect(goalsGroupExpanded({ groups: { goals: false } }, "/okrs")).toBe(true);
    expect(goalsGroupExpanded(undefined, "/okrs/abc")).toBe(true);
  });
  it("remembers the chevron elsewhere, collapsed when never set", () => {
    expect(goalsGroupExpanded(undefined, "/home")).toBe(false);
    expect(goalsGroupExpanded({ groups: { goals: true } }, "/home")).toBe(true);
    expect(goalsGroupExpanded({ groups: {} }, "/okrsx")).toBe(false);
  });
});

describe("weeklyReviewScope", () => {
  it("the URL wins, then the remembered scope, then direct", () => {
    const remembered = { teams: { surface: { "weekly-reviews": { viewOptions: { scope: "chain" } } } } };
    expect(weeklyReviewScope(remembered, "direct")).toBe("direct");
    expect(weeklyReviewScope(remembered, null)).toBe("chain");
    expect(weeklyReviewScope({}, undefined)).toBe("direct");
    expect(weeklyReviewScope({}, "everyone")).toBe("direct");
  });
});
