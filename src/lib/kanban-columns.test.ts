import { describe, it, expect } from "vitest";
import { countSubtasksByParent, groupCardsByStatus, type KanbanRow } from "./kanban-columns";

const ORDER = ["TO_DO", "IN_PROGRESS", "DONE"];

function row(id: string, status: string | null, parentItemId: string | null = null): KanbanRow {
  return { id, status, parentItemId };
}

function idsIn(map: Map<string, KanbanRow[]>, status: string): string[] {
  return (map.get(status) ?? []).map((r) => r.id);
}

function allIds(map: Map<string, KanbanRow[]>): string[] {
  return [...map.values()].flat().map((r) => r.id);
}

describe("groupCardsByStatus", () => {
  it("buckets top-level cards by their status, one bucket per declared status", () => {
    const out = groupCardsByStatus([row("a", "TO_DO"), row("b", "DONE"), row("c", "TO_DO")], ORDER);
    expect([...out.keys()]).toEqual(ORDER);
    expect(idsIn(out, "TO_DO")).toEqual(["a", "c"]);
    expect(idsIn(out, "IN_PROGRESS")).toEqual([]);
    expect(idsIn(out, "DONE")).toEqual(["b"]);
  });

  it("does NOT draw a subtask as a card of its own beside its parent", () => {
    const out = groupCardsByStatus([row("parent", "TO_DO"), row("child", "TO_DO", "parent")], ORDER);
    expect(idsIn(out, "TO_DO")).toEqual(["parent"]);
    expect(allIds(out)).not.toContain("child");
  });

  it("folds a child away even when it sits in a different column from its parent", () => {
    const out = groupCardsByStatus([row("parent", "TO_DO"), row("child", "DONE", "parent")], ORDER);
    expect(allIds(out)).toEqual(["parent"]);
  });

  it("re-roots an orphan subtask instead of hiding it (parent not on this board)", () => {
    // The parent was archived or lives in another List: the child is still a
    // live task and must stay reachable on the board.
    const out = groupCardsByStatus([row("orphan", "IN_PROGRESS", "gone")], ORDER);
    expect(idsIn(out, "IN_PROGRESS")).toEqual(["orphan"]);
  });

  it("keeps a row whose status the board no longer declares, in the first column", () => {
    const out = groupCardsByStatus([row("ghost", "ARCHIVED_STATUS"), row("blank", null)], ORDER);
    expect(idsIn(out, "TO_DO")).toEqual(["ghost", "blank"]);
  });

  it("loses no top-level row, whatever the mix", () => {
    const items = [
      row("a", "TO_DO"),
      row("b", "IN_PROGRESS", "a"),
      row("c", "WEIRD"),
      row("d", null, "missing"),
      row("e", "DONE"),
    ];
    // Everything except the one real child ("b", whose parent "a" is present).
    expect(allIds(groupCardsByStatus(items, ORDER)).sort()).toEqual(["a", "c", "d", "e"]);
  });

  it("returns no buckets when the board declares no statuses", () => {
    expect(groupCardsByStatus([row("a", "TO_DO")], []).size).toBe(0);
  });
});

describe("countSubtasksByParent", () => {
  it("counts every child against its parent, including ones no column drew", () => {
    const counts = countSubtasksByParent([
      row("p", "TO_DO"),
      row("c1", "TO_DO", "p"),
      row("c2", "DONE", "p"),
      row("orphan", "TO_DO", "gone"),
    ]);
    expect(counts.get("p")).toBe(2);
    // An orphan is drawn as a card, and still counts on the parent it names,
    // so the badge never disagrees with what opening the parent shows.
    expect(counts.get("gone")).toBe(1);
    expect(counts.get("c1")).toBeUndefined();
  });

  it("the parent's count picks up a child the columns fold away", () => {
    const items = [row("p", "TO_DO")];
    expect(countSubtasksByParent(items).get("p")).toBeUndefined();
    const after = [...items, row("new", "TO_DO", "p")];
    expect(countSubtasksByParent(after).get("p")).toBe(1);
    expect(allIds(groupCardsByStatus(after, ORDER))).toEqual(["p"]);
  });
});
