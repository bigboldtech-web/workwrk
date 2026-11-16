import { beforeEach, describe, expect, it } from "vitest";
import { forgetPersonalFilters, personalFiltersPatch, personalFiltersRaw, rememberPersonalFilters } from "./personal-filters";

const mine = { search: "", connector: "AND", rules: [{ field: "assignee", operator: "is", value: "me" }], hideDone: false };
const prefs = { home: { work: { viewOverrides: { v1: { filters: mine } } } } };

beforeEach(() => forgetPersonalFilters());

describe("personal filters", () => {
  it("reads a person's own filter for a view", () => {
    expect(personalFiltersRaw(prefs, "v1")).toEqual(mine);
  });

  it("no override, or a cleared one, means the view's own filter", () => {
    expect(personalFiltersRaw(prefs, "v2")).toBeNull();
    expect(personalFiltersRaw({ home: { work: { viewOverrides: { v1: { filters: null } } } } }, "v1")).toBeNull();
    expect(personalFiltersRaw(null, "v1")).toBeNull();
    expect(personalFiltersRaw({ home: "junk" }, "v1")).toBeNull();
  });

  it("what this tab saved wins over the page's first read, a clear included", () => {
    rememberPersonalFilters("v1", null);
    expect(personalFiltersRaw(prefs, "v1")).toBeNull();
    const other = { ...mine, hideDone: true };
    rememberPersonalFilters("v1", other);
    expect(personalFiltersRaw(prefs, "v1")).toEqual(other);
  });

  it("saves under the view, and null clears it", () => {
    expect(personalFiltersPatch("v1", mine)).toEqual({ home: { work: { viewOverrides: { v1: { filters: mine } } } } });
    expect(personalFiltersPatch("v1", null)).toEqual({ home: { work: { viewOverrides: { v1: { filters: null } } } } });
  });
});
