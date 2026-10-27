// isMeasuredAutomatically, the KPI combine and the parent-period mapping
// (docs/plans/recurring-goals.md C2, C6, D2, E4). Pure.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import fs from "node:fs";
import path from "node:path";
import type { RollupGoal, RollupPeriod } from "./period-rollup";
import { nextPeriod, periodFor, type GoalCadence, type PeriodSettings } from "./goal-period";
import { goalVerdictFor } from "@/lib/goal-verdict";
import { keyResultProgress } from "@/lib/alignment";

// The new modules are read inside each test, so each one fails on its own
// against code that does not have them.
const measure = () => import("./goal-measure");
const rollup = () => import("./period-rollup");

const S: PeriodSettings = { timezone: "Asia/Kolkata", weekStart: "MON", fiscalYearStart: 4 };
const ROOT = path.resolve(__dirname, "../../..");

describe("isMeasuredAutomatically (C2)", () => {
  it("is true for a KPI link or a List, Space or table source, and false for check-ins", async () => {
    const { isMeasuredAutomatically } = await measure();
    expect(isMeasuredAutomatically({ kpiId: "k" })).toBe(true);
    expect(isMeasuredAutomatically({ kpiId: null, source: { kind: "list", boardIds: ["b"] } })).toBe(true);
    expect(isMeasuredAutomatically({ source: { kind: "space", spaceId: "s" } })).toBe(true);
    expect(isMeasuredAutomatically({ source: { kind: "table", tableId: "t" } })).toBe(true);
    expect(isMeasuredAutomatically({ kpiId: null, source: null })).toBe(false);
    // A KPI combine choice left behind without its KPI measures nothing.
    expect(isMeasuredAutomatically({ kpiId: null, source: { kind: "kpi", combine: "SUM" } })).toBe(false);
  });

  it("replaces the four kpiId checks (GET /api/okrs, assess, the goal page, the profile)", () => {
    for (const file of [
      "src/app/api/okrs/route.ts",
      "src/app/api/okrs/[id]/assess/route.ts",
      "src/app/(dashboard)/okrs/[id]/page.tsx",
      "src/lib/person-alignment.ts",
    ]) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      expect(src, file).toMatch(/derived: isMeasuredAutomatically\(/);
      expect(src, file).not.toMatch(/derived: \w+\.kpiId != null/);
    }
  });

  it("a sourced target never makes its goal stale (the verdict reads it as measured)", async () => {
    const { isMeasuredAutomatically } = await measure();
    const base = { progress: 50, progressSource: "ROLLUP", startDate: "2026-10-01", endDate: "2026-12-31", createdAt: "2026-10-01", checkInCadence: "WEEKLY", lastCheckInAt: null, hasLinkedWork: true };
    const now = new Date("2026-11-20T00:00:00Z");
    expect(goalVerdictFor({ ...base, allDerived: false }, now).signals.isStale).toBe(true);
    expect(goalVerdictFor({ ...base, allDerived: isMeasuredAutomatically({ source: { kind: "list" } }) }, now).signals.isStale).toBe(false);
  });
});

describe("pace from trackedFrom (E4)", () => {
  it("a period is paced from its trackedFrom, not its start", async () => {
    const g = { progress: 0, progressSource: "ROLLUP", startDate: "2026-10-01T00:00:00Z", endDate: null, createdAt: "2026-10-27T04:30:00Z", checkInCadence: "WEEKLY", lastCheckInAt: null, hasLinkedWork: false };
    const period = { trackedFrom: "2026-10-27T04:30:00Z", endsAt: "2026-10-31T18:30:00Z" };
    const birth = goalVerdictFor({ ...g, period }, new Date("2026-10-27T04:30:00Z"));
    expect(birth.signals.pctTimeElapsed).toBe(0);
    expect(birth.verdict).toBe("on_track");
    const later = goalVerdictFor({ ...g, period }, new Date("2026-10-29T16:30:00Z"));
    // About half of 27 Oct 10:00 to 1 Nov 00:00 IST, not 90% of October.
    expect(later.signals.pctTimeElapsed).toBe(55);
  });
});

