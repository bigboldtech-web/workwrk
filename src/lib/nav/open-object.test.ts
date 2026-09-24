import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearOpenObject,
  favoriteKey,
  isRowRendered,
  pickPill,
  pillCandidateKeys,
  publishOpenObject,
  readOpenObject,
  registerRenderedRow,
  resetOpenObjectStore,
  rowPillState,
  subscribeOpenObject,
  treeKey,
  type PillCandidates,
  type PublishedObject,
} from "./open-object";

const pill: PillCandidates = {
  selfKey: treeKey("doc", "d1"),
  favKey: favoriteKey("doc", "d1"),
  ancestors: [treeKey("list", "l1"), treeKey("folder", "f2"), treeKey("folder", "f1"), treeKey("space", "s1")],
};

function publication(key: string, extra: Partial<PublishedObject> = {}): PublishedObject {
  return { kind: "doc", id: "d1", self: "/spaces/s/docs/d1", closeHref: "/folders/f2", pill, reveal: null, key, ...extra };
}

afterEach(() => resetOpenObjectStore());

describe("keys", () => {
  it("spells tree and favourite keys the way the rows do", () => {
    expect(treeKey("space", "s1")).toBe("space:s1");
    expect(favoriteKey("canvas", "c1")).toBe("fav:canvas:c1");
    expect(pillCandidateKeys(pill)).toEqual(["doc:d1", "fav:doc:d1", "list:l1", "folder:f2", "folder:f1", "space:s1"]);
    expect(pillCandidateKeys(null)).toEqual([]);
  });
});

describe("pickPill", () => {
  const set = (...keys: string[]) => (k: string) => keys.includes(k);

  it("prefers the object's own tree row", () => {
    expect(pickPill(pill, set("doc:d1", "fav:doc:d1", "space:s1"))).toBe("doc:d1");
  });

  it("falls back to the favourite when there is no tree row on screen", () => {
    expect(pickPill(pill, set("fav:doc:d1", "space:s1"))).toBe("fav:doc:d1");
  });

  it("falls back to the nearest rendered ancestor", () => {
    expect(pickPill(pill, set("folder:f1", "space:s1"))).toBe("folder:f1");
    expect(pickPill(pill, set("list:l1", "folder:f1"))).toBe("list:l1");
    expect(pickPill(pill, set("space:s1"))).toBe("space:s1");
  });

  it("lights nothing when nothing about the object is on screen", () => {
    expect(pickPill(pill, set("doc:other"))).toBeNull();
    expect(pickPill(null, set("doc:d1"))).toBeNull();
  });
});

describe("the store", () => {
  it("publishes, notifies and clears", () => {
    const cb = vi.fn();
    const off = subscribeOpenObject(cb);
    publishOpenObject(publication("a"));
    expect(readOpenObject()?.self).toBe("/spaces/s/docs/d1");
    expect(cb).toHaveBeenCalledTimes(1);
    clearOpenObject("a");
    expect(readOpenObject()).toBeNull();
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    publishOpenObject(publication("b"));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("never lets a stale unmount clear a newer publication", () => {
    publishOpenObject(publication("old"));
    publishOpenObject(publication("new", { id: "d2" }));
    clearOpenObject("old");
    expect(readOpenObject()?.key).toBe("new");
  });

  it("counts mounts of the same row", () => {
    const a = registerRenderedRow("doc:d1");
    const b = registerRenderedRow("doc:d1");
    a();
    expect(isRowRendered("doc:d1")).toBe(true);
    a(); // a second call of the same unregister is a no-op
    expect(isRowRendered("doc:d1")).toBe(true);
    b();
    expect(isRowRendered("doc:d1")).toBe(false);
  });

  it("answers one row's state from what is rendered", () => {
    publishOpenObject(publication("p"));
    expect(rowPillState("doc:elsewhere")).toBe("none");
    expect(rowPillState("space:s1")).toBe("candidate");
    const offSpace = registerRenderedRow("space:s1");
    expect(rowPillState("space:s1")).toBe("active");
    const offSelf = registerRenderedRow("doc:d1");
    expect(rowPillState("space:s1")).toBe("candidate");
    expect(rowPillState("doc:d1")).toBe("active");
    offSelf();
    expect(rowPillState("space:s1")).toBe("active");
    offSpace();
    clearOpenObject("p");
    expect(rowPillState("space:s1")).toBe("none");
  });
});
