/**
 * Tables: variable row heights — the pure geometry under the kernel's
 * virtualization (Sheets' drag-a-row-number-boundary resize).
 *
 * Pure module, no React, no DOM. The kernel (sheet-grid.tsx) builds ONE
 * RowGeometry per [rowIds, heights-version] and routes every vertical
 * computation through it: body box height, row offsets, the virtual
 * window, pointer→row/gap hit-testing, freeze-band height, overlay rects,
 * scroll-into-view.
 *
 * Complexity contract (the 50k-row perf world must not regress):
 * - No custom heights (the common case): NO prefix array is built. Every
 *   query is the same O(1) closed-form arithmetic the kernel used when
 *   heights were a compile-time constant — rowTop(r) = r * H,
 *   rowAtY(y) = floor(y / H), rowEndAtY(y) = ceil(y / H),
 *   gapAtY(y) = round(y / H) — so the fast path is not merely "fast", it
 *   is FORMULA-IDENTICAL to the pre-feature kernel and renders the same
 *   bytes.
 * - At least one custom height: one O(n) prefix-sum build per geometry
 *   (per data/heights change, NEVER per scroll frame), then O(log n)
 *   binary search per pointer/scroll query and O(1) per row offset.
 *
 * Heights are clamped to [MIN_ROW_HEIGHT, MAX_ROW_HEIGHT]; anything
 * non-finite or non-positive reads as the default so one corrupt stored
 * value cannot collapse or explode the layout.
 */

/** Same bounds the storage contract puts on `row.values["$rh"]`. */
export const MIN_ROW_HEIGHT = 16;
export const MAX_ROW_HEIGHT = 400;

/** Clamp a proposed row height into the legal range. NaN clamps to the
 *  minimum (never NaN out — a NaN top would blank the grid); ±Infinity
 *  clamp to the respective bound through the ordinary min/max. */
export function clampRowHeight(h: number): number {
  if (Number.isNaN(h)) return MIN_ROW_HEIGHT;
  return Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, h));
}

export type RowGeometry = {
  /** True when every row is the default height — the O(1) closed-form
   *  world. Exposed so callers (and tests) can assert the fast path. */
  uniform: boolean;
  /** Sum of all row heights = the body content height. */
  totalHeight: number;
  /** Top offset of row r, in px from the top of row 0. Valid for
   *  r in [0, count] — rowTop(count) === totalHeight, which is what the
   *  drop-indicator's "gap below the last row" needs. */
  rowTop(r: number): number;
  /** Height of row r. Out-of-range r reads as the default height. */
  rowHeight(r: number): number;
  /** The row containing y: the greatest r with rowTop(r) <= y, clamped to
   *  [0, count-1] (0 when count is 0). Uniform: floor(y / H), clamped —
   *  exactly the old kernel formula. */
  rowAtY(y: number): number;
  /** Exclusive mount end: the first r with rowTop(r) >= y, clamped to
   *  [0, count]. Uniform: ceil(y / H), clamped — exactly the old kernel's
   *  virtual-window `last`. */
  rowEndAtY(y: number): number;
  /** The nearest row BOUNDARY (insertion gap) to y, 0..count. A y exactly
   *  halfway down a row snaps to the gap below, matching Math.round —
   *  uniform: round(y / H), clamped, exactly the old gapFromClientY. */
  gapAtY(y: number): number;
};

/**
 * Build the geometry for `count` rows of default height `defaultH`, with
 * `heightAt(i)` supplying row i's custom height (undefined = default).
 * `heightAt` is called once per row at build time, never per query.
 */
export function buildRowGeometry(
  count: number,
  defaultH: number,
  heightAt?: (index: number) => number | undefined,
): RowGeometry {
  const n = Math.max(0, Math.floor(count));
  const H = defaultH > 0 && Number.isFinite(defaultH) ? defaultH : 1;

  /* One pass to discover whether any row deviates. A height equal to the
   * default after clamping is NOT custom: a sheet whose every "$rh"
   * happens to equal the default must still take the closed-form path. */
  let prefix: number[] | null = null;
  if (heightAt) {
    for (let i = 0; i < n; i++) {
      const raw = heightAt(i);
      const h = raw != null && Number.isFinite(raw) && raw > 0 ? clampRowHeight(raw) : H;
      if (h !== H && prefix === null) {
        // First deviation: backfill the uniform prefix up to here, then
        // keep accumulating for the rest of the single pass.
        prefix = new Array<number>(n + 1);
        for (let k = 0; k <= i; k++) prefix[k] = k * H;
      }
      if (prefix !== null) prefix[i + 1] = prefix[i] + h;
    }
  }

  if (prefix === null) {
    /* ── uniform fast path ────────────────────────────────────────
     * Formula-identical to the constant-height kernel:
     *   rowTop(r)    = r * H
     *   rowAtY(y)    = clamp(floor(y / H), 0, n-1)
     *   rowEndAtY(y) = clamp(ceil(y / H), 0, n)
     *   gapAtY(y)    = clamp(round(y / H), 0, n)
     * All O(1); nothing was allocated. */
    return {
      uniform: true,
      totalHeight: n * H,
      rowTop: (r) => Math.max(0, Math.min(n, r)) * H,
      rowHeight: () => H,
      rowAtY: (y) => (n === 0 ? 0 : Math.max(0, Math.min(n - 1, Math.floor(y / H)))),
      rowEndAtY: (y) => Math.max(0, Math.min(n, Math.ceil(y / H))),
      gapAtY: (y) => Math.max(0, Math.min(n, Math.round(y / H))),
    };
  }

  const p = prefix;
  const total = p[n];

  /** Greatest r with p[r] <= y, clamped to [0, n-1]. O(log n). */
  const rowAtY = (y: number): number => {
    if (n === 0) return 0;
    if (y < p[1]) return 0;
    if (y >= p[n - 1]) return n - 1;
    // Invariant: p[lo] <= y < p[hi]; answer is lo when hi = lo + 1.
    let lo = 1;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p[mid] <= y) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  return {
    uniform: false,
    totalHeight: total,
    rowTop: (r) => p[Math.max(0, Math.min(n, r))],
    rowHeight: (r) => (r >= 0 && r < n ? p[r + 1] - p[r] : H),
    rowAtY,
    rowEndAtY: (y) => {
      // First r in [0, n] with p[r] >= y.
      if (y <= 0) return 0;
      if (y > total) return n;
      let lo = 0; // p[lo] < y
      let hi = n; // p[hi] >= y
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (p[mid] >= y) hi = mid;
        else lo = mid;
      }
      return hi;
    },
    gapAtY: (y) => {
      if (n === 0) return 0;
      const r = rowAtY(y);
      // Halfway snaps DOWN-gap (r + 1), matching Math.round's half-up.
      return y - p[r] < (p[r + 1] - p[r]) / 2 ? r : r + 1;
    },
  };
}