describe("the KPI months (C6)", () => {
  const values = new Map([["2026-04", 10], ["2026-05", 20], ["2026-06", 30]]);
  const q1 = ["2026-04", "2026-05", "2026-06"];
  it("combines a quarter's months by the target's choice", async () => {
    const { combineKpiMonths, kpiCombineOf } = await measure();
    expect(combineKpiMonths(q1, values, "LATEST")).toBe(30);
    expect(combineKpiMonths(q1, values, "SUM")).toBe(60);
    expect(combineKpiMonths(q1, values, "AVERAGE")).toBe(20);
    expect(combineKpiMonths(["2026-07"], values, "SUM")).toBeNull();
    expect(kpiCombineOf({ kind: "kpi", combine: "SUM" })).toBe("SUM");
    expect(kpiCombineOf(null)).toBe("LATEST");
  });
});

describe("each period starts at (B4)", () => {
  it("defaults to last period's number for a target that counts down, the start value otherwise", async () => {
    const { periodStartOf } = await measure();
    expect(periodStartOf({ periodStart: null, direction: "LOWER" })).toBe("LAST");
    expect(periodStartOf({ periodStart: null, direction: "HIGHER" })).toBe("START");
    expect(periodStartOf({ periodStart: "START", direction: "LOWER" })).toBe("START");
  });
});

describe("a parent's period from its children's (D2)", () => {
  const range = (cadence: GoalCadence, at: string): RollupPeriod => {
    const p = periodFor(cadence, new Date(at), S);
    return { id: `${cadence}-${p.key}`, key: p.key, cadence, startsAt: p.startsAt, endsAt: p.endsAt, status: "OPEN", progress: null, attainment: null, targets: [] };
  };
  const goal = (id: string, cadence: GoalCadence, periods: RollupPeriod[]): RollupGoal => ({ id, parentId: "p", repeat: cadence, startDate: null, endDate: null, periods });

  it("a finer child gives the weeks whose nominal last day falls in the month", async () => {
    const { childPeriodsFor } = await rollup();
    const oct = range("MONTHLY", "2026-10-15T00:00:00Z");
    const weeks: RollupPeriod[] = [];
    let w = periodFor("WEEKLY", new Date("2026-09-21T00:00:00Z"), S);
    for (let i = 0; i < 8; i++) {
      weeks.push({ id: `w${i}`, key: w.key, cadence: "WEEKLY", startsAt: w.startsAt, endsAt: w.endsAt, status: "OPEN", progress: null, attainment: null, targets: [] });
      w = nextPeriod(w, "WEEKLY", S);
    }
    // Monday weeks end on a Sunday: 4, 11, 18 and 25 October. The week of
    // 26 October ends on 1 November, so it counts in November.
    expect(childPeriodsFor(goal("c", "WEEKLY", weeks), oct, S).map((p) => p.key)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]);
  });

  it("a coarser child gives its period that holds the month's nominal last day", async () => {
    const { childPeriodsFor } = await rollup();
    const nov = range("MONTHLY", "2026-11-15T00:00:00Z");
    const q3 = range("QUARTERLY", "2026-11-15T00:00:00Z");
    const q2 = range("QUARTERLY", "2026-08-15T00:00:00Z");
    expect(childPeriodsFor(goal("c", "QUARTERLY", [q2, q3]), nov, S).map((p) => p.key)).toEqual([q3.key]);
  });

  it("attainment keeps what the clamp cuts", async () => {
    const { meanScore, unclampedProgress } = await rollup();
    expect(unclampedProgress(0, 100, 112)).toBe(112);
    expect(keyResultProgress(0, 100, 112)).toBe(100);
    expect(unclampedProgress(30, 5, 0, "LOWER")).toBe(120);
    expect(meanScore([{ progress: 100, attainment: 112 }, { progress: 50, attainment: 50 }])).toEqual({ progress: 75, attainment: 81 });
  });
});
