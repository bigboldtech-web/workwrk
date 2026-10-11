import { describe, expect, it } from "vitest";
import { KPI_CLOSED_MONTH, KPI_PERIOD_RULE, integrationKpiWrite, integrationPeriodProblem } from "./kpi-integration";

const now = new Date("2026-10-12T12:00:00Z");

describe("integrationPeriodProblem", () => {
  it("takes a month key up to the month that is current somewhere", () => {
    expect(integrationPeriodProblem("2026-10", now)).toBeNull();
    expect(integrationPeriodProblem("2019-01", now)).toBeNull();
    // 10:30 UTC on the last day of October is already November 1 in UTC+14.
    expect(integrationPeriodProblem("2026-11", new Date("2026-10-31T10:30:00Z"))).toBeNull();
  });

  it("refuses every other key, and a month that has not started anywhere", () => {
    for (const p of ["2026-Q1", "2026-W33", "2026-10-12", "2026-1", "2026-00", "2026-13", "October", "", " 2026-10", 202610, null, undefined]) {
      expect(integrationPeriodProblem(p, now)).toBe(KPI_PERIOD_RULE);
    }
    expect(integrationPeriodProblem("2026-11", now)).toBe(KPI_PERIOD_RULE);
  });

  it("says what to send, with no dash, in the words the route test holds", () => {
    expect(KPI_PERIOD_RULE).toBe("period must be a month written YYYY-MM, such as 2026-10, and not a month that has not started yet. Goals read only month keys.");
    expect(KPI_CLOSED_MONTH).toBe("That month is closed, so its reading stays as it is. A reading can change only in this month or last month.");
    for (const s of [KPI_PERIOD_RULE, KPI_CLOSED_MONTH]) expect(s).not.toMatch(/--|—|–/);
  });
});

describe("integrationKpiWrite", () => {
  const ex = { actualValue: 40, targetValue: 100 };
  it("creates when there is no reading", () => {
    expect(integrationKpiWrite({ existing: null, actual: 1, target: 100, period: "2020-01", now })).toBe("create");
  });
  it("changes nothing for the same number and target, in any month", () => {
    expect(integrationKpiWrite({ existing: ex, actual: 40, target: 100, period: "2020-01", now })).toBe("unchanged");
    expect(integrationKpiWrite({ existing: ex, actual: 40, target: 100, period: "2026-10", now })).toBe("unchanged");
  });
  it("replaces a different number or target only in this month or last month", () => {
    expect(integrationKpiWrite({ existing: ex, actual: 41, target: 100, period: "2026-10", now })).toBe("update");
    expect(integrationKpiWrite({ existing: ex, actual: 40, target: 90, period: "2026-09", now })).toBe("update");
    expect(integrationKpiWrite({ existing: ex, actual: 41, target: 100, period: "2026-08", now })).toBe("closed");
  });
  it("treats a reading with no number yet as changed", () => {
    expect(integrationKpiWrite({ existing: { actualValue: null, targetValue: 100 }, actual: 0, target: 100, period: "2026-10", now })).toBe("update");
  });
});
