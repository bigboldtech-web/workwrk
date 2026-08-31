import { describe, expect, it } from "vitest";
import {
  columnLetter,
  createTableEngine,
  functionHints,
  type HostColumn,
  type HostRow,
} from "./sheet-engine-host";

function col(id: string, type: string, label?: string, formula?: string): HostColumn {
  return { id, label: label ?? id.toUpperCase(), type, formula };
}

function row(id: string, values: Record<string, unknown>): HostRow {
  return { id, values };
}

describe("classification: literal vs formula", () => {
  const make = () =>
    createTableEngine({
      columns: [col("a", "number"), col("b", "short_text")],
      rows: [row("r1", { a: 5 })],
    });

  it("a plain string is a literal", () => {
    const engine = make();
    const res = engine.setCell("b", "r1", "hello");
    expect(res.stored).toBe("hello");
    expect(engine.isFormulaCell("b", "r1")).toBe(false);
    expect(engine.value("b", "r1")).toBe("hello");
  });

  it("a leading = stores { '=': body } without the =", () => {
    const engine = make();
    const res = engine.setCell("b", "r1", "=A1+1");
    expect(res.stored).toEqual({ "=": "A1+1" });
    expect(engine.isFormulaCell("b", "r1")).toBe(true);
    expect(engine.cellSource("b", "r1")).toBe("=A1+1");
    expect(engine.value("b", "r1")).toBe(6);
  });

  it("a bare '=' stays a literal instead of a junk formula", () => {
    const engine = make();
    const res = engine.setCell("b", "r1", "=");
    expect(res.stored).toBe("=");
    expect(engine.isFormulaCell("b", "r1")).toBe(false);
  });

  it("a formula edit reports the literal it replaced", () => {
    const engine = make();
    engine.setCell("b", "r1", "kept notes");
    const res = engine.setCell("b", "r1", "=A1*2");
    expect(res.previous).toBe("kept notes");
    expect(res.stored).toEqual({ "=": "A1*2" });
  });
});

describe("column formulas: per-row evaluation, old-engine numbers", () => {
  // Column A mixes a number, a decimal, junk text, numeric text and a blank.
  // The old engine's numbers for these five functions: numbers [10, 2.5, 4]
  // (junk skipped, "4" in a number column counted, blank skipped).
  const engine = createTableEngine({
    columns: [
      col("a", "number", "Amount"),
      col("sum", "formula", "Sum", "SUM(A)"),
      col("avg", "formula", "Avg", "AVG(A)"),
      col("min", "formula", "Min", "MIN(A)"),
      col("max", "formula", "Max", "MAX(A)"),
      col("cnt", "formula", "Count", "COUNT(A)"),
      col("dbl", "formula", "Double", "A*2"),
    ],
    rows: [
      row("r1", { a: 10 }),
      row("r2", { a: 2.5 }),
      row("r3", { a: "x" }),
      row("r4", { a: "4" }),
      row("r5", { a: null }),
    ],
  });

  it("aggregates match the old engine on every row", () => {
    for (const rid of ["r1", "r5"]) {
      expect(engine.value("sum", rid)).toBe(16.5);
      expect(engine.value("avg", rid)).toBe(5.5);
      expect(engine.value("min", rid)).toBe(2.5);
      expect(engine.value("max", rid)).toBe(10);
      expect(engine.value("cnt", rid)).toBe(3);
    }
  });

  it("bare column ref narrows to the current row in scalar context", () => {
    expect(engine.value("dbl", "r1")).toBe(20);
    expect(engine.value("dbl", "r2")).toBe(5);
    expect(engine.value("dbl", "r4")).toBe(8);
  });

  it("junk text in arithmetic is #VALUE!, the documented divergence", () => {
    expect(engine.value("dbl", "r3")).toBe("#VALUE!");
  });

  it("display trims float noise the way the old engine did", () => {
    const e = createTableEngine({
      columns: [col("a", "number"), col("b", "number"), col("c", "number")],
      rows: [row("r1", { a: 0.1, b: 0.2, c: { "=": "A1+B1" } })],
    });
    expect(e.display("c", "r1")).toBe("0.3");
  });
});

