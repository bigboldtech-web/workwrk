import { describe, expect, it } from "vitest";
import { currentKpiPeriod, isKpiPeriodOpen, kpiPeriodLabel, resolveKpiPeriod } from "./kpi-period";

const now = new Date(Date.UTC(2026, 8, 27, 12, 0, 0)); // 27 Sep 2026, UTC

describe("kpi period", () => {
  it("defaults to the current month", () => {
    expect(currentKpiPeriod(now)).toBe("2026-09");
    expect(resolveKpiPeriod(undefined, now)).toBe("2026-09");
    expect(resolveKpiPeriod(["2026-08"], now)).toBe("2026-09");
  });

  it("honours a past or current month carried by the /kra-kpi/review redirect", () => {
    expect(resolveKpiPeriod("2026-08", now)).toBe("2026-08");
    expect(resolveKpiPeriod("2025-12", now)).toBe("2025-12");
    expect(resolveKpiPeriod("2026-09", now)).toBe("2026-09");
  });

  it("never opens a future month or a malformed key", () => {
    expect(resolveKpiPeriod("2026-10", now)).toBe("2026-09");
    expect(resolveKpiPeriod("2027-01", now)).toBe("2026-09");
    expect(resolveKpiPeriod("2026-13", now)).toBe("2026-09");
    expect(resolveKpiPeriod("2026-W38", now)).toBe("2026-09");
    expect(resolveKpiPeriod("2026-Q3", now)).toBe("2026-09");
    expect(resolveKpiPeriod("", now)).toBe("2026-09");
  });

  it("uses the UTC month, the one the boot badge counts", () => {
    expect(currentKpiPeriod(new Date(Date.UTC(2026, 8, 30, 23, 30, 0)))).toBe("2026-09");
    expect(currentKpiPeriod(new Date(Date.UTC(2026, 9, 1, 0, 30, 0)))).toBe("2026-10");
  });

  it("keeps a past month read only", () => {
    expect(isKpiPeriodOpen("2026-09", now)).toBe(true);
    expect(isKpiPeriodOpen("2026-08", now)).toBe(false);
    expect(isKpiPeriodOpen(resolveKpiPeriod("2025-12", now), now)).toBe(false);
  });

  it("labels a month key", () => {
    expect(kpiPeriodLabel("2026-08")).toBe("August 2026");
    expect(kpiPeriodLabel("junk")).toBe("junk");
  });
});
