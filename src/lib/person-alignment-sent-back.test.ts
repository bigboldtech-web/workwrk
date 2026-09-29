// sentBackByKpi: the number a manager sent back, with their note, that the
// KRAs tab shows the person.
//
// Request changes stores its note on the record and the notification links
// to the KRAs tab, which showed only "No reading · Changes requested": once
// the notification was cleared, the person could not find out what was
// asked. The database is mocked; the helper never touches it.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { previousPeriodKey, sentBackByKpi } from "@/lib/person-alignment";

const rec = (kpiId: string, period: string, status: string, actualValue: number | null, managerNotes: string | null) =>
  ({ kpiId, period, status, actualValue, managerNotes });

describe("previousPeriodKey", () => {
  it("steps back a month, across a year end", () => {
    expect(previousPeriodKey("2026-09")).toBe("2026-08");
    expect(previousPeriodKey("2026-01")).toBe("2025-12");
    expect(previousPeriodKey("2026-10")).toBe("2026-09");
  });
});

describe("sentBackByKpi", () => {
  it("carries this month's sent-back number and the manager's note", () => {
    const m = sentBackByKpi([rec("k1", "2026-09", "REJECTED", 5, "Still missing the links, second ask")], "2026-09");
    expect(m.get("k1")).toEqual({ period: "2026-09", actualValue: 5, managerNotes: "Still missing the links, second ask" });
  });

  it("carries last month's too: a manager reviewing on the 1st sends back the closed month", () => {
    const m = sentBackByKpi([rec("k1", "2026-08", "REJECTED", 3, "Add the PR links")], "2026-09");
    expect(m.get("k1")?.period).toBe("2026-08");
  });

  it("prefers this month when both months were sent back", () => {
    const m = sentBackByKpi([
      rec("k1", "2026-09", "REJECTED", 5, "this month"),
      rec("k1", "2026-08", "REJECTED", 3, "last month"),
    ], "2026-09");
    expect(m.get("k1")?.managerNotes).toBe("this month");
  });

  it("drops a resubmitted, approved or older number, and a blank note reads as none", () => {
    const m = sentBackByKpi([
      rec("k1", "2026-09", "SUBMITTED", 6, "old ask"),
      rec("k2", "2026-09", "APPROVED", 6, null),
      rec("k3", "2026-07", "REJECTED", 2, "too old to answer"),
      rec("k4", "2026-09", "REJECTED", 1, "   "),
    ], "2026-09");
    expect([...m.keys()]).toEqual(["k4"]);
    expect(m.get("k4")?.managerNotes).toBeNull();
  });
});
