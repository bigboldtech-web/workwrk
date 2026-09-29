import { describe, expect, it } from "vitest";
import { goalsGroupExpanded, goalsGroupHeld, goalsParentLit } from "./people-prefs";

// The Work sidebar's Goals group on /okrs: the route holds it open by default,
// but the chevron's per-visit choice (heldClosed) must still collapse it, so
// "Collapse Goals" is never a dead control there.
describe("goalsGroupExpanded with the per-visit collapse", () => {
  it("lets the chevron collapse the group on /okrs whatever the pref says", () => {
    expect(goalsGroupExpanded({ groups: { goals: true } }, "/okrs", true)).toBe(false);
    expect(goalsGroupExpanded(undefined, "/okrs/abc", true)).toBe(false);
    expect(goalsGroupExpanded({ groups: { goals: false } }, "/okrs", false)).toBe(true);
    expect(goalsGroupExpanded({ groups: { goals: false } }, "/okrs")).toBe(true);
  });
  it("ignores the per-visit collapse off /okrs, where the pref rules", () => {
    expect(goalsGroupExpanded({ groups: { goals: true } }, "/home", true)).toBe(true);
    expect(goalsGroupExpanded(undefined, "/home", true)).toBe(false);
  });
  it("holds only /okrs and its goal pages", () => {
    expect(goalsGroupHeld("/okrs")).toBe(true);
    expect(goalsGroupHeld("/okrs/abc")).toBe(true);
    expect(goalsGroupHeld("/okrsx")).toBe(false);
    expect(goalsGroupHeld("/home")).toBe(false);
  });
});

// With the group collapsed on a Goals page no child row renders, so the
// parent lights in its place; expanded, the child lights and the parent
// never does, so one URL lights exactly one row.
describe("goalsParentLit", () => {
  it("lights the parent only when collapsed on a Goals page", () => {
    expect(goalsParentLit("/okrs", false)).toBe(true);
    expect(goalsParentLit("/okrs/abc", false)).toBe(true);
    expect(goalsParentLit("/okrs", true)).toBe(false);
    expect(goalsParentLit("/okrs/abc", true)).toBe(false);
    expect(goalsParentLit("/home", false)).toBe(false);
    expect(goalsParentLit("/okrsx", false)).toBe(false);
  });
});
