import { describe, expect, it } from "vitest";
import { INTERNAL_METADATA_KEYS, changedMetadataKeys, sameIdList, sameTime } from "./item-diff";

describe("sameIdList", () => {
  it("ignores order, because order carries the DRI and not identity", () => {
    expect(sameIdList(["a", "b"], ["b", "a"])).toBe(true);
  });
  it("sees an addition and a removal", () => {
    expect(sameIdList(["a"], ["a", "b"])).toBe(false);
    expect(sameIdList(["a", "b"], ["a"])).toBe(false);
  });
  it("treats null and empty as the same nothing", () => {
    expect(sameIdList(null, [])).toBe(true);
    expect(sameIdList(undefined, undefined)).toBe(true);
  });
});

describe("sameTime", () => {
  it("matches a Date against its own ISO string", () => {
    const d = new Date("2026-09-18T10:00:00.000Z");
    expect(sameTime(d, d.toISOString())).toBe(true);
  });
  it("sees a real move", () => {
    expect(sameTime("2026-09-18T10:00:00.000Z", "2026-09-19T10:00:00.000Z")).toBe(false);
  });
  it("null only equals null", () => {
    expect(sameTime(null, null)).toBe(true);
    expect(sameTime(null, new Date())).toBe(false);
    expect(sameTime(undefined, null)).toBe(true);
  });
  it("two unparseable values are equal rather than an endless diff", () => {
    expect(sameTime("nope", "nah")).toBe(true);
  });
});

describe("changedMetadataKeys", () => {
  it("names only the keys that moved", () => {
    expect(changedMetadataKeys({ description: "a", timeEstimate: 30 }, { description: "b", timeEstimate: 30 }))
      .toEqual(["description"]);
  });

  it("sees an added and a removed key", () => {
    expect(changedMetadataKeys({ a: 1 }, { b: 2 })).toEqual(["a", "b"]);
  });

  it("returns nothing when a blob is re-saved unchanged, so no row is written", () => {
    const md = { description: "a", checklist: [{ text: "x", done: false }] };
    expect(changedMetadataKeys(md, { ...md, checklist: [{ text: "x", done: false }] })).toEqual([]);
  });

  it("compares nested values structurally", () => {
    expect(changedMetadataKeys({ checklist: [{ text: "x", done: false }] }, { checklist: [{ text: "x", done: true }] }))
      .toEqual(["checklist"]);
  });

  it("never reports the recurrence bookkeeping keys", () => {
    const before = { description: "a" };
    const after = { description: "a", lastSpawnedKey: "2026-09-18", skippedOccurrences: 2 };
    expect(changedMetadataKeys(before, after)).toEqual([]);
    for (const key of INTERNAL_METADATA_KEYS) {
      expect(changedMetadataKeys({}, { [key]: "x" })).toEqual([]);
    }
  });

  it("tolerates an absent or malformed blob on either side", () => {
    expect(changedMetadataKeys(null, undefined)).toEqual([]);
    expect(changedMetadataKeys("nope", { a: 1 })).toEqual(["a"]);
    expect(changedMetadataKeys([1, 2], null)).toEqual([]);
  });

  it("is sorted, so an activity row is stable", () => {
    expect(changedMetadataKeys({}, { z: 1, a: 2, m: 3 })).toEqual(["a", "m", "z"]);
  });
});
