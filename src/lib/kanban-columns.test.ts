import { describe, it, expect } from "vitest";
import { countSubtasksByParent, groupCardsByStatus, subtasksByParent, treeOrder, type KanbanRow } from "./kanban-columns";

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

  // Phase 5b: a card shown here through a link stores its HOME status, which
  // this board may not declare ("Shipped"). The accessor names the column it
  // belongs to HERE.
  it("places a linked card in the B-side column its accessor names", () => {
    const linked = row("linked", "SHIPPED");
    const out = groupCardsByStatus([row("a", "TO_DO"), linked], ORDER, (r) => (r.id === "linked" ? "DONE" : r.status ?? null));
    expect(idsIn(out, "DONE")).toEqual(["linked"]);
    expect(idsIn(out, "TO_DO")).toEqual(["a"]);
  });

  it("groups exactly as before without the accessor", () => {
    const items = [row("a", "TO_DO"), row("b", "DONE"), row("c", "SHIPPED"), row("d", "TO_DO", "a")];
    const withDefault = groupCardsByStatus(items, ORDER, (r) => r.status ?? null);
    const without = groupCardsByStatus(items, ORDER);
    expect([...without.entries()].map(([k, v]) => [k, v.map((r) => r.id)])).toEqual([
      ["TO_DO", ["a", "c"]],
      ["IN_PROGRESS", []],
      ["DONE", ["b"]],
    ]);
    expect([...withDefault.entries()]).toEqual([...without.entries()]);
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

// Founder report 2026-11-27: "sub task not visible on top of board". The
// Board's Subtasks control (lib/work/subtask-display.ts) opens a card's
// subtasks in place, or shows each as a card of its own under "Separate".
describe("the Board's Subtasks control", () => {
  type P = KanbanRow & { position: number };
  const p = (id: string, status: string, position: number, parentItemId: string | null = null): P => ({ id, status, position, parentItemId });
  const byPos = (a: P, b: P) => a.position - b.position || (a.id < b.id ? -1 : 1);

  it("Separate puts every subtask in the column of its own status", () => {
    const items = [p("parent", "TO_DO", 1), p("kid", "IN_PROGRESS", 1, "parent"), p("kid2", "TO_DO", 2, "parent")];
    const out = groupCardsByStatus(items, ORDER, undefined, { separate: true });
    expect(idsIn(out, "TO_DO").sort()).toEqual(["kid2", "parent"]);
    expect(idsIn(out, "IN_PROGRESS")).toEqual(["kid"]);
  });

  it("guard: without Separate a subtask still folds under its card", () => {
    const items = [p("parent", "TO_DO", 1), p("kid", "IN_PROGRESS", 1, "parent")];
    expect(allIds(groupCardsByStatus(items, ORDER))).toEqual(["parent"]);
  });

  it("a card's open list holds exactly the subtasks its count says, in the List's order", () => {
    const items = [p("a", "TO_DO", 1), p("a2", "DONE", 5, "a"), p("a1", "TO_DO", 2, "a"), p("b", "TO_DO", 2), p("b1", "TO_DO", 1, "b")];
    const lists = subtasksByParent(items, byPos);
    const counts = countSubtasksByParent(items);
    expect(lists.get("a")!.map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(lists.get("b")!.map((r) => r.id)).toEqual(["b1"]);
    for (const [parent, n] of counts) expect(lists.get(parent)!.length).toBe(n);
  });

  it("Separate orders a column with each subtask straight after the task it hangs under", () => {
    // Cards a, b, c by place; a subtask's own place is in its parent's list.
    const items = [p("a", "TO_DO", 10), p("b", "TO_DO", 20), p("c", "TO_DO", 30), p("b1", "TO_DO", 1, "b"), p("b1x", "TO_DO", 1, "b1"), p("a1", "TO_DO", 99, "a")];
    const order = treeOrder(items, byPos);
    expect([...items].sort(order).map((r) => r.id)).toEqual(["a", "a1", "b", "b1", "b1x", "c"]);
  });

  it("the cards a person arranges keep their own order under Separate", () => {
    const items = [p("a", "TO_DO", 30), p("b", "TO_DO", 10), p("a1", "TO_DO", 1, "a")];
    const top = [...items].sort(treeOrder(items, byPos)).filter((r) => !r.parentItemId).map((r) => r.id);
    expect(top).toEqual([...items].filter((r) => !r.parentItemId).sort(byPos).map((r) => r.id));
  });

  it("a subtask whose parent is not on the board sits at its own place", () => {
    const items = [p("a", "TO_DO", 10), p("orphan", "TO_DO", 15, "elsewhere"), p("b", "TO_DO", 20)];
    expect([...items].sort(treeOrder(items, byPos)).map((r) => r.id)).toEqual(["a", "orphan", "b"]);
  });

  it("a loop in the data never spins", () => {
    const items = [p("x", "TO_DO", 1, "y"), p("y", "TO_DO", 2, "x")];
    expect([...items].sort(treeOrder(items, byPos)).map((r) => r.id).sort()).toEqual(["x", "y"]);
  });
});