describe("incremental recalculation", () => {
  it("an edit recomputes only its dependents", () => {
    const engine = createTableEngine({
      columns: [col("a", "number"), col("b", "number")],
      rows: [
        row("r1", { a: 1, b: { "=": "A1*2" } }),
        row("r2", { a: 10, b: { "=": "A2*2" } }),
      ],
    });
    expect(engine.value("b", "r2")).toBe(20);
    const res = engine.setCell("a", "r1", 7);
    expect(res.affected).toEqual([{ colId: "b", rowId: "r1" }]);
    expect(engine.value("b", "r1")).toBe(14);
    expect(engine.value("b", "r2")).toBe(20);
  });

  it("affected excludes the edited cell itself", () => {
    const engine = createTableEngine({
      columns: [col("a", "number"), col("b", "number")],
      rows: [row("r1", { a: 3 })],
    });
    const res = engine.setCell("b", "r1", "=A1+1");
    expect(res.affected).toEqual([]);
    expect(engine.value("b", "r1")).toBe(4);
  });
});

describe("cycles", () => {
  it("mutual references render #CYCLE! and recover when broken", () => {
    const engine = createTableEngine({
      columns: [col("a", "number"), col("b", "number")],
      rows: [row("r1", {})],
    });
    engine.setCell("a", "r1", "=B1");
    engine.setCell("b", "r1", "=A1");
    expect(engine.display("a", "r1")).toBe("#CYCLE!");
    expect(engine.display("b", "r1")).toBe("#CYCLE!");

    const res = engine.setCell("b", "r1", 5);
    expect(engine.value("a", "r1")).toBe(5);
    expect(res.affected).toEqual([{ colId: "a", rowId: "r1" }]);
  });
});

describe("structure ops rewrite stored sources", () => {
  it("deleting a referenced column turns the ref into #REF! in the SOURCE", () => {
    const engine = createTableEngine({
      columns: [col("a", "number"), col("b", "number"), col("c", "number")],
      rows: [row("r1", { a: 2, b: 3, c: { "=": "A1+B1" } })],
    });
    expect(engine.value("c", "r1")).toBe(5);

    const res = engine.columnDeleted("a");
    // Old B slides into slot A, so B1 is rewritten to A1 and the dead ref
    // is pinned to #REF! rather than silently repointing.
    expect(res.rewritten.cells).toEqual([
      { colId: "c", rowId: "r1", stored: { "=": "#REF!+A1" } },
    ]);
    expect(engine.value("c", "r1")).toBe("#REF!");
    expect(engine.cellSource("c", "r1")).toBe("=#REF!+A1");
  });

  it("moving a column keeps refs pointing at the same data", () => {
    const engine = createTableEngine({
      columns: [
        col("a", "number"),
        col("b", "number"),
        col("c", "number"),
        col("d", "formula", "D", "A*2"),
      ],
      rows: [row("r1", { a: 6, b: 1, c: { "=": "A1" } })],
    });
    expect(engine.value("c", "r1")).toBe(6);
    expect(engine.value("d", "r1")).toBe(12);

    const res = engine.columnMoved(0, 1); // order becomes B, A, C, D
    expect(res.rewritten.cells).toEqual([
      { colId: "c", rowId: "r1", stored: { "=": "B1" } },
    ]);
    expect(res.rewritten.columns).toEqual([{ colId: "d", formula: "B:B*2" }]);
    // Same data, same answers: nothing to repaint.
    expect(res.affected).toEqual([]);
    expect(engine.value("c", "r1")).toBe(6);
    expect(engine.value("d", "r1")).toBe(12);
  });

  it("inserting a row shifts refs below the insertion point", () => {
    const engine = createTableEngine({
      columns: [col("a", "number"), col("b", "number")],
      rows: [row("r1", { a: 1 }), row("r2", { a: 9, b: { "=": "A2" } })],
    });
    expect(engine.value("b", "r2")).toBe(9);

    const res = engine.rowInserted(row("rNew", { a: 100 }), 1);
    expect(res.rewritten.cells).toEqual([
      { colId: "b", rowId: "r2", stored: { "=": "A3" } },
    ]);
    expect(engine.value("b", "r2")).toBe(9);
  });

  it("renaming a column rewrites [Header] refs", () => {
    const engine = createTableEngine({
      columns: [col("a", "number", "Price"), col("b", "number")],
      rows: [row("r1", { a: 8, b: { "=": "[Price]*2" } })],
    });
    expect(engine.value("b", "r1")).toBe(16);

    const res = engine.columnRenamed("a", "Cost");
    expect(res.rewritten.cells).toEqual([
      { colId: "b", rowId: "r1", stored: { "=": "[Cost]*2" } },
    ]);
    expect(engine.value("b", "r1")).toBe(16);
  });
});

