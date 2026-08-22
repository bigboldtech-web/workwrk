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
