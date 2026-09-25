import { describe, expect, it } from "vitest";

import { parseRecentDocViews } from "./recent-doc-views";

describe("parseRecentDocViews", () => {
  it("reads the { id, at } shape POST /api/me/recent-docs writes", () => {
    const r = parseRecentDocViews([
      { id: "d2", at: "2026-09-24T10:00:00.000Z" },
      { id: "d1", at: "2026-09-23T10:00:00.000Z" },
    ]);
    expect(r.ids).toEqual(["d2", "d1"]);
    expect(r.viewedAt.get("d2")).toBe("2026-09-24T10:00:00.000Z");
    expect(r.viewedAt.get("d1")).toBe("2026-09-23T10:00:00.000Z");
  });

  it("still reads the older { docId, at } and bare-id shapes", () => {
    const r = parseRecentDocViews(["d0", { docId: "d1", at: "t1" }, { id: "d2" }]);
    expect(r.ids).toEqual(["d0", "d1", "d2"]);
    expect(r.viewedAt.get("d1")).toBe("t1");
    expect(r.viewedAt.has("d0")).toBe(false);
    expect(r.viewedAt.has("d2")).toBe(false);
  });

  it("keeps the first (newest) view of a doc and skips junk", () => {
    const r = parseRecentDocViews([{ id: "d1", at: "new" }, null, 7, { id: 3 }, {}, { id: "d1", at: "old" }]);
    expect(r.ids).toEqual(["d1"]);
    expect(r.viewedAt.get("d1")).toBe("new");
  });

  it("reads nothing from a missing or malformed preference", () => {
    expect(parseRecentDocViews(undefined).ids).toEqual([]);
    expect(parseRecentDocViews({ id: "d1" }).ids).toEqual([]);
  });
});
