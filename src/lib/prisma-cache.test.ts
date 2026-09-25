import { describe, expect, it } from "vitest";

import { reuseCachedClient } from "./prisma-cache";

class LayerA { constructor(public n: number) {} }
class LayerB { constructor(public n: number) {} }

describe("reuseCachedClient", () => {
  it("builds when nothing is cached for this class", () => {
    const cache = new WeakMap<object, { n: number }>();
    let built = 0;
    const c = reuseCachedClient(cache, LayerA, () => new LayerA(++built), () => true, () => {});
    expect(c).toBeInstanceOf(LayerA);
    expect(built).toBe(1);
  });

  it("reuses the client cached for the SAME class and drops the fresh build", () => {
    const cache = new WeakMap<object, { n: number }>();
    const warm = new LayerA(0);
    cache.set(LayerA, warm);
    const dropped: unknown[] = [];
    const c = reuseCachedClient(cache, LayerA, () => new LayerA(1), () => true, (u) => dropped.push(u));
    expect(c).toBe(warm);
    expect(dropped).toHaveLength(1);
  });

  it("never hands one layer's client to another layer's copy of the class", () => {
    const cache = new WeakMap<object, { n: number }>();
    const pageClient = new LayerA(0);
    cache.set(LayerA, pageClient);
    // The route layer's copy is a different class: it must build its own.
    const c = reuseCachedClient(cache, LayerB, () => new LayerB(1), () => true, () => {});
    expect(c).not.toBe(pageClient);
    expect(c).toBeInstanceOf(LayerB);
  });

  it("builds fresh when the cached client has an older shape", () => {
    const cache = new WeakMap<object, { n: number }>();
    cache.set(LayerA, new LayerA(0));
    const c = reuseCachedClient(cache, LayerA, () => new LayerA(1), (a, b) => a.n === b.n, () => {});
    expect(c.n).toBe(1);
  });
});
