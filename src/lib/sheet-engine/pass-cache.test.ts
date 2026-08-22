import { describe, expect, it } from "vitest";
import { PassCache, type CacheRect } from "./pass-cache";
import type { RangeValue } from "./evaluate";

function rect(top: number, left: number, bottom: number, right: number): CacheRect {
  return { top, left, bottom, right };
}

function range(...values: number[]): RangeValue {
  return { kind: "range", rows: values.map((v) => [v]) };
}

describe("range entries", () => {
  it("round-trips a write and misses on a different key", () => {
    const cache = new PassCache();
    const value = range(1, 2, 3);
    cache.writeRange("R:0,0,2,0", rect(0, 0, 2, 0), value);
    expect(cache.readRange("R:0,0,2,0")).toBe(value);
    expect(cache.readRange("R:0,1,2,1")).toBeUndefined();
  });

  it("a write inside the rectangle evicts the entry, one outside keeps it", () => {
    const cache = new PassCache();
    cache.writeRange("a", rect(0, 0, 9, 0), range(1));
    cache.writeRange("b", rect(0, 3, 9, 3), range(2));
    cache.invalidate(5, 0);
    expect(cache.readRange("a")).toBeUndefined();
    expect(cache.readRange("b")).toBeDefined();
    // Row inside, column outside: still a keep.
    cache.invalidate(5, 1);
    expect(cache.readRange("b")).toBeDefined();
  });
});

describe("call entries", () => {
  it("a cached null result is a hit, not a miss", () => {
    const cache = new PassCache();
    cache.writeCall("K", [], null);
    expect(cache.readCall("K")).toEqual({ value: null });
    expect(cache.readCall("other")).toBeUndefined();
  });

  it("any covering rectangle of a multi-range call evicts it", () => {
    const cache = new PassCache();
    cache.writeCall("K", [rect(0, 0, 9, 0), rect(0, 2, 9, 2)], 42);
    cache.invalidate(4, 2);
    expect(cache.readCall("K")).toBeUndefined();
  });

  it("a call with no rectangles survives every invalidation", () => {
    // Value-keyed arguments re-key themselves when inputs change, so an
    // entry with no rectangle contents has nothing that can go stale.
    const cache = new PassCache();
    cache.writeCall("K", [], 7);
    cache.invalidate(0, 0);
    expect(cache.readCall("K")).toEqual({ value: 7 });
  });
});

describe("caps", () => {
  it("drops NEW keys when full instead of evicting old ones", () => {
    const cache = new PassCache({ maxRanges: 2, maxCalls: 2 });
    cache.writeRange("a", rect(0, 0, 0, 0), range(1));
    cache.writeRange("b", rect(0, 1, 0, 1), range(2));
    cache.writeRange("c", rect(0, 2, 0, 2), range(3));
    expect(cache.size().ranges).toBe(2);
    expect(cache.readRange("c")).toBeUndefined();
    expect(cache.readRange("a")).toBeDefined();

    cache.writeCall("x", [], 1);
    cache.writeCall("y", [], 2);
    cache.writeCall("z", [], 3);
    expect(cache.size().calls).toBe(2);
    expect(cache.readCall("z")).toBeUndefined();
  });

  it("still overwrites an EXISTING key when full (re-cache after invalidation)", () => {
    const cache = new PassCache({ maxRanges: 1, maxCalls: 1 });
    cache.writeRange("a", rect(0, 0, 0, 0), range(1));
    const fresh = range(9);
    cache.writeRange("a", rect(0, 0, 0, 0), fresh);
    expect(cache.readRange("a")).toBe(fresh);

    cache.writeCall("x", [], 1);
    cache.writeCall("x", [], 2);
    expect(cache.readCall("x")).toEqual({ value: 2 });
  });

  it("an invalidation frees capacity for a different key", () => {
    const cache = new PassCache({ maxRanges: 1 });
    cache.writeRange("a", rect(0, 0, 5, 0), range(1));
    cache.invalidate(3, 0);
    cache.writeRange("b", rect(0, 1, 5, 1), range(2));
    expect(cache.readRange("b")).toBeDefined();
  });
});
