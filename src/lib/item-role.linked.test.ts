import { describe, expect, it } from "vitest";
import { allowsItemAction, decideItem, denialStatusFor } from "./item-role";

// Phase 5b: a reader of a List a task is linked into may READ the task, and
// nothing more. The source only names itself when nothing else grants a role.
const base = { orgAdmin: false, guest: false, creator: false, assignee: false, listRole: "none" as const, archived: false };
const linked = { id: "B", name: "List B" };

describe("the linked-list source", () => {
  it("grants VIEW, via the linked List, to someone with nothing else", () => {
    const d = decideItem({ ...base, linkedList: linked });
    expect(d).toEqual({ role: "VIEW", via: "linked-list", viaObject: { type: "list", id: "B", name: "List B" }, roleBeforeArchive: "VIEW", archived: false });
    expect(allowsItemAction(d, "view", { creator: false })).toBe(true);
    for (const action of ["comment", "edit", "archive", "restore", "duplicate", "move", "delete"] as const) {
      expect(allowsItemAction(d, action, { creator: false })).toBe(false);
      expect(denialStatusFor(d, action)).toBe(403);
    }
  });
  it("never outranks or relabels any other source", () => {
    expect(decideItem({ ...base, listRole: "VIEW", list: { id: "A", name: "A" }, linkedList: linked }).via).toBe("list");
    expect(decideItem({ ...base, listRole: "EDIT", list: { id: "A", name: "A" }, linkedList: linked }).role).toBe("EDIT");
    expect(decideItem({ ...base, assignee: true, linkedList: linked })).toMatchObject({ role: "EDIT", via: "assignee" });
    expect(decideItem({ ...base, creator: true, linkedList: linked })).toMatchObject({ role: "FULL", via: "creator" });
  });
  it("is absent when there is no readable linked List", () => {
    expect(decideItem({ ...base, linkedList: null }).role).toBe("none");
    expect(decideItem(base).role).toBe("none");
  });
});
