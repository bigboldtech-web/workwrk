import { describe, it, expect } from "vitest";
import { buildSubtaskBody } from "./board-items-shared";

// The bug this locks down: the Kanban card's "+" POSTed { title: "New
// subtask" } and then tried to rename the row. Anything that interrupted the
// rename left that literal string saved as a task. The builder is the only way
// either surface composes the body, so a title can only ever be the user's.

describe("buildSubtaskBody", () => {
  it("sends the title the user typed, never a placeholder", () => {
    expect(buildSubtaskBody({ title: "Draft the brief", parentId: "p1", parentStatus: "TO_DO" })).toEqual({
      title: "Draft the brief",
      status: "TO_DO",
      parentItemId: "p1",
    });
  });

  it("refuses an empty or whitespace-only title rather than inventing one", () => {
    for (const title of ["", "   ", "\t\n"]) {
      expect(buildSubtaskBody({ title, parentId: "p1", parentStatus: "TO_DO" })).toBeNull();
    }
  });

  it("trims, so a stray space cannot become part of the saved name", () => {
    expect(buildSubtaskBody({ title: "  Ship it  ", parentId: "p1" })?.title).toBe("Ship it");
  });

  it("inherits the parent's status, falling back to the List's first status", () => {
    expect(buildSubtaskBody({ title: "x", parentId: "p1", parentStatus: "IN_PROGRESS", fallbackStatus: "TO_DO" })?.status)
      .toBe("IN_PROGRESS");
    expect(buildSubtaskBody({ title: "x", parentId: "p1", parentStatus: null, fallbackStatus: "TO_DO" })?.status)
      .toBe("TO_DO");
    expect(buildSubtaskBody({ title: "x", parentId: "p1" })?.status).toBeNull();
  });

  it("always carries the parent, so the row is a child and not a loose task", () => {
    expect(buildSubtaskBody({ title: "x", parentId: "parent-9" })?.parentItemId).toBe("parent-9");
  });

  it("never carries a title matching the old placeholder unless the user typed it", () => {
    const body = buildSubtaskBody({ title: "New subtask", parentId: "p1" });
    // Typed by hand it is a legitimate name; the point is that nothing else
    // in the body generates it.
    expect(body?.title).toBe("New subtask");
    expect(Object.keys(body ?? {}).sort()).toEqual(["parentItemId", "status", "title"]);
  });
});
