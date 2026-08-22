import { describe, expect, it } from "vitest";

import { parseFormula } from "./parser";
import {
  formatAst,
  formatRef,
  rewriteAst,
  rewriteFormula,
  rewriteRef,
  translateFormula,
  translateRef,
  type RewriteOptions,
  type StructureChange,
} from "./refs";
import { type Ref } from "./types";

function rewrite(
  source: string,
  change: StructureChange,
  options?: RewriteOptions,
): string {
  const result = rewriteFormula(source, change, options);
  if (!result.ok) throw new Error(result.error.message);
  return result.source;
}

function ref(source: string): Ref {
  const parsed = parseFormula(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  if (parsed.ast.type !== "ref") throw new Error(`${source} is not a bare ref`);
  return parsed.ast.ref;
}

function moved(source: string, change: StructureChange, options?: RewriteOptions) {
  const next = rewriteRef(ref(source), change, options);
  return next === null ? "#REF!" : formatRef(next);
}

describe("row insert", () => {
  const change: StructureChange = { type: "insert-rows", at: 2, count: 3 };

  it("pushes a relative ref at or below the insertion point down", () => {
    expect(moved("A3", change)).toBe("A6");
    expect(moved("A5", change)).toBe("A8");
  });

  it("leaves a ref above the insertion point alone", () => {
    expect(moved("A1", change)).toBe("A1");
    expect(moved("A2", change)).toBe("A2");
  });

  it("pins an absolute row by default", () => {
    expect(moved("A$3", change)).toBe("A$3");
    expect(moved("$A$3", change)).toBe("$A$3");
  });

  it("shifts an absolute row like Excel when pinning is turned off", () => {
    expect(moved("A$3", change, { pinAbsolute: false })).toBe("A$6");
  });

  it("expands a range the insert lands inside", () => {
    expect(moved("A1:A9", change)).toBe("A1:A12");
  });

  it("pushes a range the insert lands above", () => {
    expect(moved("A5:A9", change)).toBe("A8:A12");
  });

  it("ignores whole-column and header refs", () => {
    expect(moved("A:A", change)).toBe("A:A");
    expect(moved("[Total]", change)).toBe("[Total]");
  });

  it("rewrites the formula text and reports that it changed", () => {
    const result = rewriteFormula("A3+B1", change);
    expect(result).toEqual({ ok: true, source: "A6+B1", changed: true });
  });

  it("returns the original text byte for byte when nothing moved", () => {
    const result = rewriteFormula("A1 + B1", change);
    expect(result).toEqual({ ok: true, source: "A1 + B1", changed: false });
  });

  it("keeps a leading = when the source had one", () => {
    expect(rewrite("=A3*2", change)).toBe("=A6*2");
  });

  it("reports a syntax error instead of guessing", () => {
    const result = rewriteFormula("A3+", change);
    expect(result.ok).toBe(false);
  });
});

describe("row delete", () => {
  const change: StructureChange = { type: "delete-rows", at: 2, count: 3 };

  it("kills a ref to a deleted row", () => {
    expect(moved("A3", change)).toBe("#REF!");
    expect(moved("A5", change)).toBe("#REF!");
    expect(moved("$A$4", change)).toBe("#REF!");
  });

  it("pulls a ref below the hole up", () => {
    expect(moved("A6", change)).toBe("A3");
  });

  it("leaves a ref above the hole alone", () => {
    expect(moved("A2", change)).toBe("A2");
  });

  it("contracts a range that straddles the deletion", () => {
    expect(moved("A1:A10", change)).toBe("A1:A7");
  });

  it("contracts a range whose top is deleted", () => {
    // Rows 3..5 die; old row 6 becomes row 3, so the survivors are A3:A7.
    expect(moved("A3:A10", change)).toBe("A3:A7");
  });

  it("contracts a range whose bottom is deleted", () => {
    expect(moved("A1:A4", change)).toBe("A1:A2");
  });

  it("kills a range swallowed whole", () => {
    expect(moved("A3:A5", change)).toBe("#REF!");
  });

  it("contracts to a single cell rather than dying", () => {
    expect(moved("A2:A4", change)).toBe("A2:A2");
  });

  it("keeps the orientation the user typed", () => {
    expect(moved("A10:A1", change)).toBe("A7:A1");
  });

  it("turns a dead ref into #REF! inside a larger formula", () => {
    expect(rewrite("A3*2+B1", change)).toBe("#REF!*2+B1");
  });

  it("deletes rows from the top of the sheet", () => {
    const top: StructureChange = { type: "delete-rows", at: 0, count: 2 };
    expect(moved("A1", top)).toBe("#REF!");
    expect(moved("A3", top)).toBe("A1");
    expect(moved("A1:A5", top)).toBe("A1:A3");
  });
});

describe("column delete", () => {
  const change: StructureChange = { type: "delete-columns", at: 1, count: 2 };

  it("kills a ref to a deleted column", () => {
    expect(moved("B1", change)).toBe("#REF!");
    expect(moved("C1", change)).toBe("#REF!");
  });

  it("pulls later columns left", () => {
    expect(moved("D1", change)).toBe("B1");
    expect(moved("D:D", change)).toBe("B:B");
  });

  it("contracts a straddling column range", () => {
    expect(moved("A:D", change)).toBe("A:B");
  });

  it("contracts a straddling cell range", () => {
    expect(moved("A1:D9", change)).toBe("A1:B9");
  });

  it("leaves row refs untouched", () => {
    expect(moved("A5", change)).toBe("A5");
  });

  it("kills a header ref whose column died", () => {
    const options = { resolveHeader: (name: string) => (name === "Price" ? 1 : 5) };
    expect(moved("[Price]", change, options)).toBe("#REF!");
    expect(moved("[Other]", change, options)).toBe("[Other]");
  });

  it("leaves header refs alone when it cannot resolve them", () => {
    expect(moved("[Price]", change)).toBe("[Price]");
  });
});

describe("column move", () => {
  // A B C D, lift A out and drop it at index 2: B C A D.
  const change: StructureChange = { type: "move-columns", from: 0, count: 1, to: 2 };

  it("follows the column that moved", () => {
    expect(moved("A1", change)).toBe("C1");
  });

  it("slides the columns it passed", () => {
    expect(moved("B1", change)).toBe("A1");
    expect(moved("C1", change)).toBe("B1");
    expect(moved("D1", change)).toBe("D1");
  });

  it("follows a pinned ref too, because the data itself moved", () => {
    expect(moved("$A$1", change)).toBe("$C$1");
    expect(moved("$A$1", change, { pinAbsolute: false })).toBe("$C$1");
  });

  it("follows a whole-column ref", () => {
    expect(moved("A:A", change)).toBe("C:C");
  });

  it("leaves a header ref pointing at its own column", () => {
    expect(moved("[Qty]", change)).toBe("[Qty]");
  });

  it("keeps a range covering the same columns when the ends cross", () => {
    // B:C with B moved past C is still the pair {C,B}.
    expect(moved("B:C", { type: "move-columns", from: 1, count: 1, to: 2 })).toBe(
      "B:C",
    );
  });

  it("moves a block of several columns", () => {
    const block: StructureChange = { type: "move-columns", from: 0, count: 2, to: 1 };
    // A B C D -> lift AB -> C D -> insert at 1 -> C A B D.
    expect(moved("A1", block)).toBe("B1");
    expect(moved("B1", block)).toBe("C1");
    expect(moved("C1", block)).toBe("A1");
    expect(moved("D1", block)).toBe("D1");
  });

  it("never produces #REF!", () => {
    expect(rewrite("A1+B1+C1+D1", change)).toBe("C1+A1+B1+D1");
  });
});

describe("row move", () => {
  const change: StructureChange = { type: "move-rows", from: 4, count: 1, to: 0 };

  it("carries a ref to the moved row with it", () => {
    expect(moved("A5", change)).toBe("A1");
  });

  it("pushes the rows it landed on down", () => {
    expect(moved("A1", change)).toBe("A2");
    expect(moved("A4", change)).toBe("A5");
    expect(moved("A6", change)).toBe("A6");
  });

  it("leaves column refs alone", () => {
    expect(moved("B:B", change)).toBe("B:B");
  });
});

describe("column insert", () => {
  const change: StructureChange = { type: "insert-columns", at: 1, count: 1 };

  it("pushes columns right", () => {
    expect(moved("B1", change)).toBe("C1");
    expect(moved("A1", change)).toBe("A1");
    expect(moved("B:C", change)).toBe("C:D");
  });

  it("pins an absolute column by default", () => {
    expect(moved("$B1", change)).toBe("$B1");
    expect(moved("$B1", change, { pinAbsolute: false })).toBe("$C1");
  });
});

describe("rename-header", () => {
  const change: StructureChange = { type: "rename-header", from: "Qty", to: "Units" };

  it("renames a matching header ref", () => {
    expect(moved("[Qty]", change)).toBe("[Units]");
  });

  it("matches case-insensitively", () => {
    expect(moved("[qty]", change)).toBe("[Units]");
  });

  it("leaves other refs alone", () => {
    expect(moved("[Price]", change)).toBe("[Price]");
    expect(moved("A1", change)).toBe("A1");
  });

  it("escapes a bracket in the new name", () => {
    const odd: StructureChange = {
      type: "rename-header",
      from: "Qty",
      to: "Qty [kg]",
    };
    // Only the closing bracket needs doubling; `[` is not special inside.
    expect(moved("[Qty]", odd)).toBe("[Qty [kg]]]");
    const parsed = parseFormula("[Qty [kg]]]");
    expect(parsed.ok && parsed.ast.type === "ref" && parsed.ast.ref).toEqual({
      kind: "header",
      name: "Qty [kg]",
    });
  });
});

describe("bounds", () => {
  it("refuses to push a ref past the last column", () => {
    const change: StructureChange = { type: "insert-columns", at: 0, count: 1 };
    expect(moved("ZZZ1", change)).toBe("#REF!");
  });

  it("refuses to push a ref past the last row", () => {
    const change: StructureChange = { type: "insert-rows", at: 0, count: 1 };
    expect(moved("A1048576", change)).toBe("#REF!");
  });
});

describe("translateRef", () => {
  it("shifts relative coordinates and pins absolute ones", () => {
    expect(formatRef(translateRef(ref("A1"), 2, 1) as Ref)).toBe("B3");
    expect(formatRef(translateRef(ref("$A1"), 2, 1) as Ref)).toBe("$A3");
    expect(formatRef(translateRef(ref("A$1"), 2, 1) as Ref)).toBe("B$1");
    expect(formatRef(translateRef(ref("$A$1"), 2, 1) as Ref)).toBe("$A$1");
  });

  it("moves both ends of a range", () => {
    expect(formatRef(translateRef(ref("A1:B2"), 1, 0) as Ref)).toBe("A2:B3");
    expect(formatRef(translateRef(ref("A$1:B2"), 1, 0) as Ref)).toBe("A$1:B3");
  });

  it("moves a column ref sideways only", () => {
    expect(formatRef(translateRef(ref("A:A"), 5, 1) as Ref)).toBe("B:B");
    expect(formatRef(translateRef(ref("$A:$A"), 5, 1) as Ref)).toBe("$A:$A");
  });

  it("never moves a header ref", () => {
    expect(formatRef(translateRef(ref("[Qty]"), 3, 3) as Ref)).toBe("[Qty]");
  });

  it("is #REF! off the top or left edge", () => {
    expect(translateRef(ref("A1"), -1, 0)).toBe(null);
    expect(translateRef(ref("A1"), 0, -1)).toBe(null);
  });

  it("fills a formula down", () => {
    expect(translateFormula("A1*$B$1", 1, 0)).toEqual({
      ok: true,
      source: "A2*$B$1",
      changed: true,
    });
  });

  it("reports no change for a formula with nothing relative in it", () => {
    expect(translateFormula("$A$1*2", 5, 5)).toEqual({
      ok: true,
      source: "$A$1*2",
      changed: false,
    });
  });
});

describe("rewriteAst", () => {
  it("returns the identical tree when nothing moved", () => {
    const parsed = parseFormula("A1+1");
    if (!parsed.ok) throw new Error("unparsable");
    const result = rewriteAst(parsed.ast, {
      type: "insert-rows",
      at: 9,
      count: 1,
    });
    expect(result.changed).toBe(false);
    expect(result.ast).toBe(parsed.ast);
  });

  it("rewrites inside call arguments", () => {
    expect(rewrite("SUM(A1:A5,B7)", { type: "insert-rows", at: 0, count: 2 })).toBe(
      "SUM(A3:A7,B9)",
    );
  });
});

describe("formatAst", () => {
  function roundTrip(source: string): string {
    const parsed = parseFormula(source);
    if (!parsed.ok) throw new Error(`${source}: ${parsed.error.message}`);
    return formatAst(parsed.ast);
  }

  it("drops parentheses the tree shape already records", () => {
    expect(roundTrip("(1+2)*3")).toBe("(1+2)*3");
    expect(roundTrip("1+(2*3)")).toBe("1+2*3");
    expect(roundTrip("((A1))")).toBe("A1");
  });

  it("keeps the parentheses that change the answer", () => {
    expect(roundTrip("1-(2-3)")).toBe("1-(2-3)");
    expect(roundTrip("1-2-3")).toBe("1-2-3");
    expect(roundTrip("8/(4/2)")).toBe("8/(4/2)");
    expect(roundTrip("(2^3)^2")).toBe("(2^3)^2");
    expect(roundTrip("2^3^2")).toBe("2^3^2");
  });

  it("keeps unary and percent binding right", () => {
    expect(roundTrip("-2^2")).toBe("-2^2");
    expect(roundTrip("(-2)^2")).toBe("(-2)^2");
    expect(roundTrip("-(1+2)")).toBe("-(1+2)");
    expect(roundTrip("(1+2)%")).toBe("(1+2)%");
    expect(roundTrip("-5%")).toBe("-5%");
  });

  it("re-quotes strings and doubles the quote inside", () => {
    expect(roundTrip('"say ""hi"""')).toBe('"say ""hi"""');
    expect(roundTrip("'it''s'")).toBe('"it\'s"');
  });

  it("writes booleans, errors and names as typed", () => {
    expect(roundTrip("TRUE")).toBe("TRUE");
    expect(roundTrip("#N/A")).toBe("#N/A");
    expect(roundTrip("Revenue")).toBe("Revenue");
  });

  it("normalises a bare column ref to the explicit form", () => {
    expect(roundTrip("A*2")).toBe("A:A*2");
    expect(roundTrip("SUM(A)")).toBe("SUM(A:A)");
  });

  it("keeps every dollar sign", () => {
    expect(roundTrip("$A$1+A$2+$A3")).toBe("$A$1+A$2+$A3");
    expect(roundTrip("$A:$C")).toBe("$A:$C");
  });

  it("round-trips through the parser unchanged", () => {
    const sources = [
      "1+2*3",
      "(1+2)*3",
      "1-(2-3)",
      "2^3^2",
      "(2^3)^2",
      "-2^2",
      "SUM(A1:A10,B:B,[Total Cost])",
      'IF(A1>=10,"big","small")',
      "A1&B1&\"x\"",
      "-(1+2)%",
      "ROUND(1.5,0)",
      "1e3+0.5",
    ];
    for (const source of sources) {
      const once = roundTrip(source);
      expect(roundTrip(once), source).toBe(once);
    }
  });

  it("evaluates to the same shape after a rewrite that changed nothing structural", () => {
    expect(rewrite("SUM(A1:A3)*2", { type: "insert-rows", at: 0, count: 1 })).toBe(
      "SUM(A2:A4)*2",
    );
  });
});
