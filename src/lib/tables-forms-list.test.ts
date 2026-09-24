import { describe, expect, it } from "vitest";
import {
  copyName, countListViews, formGoesTo, formStatus, matchesListFilters, matchesListView,
  parseFormsListQuery, parseTablesListQuery, slicePage, sortListRows, type ListCandidate,
} from "./tables-forms-list";

const row = (over: Partial<ListCandidate> = {}): ListCandidate => ({
  id: "t1", name: "Budget", createdById: "me", updatedAt: "2026-09-20T10:00:00Z", spaceId: null, isPublic: false, ...over,
});
const facts = { userId: "me", favoriteIds: new Set(["t2"]) };

describe("parseTablesListQuery", () => {
  it("defaults to the bare shape when no list param is given", () => {
    const q = parseTablesListQuery(new URLSearchParams(""));
    expect(q.paged).toBe(false);
    expect(q.view).toBe("all");
    expect(q.sort).toBe("updated");
    expect(q.dir).toBe("desc");
  });
  it("reads the page's params and caps the limit", () => {
    const q = parseTablesListQuery(new URLSearchParams("view=mine&q=Bud&sort=name&limit=999&hasForm=1&location=none"));
    expect(q).toMatchObject({ paged: true, view: "mine", q: "bud", sort: "name", dir: "asc", limit: 100, hasForm: true, location: "none" });
  });
  it("ignores an unknown view or sort", () => {
    const q = parseTablesListQuery(new URLSearchParams("view=kanban&sort=colour"));
    expect(q.view).toBe("all");
    expect(q.sort).toBe("updated");
  });
  it("forms read status, goesTo and the public filter", () => {
    const q = parseFormsListQuery(new URLSearchParams("status=needs-destination&goesTo=list:b1&public=on&sort=responses"));
    expect(q).toMatchObject({ status: "needs-destination", goesTo: "list:b1", publicLink: "on", sort: "responses", dir: "desc" });
    expect(parseFormsListQuery(new URLSearchParams("status=bogus&public=maybe")).status).toBeNull();
  });
});

describe("views", () => {
  it("mine is what the viewer made", () => {
    expect(matchesListView(row(), "mine", facts)).toBe(true);
    expect(matchesListView(row({ createdById: "you" }), "mine", facts)).toBe(false);
  });
  it("shared is someone else's object reached through a Space, never the org-wide Everyone row", () => {
    expect(matchesListView(row({ createdById: "you", spaceId: "s1" }), "shared", facts)).toBe(true);
    expect(matchesListView(row({ createdById: "you", spaceId: null }), "shared", facts)).toBe(false);
    expect(matchesListView(row({ createdById: "me", spaceId: "s1" }), "shared", facts)).toBe(false);
  });
  it("favorites reads the starred ids", () => {
    expect(matchesListView(row({ id: "t2" }), "favorites", facts)).toBe(true);
    expect(matchesListView(row(), "favorites", facts)).toBe(false);
  });
  it("counts every view from one set", () => {
    const rows = [row({ id: "a" }), row({ id: "t2", createdById: "you", spaceId: "s" }), row({ id: "c", createdById: "you" })];
    expect(countListViews(rows, facts)).toEqual({ all: 3, mine: 1, shared: 1, favorites: 1 });
  });
});

describe("filters", () => {
  const base = parseTablesListQuery(new URLSearchParams("view=all"));
  it("search matches the name, case-insensitively", () => {
    expect(matchesListFilters(row(), { ...base, q: "budg" })).toBe(true);
    expect(matchesListFilters(row(), { ...base, q: "zzz" })).toBe(false);
  });
  it("location none is a table outside any Space", () => {
    expect(matchesListFilters(row(), { ...base, location: "none" })).toBe(true);
    expect(matchesListFilters(row({ spaceId: "s1" }), { ...base, location: "none" })).toBe(false);
    expect(matchesListFilters(row({ spaceId: "s1" }), { ...base, location: "s1" })).toBe(true);
  });
  it("the updated range is inclusive of whole days", () => {
    expect(matchesListFilters(row(), { ...base, updatedFrom: "2026-09-20", updatedTo: "2026-09-20" })).toBe(true);
    expect(matchesListFilters(row(), { ...base, updatedFrom: "2026-09-21" })).toBe(false);
  });
  it("has a form, goes to, status and public link", () => {
    expect(matchesListFilters(row({ hasForm: false }), { ...base, hasForm: true })).toBe(false);
    const fq = parseFormsListQuery(new URLSearchParams("view=all"));
    expect(matchesListFilters(row({ goesTo: null }), { ...fq, goesTo: "none" })).toBe(true);
    expect(matchesListFilters(row({ goesTo: "list:b" }), { ...fq, goesTo: "list:b" })).toBe(true);
    expect(matchesListFilters(row({ status: "open" }), { ...fq, status: "closed" })).toBe(false);
    expect(matchesListFilters(row({ isPublic: true }), { ...fq, publicLink: "off" })).toBe(false);
  });
});

describe("sort and pages", () => {
  const rows = [row({ id: "a", name: "b", count: 3 }), row({ id: "b", name: "A", count: 9 }), row({ id: "c", name: "c", count: 1 })];
  it("sorts by name without case and by count", () => {
    expect(sortListRows(rows, "name", "asc").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortListRows(rows, "rows", "desc").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
  it("pages by cursor", () => {
    const { page, nextCursor } = slicePage(rows, null, 2);
    expect(page.map((r) => r.id)).toEqual(["a", "b"]);
    expect(nextCursor).toBe("b");
    expect(slicePage(rows, "b", 2).page.map((r) => r.id)).toEqual(["c"]);
  });
});

describe("form status and destination", () => {
  it("needs a destination until it sends answers somewhere", () => {
    expect(formStatus({ targetBoardId: null, targetTableId: null })).toBe("needs-destination");
    expect(formStatus({ targetBoardId: "b", targetTableId: null })).toBe("open");
  });
  it("reads the additive settings bucket when present, tolerating its absence", () => {
    expect(formStatus({ targetBoardId: "b", targetTableId: null, settings: { acceptingResponses: false } })).toBe("closed");
    const past = new Date("2026-01-01T00:00:00Z").toISOString();
    expect(formStatus({ targetBoardId: "b", targetTableId: null, settings: { closesAt: past } }, new Date("2026-09-01"))).toBe("closed");
    expect(formStatus({ targetBoardId: "b", targetTableId: null, settings: undefined })).toBe("open");
  });
  it("the List wins when both targets are set", () => {
    expect(formGoesTo({ targetBoardId: "b", targetTableId: "t" })).toBe("list:b");
    expect(formGoesTo({ targetBoardId: null, targetTableId: "t" })).toBe("table:t");
    expect(formGoesTo({ targetBoardId: null, targetTableId: null })).toBeNull();
  });
  it("names a copy and caps it", () => {
    expect(copyName("Budget", "Untitled table")).toBe("Copy of Budget");
    expect(copyName("  ", "Untitled form")).toBe("Copy of Untitled form");
    expect(copyName("x".repeat(300), "t").length).toBe(200);
  });
});
