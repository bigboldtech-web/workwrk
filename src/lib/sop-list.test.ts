import { describe, expect, it } from "vitest";
import { activeSopsFilterCount, parseSopsQuery, sopsOrderBy, sopsSearchWhere, viewStatusWhere } from "./sop-list";

describe("parseSopsQuery", () => {
  it("defaults every parameter", () => {
    const q = parseSopsQuery(new URLSearchParams(""));
    expect(q).toMatchObject({ view: "all", q: "", kind: null, sort: "updated", dir: "desc", page: 1, pageSize: 40, assignedToMe: false, tags: [] });
  });
  it("reads a full URL and rejects unknown words silently", () => {
    const q = parseSopsQuery(new URLSearchParams("view=drafts&kind=checklist&q=+onboard+&sort=name&page=3&pageSize=100&tags=hr,ops&assignedToMe=1&status=BOGUS"));
    expect(q).toMatchObject({ view: "drafts", kind: "checklist", q: "onboard", sort: "name", dir: "asc", page: 3, pageSize: 100, tags: ["hr", "ops"], assignedToMe: true, status: null });
    expect(parseSopsQuery(new URLSearchParams("view=nope&sort=nope&pageSize=7&page=-2")).view).toBe("all");
    expect(parseSopsQuery(new URLSearchParams("view=nope&sort=nope&pageSize=7&page=-2")).pageSize).toBe(40);
    expect(parseSopsQuery(new URLSearchParams("page=-2")).page).toBe(1);
  });
  it("counts active filters with the search term as one", () => {
    expect(activeSopsFilterCount(parseSopsQuery(new URLSearchParams("")))).toBe(0);
    expect(activeSopsFilterCount(parseSopsQuery(new URLSearchParams("q=x&kind=steps&updatedFrom=2026-01-01")))).toBe(3);
  });
});

describe("viewStatusWhere", () => {
  it("maps the five views", () => {
    expect(viewStatusWhere("all")).toEqual({ status: { not: "ARCHIVED" } });
    expect(viewStatusWhere("published")).toEqual({ status: "PUBLISHED" });
    expect(viewStatusWhere("drafts")).toEqual({ status: "DRAFT" });
    expect(viewStatusWhere("review")).toEqual({ status: { in: ["IN_REVIEW", "APPROVED"] } });
    expect(viewStatusWhere("archived")).toEqual({ status: "ARCHIVED" });
  });
});

describe("sopsOrderBy and sopsSearchWhere", () => {
  it("orders by the chosen column with a stable tiebreak", () => {
    expect(sopsOrderBy("updated", "desc")).toEqual([{ updatedAt: "desc" }]);
    expect(sopsOrderBy("name", "asc")[0]).toEqual({ title: "asc" });
    expect(sopsOrderBy("owner", "desc")[0]).toEqual({ createdBy: { firstName: "desc" } });
  });
  it("searches title, description and exact tag names", () => {
    expect(sopsSearchWhere("  ")).toBeNull();
    const w = sopsSearchWhere("hr") as { OR: unknown[] };
    expect(w.OR).toHaveLength(3);
    expect(w.OR[2]).toEqual({ tags: { has: "hr" } });
  });
});
