import { describe, it, expect } from "vitest";
import { TRASH_HREF, TRASH_LABEL, trashHref, type TrashType } from "./trash";

const ALL: TrashType[] = [
  "note", "sop", "whiteboard", "table", "file", "policy", "contract",
  "space", "folder", "board", "item",
];

describe("trashHref: where a restored row lives", () => {
  it("sends each object kind to its own page, with the row's id in it", () => {
    expect(trashHref("note", "d1")).toBe("/docs/d1");
    expect(trashHref("whiteboard", "w1")).toBe("/canvas/w1");
    expect(trashHref("table", "t1")).toBe("/tables/t1");
    expect(trashHref("sop", "s1")).toBe("/sops/s1");
    expect(trashHref("policy", "p1")).toBe("/policies/p1");
    expect(trashHref("contract", "c1")).toBe("/agreements/c1");
  });

  it("opens a file in the /files preview drawer, because a file has no page", () => {
    expect(trashHref("file", "f1")).toBe("/files?file=f1");
  });

  it("no longer points ANYTHING at /library, which is retired in Phase 3", () => {
    for (const t of ALL) expect(TRASH_HREF[t]).not.toContain("/library");
    for (const t of ALL) expect(trashHref(t, "x")).not.toContain("/library");
  });

  it("encodes an id so a stray character cannot break the URL", () => {
    expect(trashHref("note", "a b/c")).toBe("/docs/a%20b%2Fc");
  });

  it("degrades to the list page when there is no id, never to a literal [id]", () => {
    expect(trashHref("note", null)).toBe("/docs");
    expect(trashHref("sop", undefined)).toBe("/sops");
    expect(trashHref("file", "")).toBe("/files");
    for (const t of ALL) expect(trashHref(t, null)).not.toContain("[id]");
  });

  it("leaves the hierarchy kinds informational: they are reached by slug, not id", () => {
    for (const t of ["space", "folder", "board", "item"] as TrashType[]) {
      expect(trashHref(t, "x")).toBe("/");
    }
  });

  it("has one href and one label for every type, so neither table can drift", () => {
    for (const t of ALL) {
      expect(typeof TRASH_HREF[t]).toBe("string");
      expect(typeof TRASH_LABEL[t]).toBe("string");
    }
    expect(Object.keys(TRASH_HREF).sort()).toEqual(Object.keys(TRASH_LABEL).sort());
  });
});
