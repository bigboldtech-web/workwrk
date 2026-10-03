import { describe, expect, it } from "vitest";
import { MIN_GAP, POSITION_STEP, byPosition, dropSide, indexAtPointer, indexFor, moveInOrder, placeInOrder, planDrop, renumberedPositions, type Ordered } from "./reorder";

const t = (id: string, position: number): Ordered => ({ id, position });

describe("planDrop: one write between the new neighbours", () => {
  const col = [t("a", 1024), t("b", 2048), t("c", 3072)];

  it("puts a task dragged down between its new neighbours, at their midpoint", () => {
    // a moves between b and c.
    expect(planDrop(col, "a", 1)).toEqual({ kind: "position", position: 2560 });
  });

  it("puts a task dragged up at the top, one step above the first", () => {
    expect(planDrop(col, "c", 0)).toEqual({ kind: "position", position: 1024 - POSITION_STEP });
  });

  it("puts a task dragged to the bottom one step below the last", () => {
    expect(planDrop(col, "a", 2)).toEqual({ kind: "position", position: 3072 + POSITION_STEP });
  });

  it("does nothing when it is dropped back where it already is", () => {
    expect(planDrop(col, "b", 1)).toEqual({ kind: "none" });
    expect(planDrop(col, "a", 0)).toEqual({ kind: "none" });
    expect(planDrop(col, "c", 2)).toEqual({ kind: "none" });
  });

  it("places a task arriving from another column among this one's tasks", () => {
    // x comes from elsewhere and lands between a and b.
    expect(planDrop(col, "x", 1)).toEqual({ kind: "position", position: 1536 });
    // Into an empty column only its status changes.
    expect(planDrop([], "x", 0)).toEqual({ kind: "none" });
  });
});

describe("planDrop: when there is no room, the server renumbers the List", () => {
  it("asks for a renumber between tasks that share a position (seeded or templated) instead of doing nothing", () => {
    const tied = [t("a", 0), t("b", 0), t("c", 0), t("d", 0)];
    expect(planDrop(tied, "d", 1)).toEqual({ kind: "renumber", afterId: "a", beforeId: "b" });
  });

  it("asks for a renumber when repeated drops have halved one gap below MIN_GAP", () => {
    const tight = [t("a", 1000), t("b", 1000 + MIN_GAP / 2), t("c", 2000)];
    expect(planDrop(tight, "c", 1)).toEqual({ kind: "renumber", afterId: "a", beforeId: "b" });
  });
});

describe("moveInOrder: the server's renumber over the WHOLE List", () => {
  it("puts the task before its next neighbour and keeps every other task's order", () => {
    // y belongs to another group; x and z are hidden by the person's filter.
    const all = [t("x", -5), t("a", 10), t("b", 10), t("z", 30), t("y", 50)];
    const order = moveInOrder(all, "y", "a", "b");
    expect(order).toEqual(["x", "a", "y", "b", "z"]);
    expect(renumberedPositions(order!).get("z")).toBe(5 * POSITION_STEP);
  });

  it("falls back to after the previous neighbour when the next one left the List", () => {
    expect(moveInOrder([t("a", 0), t("b", 0), t("c", 0)], "c", "a", "gone")).toEqual(["a", "c", "b"]);
  });

  it("refuses when the task or both neighbours are no longer in the List", () => {
    expect(moveInOrder([t("a", 0), t("b", 0)], "gone", "a", "b")).toBeNull();
    expect(moveInOrder([t("a", 0), t("b", 0), t("c", 0)], "c", "x", "y")).toBeNull();
  });
});

describe("placeInOrder: the server's one write between the true neighbours", () => {
  const pos = new Map([["a", 1024], ["b", 2048], ["c", 2048], ["u", 5000]]);
  it("splits the real gap, including neighbours the view never loaded", () => {
    // The view thought the bottom was after b; the List also holds u at 5000.
    expect(placeInOrder(["a", "b", "x", "u"], pos, "x")).toBe(3524);
  });
  it("steps past an end, and is the first number in an empty List", () => {
    expect(placeInOrder(["x", "a"], pos, "x")).toBe(1024 - POSITION_STEP);
    expect(placeInOrder(["a", "x"], pos, "x")).toBe(1024 + POSITION_STEP);
    expect(placeInOrder(["x"], pos, "x")).toBe(POSITION_STEP);
  });
  it("asks for a renumber when the neighbours have no room", () => {
    expect(placeInOrder(["b", "x", "c"], pos, "x")).toBeNull();
    expect(placeInOrder(["a", "b"], pos, "gone")).toBeNull();
  });
});

describe("pointer and index helpers", () => {
  it("reads the upper half of a card as before it and the lower half as after", () => {
    expect(dropSide(105, { top: 100, height: 40 })).toBe("before");
    expect(dropSide(125, { top: 100, height: 40 })).toBe("after");
  });

  it("counts the drop index among the group's other tasks", () => {
    const col = [t("a", 1), t("b", 2), t("c", 3)];
    expect(indexFor(col, "a", "c", "after")).toBe(2);
    expect(indexFor(col, "c", "a", "before")).toBe(0);
    expect(indexFor(col, "x", "b", "after")).toBe(2);
    expect(indexFor(col, "a", "gone", "before")).toBe(2);
  });

  it("reads a drop on the dragged task itself as no move, never the bottom", () => {
    const col = [t("a", 1), t("b", 2), t("c", 3)];
    for (const side of ["before", "after"] as const) {
      expect(planDrop(col, "b", indexFor(col, "b", "b", side))).toEqual({ kind: "none" });
      expect(planDrop(col, "a", indexFor(col, "a", "a", side))).toEqual({ kind: "none" });
    }
  });

  it("gives the gap between two cards to the card below it", () => {
    // Other cards at 0-40 (place 0) and 48-88 (place 1): the 8px gap is before place 1.
    const boxes = [{ place: 0, top: 0, height: 40 }, { place: 1, top: 48, height: 40 }];
    expect(indexAtPointer(10, boxes, 2)).toBe(0);
    expect(indexAtPointer(44, boxes, 2)).toBe(1);
    expect(indexAtPointer(60, boxes, 2)).toBe(1);
    expect(indexAtPointer(80, boxes, 2)).toBe(2);
    expect(indexAtPointer(500, [], 0)).toBe(0);
  });

  it("orders by position, then id, so tied rows never trade places", () => {
    expect([t("b", 0), t("a", 0), t("c", -1)].sort(byPosition).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});
