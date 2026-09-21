import { describe, expect, it } from "vitest";
import { sprintBurndown, sprintDays, sprintVerdict, SPRINT_POINTS_FIELD_KEY } from "./sprint";
import { DEFAULT_STATUS_OPTIONS } from "./board-items-shared";

const NOW = new Date(2026, 8, 21, 10); // 21 Sep 2026, local
const STATUSES = [...DEFAULT_STATUS_OPTIONS];
const DONE = STATUSES.find((s) => s.group !== "ACTIVE")!.value;
const TODO = STATUSES[0].value;

function item(points: number, status: string, updatedAt = "2026-09-01T00:00:00.000Z") {
  return { status, metadata: { [SPRINT_POINTS_FIELD_KEY]: points }, updatedAt: new Date(updatedAt) };
}

describe("sprintDays", () => {
  it("counts both ends", () => {
    expect(sprintDays("2026-09-15", "2026-09-28")).toBe(14);
    expect(sprintDays("2026-09-15", "2026-09-15")).toBe(1);
  });
});

describe("sprintBurndown", () => {
  it("draws the ideal from the total to zero and actuals only for elapsed days", () => {
    const b = sprintBurndown([item(5, TODO), item(3, TODO)], STATUSES, "2026-09-15", "2026-09-28", NOW);
    expect(b.total).toBe(8);
    expect(b.days).toBe(14);
    expect(b.dayOf).toBe(7);
    expect(b.points[0].ideal).toBe(8);
    expect(b.points[13].ideal).toBe(0);
    expect(b.points[6].actual).toBe(8);
    expect(b.points[7].actual).toBeNull();
  });

  it("burns a done task's points on the day it was last updated", () => {
    const b = sprintBurndown(
      [item(5, DONE, new Date(2026, 8, 18, 9).toISOString()), item(3, TODO)],
      STATUSES,
      "2026-09-15",
      "2026-09-28",
      NOW,
    );
    expect(b.points[2].actual).toBe(8); // Sep 17
    expect(b.points[3].actual).toBe(3); // Sep 18
  });
});

describe("sprintVerdict", () => {
  it("is Planning with no points or before the start", () => {
    expect(sprintVerdict([], STATUSES, "2026-09-15", "2026-09-28", NOW).label).toBe("Planning");
    expect(sprintVerdict([item(5, TODO)], STATUSES, "2026-10-01", "2026-10-14", NOW).label).toBe("Planning");
  });
  it("grades pace against an even burn", () => {
    expect(sprintVerdict([item(5, DONE), item(5, DONE)], STATUSES, "2026-09-15", "2026-09-28", NOW).label).toBe("Ahead of pace");
    expect(sprintVerdict([item(5, TODO), item(5, TODO)], STATUSES, "2026-09-15", "2026-09-28", NOW).label).toBe("Behind pace");
  });
});
