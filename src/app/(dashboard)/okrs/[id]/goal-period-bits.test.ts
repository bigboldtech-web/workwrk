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
vi.mock("@/components/ui/dialog", () => {
  const pass = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return { Dialog: pass, DialogContent: pass, DialogHeader: pass, DialogTitle: pass, DialogFooter: pass, DialogDescription: pass };
});
// The row menu, open: its items are what is asserted.
vi.mock("@/components/layout/os/more-portal", () => ({ MorePortal: ({ children }: { children?: ReactNode }) => h("div", { "data-menu": "" }, children) }));

import { GoalPeriodControl, PastPeriods, periodHref, trendPoints } from "./goal-period-bits";
import { GoalTargets, type TargetRowData } from "./goal-targets";
import { checkInBody } from "./okr-checkin-modal";
import { TargetEditor } from "./target-editor";
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
    expect(html).toMatch(/aria-disabled="true"[^>]*aria-label="Next period"/);
    expect(html).not.toMatch(/aria-disabled="true"[^>]*aria-label="Previous period"/);
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
    expect(points[3]).toMatchObject({ progress: 100, attainment: 112, words: "Hit, 112%" });
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
    const period = { key: "2026-09-01", label: "September 2026", current: false, state: "grace" as const, takesCheckIns: true, line: "Open for late numbers until 5 Oct." };
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, targets: [target()], period, editor }));
    expect(html).toContain("Open for late numbers until 5 Oct.");
    expect(html).toMatch(/>Check in</);
    expect(html).not.toContain("Edit target");
    expect(html).not.toContain("Delete target");
    expect(html).not.toContain("Add target");
  });

  it("a closed period is read only; a deleted target's row still shows, with no menu", () => {
    const period = { key: "2026-08-01", label: "August 2026", current: false, state: "closed" as const, takesCheckIns: false, line: "Closed on 6 Sep. Its numbers are final." };
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, period, editor,
      targets: [target(), target({ id: "row-9", title: "Old target", deleted: true })] }));
    expect(html).toContain("Closed on 6 Sep. Its numbers are final.");
    expect(html).not.toMatch(/>Check in</);
    expect(html).toContain("Old target");
    expect(html.match(/<button[^>]*aria-label="Actions for/g)).toHaveLength(1);
  });

  it("a carried target reads 'Carried from October'", () => {
    const period = { key: "2026-11-01", label: "November 2026", current: true, state: "open" as const, takesCheckIns: true, line: null };
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, period, targets: [target({ carriedFrom: "October" })] }));
    expect(html).toContain("Carried from October");
  });
});

describe("the step 3 review", () => {
  it("M1, L3: a stopped goal's last period in its grace is the one shown for now, yet takes only late numbers: Check in stays, no adding, editing or deleting", () => {
    const period = { key: "2026-10-01", label: "October 2026", current: true, state: "grace" as const, takesCheckIns: true, line: "Open for late numbers until 5 Nov." };
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, targets: [target()], period, editor }));
    expect(html).toMatch(/>Check in</);
    expect(html).not.toContain("Edit target");
    expect(html).not.toContain("Delete target");
    expect(html).not.toContain("Add target");
  });

  it("M1: a check-in always names the period on screen, so it lands there whatever period runs now", () => {
    expect(checkInBody("kr1", 7, " late ", { key: "2026-10-01" })).toEqual({ keyResultId: "kr1", value: 7, note: "late", periodKey: "2026-10-01" });
    expect(checkInBody("kr1", 7, "", null)).toEqual({ keyResultId: "kr1", value: 7, note: null });
  });

  it("L5: the trend's text alternative reads each period's real result, 112%, not the clamped 100%", () => {
    const html = renderToStaticMarkup(h(PastPeriods, { okrId: "g1", initial: { rows: [row("2026-09-01", "September 2026", "Sep", "HIT", "Hit", 100, 112), row("2026-08-01", "August 2026", "Aug", "MISSED", "Missed", 40, 40)], total: 2 }, selectedKey: null, currentKey: null }));
    expect(html).toContain('aria-label="Results of the last 2 periods: August 2026 Missed, 40%, September 2026 Hit, 112%"');
  });

  it("L5, L7: the editor's pickers say their value, and the preview's numbers go under the name below sm", () => {
    const html = renderToStaticMarkup(h(TargetEditor, {
      goal: { okrId: "g1", repeat: "QUARTERLY", ownerId: "u1", periodWord: "This quarter", kpiMonths: ["2026-10", "2026-11", "2026-12"] },
      initial: { id: "kr1", title: "Tickets closed", startValue: 0, targetValue: 300, unit: "tickets", currentValue: 120, kpiId: "kpi-1", kpiName: "Tickets", combine: "SUM" },
      onClose: () => {},
    }));
    expect(html).toContain('aria-label="KPI, Tickets"');
    expect(html).toContain('aria-label="Months, Sum of months"');
    expect(html).toContain("flex-col gap-1 sm:h-9 sm:flex-row");
  });
});
