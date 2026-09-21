import { describe, expect, it } from "vitest";
import { matchesFilters, matchesView, parseDocsListQuery, slicePage, sortDocs, type DocsCandidate } from "./docs-list";

const me = "u1";
const NOW = new Date("2026-09-21T12:00:00Z");
const facts = {
  userId: me,
  favoriteIds: new Set(["d2"]),
  viewedAt: new Map([["d1", "2026-09-20T10:00:00Z"], ["d3", "2026-06-01T10:00:00Z"]]),
  now: NOW,
};

const rows: DocsCandidate[] = [
  { id: "d1", title: "Alpha", parentId: null, entityType: null, entityId: null, createdById: me, updatedAt: "2026-09-20T10:00:00Z", locationName: "", ownerName: "Me" },
  { id: "d2", title: "beta", parentId: null, entityType: "SPACE", entityId: "s1", createdById: "u2", updatedAt: "2026-09-19T10:00:00Z", locationName: "Engineering", ownerName: "Zed" },
  { id: "d3", title: "Gamma", parentId: "d1", entityType: null, entityId: null, createdById: "u3", updatedAt: "2026-09-21T10:00:00Z", locationName: "", ownerName: "Ann", sharedWithMe: true },
];

describe("parseDocsListQuery", () => {
  it("defaults, and knows when the caller wants the paged envelope", () => {
    const q = parseDocsListQuery(new URLSearchParams(""));
    expect(q.view).toBe("all");
    expect(q.sort).toBe("updated");
    expect(q.dir).toBe("desc");
    expect(q.limit).toBe(40);
    expect(q.paged).toBe(false);
    expect(parseDocsListQuery(new URLSearchParams("view=my")).paged).toBe(true);
    expect(parseDocsListQuery(new URLSearchParams("limit=500")).limit).toBe(100);
    expect(parseDocsListQuery(new URLSearchParams("view=bogus&sort=bogus")).view).toBe("all");
  });
  it("Recent sorts by Date viewed until the person sorts", () => {
    expect(parseDocsListQuery(new URLSearchParams("view=recent")).sort).toBe("viewed");
    expect(parseDocsListQuery(new URLSearchParams("view=recent&sort=name")).sort).toBe("name");
  });
  it("text sorts default ascending, date sorts descending", () => {
    expect(parseDocsListQuery(new URLSearchParams("sort=name")).dir).toBe("asc");
    expect(parseDocsListQuery(new URLSearchParams("sort=updated")).dir).toBe("desc");
    expect(parseDocsListQuery(new URLSearchParams("sort=name&dir=desc")).dir).toBe("desc");
  });
});

describe("matchesView", () => {
  it("all", () => expect(rows.filter((r) => matchesView(r, "all", facts)).map((r) => r.id)).toEqual(["d1", "d2", "d3"]));
  it("recent = opened in the last 30 days", () => {
    expect(rows.filter((r) => matchesView(r, "recent", facts)).map((r) => r.id)).toEqual(["d1"]);
  });
  it("my = created by the viewer", () => {
    expect(rows.filter((r) => matchesView(r, "my", facts)).map((r) => r.id)).toEqual(["d1"]);
  });
  it("shared = a share row or an anchored doc the viewer does not own, never their own", () => {
    expect(rows.filter((r) => matchesView(r, "shared", facts)).map((r) => r.id)).toEqual(["d2", "d3"]);
  });
  it("favorites = starred", () => {
    expect(rows.filter((r) => matchesView(r, "favorites", facts)).map((r) => r.id)).toEqual(["d2"]);
  });
});

describe("matchesFilters", () => {
  it("hides sub-docs unless Include sub-docs is on", () => {
    const q = parseDocsListQuery(new URLSearchParams(""));
    expect(rows.filter((r) => matchesFilters(r, q)).map((r) => r.id)).toEqual(["d1", "d2"]);
    const q2 = parseDocsListQuery(new URLSearchParams("includeChildren=1"));
    expect(rows.filter((r) => matchesFilters(r, q2)).map((r) => r.id)).toEqual(["d1", "d2", "d3"]);
  });
  it("searches the title, filters by owner, location and updated range", () => {
    expect(rows.filter((r) => matchesFilters(r, parseDocsListQuery(new URLSearchParams("q=ALPHA")))).map((r) => r.id)).toEqual(["d1"]);
    expect(rows.filter((r) => matchesFilters(r, parseDocsListQuery(new URLSearchParams("owner=u2")))).map((r) => r.id)).toEqual(["d2"]);
    expect(rows.filter((r) => matchesFilters(r, parseDocsListQuery(new URLSearchParams("location=SPACE:s1")))).map((r) => r.id)).toEqual(["d2"]);
    expect(rows.filter((r) => matchesFilters(r, parseDocsListQuery(new URLSearchParams("location=none")))).map((r) => r.id)).toEqual(["d1"]);
    expect(rows.filter((r) => matchesFilters(r, parseDocsListQuery(new URLSearchParams("updatedFrom=2026-09-20T00:00:00Z&includeChildren=1")))).map((r) => r.id)).toEqual(["d1", "d3"]);
    expect(rows.filter((r) => matchesFilters(r, parseDocsListQuery(new URLSearchParams("updatedTo=2026-09-19T23:59:59Z")))).map((r) => r.id)).toEqual(["d2"]);
  });
});

describe("sortDocs", () => {
  it("sorts by every column with a stable id tie-break", () => {
    expect(sortDocs(rows, "updated", "desc", facts).map((r) => r.id)).toEqual(["d3", "d1", "d2"]);
    expect(sortDocs(rows, "name", "asc", facts).map((r) => r.id)).toEqual(["d1", "d2", "d3"]);
    expect(sortDocs(rows, "location", "asc", facts).map((r) => r.id)).toEqual(["d1", "d3", "d2"]);
    expect(sortDocs(rows, "owner", "asc", facts).map((r) => r.id)).toEqual(["d3", "d1", "d2"]);
    expect(sortDocs(rows, "viewed", "desc", facts).map((r) => r.id)).toEqual(["d1", "d3", "d2"]);
  });
});

describe("slicePage", () => {
  it("pages by the previous page's last id and reports the next cursor", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const p1 = slicePage(list, null, 2);
    expect(p1.page.map((r) => r.id)).toEqual(["a", "b"]);
    expect(p1.nextCursor).toBe("b");
    const p2 = slicePage(list, "b", 2);
    expect(p2.page.map((r) => r.id)).toEqual(["c", "d"]);
    expect(p2.from).toBe(2);
    const p3 = slicePage(list, "d", 2);
    expect(p3.page.map((r) => r.id)).toEqual(["e"]);
    expect(p3.nextCursor).toBeNull();
    expect(slicePage(list, "zzz", 2).from).toBe(0);
  });
});
