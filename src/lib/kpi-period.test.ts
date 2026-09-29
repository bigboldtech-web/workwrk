import { describe, expect, it } from "vitest";
import { currentKpiPeriod, isKpiPeriodOpen, isKpiPeriodWritable, isKpiPeriodWritableAnyZone, kpiPeriodLabel, resolveKpiPeriod, shiftKpiPeriod } from "./kpi-period";

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

describe("shiftKpiPeriod and isKpiPeriodWritable", () => {
  it("walks across years", () => {
    expect(shiftKpiPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftKpiPeriod("2025-12", 1)).toBe("2026-01");
  });
  it("the current and previous month take numbers", () => {
    const now = new Date("2026-09-15T00:00:00Z");
    expect(isKpiPeriodWritable("2026-09", now)).toBe(true);
    expect(isKpiPeriodWritable("2026-08", now)).toBe(true);
    expect(isKpiPeriodWritable("2026-07", now)).toBe(false);
  });
});

describe("isKpiPeriodWritableAnyZone", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  it("takes this month and last month", () => {
    expect(isKpiPeriodWritableAnyZone("2026-09", now)).toBe(true);
    expect(isKpiPeriodWritableAnyZone("2026-08", now)).toBe(true);
  });
  it("refuses a closed month, a future month and junk", () => {
    expect(isKpiPeriodWritableAnyZone("2026-07", now)).toBe(false);
    expect(isKpiPeriodWritableAnyZone("2026-10", now)).toBe(false);
    expect(isKpiPeriodWritableAnyZone("zzz", now)).toBe(false);
    expect(isKpiPeriodWritableAnyZone(undefined, now)).toBe(false);
  });
  it("allows the local month either side of a UTC month boundary", () => {
    const edge = new Date("2026-09-30T20:00:00Z");
    expect(isKpiPeriodWritableAnyZone("2026-10", edge)).toBe(true);
    const start = new Date("2026-10-01T03:00:00Z");
    expect(isKpiPeriodWritableAnyZone("2026-08", start)).toBe(true);
  });
});
