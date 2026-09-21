import { describe, expect, it } from "vitest";
import { SPRINT_DAYS, isRowDone, sprintSummary, sprintWindow } from "./my-work-sprint";
import type { MyWorkRow } from "./my-work";
import type { DueBucket } from "./work-buckets";

const NOW = new Date(2026, 8, 21, 10, 0, 0); // Mon 21 Sep 2026, local

function row(over: Partial<MyWorkRow> & { id: string }): MyWorkRow {
  return {
    title: `Task ${over.id}`,
    status: null,
    priority: null,
    startAt: null,
    dueAt: null,
    ownerId: "me",
    assigneeIds: ["me"],
    parentItemId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    dueBucket: "none" as DueBucket,
    statusLabel: null,
    statusColor: null,
    doneStatus: "DONE",
    board: null,
    space: null,
    listReadable: false,
    assignees: [{ id: "me", firstName: "Me", lastName: null, avatar: null }],
    ...over,
  };
}

function daysFrom(d: Date, n: number): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
  return x.toISOString();
}

describe("sprintWindow", () => {
  it("is the fortnight that started six days ago, which is what /tasks/sprint showed", () => {
    const { start, end } = sprintWindow(NOW);
    expect(start.getDate()).toBe(15);
    expect(start.getHours()).toBe(0);
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(SPRINT_DAYS);
  });
});

describe("isRowDone", () => {
  it("follows the row's own List: its done status wins over the name heuristic", () => {
    expect(isRowDone(row({ id: "a", status: "SHIPPED", doneStatus: "SHIPPED" }))).toBe(true);
    expect(isRowDone(row({ id: "b", status: "DONE", doneStatus: "SHIPPED" }))).toBe(false);
  });
  it("falls back to the cross-board name rule when the List declares no done status", () => {
    expect(isRowDone(row({ id: "c", status: "Completed", doneStatus: null }))).toBe(true);
    expect(isRowDone(row({ id: "d", status: "Open", doneStatus: null }))).toBe(false);
  });
});

describe("sprintSummary", () => {
  it("keeps only rows dated inside the window and counts them", () => {
    const s = sprintSummary(
      [
        row({ id: "in1", dueAt: daysFrom(NOW, 0) }),
        row({ id: "in2", dueAt: daysFrom(NOW, 5), status: "DONE" }),
        row({ id: "start-only", startAt: daysFrom(NOW, 2) }),
        row({ id: "out", dueAt: daysFrom(NOW, 30) }),
        row({ id: "undated" }),
      ],
      NOW,
    );
    expect(s.rows.map((r) => r.id)).toEqual(["in1", "in2", "start-only"]);
    expect(s.total).toBe(3);
    expect(s.done).toBe(1);
    expect(s.completionPct).toBe(33);
    expect(s.dayOf).toBe(7);
  });

  it("draws one ideal point per day from total to zero, and actuals only for elapsed days", () => {
    const s = sprintSummary([row({ id: "a", dueAt: daysFrom(NOW, 1) }), row({ id: "b", dueAt: daysFrom(NOW, 1) })], NOW);
    expect(s.points).toHaveLength(SPRINT_DAYS);
    expect(s.points[0].ideal).toBe(2);
    expect(s.points[SPRINT_DAYS - 1].ideal).toBe(0);
    expect(s.points[s.dayOf - 1].actual).toBe(2);
    expect(s.points[s.dayOf].actual).toBeNull();
  });

  it("burns a done task on the day it was last updated", () => {
    const doneAt = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 2, 9).toISOString();
    const s = sprintSummary(
      [row({ id: "a", dueAt: daysFrom(NOW, 1), status: "DONE", updatedAt: doneAt }), row({ id: "b", dueAt: daysFrom(NOW, 1) })],
      NOW,
    );
    // Day 0..3 (Sep 15..18) still 2; from day 4 (Sep 19) it is 1.
    expect(s.points[3].actual).toBe(2);
    expect(s.points[4].actual).toBe(1);
  });

  it("says Planning with nothing in the window and grades pace otherwise", () => {
    expect(sprintSummary([], NOW).verdict.label).toBe("Planning");
    const allDone = [1, 2, 3, 4].map((n) => row({ id: `d${n}`, dueAt: daysFrom(NOW, 1), status: "DONE" }));
    expect(sprintSummary(allDone, NOW).verdict.label).toBe("Ahead of pace");
    const noneDone = [1, 2, 3, 4].map((n) => row({ id: `o${n}`, dueAt: daysFrom(NOW, 1) }));
    expect(sprintSummary(noneDone, NOW).verdict.label).toBe("Behind pace");
  });

  it("lists past-due open rows and unassigned non-low rows as at risk", () => {
    const s = sprintSummary(
      [
        row({ id: "late", dueAt: daysFrom(NOW, -1) }),
        row({ id: "late-done", dueAt: daysFrom(NOW, -1), status: "DONE" }),
        row({ id: "nobody", dueAt: daysFrom(NOW, 2), assignees: [], assigneeIds: [], ownerId: null }),
        row({ id: "nobody-low", dueAt: daysFrom(NOW, 2), priority: "LOW", assignees: [], assigneeIds: [], ownerId: null }),
        row({ id: "fine", dueAt: daysFrom(NOW, 3) }),
      ],
      NOW,
    );
    expect(s.atRisk.map((r) => r.id)).toEqual(["late", "nobody"]);
    expect(s.unassigned.map((r) => r.id)).toEqual(["nobody", "nobody-low"]);
  });
});
