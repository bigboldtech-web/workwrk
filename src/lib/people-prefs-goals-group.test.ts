import { describe, expect, it } from "vitest";
import { goalsGroupExpanded, goalsGroupHeld } from "./people-prefs";

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
