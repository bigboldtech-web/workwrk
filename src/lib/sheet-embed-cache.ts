// A small server-side memo for the public table embed's evaluated snapshot.
//
// GET /api/public/tables/[id] answers without authentication, and evaluating a
// table runs the whole engine over every row (a formula on page one may read
// any row). Without a memo, every page request and every query-string variant
// re-evaluated the whole table, a cheap way to burn CPU and memory on the one
// production box. The HTTP Cache-Control header only helps when a browser or a
// CDN honours it; this does not depend on either.
//
// Keyed by table id and a signature of the data (the table's updatedAt, the
// newest row's updatedAt and the row count), so any edit, delete or column
// change is a miss and the embed never serves stale data past the TTL. Two
// requests for the same table while it is being evaluated share one build.
// Bounded by entry count and by a TTL. Per process, like the rate limiter.
//
// Pure: no imports.

export interface EmbedCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

interface Entry<T> {
  sig: string;
  at: number;
  value: Promise<T>;
}

export class EmbedSnapshotCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: EmbedCacheOptions = {}) {
    this.maxEntries = Math.max(1, opts.maxEntries ?? 8);
    this.ttlMs = Math.max(0, opts.ttlMs ?? 60_000);
    this.now = opts.now ?? Date.now;
  }

  /** The value for (key, sig), building it once when missing or stale. A
   *  build that throws is not kept, so the next request tries again. */
  get(key: string, sig: string, build: () => Promise<T>): Promise<T> {
    const t = this.now();
    const hit = this.entries.get(key);
    if (hit && hit.sig === sig && t - hit.at <= this.ttlMs) {
      // Refresh recency for the LRU order.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }
    const value = build();
    const entry: Entry<T> = { sig, at: t, value };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  get size(): number {
    return this.entries.size;
  }
}
