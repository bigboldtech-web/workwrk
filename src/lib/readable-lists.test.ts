import { describe, expect, it } from "vitest";
import { groupReadableLists, readableListsUrl, type ReadableListRow, type ReadableListsResponse } from "./readable-lists";

const row = (id: string, over: Partial<ReadableListRow> = {}): ReadableListRow => ({
  id,
  slug: id,
  name: id.toUpperCase(),
  icon: null,
  color: null,
  spaceId: null,
  folderId: null,
  productSlug: null,
  ...over,
});

describe("readableListsUrl", () => {
  it("always asks the readable branch and nothing else by default", () => {
    expect(readableListsUrl({})).toBe("/api/boards?readable=1");
  });
  it("encodes the search, names held ids once, and carries the flags", () => {
    const url = readableListsUrl({ q: "  Q3 plan & more ", ids: ["a", "b", "a", " ", "c d"], spaceId: "S1", targets: true, writable: true, limit: 500 });
    expect(url).toBe("/api/boards?readable=1&q=Q3%20plan%20%26%20more&ids=a,b,c%20d&spaceId=S1&targets=1&writable=1&limit=100");
    const parsed = new URL(url, "http://x");
    expect(parsed.searchParams.get("q")).toBe("Q3 plan & more");
    expect(parsed.searchParams.get("ids")?.split(",")).toEqual(["a", "b", "c d"]);
  });
  it("caps the search at 80 characters and the ids at 50", () => {
    const long = "x".repeat(200);
    expect(new URL(readableListsUrl({ q: long }), "http://x").searchParams.get("q")).toHaveLength(80);
    const ids = Array.from({ length: 70 }, (_, i) => `id${i}`);
    expect(new URL(readableListsUrl({ ids }), "http://x").searchParams.get("ids")?.split(",")).toHaveLength(50);
    expect(readableListsUrl({ limit: 0 })).toBe("/api/boards?readable=1&limit=1");
    expect(readableListsUrl({ spaceId: null, ids: [] })).toBe("/api/boards?readable=1");
  });
});

describe("groupReadableLists", () => {
  const res: ReadableListsResponse = {
    boards: [
      row("shared1", { spaceId: "S-unread" }),
      row("b2", { spaceId: "S2" }),
      row("personal", { productSlug: "personal-list" }),
      row("b1", { spaceId: "S1" }),
      row("loose"),
      row("b1", { spaceId: "S1" }),
      row("b3", { spaceId: "S1" }),
    ],
    spaces: [
      { id: "S1", name: "Design", icon: null, color: null },
      { id: "S2", name: "Ops", icon: null, color: null },
      { id: "S-empty", name: "Empty", icon: null, color: null },
    ],
    truncated: false,
  };
  it("puts the Personal List first, then Spaces in the server's order, then Shared with you", () => {
    const groups = groupReadableLists(res);
    expect(groups.map((g) => [g.label, g.lists.map((l) => l.id)])).toEqual([
      ["My work", ["personal"]],
      ["Design", ["b1", "b3"]],
      ["Ops", ["b2"]],
      ["Shared with you", ["shared1", "loose"]],
    ]);
  });
  it("never draws a header over nothing", () => {
    const groups = groupReadableLists({ boards: [row("b2", { spaceId: "S2" })], spaces: res.spaces, truncated: false });
    expect(groups.map((g) => g.key)).toEqual(["space:S2"]);
    expect(groupReadableLists({ boards: [], spaces: res.spaces, truncated: true })).toEqual([]);
  });
});
