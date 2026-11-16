import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, hiddenByFilters, type BoardFilters } from "./board-filter-bar";
import type { BoardItemRow } from "@/lib/board-items-shared";

// Founder report 2026-11-10: a List with one saved filter showed 0 in every
// column, so its tasks read as gone and each new task as never added.

const task = (over: Partial<BoardItemRow> = {}) =>
  ({ id: "t1", title: "Fix the header", status: "TO_DO", ownerId: null, assigneeIds: [], metadata: {}, parentItemId: null, ...over }) as unknown as BoardItemRow;
const onlyAsha: BoardFilters = { ...EMPTY_FILTERS, rules: [{ id: "r1", field: "assignee", operator: "is", value: "asha" }] };

describe("hiddenByFilters", () => {
  it("a task the filter does not match is hidden", () => {
    expect(hiddenByFilters(task(), onlyAsha, [])).toBe(true);
  });

  it("a task the filter matches is not", () => {
    expect(hiddenByFilters(task({ ownerId: "asha" }), onlyAsha, [])).toBe(false);
  });

  it("guard: with no filter nothing is hidden", () => {
    expect(hiddenByFilters(task(), EMPTY_FILTERS, [])).toBe(false);
  });

  it("a search counts as a filter", () => {
    expect(hiddenByFilters(task(), { ...EMPTY_FILTERS, search: "invoice" }, [])).toBe(true);
  });
});

describe("the List says so", () => {
  const canvas = readFileSync("src/components/board-view/board-canvas.tsx", "utf8");

  it("when a new task is hidden, with the way out on the message", () => {
    expect(canvas).toMatch(/Task added, but a filter on this view is hiding it\./);
  });

  it("when a view opens with every task hidden, once per view", () => {
    expect(canvas).toMatch(/Every task in this view is hidden by a filter\./);
    expect(canvas).toMatch(/toldEmptyFor\.current === openedView/);
  });

  it("Clear filter acts only on the view it spoke of, and can be undone", () => {
    expect(canvas).toMatch(/if \(now\.view !== view\) return;/);
    expect(canvas).toMatch(/onUndo: \(\) => \{\s+if \(filterNow\.current\.view === view\) filterNow\.current\.apply\(before\);/);
  });

  it("on a shared view, Clear filter clears the person's own filter only", () => {
    expect(canvas).toMatch(/apply: \(next: BoardFilters\) => setFilters\(next\)/);
    expect(canvas).toMatch(/if \(ownFilters && viewId\) saveOwnFilters\(viewId, next, viewFilters\);/);
  });

  it("only Save for everyone changes a shared view's filter", () => {
    expect(canvas).toMatch(/const saveFiltersForEveryone = useCallback\(\(\) => \{\s+if \(!viewId\) return;\s+persistViewConfig\(\{ filters: serializeFilters\(filters\) \}, "filters"\);/);
  });

  it("a view type with no filter menu never says so", () => {
    expect(canvas).toMatch(/everyTaskHidden = filterable &&/);
    expect(canvas).toMatch(/now\.filterable && hiddenByFilters/);
  });
});
