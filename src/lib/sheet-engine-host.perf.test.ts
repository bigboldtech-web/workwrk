// Performance gates for the Phase-5 recalc-perf fix (per-pass aggregate
// caching + whole-column dependent index + batch writes). The shape under
// test is the recorded O(n²) killer: a per-row scalar combined with a
// whole-column aggregate, `=[Amount]/SUM([Amount])`, over 10k rows —
// measured at 10.1s (constructor) / 12.6s (one setCell) before the fix.
//
// The bounds are GENEROUS on purpose (roughly 10x the measured times on a
// 2026 dev laptop): they exist to catch an O(n²) regression, which blows
// past any of them by an order of magnitude, not to benchmark CI hardware.

import { describe, expect, it } from "vitest";
import { createTableEngine, type HostRow } from "./sheet-engine-host";

const N = 10_000;

function build(n: number) {
  const columns = [
    { id: "amount", label: "Amount", type: "number" },
    { id: "share", label: "Share", type: "formula", formula: "=[Amount]/SUM([Amount])" },
  ];
  const rows: HostRow[] = [];
  for (let i = 0; i < n; i++) rows.push({ id: "r" + i, values: { amount: (i % 97) + 1 } });
  return { columns, rows };
}

/** SUM of (i % 97) + 1 over n rows, the oracle for spot checks. */
function totalOf(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += (i % 97) + 1;
  return total;
}

describe(`aggregate formula column at ${N} rows`, () => {
  it("constructor full pass stays O(n)", () => {
    const { columns, rows } = build(N);
    const start = performance.now();
    const engine = createTableEngine({ columns, rows });
    const elapsed = performance.now() - start;
    console.log(`constructor @ ${N}: ${elapsed.toFixed(1)}ms`);

    const total = totalOf(N);
    expect(engine.value("share", "r0")).toBe(1 / total);
    expect(engine.value("share", "r" + (N - 1))).toBe((((N - 1) % 97) + 1) / total);
    expect(elapsed).toBeLessThan(3000);
  });

  it("one setCell recomputes the column in one cached pass", () => {
    const { columns, rows } = build(N);
    const engine = createTableEngine({ columns, rows });
    const start = performance.now();
    const res = engine.setCell("amount", "r5000", 500);
    const elapsed = performance.now() - start;
    console.log(`setCell @ ${N}: ${elapsed.toFixed(1)}ms`);

    // (5000 % 97) + 1 = 54 was replaced by 500.
    const total = totalOf(N) - 54 + 500;
    expect(res.affected.length).toBe(N); // every Share cell moved
    expect(engine.value("share", "r5000")).toBe(500 / total);
    expect(engine.value("share", "r0")).toBe(1 / total);
    expect(elapsed).toBeLessThan(1500);
  });

  it("a 500-write setCells batch is one pass, not 500", () => {
    const { columns, rows } = build(N);
    const engine = createTableEngine({ columns, rows });
    const writes = [];
    for (let i = 0; i < 500; i++) {
      writes.push({ colId: "amount", rowId: "r" + i * 20, raw: 1000 + i });
    }
    const start = performance.now();
    const { results } = engine.setCells(writes);
    const elapsed = performance.now() - start;
    console.log(`setCells(500) @ ${N}: ${elapsed.toFixed(1)}ms`);

    expect(results).toHaveLength(500);
    let total = totalOf(N);
    for (let i = 0; i < 500; i++) total += 1000 + i - (((i * 20) % 97) + 1);
    expect(engine.value("share", "r0")).toBe(1000 / total);
    expect(engine.value("share", "r1")).toBe(2 / total);
    expect(elapsed).toBeLessThan(5000);
  });
});