describe("rowMoved: the gutter drag never repoints a formula", () => {
  // Four rows, values 10/20/30/40 in column a. Formulas are planted per test.
  const make = (extra: Record<string, Record<string, unknown>> = {}) =>
    createTableEngine({
      columns: [col("a", "number"), col("b", "number")],
      rows: [
        row("r1", { a: 10, ...extra.r1 }),
        row("r2", { a: 20, ...extra.r2 }),
        row("r3", { a: 30, ...extra.r3 }),
        row("r4", { a: 40, ...extra.r4 }),
      ],
    });

  it("a ref TO the moved row follows it (move up)", () => {
    // b1 watches r3 by address; r3 also watches its own row's a.
    const engine = make({ r1: { b: { "=": "A3" } }, r3: { b: { "=": "A3*2" } } });
    expect(engine.value("b", "r1")).toBe(30);
    expect(engine.value("b", "r3")).toBe(60);

    const res = engine.rowMoved("r3", 0); // order: r3, r1, r2, r4
    // r3 is now row 1, so both refs rewrite to A1 — the watcher keeps
    // watching r3, and r3's own formula keeps reading its own row.
    expect(res.rewritten.cells).toEqual(
      expect.arrayContaining([
        { colId: "b", rowId: "r1", stored: { "=": "A1" } },
        { colId: "b", rowId: "r3", stored: { "=": "A1*2" } },
      ]),
    );
    expect(res.rewritten.cells).toHaveLength(2);
    // Same data through new addresses: nothing recomputed to a new value.
    expect(res.affected).toEqual([]);
    expect(engine.value("b", "r1")).toBe(30);
    expect(engine.value("b", "r3")).toBe(60);
  });

  it("rows between from and to shift by one (move up)", () => {
    const engine = make({ r1: { b: { "=": "A2" } } }); // watches r2 (row 2)
    expect(engine.value("b", "r1")).toBe(20);

    engine.rowMoved("r4", 0); // order: r4, r1, r2, r3 — r2 slid down to row 3
    expect(engine.cellSource("b", "r1")).toBe("=A3");
    expect(engine.value("b", "r1")).toBe(20);
  });

  it("rows between from and to shift by one (move down)", () => {
    const engine = make({ r4: { b: { "=": "A1+A2" } } }); // r1 (row 1) + r2 (row 2)
    expect(engine.value("b", "r4")).toBe(30);

    engine.rowMoved("r1", 2); // order: r2, r3, r1, r4
    // r1 landed at row 3; r2 slid up to row 1.
    expect(engine.cellSource("b", "r4")).toBe("=A3+A1");
    expect(engine.value("b", "r4")).toBe(30);
  });

  it("a same-slot move is a recognised no-op", () => {
    const engine = make({ r1: { b: { "=": "A2" } } });
    const res = engine.rowMoved("r2", 1);
    expect(res.rewritten.cells).toEqual([]);
    expect(res.rewritten.columns).toEqual([]);
    expect(res.affected).toEqual([]);
    expect(engine.cellSource("b", "r1")).toBe("=A2");
    expect(engine.value("b", "r1")).toBe(20);
  });

  it("column formulas and whole-column aggregates ride through unchanged", () => {
    const engine = createTableEngine({
      columns: [
        col("a", "number"),
        col("dbl", "formula", "Double", "A*2"), // per-row: current row's a
        col("sum", "formula", "Sum", "SUM(A)"), // order-independent aggregate
      ],
      rows: [row("r1", { a: 1 }), row("r2", { a: 2 }), row("r3", { a: 4 })],
    });
    expect(engine.value("dbl", "r1")).toBe(2);
    expect(engine.value("sum", "r1")).toBe(7);

    const res = engine.rowMoved("r1", 2); // order: r2, r3, r1
    // Bare column refs have no row coordinate, so nothing rewrites…
    expect(res.rewritten.columns).toEqual([]);
    expect(res.rewritten.cells).toEqual([]);
    // …and every value survives keyed by rowId: same numbers, new order.
    expect(res.affected).toEqual([]);
    expect(engine.value("a", "r1")).toBe(1);
    expect(engine.value("dbl", "r1")).toBe(2);
    expect(engine.value("dbl", "r3")).toBe(8);
    for (const rid of ["r1", "r2", "r3"]) expect(engine.value("sum", rid)).toBe(7);
  });

  it("clamps an out-of-range target instead of throwing", () => {
    const engine = make({ r1: { b: { "=": "A1" } } });
    engine.rowMoved("r1", 99); // clamps to the last slot: r2, r3, r4, r1
    expect(engine.cellSource("b", "r1")).toBe("=A4");
    expect(engine.value("b", "r1")).toBe(10);
  });

  it("an unknown rowId throws with the table untouched", () => {
    const engine = make({ r1: { b: { "=": "A2" } } });
    expect(() => engine.rowMoved("ghost", 0)).toThrow(/unknown row/);
    expect(engine.cellSource("b", "r1")).toBe("=A2");
  });
});

