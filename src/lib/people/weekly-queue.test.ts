import { describe, expect, it } from "vitest";
import {
  firstLine,
  kpiSnapshotTone,
  parseWeeklyQuery,
  recentWeekKeys,
  statusClause,
  weeklyKraSummary,
  weeklyStatusOf,
} from "./weekly-queue";

describe("parseWeeklyQuery", () => {
  it("defaults every parameter", () => {
    const q = parseWeeklyQuery(new URLSearchParams(""));
    expect(q).toMatchObject({ view: "waiting", scope: null, statuses: [], week: null, person: null, q: "", sort: "oldest", group: "none", page: 1 });
  });
  it("reads the real values and drops the unknown ones", () => {
    const q = parseWeeklyQuery(new URLSearchParams("view=acted&scope=chain&status=approved,bogus,changes&week=2026-09-07&sort=person&group=week&page=3"));
    expect(q.view).toBe("acted");
    expect(q.scope).toBe("chain");
    expect(q.statuses).toEqual(["approved", "changes"]);
    expect(q.week).toBe("2026-09-07");
    expect(q.sort).toBe("person");
    expect(q.group).toBe("week");
    expect(q.page).toBe(3);
  });
  it("never trusts a malformed week or page", () => {
    const q = parseWeeklyQuery(new URLSearchParams("week=2026-13-45&page=-2&scope=org"));
    expect(q.week).toBeNull();
    expect(q.page).toBe(1);
    expect(q.scope).toBeNull();
  });
});

describe("weeklyStatusOf", () => {
  it("names every state in the canon", () => {
    expect(weeklyStatusOf({ status: "SUBMITTED", managerStatus: "PENDING" }).label).toBe("Waiting on you");
    expect(weeklyStatusOf({ status: "ACKNOWLEDGED", managerStatus: "APPROVED" }).tone).toBe("success");
    expect(weeklyStatusOf({ status: "ACKNOWLEDGED", managerStatus: "CHANGES_REQUESTED" }).key).toBe("changes");
    expect(weeklyStatusOf({ status: "DRAFT", managerStatus: null }).label).toBe("Not submitted");
  });
  it("round-trips through the status clause", () => {
    for (const k of ["waiting", "approved", "changes", "notsubmitted"] as const) {
      const c = statusClause(k);
      expect(weeklyStatusOf({ status: c.status, managerStatus: c.managerStatus ?? null }).key).toBe(k);
    }
  });
});

describe("weeklyKraSummary", () => {
  it("counts rows at or over the line and ignores junk", () => {
    expect(weeklyKraSummary([{ progressPct: 70 }, { progressPct: 69 }, { progressPct: 100 }, { progressPct: "x" }, {}])).toEqual({ onTrack: 2, total: 3 });
    expect(weeklyKraSummary([])).toEqual({ onTrack: 0, total: 0 });
  });
});

describe("kpiSnapshotTone", () => {
  it("is neutral without a number or a target", () => {
    expect(kpiSnapshotTone(null, 10, "HIGHER").tone).toBe("neutral");
    expect(kpiSnapshotTone(5, null, "HIGHER").label).toBe("No target");
  });
  it("reads the direction", () => {
    expect(kpiSnapshotTone(12, 10, "HIGHER").tone).toBe("success");
    expect(kpiSnapshotTone(12, 10, "LOWER").tone).toBe("warning");
    expect(kpiSnapshotTone(8, 10, null, true).tone).toBe("success");
    expect(kpiSnapshotTone(10.4, 10, "MAINTAIN").tone).toBe("success");
    expect(kpiSnapshotTone(12, 10, "MAINTAIN").tone).toBe("warning");
  });
});

describe("firstLine and weeks", () => {
  it("takes the first non-empty line and trims long ones", () => {
    expect(firstLine("\n  shipped the thing \nmore")).toBe("shipped the thing");
    expect(firstLine("a".repeat(200), 10)).toHaveLength(10);
    expect(firstLine(null)).toBe("");
  });
  it("lists Mondays newest first", () => {
    const w = recentWeekKeys(new Date("2026-09-27T10:00:00Z"), 3);
    expect(w).toEqual(["2026-09-21", "2026-09-14", "2026-09-07"]);
  });
});
