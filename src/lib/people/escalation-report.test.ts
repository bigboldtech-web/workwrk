import { describe, expect, it } from "vitest";
import {
  isOverdueTrigger,
  itemPeople,
  thresholdDurationMs,
  unreachableHolders,
  wouldHaveEscalated,
  type ReportItem,
} from "./escalation-report";

const DAY = 86_400_000;
const now = new Date("2026-09-28T12:00:00Z");
const since = new Date(now.getTime() - 30 * DAY);
const holders = new Set(["u1", "u2"]);
const item = (o: Partial<ReportItem>): ReportItem => ({ ownerId: "u1", assigneeIds: [], status: "Working on it", dueAt: new Date(now.getTime() - 5 * DAY), ...o });

describe("thresholdDurationMs", () => {
  it("reads minutes, hours, days and weeks", () => {
    expect(thresholdDurationMs(45, "min")).toBe(45 * 60_000);
    expect(thresholdDurationMs(2, "hours")).toBe(2 * 3_600_000);
    expect(thresholdDurationMs(1, "day")).toBe(DAY);
    expect(thresholdDurationMs(1, "weeks")).toBe(7 * DAY);
  });
  it("answers null for a unit that is not a duration, or a bad value", () => {
    expect(thresholdDurationMs(3, "items")).toBeNull();
    expect(thresholdDurationMs(3, null)).toBeNull();
    expect(thresholdDurationMs(-1, "h")).toBeNull();
    expect(thresholdDurationMs(Number.NaN, "h")).toBeNull();
  });
});

describe("isOverdueTrigger", () => {
  it("recognises the overdue-shaped triggers only", () => {
    expect(isOverdueTrigger("Overdue by")).toBe(true);
    expect(isOverdueTrigger("past due")).toBe(true);
    expect(isOverdueTrigger("unclaimed")).toBe(false);
    expect(isOverdueTrigger(null)).toBe(false);
  });
});

describe("itemPeople", () => {
  it("lists the owner then each assignee once", () => {
    expect(itemPeople({ ownerId: "a", assigneeIds: ["b", "a", "b", "c"] })).toEqual(["a", "b", "c"]);
    expect(itemPeople({ ownerId: null, assigneeIds: [] })).toEqual([]);
  });
});

describe("wouldHaveEscalated", () => {
  it("counts an open item of a holder that crossed inside the window", () => {
    expect(wouldHaveEscalated(item({}), holders, DAY, since, now)).toBe(true);
  });
  it("counts a holder who is only an assignee (multi-assignee work)", () => {
    expect(wouldHaveEscalated(item({ ownerId: "x", assigneeIds: ["u2"] }), holders, DAY, since, now)).toBe(true);
  });
  it("never counts a done item", () => {
    expect(wouldHaveEscalated(item({ status: "Done" }), holders, DAY, since, now)).toBe(false);
  });
  it("reads a custom closed status by its List's group, not its name", () => {
    const statuses = [
      { value: "BUILDING", label: "Building", color: "#000", group: "ACTIVE" as const },
      { value: "SHIPPED", label: "Shipped", color: "#000", group: "CLOSED" as const },
    ];
    expect(wouldHaveEscalated(item({ status: "SHIPPED", statuses }), holders, DAY, since, now)).toBe(false);
    expect(wouldHaveEscalated(item({ status: "BUILDING", statuses }), holders, DAY, since, now)).toBe(true);
    // A value the List no longer lists falls back to the name rule.
    expect(wouldHaveEscalated(item({ status: "Completed", statuses }), holders, DAY, since, now)).toBe(false);
  });
  it("never counts someone else's item", () => {
    expect(wouldHaveEscalated(item({ ownerId: "x", assigneeIds: ["y"] }), holders, DAY, since, now)).toBe(false);
  });
  it("skips an item with no due date", () => {
    expect(wouldHaveEscalated(item({ dueAt: null }), holders, DAY, since, now)).toBe(false);
  });
  it("skips a crossing before the window opened and one still in the future", () => {
    expect(wouldHaveEscalated(item({ dueAt: new Date(now.getTime() - 40 * DAY) }), holders, DAY, since, now)).toBe(false);
    expect(wouldHaveEscalated(item({ dueAt: new Date(now.getTime() - 3_600_000) }), holders, DAY, since, now)).toBe(false);
  });
});

describe("unreachableHolders", () => {
  it("is zero when the threshold names a person", () => {
    expect(unreachableHolders("boss", [{ managerId: null }])).toBe(0);
  });
  it("counts holders with no manager when escalation falls back to the manager", () => {
    expect(unreachableHolders(null, [{ managerId: null }, { managerId: "m" }, { managerId: null }])).toBe(2);
  });
});
