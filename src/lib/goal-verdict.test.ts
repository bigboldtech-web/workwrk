import { describe, expect, it } from "vitest";
import { assessGoal, goalStaleness, goalTimeSignals, rollupVerdict, verdictChip, verdictForGoal, verdictNarrative, type GoalVerdict } from "./goal-verdict";

const NOW = new Date("2026-09-15T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86400000);

describe("assessGoal", () => {
  const base = { progress: 50, progressSource: "ROLLUP", pctTimeElapsed: 50, daysLeft: 30, isStale: false, hasLinkedWork: true, markedComplete: false };
  it("reads pace, not absolute progress: 30% done in week one is on track", () => {
    expect(assessGoal({ ...base, progress: 30, pctTimeElapsed: 8 })).toBe("on_track");
  });
  it("off track past 25 points behind, at risk past 10", () => {
    expect(assessGoal({ ...base, progress: 20, pctTimeElapsed: 50 })).toBe("off_track");
    expect(assessGoal({ ...base, progress: 35, pctTimeElapsed: 50 })).toBe("at_risk");
    expect(assessGoal({ ...base, progress: 45, pctTimeElapsed: 50 })).toBe("on_track");
  });
  it("stale check-ins and no linked work late in the window are risks", () => {
    expect(assessGoal({ ...base, isStale: true })).toBe("at_risk");
    expect(assessGoal({ ...base, pctTimeElapsed: 70, progress: 70, hasLinkedWork: false })).toBe("at_risk");
  });
  it("completed wins, unmeasured is its own word", () => {
    expect(assessGoal({ ...base, progress: 100 })).toBe("completed");
    expect(assessGoal({ ...base, progress: 10, markedComplete: true })).toBe("completed");
    expect(assessGoal({ ...base, progress: null, progressSource: "NONE" })).toBe("not_measured");
    expect(assessGoal({ ...base, progress: 0, progressSource: "NONE", markedComplete: true })).toBe("completed");
  });
});

describe("goalStaleness", () => {
  it("cadence None is never stale", () => {
    expect(goalStaleness({ cadence: "NONE", lastCheckInAt: null, createdAt: day(-90), completed: false }, NOW).isStale).toBe(false);
  });
  it("a new goal with no check-in is measured from its creation", () => {
    expect(goalStaleness({ cadence: "WEEKLY", lastCheckInAt: null, createdAt: day(-2), completed: false }, NOW).isStale).toBe(false);
    expect(goalStaleness({ cadence: "WEEKLY", lastCheckInAt: null, createdAt: day(-9), completed: false }, NOW).isStale).toBe(true);
  });
  it("KPI-fed targets and completed goals are never stale", () => {
    expect(goalStaleness({ cadence: "WEEKLY", lastCheckInAt: day(-30), createdAt: day(-60), completed: false, allDerived: true }, NOW).isStale).toBe(false);
    expect(goalStaleness({ cadence: "WEEKLY", lastCheckInAt: day(-30), createdAt: day(-60), completed: true }, NOW).isStale).toBe(false);
  });
});

describe("goalTimeSignals", () => {
  it("falls back to createdAt when there is no start date", () => {
    expect(goalTimeSignals({ startDate: null, endDate: day(10), createdAt: day(-10) }, NOW)).toEqual({ pctTimeElapsed: 50, daysLeft: 10 });
  });
  it("no dates means no pace", () => {
    expect(goalTimeSignals({ startDate: null, endDate: null, createdAt: day(-10) }, NOW)).toEqual({ pctTimeElapsed: null, daysLeft: null });
  });
});

// The list and the goal page gather their inputs differently (one batched
// query over every goal's targets vs one goal's targets read with the page);
// both pass through verdictForGoal, so for the same data they must agree.
describe("list verdict equals detail verdict", () => {
  type Fixture = {
    id: string; startDate: Date | null; endDate: Date | null; createdAt: Date; completedAt: Date | null; checkInCadence: string;
    rollup: { progress: number; source: string };
    targets: { id: string; kpiId: string | null; checkIns: Date[] }[];
    links: string[];
  };
  const fixtures: Fixture[] = [
    { id: "a", startDate: day(-30), endDate: day(30), createdAt: day(-30), completedAt: null, checkInCadence: "WEEKLY", rollup: { progress: 50, source: "ROLLUP" }, targets: [{ id: "k1", kpiId: null, checkIns: [day(-2), day(-9)] }], links: ["KRA"] },
    { id: "b", startDate: day(-30), endDate: day(30), createdAt: day(-30), completedAt: null, checkInCadence: "WEEKLY", rollup: { progress: 10, source: "ROLLUP" }, targets: [{ id: "k2", kpiId: null, checkIns: [] }], links: [] },
    { id: "c", startDate: null, endDate: day(5), createdAt: day(-40), completedAt: null, checkInCadence: "MONTHLY", rollup: { progress: 70, source: "MANUAL" }, targets: [], links: [] },
    { id: "d", startDate: day(-10), endDate: day(80), createdAt: day(-10), completedAt: null, checkInCadence: "NONE", rollup: { progress: 0, source: "NONE" }, targets: [], links: [] },
    { id: "e", startDate: day(-80), endDate: day(-1), createdAt: day(-80), completedAt: day(-2), checkInCadence: "WEEKLY", rollup: { progress: 60, source: "ROLLUP" }, targets: [{ id: "k3", kpiId: "kpi", checkIns: [] }], links: ["BOARD"] },
    { id: "f", startDate: day(-20), endDate: day(20), createdAt: day(-20), completedAt: null, checkInCadence: "BIWEEKLY", rollup: { progress: 100, source: "ROLLUP" }, targets: [{ id: "k4", kpiId: "kpi", checkIns: [] }, { id: "k5", kpiId: null, checkIns: [day(-20)] }], links: ["SPACE"] },
  ];

  // The list's path: one flat query result for every goal, grouped by goal.
  function listPath(): Record<string, GoalVerdict> {
    const flat = fixtures.flatMap((g) => g.targets.map((t) => ({ okrId: g.id, kpiId: t.kpiId, last: t.checkIns.length ? new Date(Math.max(...t.checkIns.map((d) => d.getTime()))) : null })));
    const linked = new Set(fixtures.filter((g) => g.links.length > 0).map((g) => g.id));
    const out: Record<string, GoalVerdict> = {};
    for (const g of fixtures) {
      const targets = flat.filter((r) => r.okrId === g.id).map((r) => ({ lastCheckInAt: r.last, derived: r.kpiId != null }));
      out[g.id] = verdictForGoal({ goal: g, rollup: g.rollup, targets, hasLinkedWork: linked.has(g.id) }, NOW).verdict;
    }
    return out;
  }
  // The page's path: one goal, its targets with their newest check-in (take 1).
  function detailPath(g: Fixture): GoalVerdict {
    const targets = g.targets.map((t) => ({ lastCheckInAt: [...t.checkIns].sort((a, b) => b.getTime() - a.getTime())[0] ?? null, derived: t.kpiId != null }));
    return verdictForGoal({ goal: g, rollup: g.rollup, targets, hasLinkedWork: g.links.length > 0 }, NOW).verdict;
  }

  it("agrees on every fixture", () => {
    const list = listPath();
    for (const g of fixtures) expect(list[g.id], g.id).toBe(detailPath(g));
  });
  it("covers every verdict word", () => {
    expect(new Set(Object.values(listPath()))).toEqual(new Set(["on_track", "off_track", "at_risk", "not_measured", "completed"]));
  });
});

describe("rollupVerdict and the chip", () => {
  it("worst open goal wins; completed only when all are", () => {
    expect(rollupVerdict([])).toBeNull();
    expect(rollupVerdict(["completed", "completed"])).toBe("completed");
    expect(rollupVerdict(["on_track", "completed", "at_risk"])).toBe("at_risk");
    expect(rollupVerdict(["not_measured", "on_track"])).toBe("on_track");
  });
  it("labels are the canon and the narrative has no em dash", () => {
    expect(verdictChip("off_track")).toEqual({ tone: "danger", label: "Off track" });
    for (const v of ["on_track", "at_risk", "off_track", "completed", "not_measured"] as const) {
      const n = verdictNarrative(v, { progress: 40, pctTimeElapsed: 50, daysLeft: 3, isStale: true, daysSinceCheckin: 9, hasLinkedWork: false, totalHours: 0, tasksOpen: 0, tasksDone: 0 });
      expect(JSON.stringify(n)).not.toMatch(/—|--/);
    }
  });
});

describe("nothing to check in", () => {
  it("a goal with no targets is never stale", () => {
    const v = verdictForGoal({ goal: { startDate: null, endDate: null, createdAt: day(-90), checkInCadence: "WEEKLY" }, rollup: { progress: 0, source: "NONE" }, targets: [], hasLinkedWork: false }, NOW);
    expect(v.signals.isStale).toBe(false);
    expect(v.verdict).toBe("not_measured");
  });
});
