// Per-recalc-pass cache for range reads and pure function calls. Pure: no
// React, no DOM, no I/O.
//
// WHY THIS EXISTS. A formula column like `=[Amount]/SUM([Amount])` puts a
// whole-column aggregate in every row: without caching, a full pass over n
// rows materialises and folds the same n-cell column n times — O(n²), the
// measured 11.8s at 10k rows that gates Phase 5. Within ONE pass the answer
// to "read column Amount" and to "SUM of column Amount" is the same for
// every asking cell, so both are cached here and the pass is O(n).
//
// LIFETIME IS ONE PASS, NEVER LONGER. The graph creates a fresh instance per
// recalc pass and drops it when the pass ends. A cache that survived a pass
// would serve values from before the edit that started the next one.
//
// INVALIDATION, NOT IMMUTABILITY. Values are not frozen during a pass: every
// time a formula cell settles, its new value becomes visible to later reads.
// Topological order means a reader of a range normally runs after every
// dirty formula cell inside it, but that guarantee lives in the dependency
// extractor, a different module; this one does not assume it. The owner
// calls `invalidate(row, col)` on every mid-pass write and any entry whose
// rectangle covers the cell is dropped, so a cached read stays
// indistinguishable from an uncached one even if extraction ever drifts.
//
// BOUNDED ON PURPOSE. Entry counts are capped and a full cache drops new
// keys rather than evicting old ones: the expensive shapes (whole-column
// reads, aggregate folds) are few and repeat, while per-row-distinct keys
// (a lookup keyed by the current row's value) would otherwise crowd the map
// and make `invalidate` itself the next O(n²). Overwriting an EXISTING key
// is always allowed, so a re-read after invalidation re-caches.

import type { RangeValue } from "./evaluate";
import type { CellValue } from "./types";

/** Clamped, finite rectangle a cached entry was read from. */
export interface CacheRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Reads at least this big are worth a cache slot; smaller ones cost more to
 *  key than to re-read. Also the floor for memoizing a call: a call with no
 *  range argument of this size folds too little to bother. */
export const RANGE_CACHE_MIN_CELLS = 64;

const MAX_RANGE_ENTRIES = 64;
const MAX_CALL_ENTRIES = 256;

interface RangeEntry {
  rect: CacheRect;
  value: RangeValue;
}

interface CallEntry {
  rects: readonly CacheRect[];
  value: CellValue;
}

function covers(rect: CacheRect, row: number, col: number): boolean {
  return (
    row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right
  );
}

export class PassCache {
  private readonly maxRanges: number;
  private readonly maxCalls: number;
  private readonly ranges = new Map<string, RangeEntry>();
  private readonly calls = new Map<string, CallEntry>();

  constructor(limits?: { maxRanges?: number; maxCalls?: number }) {
    this.maxRanges = limits?.maxRanges ?? MAX_RANGE_ENTRIES;
    this.maxCalls = limits?.maxCalls ?? MAX_CALL_ENTRIES;
  }

  readRange(key: string): RangeValue | undefined {
    return this.ranges.get(key)?.value;
  }

  writeRange(key: string, rect: CacheRect, value: RangeValue): void {
    if (this.ranges.size >= this.maxRanges && !this.ranges.has(key)) return;
    this.ranges.set(key, { rect, value });
  }

  /** Wrapped so a cached `null` (a legal cell value) is not a miss. */
  readCall(key: string): { value: CellValue } | undefined {
    const entry = this.calls.get(key);
    return entry ? { value: entry.value } : undefined;
  }

  writeCall(key: string, rects: readonly CacheRect[], value: CellValue): void {
    if (this.calls.size >= this.maxCalls && !this.calls.has(key)) return;
    this.calls.set(key, { rects, value });
  }

  /** Drop every entry whose rectangle covers the written cell. Value-keyed
   *  parts of a call key re-key themselves when their input changes; only
   *  rectangle-keyed contents can go stale, so rectangles are what is
   *  checked. */
  invalidate(row: number, col: number): void {
    for (const [key, entry] of this.ranges) {
      if (covers(entry.rect, row, col)) this.ranges.delete(key);
    }
    for (const [key, entry] of this.calls) {
      for (const rect of entry.rects) {
        if (covers(rect, row, col)) {
          this.calls.delete(key);
          break;
        }
      }
    }
  }

  /** Occupancy, so a test can prove the caps hold. */
  size(): { ranges: number; calls: number } {
    return { ranges: this.ranges.size, calls: this.calls.size };
  }
}
