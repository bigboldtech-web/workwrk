// Done is decided by each task's own List (src/lib/list-done.ts). The five
// words isDoneStatusName knows were the whole rule on Home, My work,
// Everything, the pickers and goal Effort, so a content List's PUBLISHED and a
// CANCELLED in a CLOSED group read as open work for ever.

import { describe, expect, it, vi } from "vitest";
import { itemTestDb, matchesWhere, installItemTestDb } from "./item-test-db";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./item-test-db")).itemTestPrisma }));

import { doneClauses, doneParamWhere, listDoneTest, splitDoneByList } from "./list-done";

const db = installItemTestDb(itemTestDb());

const CONTENT = {
  id: "b-content",
  organizationId: "org-1",
  statuses: [
    { value: "DRAFT", label: "Draft", color: "#999999", group: "ACTIVE" },
    { value: "PUBLISHED", label: "Published", color: "#15803D", group: "DONE" },
    { value: "CANCELLED", label: "Cancelled", color: "#D92D20", group: "CLOSED" },
    // A List may call a status Closed and still mean open work.
    { value: "CLOSED", label: "Closed for review", color: "#0073EA", group: "ACTIVE" },
  ],
};
const PLAIN = { id: "b-plain", organizationId: "org-1", statuses: null };

describe("listDoneTest", () => {
  const isDone = listDoneTest([CONTENT, PLAIN]);

  it("reads each List's own set, not the five words", () => {
    expect(isDone("b-content", "PUBLISHED")).toBe(true);
    expect(isDone("b-content", "CANCELLED")).toBe(true);
    expect(isDone("b-content", "DRAFT")).toBe(false);
    // The List's own ACTIVE wins over the word.
    expect(isDone("b-content", "CLOSED")).toBe(false);
  });

  it("a value a set does not declare, and a List it was not given, fall back to the default set and the words", () => {
    expect(isDone("b-content", "COMPLETED")).toBe(true);
    expect(isDone("b-plain", "DONE")).toBe(true);
    expect(isDone("b-plain", "PUBLISHED")).toBe(false);
    expect(isDone("b-elsewhere", "DONE")).toBe(true);
    expect(isDone("b-content", null)).toBe(false);
  });
});

describe("doneClauses", () => {
  const rows = [
    { id: "1", boardId: "b-content", status: "PUBLISHED" },
    { id: "2", boardId: "b-content", status: "CANCELLED" },
    { id: "3", boardId: "b-content", status: "DRAFT" },
    { id: "4", boardId: "b-content", status: "CLOSED" },
    { id: "5", boardId: "b-plain", status: "DONE" },
    { id: "6", boardId: "b-plain", status: "PUBLISHED" },
    { id: "7", boardId: "b-plain", status: null },
  ];
  const clauses = doneClauses(rows, listDoneTest([CONTENT, PLAIN]));
  const keep = (where: object) => rows.filter((r) => matchesWhere(r, where as never, db)).map((r) => r.id);

  it("open keeps what each List calls open, and a task with no status", () => {
    expect(keep(clauses.open)).toEqual(["3", "4", "6", "7"]);
  });

  it("done keeps what each List calls done", () => {
    expect(keep(clauses.done)).toEqual(["1", "2", "5"]);
  });

  it("Lists with the same done values share one branch", () => {
    const shared = doneClauses(
      [{ boardId: "a", status: "DONE" }, { boardId: "b", status: "DONE" }],
      listDoneTest([]),
    );
    expect(shared.done).toEqual({ OR: [{ boardId: { in: ["a", "b"] }, status: { in: ["DONE"] } }] });
  });

  it("with nothing done in reach, open is everything and done is nothing", () => {
    const none = doneClauses([{ boardId: "b-plain", status: "TO_DO" }], listDoneTest([PLAIN]));
    expect(keep(none.open)).toEqual(rows.map((r) => r.id));
    expect(keep(none.done)).toEqual([]);
  });

  it("the done parameter picks the clause", () => {
    expect(doneParamWhere("0", clauses)).toBe(clauses.open);
    expect(doneParamWhere("only", clauses)).toBe(clauses.done);
    expect(doneParamWhere("1", clauses)).toBeNull();
  });
});

describe("splitDoneByList", () => {
  it("counts open and done over the caller's where, by each row's own List", async () => {
    db.boards.push(CONTENT, PLAIN);
    db.items.push(
      { id: "a", organizationId: "org-1", boardId: "b-content", status: "PUBLISHED", ownerId: "u-1" },
      { id: "b", organizationId: "org-1", boardId: "b-content", status: "DRAFT", ownerId: "u-1" },
      { id: "c", organizationId: "org-1", boardId: "b-plain", status: "DONE", ownerId: "u-1" },
      { id: "d", organizationId: "org-1", boardId: "b-plain", status: "DONE", ownerId: "u-2" },
    );
    const split = await splitDoneByList({ organizationId: "org-1", ownerId: "u-1" }, "org-1");
    expect(split.counts).toEqual({ open: 1, done: 2 });
    expect(split.isDone("b-content", "PUBLISHED")).toBe(true);
    const ids = db.items.filter((r) => matchesWhere(r, { AND: [{ ownerId: "u-1" }, split.open] }, db)).map((r) => r.id);
    expect(ids).toEqual(["b"]);
  });
});
