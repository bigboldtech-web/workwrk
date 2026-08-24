import { describe, expect, it } from "vitest";

import {
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  buildRowGeometry,
  clampRowHeight,
} from "./sheet-row-geometry";

const H = 33; // the kernel's SHEET_ROW_H

describe("clampRowHeight", () => {
  it("clamps into [MIN, MAX]", () => {
    expect(clampRowHeight(1)).toBe(MIN_ROW_HEIGHT);
    expect(clampRowHeight(16)).toBe(16);
    expect(clampRowHeight(120)).toBe(120);
    expect(clampRowHeight(400)).toBe(400);
    expect(clampRowHeight(9999)).toBe(MAX_ROW_HEIGHT);
  });

  it("never returns NaN", () => {
    expect(clampRowHeight(NaN)).toBe(MIN_ROW_HEIGHT);
    expect(clampRowHeight(Infinity)).toBe(MAX_ROW_HEIGHT);
    expect(clampRowHeight(-Infinity)).toBe(MIN_ROW_HEIGHT);
  });
});

describe("buildRowGeometry: uniform fast path", () => {
  it("is uniform with no heightAt at all", () => {
    const g = buildRowGeometry(1000, H);
    expect(g.uniform).toBe(true);
    expect(g.totalHeight).toBe(1000 * H);
  });

  it("is uniform when heightAt answers undefined everywhere", () => {
    const g = buildRowGeometry(1000, H, () => undefined);
    expect(g.uniform).toBe(true);
  });

  it("is uniform when every custom height EQUALS the default", () => {
    const g = buildRowGeometry(50, H, () => H);
    expect(g.uniform).toBe(true);
  });

  it("treats non-finite / non-positive heights as default (still uniform)", () => {
    const g = buildRowGeometry(10, H, (i) => (i === 3 ? NaN : i === 4 ? -5 : i === 5 ? 0 : undefined));
    expect(g.uniform).toBe(true);
  });

  it("matches the old kernel's closed-form formulas exactly", () => {
    const n = 200;
    const g = buildRowGeometry(n, H);
    // rowTop(r) = r * H (valid through r = n)
    for (const r of [0, 1, 7, 199, 200]) expect(g.rowTop(r)).toBe(r * H);
    expect(g.rowHeight(42)).toBe(H);
    // rowAtY = clamp(floor(y/H)); rowEndAtY = clamp(ceil(y/H)); gapAtY = clamp(round(y/H))
    for (const y of [-50, 0, 1, H - 1, H, H + 1, 5.5 * H, n * H - 1, n * H, n * H + 500]) {
      expect(g.rowAtY(y)).toBe(Math.max(0, Math.min(n - 1, Math.floor(y / H))));
      expect(g.rowEndAtY(y)).toBe(Math.max(0, Math.min(n, Math.ceil(y / H))));
      expect(g.gapAtY(y)).toBe(Math.max(0, Math.min(n, Math.round(y / H))));
    }
  });

  it("handles count 0 without exploding", () => {
    const g = buildRowGeometry(0, H);
    expect(g.totalHeight).toBe(0);
    expect(g.rowAtY(50)).toBe(0);
    expect(g.rowEndAtY(50)).toBe(0);
    expect(g.gapAtY(50)).toBe(0);
    expect(g.rowTop(0)).toBe(0);
  });
});

describe("buildRowGeometry: variable heights (prefix sums + binary search)", () => {
  // Rows: 0..9 default except row 2 = 100, row 7 = 66.
  const heights = (i: number) => (i === 2 ? 100 : i === 7 ? 66 : undefined);
  const g = buildRowGeometry(10, H, heights);
  const hs = Array.from({ length: 10 }, (_, i) => heights(i) ?? H);
  const tops = [0];
  for (const h of hs) tops.push(tops[tops.length - 1] + h);

  it("is not uniform and sums heights", () => {
    expect(g.uniform).toBe(false);
    expect(g.totalHeight).toBe(tops[10]);
  });

  it("rowTop / rowHeight follow the prefix sums", () => {
    for (let r = 0; r <= 10; r++) expect(g.rowTop(r)).toBe(tops[r]);
    for (let r = 0; r < 10; r++) expect(g.rowHeight(r)).toBe(hs[r]);
    // Out-of-range height reads as default, out-of-range top clamps.
    expect(g.rowHeight(-1)).toBe(H);
    expect(g.rowHeight(10)).toBe(H);
    expect(g.rowTop(-1)).toBe(0);
    expect(g.rowTop(99)).toBe(tops[10]);
  });

  it("rowAtY finds the containing row (boundaries belong to the row below)", () => {
    // Reference: linear scan.
    const ref = (y: number) => {
      if (y < 0) return 0;
      for (let r = 0; r < 10; r++) if (y < tops[r + 1]) return r;
      return 9;
    };
    for (let y = -20; y <= tops[10] + 20; y++) expect(g.rowAtY(y)).toBe(ref(y));
    // Exact boundary: rowTop(r) belongs to row r.
    expect(g.rowAtY(tops[2])).toBe(2);
    expect(g.rowAtY(tops[3])).toBe(3);
  });

  it("rowEndAtY is the exclusive mount end (first rowTop >= y)", () => {
    const ref = (y: number) => {
      for (let r = 0; r <= 10; r++) if (tops[r] >= y) return r;
      return 10;
    };
    for (let y = -20; y <= tops[10] + 20; y++) expect(g.rowEndAtY(y)).toBe(ref(y));
  });

  it("gapAtY snaps to the nearest boundary, half-up like Math.round", () => {
    // Middle of tall row 2 (height 100): first half → gap 2, second half → gap 3.
    const mid = tops[2] + 50;
    expect(g.gapAtY(mid - 1)).toBe(2);
    expect(g.gapAtY(mid)).toBe(3); // exactly half snaps down-gap, like round(.5)
    expect(g.gapAtY(mid + 1)).toBe(3);
    // Extremes clamp to 0..count.
    expect(g.gapAtY(-500)).toBe(0);
    expect(g.gapAtY(tops[10] + 500)).toBe(10);
  });

  it("clamps stored custom heights into [MIN, MAX]", () => {
    const wild = buildRowGeometry(3, H, (i) => (i === 0 ? 4 : i === 1 ? 4000 : undefined));
    expect(wild.rowHeight(0)).toBe(MIN_ROW_HEIGHT);
    expect(wild.rowHeight(1)).toBe(MAX_ROW_HEIGHT);
    expect(wild.rowHeight(2)).toBe(H);
  });

  it("a custom FIRST row still backfills correctly (deviation at i = 0)", () => {
    const g0 = buildRowGeometry(3, H, (i) => (i === 0 ? 66 : undefined));
    expect(g0.uniform).toBe(false);
    expect(g0.rowTop(1)).toBe(66);
    expect(g0.rowTop(3)).toBe(66 + 2 * H);
  });

  it("agrees with the uniform formulas when re-run without customs", () => {
    // The same y-queries through both paths on an all-default sheet: the
    // variable path is exercised by forcing one custom then resetting it.
    const a = buildRowGeometry(64, H);
    const b = buildRowGeometry(64, H, (i) => (i === 63 ? H + 1 : undefined));
    for (let y = 0; y < 63 * H; y += 7) {
      expect(b.rowAtY(y)).toBe(a.rowAtY(y));
      expect(b.rowEndAtY(y)).toBe(a.rowEndAtY(y));
      expect(b.gapAtY(y)).toBe(a.gapAtY(y));
    }
  });
});
