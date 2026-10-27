// The goal page's period pieces (docs/plans/recurring-goals.md E2, E3, 2.0),
// rendered to static markup from the server's period data: the period
// control, Past periods with its trend, the Targets card's period lines, and
// the target editor's doors, which do not render with the switch off.

import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }) }));
vi.mock("@/components/layout/os/toast", () => ({ useOsToast: () => ({ toast: () => {} }) }));
vi.mock("@/components/ui/dialog-provider", () => ({ useConfirm: () => async () => true }));
// The row menu, open: its items are what is asserted.
vi.mock("@/components/layout/os/more-portal", () => ({ MorePortal: ({ children }: { children?: ReactNode }) => h("div", { "data-menu": "" }, children) }));

import { GoalPeriodControl, PastPeriods, periodHref, trendPoints } from "./goal-period-bits";
import { GoalTargets, type TargetRowData } from "./goal-targets";
import type { PastPeriodRow } from "@/lib/goals/goal-period-view.server";

const choices = [
  { key: "2026-08-01", label: "August 2026" },
  { key: "2026-09-01", label: "September 2026" },
  { key: "2026-10-01", label: "October 2026" },
];

describe("the period control renders the server's periods", () => {
  it("‹ October 2026 › with what is left, Next stopped at the period running now", () => {
    const html = renderToStaticMarkup(h(GoalPeriodControl, { okrId: "g1", choices, value: "2026-10-01", currentKey: "2026-10-01", aside: "4 days left" }));
    expect(html).toContain("October 2026");
    expect(html).toContain("4 days left");
    expect(html).toMatch(/disabled=""[^>]*aria-label="Next period"/);
    expect(html).not.toMatch(/disabled=""[^>]*aria-label="Previous period"/);
  });

  it("writes ?period= for a past period and the bare page for the current one", () => {
    expect(periodHref("g1", "2026-09-01", "2026-10-01")).toBe("/okrs/g1?period=2026-09-01");
    expect(periodHref("g1", "2026-10-01", "2026-10-01")).toBe("/okrs/g1");
  });
});

const row = (key: string, label: string, short: string, result: PastPeriodRow["result"], resultLabel: string, progress: number, attainment: number, single: PastPeriodRow["single"] = null): PastPeriodRow =>
  ({ key, label, shortLabel: short, result, resultLabel, progress, attainment, single });

describe("Past periods renders the closed periods it was given", () => {
  const rows = [
    row("2026-09-01", "September 2026", "Sep", "HIT", "Hit", 100, 112, { currentValue: 45, targetValue: 40, unit: "demos" }),
    row("2026-08-01", "August 2026", "Aug", "MISSED", "Missed", 55, 55, { currentValue: 22, targetValue: 40, unit: "demos" }),
    row("2026-07-01", "July 2026", "Jul", "PARTLY_HIT", "Partly hit", 80, 80, null),
    row("2026-06-01", "June 2026", "Jun", "NOT_MEASURED", "Not measured", 0, 0, null),
  ];

  it("one row each, newest first: the name, the result chip, '45 of 40 demos' or the attainment, and a bar", () => {
    const html = renderToStaticMarkup(h(PastPeriods, { okrId: "g1", initial: { rows, total: 4 }, selectedKey: null, currentKey: "2026-10-01" }));
    expect(html).toContain("Past periods");
    const list = html.slice(html.indexOf("<ol"));
    const order = ["September 2026", "August 2026", "July 2026", "June 2026"].map((l) => list.indexOf(l));
    expect(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1]))).toBe(true);
    expect(html).toContain(">Hit<");
    expect(html).toContain(">Missed<");
    expect(html).toContain(">Partly hit<");
    expect(html).toContain("45 of 40 demos");
    expect(html).toContain("22 of 40 demos");
    expect(html).toContain("80%");
    expect(html).not.toContain("Show more");
  });

  it("offers Show more when the goal has more closed periods than it was given", () => {
    const html = renderToStaticMarkup(h(PastPeriods, { okrId: "g1", initial: { rows, total: 20 }, selectedKey: null, currentKey: null }));
    expect(html).toContain("Show more");
    expect(html).toContain(">20<");
  });

  it("marks the period on screen", () => {
    const html = renderToStaticMarkup(h(PastPeriods, { okrId: "g1", initial: { rows, total: 4 }, selectedKey: "2026-08-01", currentKey: null }));
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("the trend reads the last 12 oldest first, clamped, with each period's words", () => {
    const points = trendPoints(rows);
    expect(points.map((p) => p.label)).toEqual(["Jun", "Jul", "Aug", "Sep"]);
    expect(points[3]).toMatchObject({ progress: 100, words: "Hit, 112%" });
    expect(points[0].words).toBe("Not measured");
    const many = Array.from({ length: 15 }, (_, i) => row(`k${i}`, `P${i}`, `p${i}`, "HIT", "Hit", 100, 100));
    expect(trendPoints(many)).toHaveLength(12);
    expect(trendPoints(many)[11].label).toBe("p0");
  });
});

const target = (extra: Partial<TargetRowData> = {}): TargetRowData => ({
  id: "kr1", title: "Product demos", unit: "demos", startValue: 0, targetValue: 40, currentValue: 18, progress: 45,
  isDerived: false, kpiName: null, lastCheckIn: "2d ago", ...extra,
});
const editor = { okrId: "g1", repeat: "MONTHLY" as const, ownerId: "u1", periodWord: "This month", kpiMonths: ["2026-10"] };

describe("the Targets card follows the period on screen", () => {
  it("one-time goal, switch off: as before, no period line and no Edit target", () => {
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, targets: [target()] }));
    expect(html).toContain("Check in");
    expect(html).toContain("Delete target");
    expect(html).not.toContain("Edit target");
    expect(html).not.toContain("Open for");
  });

  it("with the switch on, editors get Edit target", () => {
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, targets: [target()], editor }));
    expect(html).toContain("Edit target");
  });

  it("a period in its grace: the late-numbers line, Check in kept, no adding, editing or deleting", () => {
    const period = { key: "2026-09-01", label: "September 2026", current: false, takesCheckIns: true, line: "Open for late numbers until 5 Oct." };
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, targets: [target()], period, editor }));
    expect(html).toContain("Open for late numbers until 5 Oct.");
    expect(html).toMatch(/>Check in</);
    expect(html).not.toContain("Edit target");
    expect(html).not.toContain("Delete target");
    expect(html).not.toContain("Add target");
  });

  it("a closed period is read only; a deleted target's row still shows, with no menu", () => {
    const period = { key: "2026-08-01", label: "August 2026", current: false, takesCheckIns: false, line: "Closed on 6 Sep. Its numbers are final." };
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, period, editor,
      targets: [target(), target({ id: "row-9", title: "Old target", deleted: true })] }));
    expect(html).toContain("Closed on 6 Sep. Its numbers are final.");
    expect(html).not.toMatch(/>Check in</);
    expect(html).toContain("Old target");
    expect(html.match(/<button[^>]*aria-label="Actions for/g)).toHaveLength(1);
  });

  it("a carried target reads 'Carried from October'", () => {
    const period = { key: "2026-11-01", label: "November 2026", current: true, takesCheckIns: true, line: null };
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, period, targets: [target({ carriedFrom: "October" })] }));
    expect(html).toContain("Carried from October");
  });
});
