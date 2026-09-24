import { describe, expect, it } from "vitest";
import { EmbedSnapshotCache } from "./sheet-embed-cache";

describe("EmbedSnapshotCache (one evaluation per table version, not per request)", () => {
  it("builds once for repeated requests with the same data signature", async () => {
    const cache = new EmbedSnapshotCache<number>();
    let builds = 0;
    const build = async () => { builds += 1; return 42; };
    await Promise.all([cache.get("t", "s1", build), cache.get("t", "s1", build), cache.get("t", "s1", build)]);
    expect(builds).toBe(1);
  });
  it("rebuilds when the data changes", async () => {
    const cache = new EmbedSnapshotCache<string>();
    expect(await cache.get("t", "s1", async () => "old")).toBe("old");
    expect(await cache.get("t", "s2", async () => "new")).toBe("new");
  });
  it("rebuilds after the TTL", async () => {
    let t = 0;
    const cache = new EmbedSnapshotCache<number>({ ttlMs: 1000, now: () => t });
    let builds = 0;
    const build = async () => ++builds;
    await cache.get("t", "s", build);
    t = 999; await cache.get("t", "s", build);
    t = 1001; await cache.get("t", "s", build);
    expect(builds).toBe(2);
  });
  it("evicts the least recently used past its bound", async () => {
    const cache = new EmbedSnapshotCache<number>({ maxEntries: 2 });
    await cache.get("a", "s", async () => 1);
    await cache.get("b", "s", async () => 2);
    await cache.get("a", "s", async () => 1);
    await cache.get("c", "s", async () => 3);
    expect(cache.size).toBe(2);
    let rebuiltB = false;
    await cache.get("b", "s", async () => { rebuiltB = true; return 2; });
    expect(rebuiltB).toBe(true);
  });
  it("does not keep a failed build", async () => {
    const cache = new EmbedSnapshotCache<number>();
    await expect(cache.get("t", "s", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await new Promise((r) => setTimeout(r, 0));
    expect(await cache.get("t", "s", async () => 7)).toBe(7);
  });
});
