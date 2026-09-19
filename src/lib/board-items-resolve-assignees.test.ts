// resolveAssignees — the normaliser every WRITE path runs an assignee set
// through (create, the multi-picker, /api/items/bulk).
//
// The rule it exists to hold: ownerId is assigneeIds[0], and nobody the caller
// listed is ever dropped on the way in. The bug fixed here is the quiet half
// of that: an explicit ownerId sent ALONGSIDE assigneeIds was ignored whenever
// the array was non-empty, so `{ assigneeIds: ["b","c"], ownerId: "c" }`
// answered 200 and made "b" the DRI. /api/items/bulk forwards both fields
// together, so that shape reaches this function for real.

import { describe, expect, it } from "vitest";
import { resolveAssignees } from "@/lib/board-items-shared";

describe("resolveAssignees", () => {
  it("obeys an explicit ownerId sent with a set, instead of silently overriding it", () => {
    expect(resolveAssignees(["b", "c"], "c")).toEqual({ assigneeIds: ["c", "b"], ownerId: "c" });
  });

  it("adds a named owner who is not in the set rather than swapping anyone out", () => {
    const out = resolveAssignees(["b", "c"], "z");
    expect(out.ownerId).toBe("z");
    expect(out.assigneeIds).toEqual(["z", "b", "c"]);
    // nobody the caller listed is missing
    expect(out.assigneeIds).toContain("b");
    expect(out.assigneeIds).toContain("c");
  });

  it("keeps the caller's order when no owner is named", () => {
    expect(resolveAssignees(["b", "c"], null)).toEqual({ assigneeIds: ["b", "c"], ownerId: "b" });
  });

  it("falls back to the legacy single ownerId when no set is given", () => {
    expect(resolveAssignees(undefined, "a")).toEqual({ assigneeIds: ["a"], ownerId: "a" });
    expect(resolveAssignees(undefined, null)).toEqual({ assigneeIds: [], ownerId: null });
  });

  it("an explicit empty set really is nobody", () => {
    expect(resolveAssignees([], null)).toEqual({ assigneeIds: [], ownerId: null });
  });

  it("dedupes without losing a person", () => {
    expect(resolveAssignees(["b", "b", "c"], "b").assigneeIds).toEqual(["b", "c"]);
  });

  it("drops whitespace-only ids, which zod's min(1) used to wave through", () => {
    expect(resolveAssignees(["  ", "b"], null)).toEqual({ assigneeIds: ["b"], ownerId: "b" });
  });
});
