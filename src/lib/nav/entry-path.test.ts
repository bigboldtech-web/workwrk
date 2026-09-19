// The one question the task drawer asks before it renders.
//
// This is the guard on the defect that cost every non-list door into a task:
// the intercept used to render only when a sessionStorage "intent" named the
// task, so an Inbox row, the bell, a reminder, a Space-overview link, a canvas
// card, "Create and open" and the `?item=` back-compat redirect all put the
// task's URL in the bar and left the previous surface on screen. The rule that
// replaced it must stay narrow: exactly one state suppresses the drawer, and
// it stops being true the moment the tab navigates.

import { beforeEach, describe, expect, it } from "vitest";
import { isInitialEntryPath, recordShellPath, resetEntryPathForTest } from "./entry-path";

describe("isInitialEntryPath", () => {
  beforeEach(resetEntryPathForTest);

  it("is true for the path the document was loaded at", () => {
    recordShellPath("/item/abc");
    expect(isInitialEntryPath("/item/abc")).toBe(true);
  });

  it("is false for any other path, even before a navigation", () => {
    recordShellPath("/item/abc");
    expect(isInitialEntryPath("/item/xyz")).toBe(false);
  });

  it("is false for a task opened by a click on a list", () => {
    recordShellPath("/boards/tasks");
    recordShellPath("/item/abc");
    expect(isInitialEntryPath("/item/abc")).toBe(false);
  });

  it("stays false after the tab has navigated, even back to the entry path", () => {
    recordShellPath("/item/abc");
    recordShellPath("/boards/tasks");
    recordShellPath("/item/abc");
    expect(isInitialEntryPath("/item/abc")).toBe(false);
  });

  it("a query-string change is not a navigation (the ?comment= strip)", () => {
    // usePathname never carries the query, so stripping ?comment= re-renders
    // with the same value and must not flip the answer.
    recordShellPath("/item/abc");
    recordShellPath("/item/abc");
    expect(isInitialEntryPath("/item/abc")).toBe(true);
  });

  it("answers false before the shell has recorded anything", () => {
    expect(isInitialEntryPath("/item/abc")).toBe(false);
  });

  it("ignores an empty pathname rather than recording one", () => {
    recordShellPath(null);
    recordShellPath(undefined);
    recordShellPath("");
    recordShellPath("/item/abc");
    expect(isInitialEntryPath("/item/abc")).toBe(true);
  });
});
