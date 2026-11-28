import { describe, expect, it } from "vitest";
import { applyChecklistOp, checklistOpSchema, CHECKLIST_MAX_ITEMS } from "./checklist-op";

// Pen test 2026-11-28, V-33: two people on one checklist at once.

const a1 = { text: "a1", done: false };
const b1 = { text: "b1", done: false };

describe("applyChecklistOp", () => {
  it("two adds made from the same old list both land", () => {
    const stored: unknown[] = [];
    const afterAdmin = applyChecklistOp(stored, { kind: "add", text: "a1" });
    const afterManager = applyChecklistOp(afterAdmin, { kind: "add", text: "b1" });
    expect(afterManager).toEqual([a1, b1]);
  });

  it("ticks the item by its text, even after someone added above it", () => {
    const stored = [{ text: "new on top", done: false }, a1, b1];
    expect(applyChecklistOp(stored, { kind: "toggle", index: 0, text: "a1", done: true })).toEqual([{ text: "new on top", done: false }, { text: "a1", done: true }, b1]);
  });

  it("sets the tick rather than flipping it, so two people ticking one item agree", () => {
    const once = applyChecklistOp([a1], { kind: "toggle", index: 0, text: "a1", done: true });
    expect(applyChecklistOp(once, { kind: "toggle", index: 0, text: "a1", done: true })).toEqual([{ text: "a1", done: true }]);
  });

  it("of two items with the same text, changes the one nearest where the editor saw it", () => {
    const stored = [{ text: "x", done: false }, b1, { text: "x", done: false }];
    expect(applyChecklistOp(stored, { kind: "remove", index: 2, text: "x" })).toEqual([{ text: "x", done: false }, b1]);
  });

  it("changes nothing when the item is already gone", () => {
    expect(applyChecklistOp([b1], { kind: "remove", index: 0, text: "a1" })).toEqual([b1]);
    expect(applyChecklistOp([b1], { kind: "toggle", index: 0, text: "a1", done: true })).toEqual([b1]);
    expect(applyChecklistOp([b1], { kind: "move", index: 0, text: "a1", to: 0 })).toEqual([b1]);
  });

  it("moves an item to its place in the list without it, and keeps what else the item held", () => {
    const c = { text: "c", done: true, extra: 1 };
    expect(applyChecklistOp([a1, b1, c], { kind: "move", index: 2, text: "c", to: 0 })).toEqual([c, a1, b1]);
    expect(applyChecklistOp([a1, b1, c], { kind: "move", index: 0, text: "a1", to: 99 })).toEqual([b1, c, a1]);
  });

  it("reads anything stored that is not a list as empty, and stops adding at the cap", () => {
    expect(applyChecklistOp({ not: "a list" }, { kind: "add", text: "a1" })).toEqual([a1]);
    const full = Array.from({ length: CHECKLIST_MAX_ITEMS }, (_, i) => ({ text: `t${i}`, done: false }));
    expect(applyChecklistOp(full, { kind: "add", text: "one more" })).toHaveLength(CHECKLIST_MAX_ITEMS);
  });

  it("the wire shape refuses an unknown change or an empty text", () => {
    expect(checklistOpSchema.safeParse({ kind: "rename", index: 0, text: "a" }).success).toBe(false);
    expect(checklistOpSchema.safeParse({ kind: "add", text: "" }).success).toBe(false);
    expect(checklistOpSchema.safeParse({ kind: "toggle", index: 0, text: "a", done: true }).success).toBe(true);
  });
});