describe("clock snapshot", () => {
  it("one recalc pass sees exactly one TODAY()", () => {
    // Every clock() call advances a day: per-call evaluation would give the
    // two cells different dates, a snapshot gives them the same one.
    let calls = 0;
    const engine = createTableEngine({
      columns: [col("a", "date"), col("b", "date")],
      rows: [row("r1", { a: { "=": "TODAY()" }, b: { "=": "TODAY()" } })],
      clock: () => new Date(Date.UTC(2026, 0, 1 + calls++)),
    });
    const first = engine.value("a", "r1");
    expect(first).toBe(engine.value("b", "r1"));

    const changed = engine.refresh();
    expect(engine.value("a", "r1")).toBe(engine.value("b", "r1"));
    expect(engine.value("a", "r1")).not.toBe(first);
    expect(changed).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("columnLetter matches the old display helper", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
  });

  it("function hints carry signature and summary for autocomplete", () => {
    const hints = functionHints();
    const sum = hints.find((h) => h.name === "SUM");
    expect(sum?.signature).toContain("SUM(");
    expect(sum?.summary.length).toBeGreaterThan(0);
  });
});

describe("setCells: one pass for a whole batch", () => {
  const make = () =>
    createTableEngine({
      columns: [col("a", "number"), col("b", "number"), col("sum", "formula", "Sum", "=[A]+[B]")],
      rows: [row("r1", { a: 1, b: 2 }), row("r2", { a: 3, b: 4 })],
    });

  it("applies every write and reports per-write stored/previous", () => {
    const engine = make();
    const { results } = engine.setCells([
      { colId: "a", rowId: "r1", raw: 10 },
      { colId: "b", rowId: "r2", raw: "=A1*2" },
    ]);
    expect(results).toEqual([
      { colId: "a", rowId: "r1", stored: 10, previous: 1 },
      { colId: "b", rowId: "r2", stored: { "=": "A1*2" }, previous: 4 },
    ]);
    expect(engine.value("sum", "r1")).toBe(12);
    expect(engine.value("b", "r2")).toBe(20);
    expect(engine.value("sum", "r2")).toBe(23);
  });

  it("two writes to one cell: last wins, both report the PRE-BATCH value", () => {
    const engine = make();
    const { results } = engine.setCells([
      { colId: "a", rowId: "r1", raw: 100 },
      { colId: "a", rowId: "r1", raw: 7 },
    ]);
    expect(results[0]).toEqual({ colId: "a", rowId: "r1", stored: 100, previous: 1 });
    expect(results[1]).toEqual({ colId: "a", rowId: "r1", stored: 7, previous: 1 });
    expect(engine.value("a", "r1")).toBe(7);
    expect(engine.value("sum", "r1")).toBe(9);
  });

  it("formula then literal on the same cell reverts to the literal", () => {
    const engine = make();
    engine.setCells([
      { colId: "b", rowId: "r1", raw: "=A1*10" },
      { colId: "b", rowId: "r1", raw: 5 },
    ]);
    expect(engine.isFormulaCell("b", "r1")).toBe(false);
    expect(engine.value("b", "r1")).toBe(5);
    expect(engine.value("sum", "r1")).toBe(6);
  });

  it("matches one-by-one setCell for distinct cells, in one pass", () => {
    const batch = make();
    const oneByOne = make();
    const writes = [
      { colId: "a", rowId: "r1", raw: 8 },
      { colId: "b", rowId: "r1", raw: "=A1+1" },
      { colId: "a", rowId: "r2", raw: "" },
    ];
    const { results } = batch.setCells(writes);
    for (const w of writes) {
      const res = oneByOne.setCell(w.colId, w.rowId, w.raw);
      const mine = results.find((r) => r.colId === w.colId && r.rowId === w.rowId);
      expect(mine?.stored).toEqual(res.stored);
      expect(mine?.previous).toEqual(res.previous);
    }
    for (const c of ["a", "b", "sum"]) {
      for (const r of ["r1", "r2"]) {
        expect(batch.display(c, r)).toBe(oneByOne.display(c, r));
      }
    }
  });

  it("one batch = one clock snapshot", () => {
    // A ticking clock: two NOW() cells written in one batch must agree;
    // written one at a time they must not, or the batch ran two passes.
    let calls = 0;
    const mk = () =>
      createTableEngine({
        columns: [col("a", "date"), col("b", "date")],
        rows: [row("r1", {})],
        clock: () => new Date(Date.UTC(2026, 0, 1 + calls++)),
      });
    const batched = mk();
    batched.setCells([
      { colId: "a", rowId: "r1", raw: "=NOW()" },
      { colId: "b", rowId: "r1", raw: "=NOW()" },
    ]);
    expect(batched.value("a", "r1")).toBe(batched.value("b", "r1"));

    const sequential = mk();
    sequential.setCell("a", "r1", "=NOW()");
    sequential.setCell("b", "r1", "=NOW()");
    expect(sequential.value("a", "r1")).not.toBe(sequential.value("b", "r1"));
  });

  it("an unknown id throws before ANY write is applied", () => {
    const engine = make();
    expect(() =>
      engine.setCells([
        { colId: "a", rowId: "r1", raw: 99 },
        { colId: "nope", rowId: "r1", raw: 1 },
      ]),
    ).toThrow(/unknown cell/);
    expect(engine.value("a", "r1")).toBe(1);
    expect(engine.value("sum", "r1")).toBe(3);
  });

  it("an empty batch is a no-op", () => {
    const engine = make();
    expect(engine.setCells([]).results).toEqual([]);
    expect(engine.value("sum", "r1")).toBe(3);
  });

  it("keeps the mirror honest: a later edit's affected list is a true diff", () => {
    const engine = make();
    engine.setCells([{ colId: "a", rowId: "r1", raw: 10 }]);
    // Writing the same value back changes nothing, so nothing is affected.
    const res = engine.setCell("a", "r1", 10);
    expect(res.affected).toEqual([]);
    // A real change reports exactly the dependent formula cell.
    const res2 = engine.setCell("a", "r1", 11);
    expect(res2.affected).toEqual([{ colId: "sum", rowId: "r1" }]);
  });
});

describe("aggregate caching stays invisible", () => {
  // The per-pass cache must be indistinguishable from uncached evaluation:
  // these tests pin the killer shapes against hand-computed oracles.

  it("per-row scalar + whole-column aggregate matches a hand-built oracle", () => {
    const n = 200;
    const rows: HostRow[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const amount = (i % 7) + 1;
      total += amount;
      rows.push(row("r" + i, { amount }));
    }
    const engine = createTableEngine({
      columns: [
        { id: "amount", label: "Amount", type: "number" },
        { id: "share", label: "Share", type: "formula", formula: "=[Amount]/SUM([Amount])" },
      ],
      rows,
    });
    for (let i = 0; i < n; i++) {
      const expected = ((i % 7) + 1) / total;
      expect(engine.value("share", "r" + i)).toBe(expected);
    }
  });

  it("an aggregate over a column recomputed in the SAME pass sees new values", () => {
    // A literal feeds a formula column, which feeds an aggregate: the edit's
    // one pass recomputes [Double] AND every SUM([Double]) reader. A cache
    // that survived the pass, or one that failed to invalidate, would leave
    // [Total] holding sums of the old doubles.
    const n = 100;
    const rows: HostRow[] = [];
    for (let i = 0; i < n; i++) rows.push(row("r" + i, { base: i + 1 }));
    const engine = createTableEngine({
      columns: [
        { id: "base", label: "Base", type: "number" },
        { id: "double", label: "Double", type: "formula", formula: "=[Base]*2" },
        { id: "total", label: "Total", type: "formula", formula: "=SUM([Double])+[Base]" },
      ],
      rows,
    });
    const sumDoubles = (n * (n + 1)) / 2 * 2;
    expect(engine.value("total", "r0")).toBe(sumDoubles + 1);
    expect(engine.value("total", "r" + (n - 1))).toBe(sumDoubles + n);

    engine.setCell("base", "r3", 1000); // was 4
    const newSum = sumDoubles - 8 + 2000;
    expect(engine.value("double", "r3")).toBe(2000);
    for (let i = 0; i < n; i++) {
      const base = i === 3 ? 1000 : i + 1;
      expect(engine.value("total", "r" + i)).toBe(newSum + base);
    }
  });

  it("a batch touching the aggregated column recomputes every reader once, correctly", () => {
    const rows: HostRow[] = [];
    for (let i = 0; i < 50; i++) rows.push(row("r" + i, { v: 1 }));
    const engine = createTableEngine({
      columns: [
        { id: "v", label: "V", type: "number" },
        { id: "share", label: "Share", type: "formula", formula: "=[V]/SUM([V])" },
      ],
      rows,
    });
    engine.setCells([
      { colId: "v", rowId: "r0", raw: 26 },
      { colId: "v", rowId: "r1", raw: 26 },
    ]);
    // Total is now 26+26+48 = 100.
    expect(engine.value("share", "r0")).toBe(0.26);
    expect(engine.value("share", "r1")).toBe(0.26);
    expect(engine.value("share", "r2")).toBe(0.01);
  });

  it("errors propagate through a cached aggregate and clear when fixed", () => {
    const rows: HostRow[] = [];
    for (let i = 0; i < 80; i++) rows.push(row("r" + i, { v: 1 }));
    const engine = createTableEngine({
      columns: [
        { id: "v", label: "V", type: "number" },
        { id: "sum", label: "Sum", type: "formula", formula: "=SUM([V])" },
      ],
      rows,
    });
    engine.setCell("v", "r5", "=1/0");
    expect(engine.display("sum", "r0")).toBe("#DIV/0!");
    expect(engine.display("sum", "r79")).toBe("#DIV/0!");
    engine.setCell("v", "r5", 21);
    expect(engine.value("sum", "r0")).toBe(100);
  });

  it("numeric text counts only in numeric-typed columns, cached or not", () => {
    const rows: HostRow[] = [];
    for (let i = 0; i < 80; i++) rows.push(row("r" + i, { num: "1", txt: "1" }));
    const engine = createTableEngine({
      columns: [
        { id: "num", label: "Num", type: "number" },
        { id: "txt", label: "Txt", type: "short_text" },
        { id: "sumnum", label: "SumNum", type: "formula", formula: "=SUM([Num])" },
        { id: "sumtxt", label: "SumTxt", type: "formula", formula: "=SUM([Txt])" },
      ],
      rows,
    });
    // 80 numeric-text cells in a number column each read as 1; the same
    // text in a text column is text, which SUM ignores.
    expect(engine.value("sumnum", "r0")).toBe(80);
    expect(engine.value("sumtxt", "r0")).toBe(0);
  });
});

describe("dynamic arrays: spill maps to the right cells", () => {
  const make = () =>
    createTableEngine({
      columns: [col("a", "number"), col("out", "short_text")],
      rows: [row("r1", {}), row("r2", {}), row("r3", {}), row("r4", {})],
    });

  it("a =SEQUENCE anchor spills down into the rows below", () => {
    const engine = make();
    engine.setCell("out", "r1", "=SEQUENCE(3)");
    expect(engine.value("out", "r1")).toBe(1);
    expect(engine.value("out", "r2")).toBe(2);
    expect(engine.value("out", "r3")).toBe(3);
    // The overflow rows are spilled, not formulas of their own.
    expect(engine.isFormulaCell("out", "r2")).toBe(false);
    expect(engine.isSpilledCell("out", "r2")).toBe(true);
    expect(engine.isSpilledCell("out", "r1")).toBe(false);
    // r4 is past the array — untouched.
    expect(engine.isSpilledCell("out", "r4")).toBe(false);
    expect(engine.value("out", "r4")).toBeNull();
  });

  it("a literal in the spill range yields #SPILL! and never overwrites it", () => {
    const engine = make();
    engine.setCell("out", "r2", "keep me");
    engine.setCell("out", "r1", "=SEQUENCE(3)");
    expect(engine.value("out", "r1")).toBe("#SPILL!");
    expect(engine.value("out", "r2")).toBe("keep me");
    expect(engine.isSpilledCell("out", "r2")).toBe(false);
  });

  it("clearing the blocker lets the array recover", () => {
    const engine = make();
    engine.setCell("out", "r2", "block");
    engine.setCell("out", "r1", "=SEQUENCE(3)");
    expect(engine.value("out", "r1")).toBe("#SPILL!");
    engine.setCell("out", "r2", null);
    expect(engine.value("out", "r1")).toBe(1);
    expect(engine.value("out", "r2")).toBe(2);
    expect(engine.value("out", "r3")).toBe(3);
  });

  it("deleting the anchor formula clears the whole footprint", () => {
    const engine = make();
    engine.setCell("out", "r1", "=SEQUENCE(3)");
    expect(engine.isSpilledCell("out", "r3")).toBe(true);
    engine.setCell("out", "r1", null);
    expect(engine.isSpilledCell("out", "r2")).toBe(false);
    expect(engine.isSpilledCell("out", "r3")).toBe(false);
    expect(engine.value("out", "r2")).toBeNull();
  });
});
