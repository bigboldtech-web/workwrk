import { describe, expect, it } from "vitest";
import { resolveEverythingView } from "./everything-view";

/**
 * The /everything URL contract (spec-work-home section 2).
 *
 * spec-spaces-lists section 0 sends five Space-wide and Folder-wide views here
 * with a 308, and two of them name a view that has no cross-List form. If this
 * table is wrong those two redirects land on nothing, which is the exact thing
 * the "nothing disappears" rule forbids.
 */
describe("resolveEverythingView", () => {
  it("passes the three real views through", () => {
    expect(resolveEverythingView("list")).toEqual({ view: "list", group: null });
    expect(resolveEverythingView("board")).toEqual({ view: "board", group: null });
    expect(resolveEverythingView("calendar")).toEqual({ view: "calendar", group: null });
  });

  it("resolves gantt to list: a Gantt is a List view, never a cross-List one", () => {
    expect(resolveEverythingView("gantt")).toEqual({ view: "list", group: null });
  });

  it("resolves team to a list grouped by assignee, which is what the old Space team view showed", () => {
    expect(resolveEverythingView("team")).toEqual({ view: "list", group: "assignee" });
  });

  it("falls back to list rather than erroring on an unknown, empty or missing value", () => {
    expect(resolveEverythingView("nonsense").view).toBe("list");
    expect(resolveEverythingView("").view).toBe("list");
    expect(resolveEverythingView(null).view).toBe("list");
  });

  it("is case-insensitive, because a hand-typed link is not lower case", () => {
    expect(resolveEverythingView("BOARD").view).toBe("board");
    expect(resolveEverythingView("Team").group).toBe("assignee");
  });
});
