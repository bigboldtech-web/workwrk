import { describe, it, expect } from "vitest";
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  WORK_GROUPS,
  WORK_SORTS,
  WORK_VIEWS,
  boardColumns,
  groupRows,
  overdueAndTodayCount,
  type MyWorkRow,
} from "./my-work";
import type { DueBucket } from "./work-buckets";

function row(over: Partial<MyWorkRow> & { id: string }): MyWorkRow {
  return {
    title: `Task ${over.id}`,
    status: null,
    priority: null,
    startAt: null,
    dueAt: null,
    ownerId: null,
    assigneeIds: [],
    parentItemId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    dueBucket: "none" as DueBucket,
    statusLabel: null,
    statusColor: null,
    doneStatus: null,
    board: null,
    space: null,
    listReadable: false,
    assignees: [],
    ...over,
  };
}

describe("groupRows by due date", () => {
  it("cuts a contiguous run into headed groups in the order the server sent", () => {
    const rows = [
      row({ id: "1", dueBucket: "overdue" }),
      row({ id: "2", dueBucket: "overdue" }),
      row({ id: "3", dueBucket: "today" }),
      row({ id: "4", dueBucket: "later" }),
    ];
    const groups = groupRows(rows, "due");
    expect(groups.map((g) => [g.key, g.rows.length])).toEqual([
      ["overdue", 2],
      ["today", 1],
      ["later", 1],
    ]);
    expect(groups[0].label).toBe("Overdue");
  });

  it("marks Overdue, and only Overdue, as the one semantic colour", () => {
    const groups = groupRows(
      [row({ id: "1", dueBucket: "overdue" }), row({ id: "2", dueBucket: "today" })],
      "due",
    );
    expect(groups[0].tone).toBe("danger");
    expect(groups[1].tone).toBeUndefined();
  });

  it("never re-sorts: the first row of a group decides where the group sits", () => {
    const rows = [row({ id: "1", dueBucket: "today" }), row({ id: "2", dueBucket: "overdue" })];
    expect(groupRows(rows, "due").map((g) => g.key)).toEqual(["today", "overdue"]);
  });

  it("ONE group per key, even when the rows arrive interleaved", () => {
    // The sort is the reader's choice and the grouping is a second, separate
    // choice, so the rows of one group are NOT necessarily adjacent. A
    // run-length grouper opened a fresh group per run: three headers with the
    // same name, three partial counts of one set, and three React children
    // with the same key.
    const rows = [
      row({ id: "1", dueBucket: "today" }),
      row({ id: "2", dueBucket: "overdue" }),
      row({ id: "3", dueBucket: "today" }),
      row({ id: "4", dueBucket: "overdue" }),
    ];
    const groups = groupRows(rows, "due");
    expect(groups.map((g) => [g.key, g.rows.length])).toEqual([
      ["today", 2],
      ["overdue", 2],
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
  });

  it("the same, grouping by List: one header per List", () => {
    const b1 = { id: "b1", slug: "q4", name: "Q4 leads", icon: null, color: null, spaceId: "s1" };
    const b2 = { id: "b2", slug: "hr", name: "HR", icon: null, color: null, spaceId: "s1" };
    const groups = groupRows(
      [row({ id: "1", board: b1 }), row({ id: "2", board: b2 }), row({ id: "3", board: b1 })],
      "list",
    );
    expect(groups.map((g) => [g.key, g.rows.length])).toEqual([
      ["b1", 2],
      ["b2", 1],
    ]);
  });

  it("is empty for no rows", () => {
    expect(groupRows([], "due")).toEqual([]);
  });
});

describe("groupRows by the other keys", () => {
  it("groups by status under the WORD the List calls it, not the stored value", () => {
    const groups = groupRows(
      [row({ id: "1", status: "IN_PROGRESS", statusLabel: "Doing" }), row({ id: "2" })],
      "status",
    );
    expect(groups.map((g) => g.label)).toEqual(["Doing", "No status"]);
    // The KEY is still the stored value, so two Lists that both call
    // "IN_PROGRESS" something different do not merge into one header.
    expect(groups[0].key).toBe("IN_PROGRESS");
  });

  it("groups by List and names a missing List", () => {
    const board = { id: "b1", slug: "q4", name: "Q4 leads", icon: null, color: null, spaceId: "s1" };
    const groups = groupRows([row({ id: "1", board }), row({ id: "2" })], "list");
    expect(groups.map((g) => g.label)).toEqual(["Q4 leads", "No list"]);
  });

  it("groups by priority with the Urgent/High/Normal/Low words", () => {
    const groups = groupRows([row({ id: "1", priority: "URGENT" }), row({ id: "2" })], "priority");
    expect(groups.map((g) => g.label)).toEqual(["Urgent", "No priority"]);
  });

  it("group=none is one unlabelled run, never a header per row", () => {
    const groups = groupRows([row({ id: "1" }), row({ id: "2" })], "none");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("");
    expect(groups[0].rows).toHaveLength(2);
  });
});

describe("boardColumns", () => {
  it("draws every due bucket, including the empty ones you drag into", () => {
    const columns = boardColumns([row({ id: "1", dueBucket: "today" })], "due");
    expect(columns.map((c) => c.key)).toEqual(["overdue", "today", "tomorrow", "week", "later", "none"]);
    expect(columns.find((c) => c.key === "today")!.rows).toHaveLength(1);
    expect(columns.find((c) => c.key === "overdue")!.rows).toEqual([]);
  });

  it("draws every priority column even when nothing carries that priority", () => {
    const columns = boardColumns([row({ id: "1", priority: "HIGH" })], "priority");
    expect(columns.map((c) => c.key)).toEqual([...PRIORITY_ORDER, "__none"]);
  });

  it("does not put a row in two columns", () => {
    const rows = [row({ id: "1", dueBucket: "today" }), row({ id: "2", dueBucket: "overdue" })];
    const seen = boardColumns(rows, "due").flatMap((c) => c.rows.map((r) => r.id));
    expect(seen.sort()).toEqual(["1", "2"]);
  });

  it("falls back to whatever statuses the page holds, since they are unbounded", () => {
    const columns = boardColumns([row({ id: "1", status: "DOING", statusLabel: "Doing" })], "status");
    expect(columns.map((c) => c.label)).toEqual(["Doing"]);
  });

  it("group=none on a board still gives something to render", () => {
    expect(boardColumns([row({ id: "1", status: "A", statusLabel: "A" })], "none")).toHaveLength(1);
  });
});

describe("overdueAndTodayCount", () => {
  it("is the number the sidebar badge prints", () => {
    const rows = [
      row({ id: "1", dueBucket: "overdue" }),
      row({ id: "2", dueBucket: "today" }),
      row({ id: "3", dueBucket: "week" }),
      row({ id: "4", dueBucket: "none" }),
    ];
    expect(overdueAndTodayCount(rows)).toBe(2);
  });

  it("is zero, not NaN, for an empty list", () => {
    expect(overdueAndTodayCount([])).toBe(0);
  });
});

describe("the vocabularies", () => {
  it("offers the five groupings the spec names, plus Assignee for /everything's ?view=team", () => {
    // spec-work-home section 2 (/my-work) names five. /everything shares this
    // vocabulary and its URL contract accepts `?view=team`, which resolves to
    // a list grouped by assignee, so the sixth is the landing for one of the
    // five 308s spec-spaces-lists points here.
    expect(WORK_GROUPS.map((g) => g.key)).toEqual(["due", "status", "list", "priority", "assignee", "none"]);
  });

  it("offers exactly the six sorts the spec names", () => {
    expect(WORK_SORTS.map((s) => s.key)).toEqual(["due", "priority", "title", "list", "created", "updated"]);
  });

  it("offers three views and no Gantt (Gantt is a List view)", () => {
    expect(WORK_VIEWS.map((v) => v.key)).toEqual(["list", "board", "calendar"]);
  });

  it("uses the Urgent / High / Normal / Low words, not Critical / Medium", () => {
    expect(Object.values(PRIORITY_LABEL)).toEqual(["Urgent", "High", "Normal", "Low"]);
    expect(Object.values(PRIORITY_LABEL)).not.toContain("Critical");
    expect(Object.values(PRIORITY_LABEL)).not.toContain("Medium");
  });
});
