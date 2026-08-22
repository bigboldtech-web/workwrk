import { describe, expect, it } from "vitest";

import { MAX_ARGUMENTS, MAX_PARSE_DEPTH, parseFormula, parseTokens } from "./parser";
import { tokenize } from "./tokenizer";
import type { Ast, FormulaParseError } from "./types";

/** Drops source spans so a test can assert the tree shape exactly. */
function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "start" || key === "end") continue;
      out[key] = strip(value);
    }
    return out;
  }
  return node;
}

function tree(source: string): unknown {
  const result = parseFormula(source);
  if (!result.ok) {
    throw new Error(
      `expected a tree for ${JSON.stringify(source)}, got ${result.error.code}: ${result.error.message}`,
    );
  }
  return strip(result.ast);
}

function raw(source: string): Ast {
  const result = parseFormula(source);
  if (!result.ok) throw new Error(`expected a tree, got ${result.error.code}`);
  return result.ast;
}

function parseError(source: string): FormulaParseError {
  const result = parseFormula(source);
  if (result.ok) {
    throw new Error(
      `expected an error for ${JSON.stringify(source)}, got a tree`,
    );
  }
  return result.error;
}

const num = (value: number) => ({ type: "number", value });
const str = (value: string) => ({ type: "string", value });
const bin = (op: string, left: unknown, right: unknown) => ({
  type: "binary",
  op,
  left,
  right,
});
const neg = (operand: unknown) => ({ type: "unary", op: "-", operand });
const pct = (operand: unknown) => ({ type: "percent", operand });

describe("literals", () => {
  it("parses each literal kind", () => {
    expect(tree("42")).toEqual(num(42));
    expect(tree('"hi"')).toEqual(str("hi"));
    expect(tree("TRUE")).toEqual({ type: "boolean", value: true });
    expect(tree("#N/A")).toEqual({ type: "error", value: "#N/A" });
  });

  it("parses a bare unknown word as a name for the evaluator to resolve", () => {
    expect(tree("Revenue")).toEqual({ type: "name", name: "Revenue" });
  });
});

describe("precedence", () => {
  it("multiplies before it adds", () => {
    expect(tree("2+3*4")).toEqual(bin("+", num(2), bin("*", num(3), num(4))));
  });

  it("lets parentheses override, without leaving a node behind", () => {
    expect(tree("(2+3)*4")).toEqual(bin("*", bin("+", num(2), num(3)), num(4)));
    expect(tree("(42)")).toEqual(num(42));
    expect(tree("((42))")).toEqual(num(42));
  });

  it("binds power tighter than unary minus", () => {
    // Locked by the Phase 3 brief. Excel disagrees and reads this as 4.
    expect(tree("-2^2")).toEqual(neg(bin("^", num(2), num(2))));
  });

  it("binds percent tightest", () => {
    expect(tree("50%*2")).toEqual(bin("*", pct(num(50)), num(2)));
    expect(tree("-50%")).toEqual(neg(pct(num(50))));
    expect(tree("2^50%")).toEqual(bin("^", num(2), pct(num(50))));
    expect(tree("50%%")).toEqual(pct(pct(num(50))));
  });

  it("puts concatenation below arithmetic and above comparison", () => {
    expect(tree("1+2&3")).toEqual(bin("&", bin("+", num(1), num(2)), num(3)));
    expect(tree("1&2=3")).toEqual(bin("=", bin("&", num(1), num(2)), num(3)));
  });

  it("puts comparison lowest of all", () => {
    expect(tree("1+1=2")).toEqual(bin("=", bin("+", num(1), num(1)), num(2)));
    expect(tree("2*3>5")).toEqual(bin(">", bin("*", num(2), num(3)), num(5)));
  });

  it("stacks the whole ladder in one expression", () => {
    expect(tree("1+2*3^2&4=5")).toEqual(
      bin(
        "=",
        bin(
          "&",
          bin("+", num(1), bin("*", num(2), bin("^", num(3), num(2)))),
          num(4),
        ),
        num(5),
      ),
    );
  });
});

describe("associativity", () => {
  it("is left associative for additive, multiplicative and concat", () => {
    expect(tree("10-3-2")).toEqual(bin("-", bin("-", num(10), num(3)), num(2)));
    expect(tree("8/4/2")).toEqual(bin("/", bin("/", num(8), num(4)), num(2)));
    expect(tree('"a"&"b"&"c"')).toEqual(
      bin("&", bin("&", str("a"), str("b")), str("c")),
    );
  });

  it("is left associative for comparison chains", () => {
    expect(tree("1<2<3")).toEqual(bin("<", bin("<", num(1), num(2)), num(3)));
    expect(tree("1<>2=3")).toEqual(bin("=", bin("<>", num(1), num(2)), num(3)));
  });

  it("is right associative for power", () => {
    // Locked by the Phase 3 brief. Excel disagrees and reads this as (2^3)^2.
    expect(tree("2^3^2")).toEqual(bin("^", num(2), bin("^", num(3), num(2))));
  });

  it("accepts a signed power operand without losing right associativity", () => {
    expect(tree("2^-3")).toEqual(bin("^", num(2), neg(num(3))));
    expect(tree("2^-3^2")).toEqual(
      bin("^", num(2), neg(bin("^", num(3), num(2)))),
    );
  });
});

describe("unary operators", () => {
  it("stacks prefixes", () => {
    expect(tree("--5")).toEqual(neg(neg(num(5))));
    expect(tree("-+5")).toEqual(neg({ type: "unary", op: "+", operand: num(5) }));
  });

  it("reads a sign after a binary operator", () => {
    expect(tree("2*-3")).toEqual(bin("*", num(2), neg(num(3))));
    expect(tree("2--3")).toEqual(bin("-", num(2), neg(num(3))));
  });
});

describe("references", () => {
  it("carries every ref form through to the tree", () => {
    expect(tree("A1")).toEqual({
      type: "ref",
      ref: {
        kind: "cell",
        addr: { row: 0, col: 0, rowAbsolute: false, colAbsolute: false },
      },
    });
    expect(tree("$A$1")).toEqual({
      type: "ref",
      ref: {
        kind: "cell",
        addr: { row: 0, col: 0, rowAbsolute: true, colAbsolute: true },
      },
    });
    expect(tree("A1:B10")).toMatchObject({ type: "ref", ref: { kind: "range" } });
    expect(tree("A:C")).toMatchObject({ type: "ref", ref: { kind: "column" } });
    expect(tree("[Total Cost]")).toEqual({
      type: "ref",
      ref: { kind: "header", name: "Total Cost" },
    });
  });

  it("mixes refs into arithmetic", () => {
    expect(tree("A1+$B$2")).toMatchObject({
      type: "binary",
      op: "+",
      left: { type: "ref", ref: { kind: "cell" } },
      right: { type: "ref", ref: { kind: "cell" } },
    });
    expect(tree("[Price]*[Qty]")).toEqual(
      bin(
        "*",
        { type: "ref", ref: { kind: "header", name: "Price" } },
        { type: "ref", ref: { kind: "header", name: "Qty" } },
      ),
    );
  });

  it("keeps today's column formula shape working", () => {
    // `A*2` is how column formulas are written now, and it must still parse.
    expect(tree("A*2")).toEqual(
      bin(
        "*",
        {
          type: "ref",
          ref: {
            kind: "column",
            from: { col: 0, absolute: false },
            to: { col: 0, absolute: false },
          },
        },
        num(2),
      ),
    );
  });
});

describe("function calls", () => {
  it("parses a call with no arguments", () => {
    expect(tree("TODAY()")).toEqual({ type: "call", name: "TODAY", args: [] });
  });

  it("parses an argument list", () => {
    expect(tree("SUM(1,2,3)")).toEqual({
      type: "call",
      name: "SUM",
      args: [num(1), num(2), num(3)],
    });
  });

  it("upper-cases the name so the registry can be a plain map", () => {
    expect(tree("sum(1)")).toMatchObject({ name: "SUM" });
    expect(tree("If(1,2,3)")).toMatchObject({ name: "IF" });
  });

  it("takes a range as an argument", () => {
    expect(tree("SUM(A1:A10)")).toMatchObject({
      type: "call",
      name: "SUM",
      args: [{ type: "ref", ref: { kind: "range" } }],
    });
    expect(tree("SUM(A:A)")).toMatchObject({
      args: [{ type: "ref", ref: { kind: "column" } }],
    });
    expect(tree("SUM([Total Cost])")).toMatchObject({
      args: [{ type: "ref", ref: { kind: "header", name: "Total Cost" } }],
    });
  });

  it("nests calls inside calls and inside expressions", () => {
    expect(tree('IF(AND(A1>0,B1>0),"y","n")')).toEqual({
      type: "call",
      name: "IF",
      args: [
        {
          type: "call",
          name: "AND",
          args: [
            bin(">", { type: "ref", ref: { kind: "cell", addr: { row: 0, col: 0, rowAbsolute: false, colAbsolute: false } } }, num(0)),
            bin(">", { type: "ref", ref: { kind: "cell", addr: { row: 0, col: 1, rowAbsolute: false, colAbsolute: false } } }, num(0)),
          ],
        },
        str("y"),
        str("n"),
      ],
    });
    expect(tree("SUM(A1:A10)+1")).toMatchObject({
      type: "binary",
      op: "+",
      left: { type: "call", name: "SUM" },
    });
    expect(tree("MAX(SUM(1,2),3)")).toMatchObject({
      name: "MAX",
      args: [{ type: "call", name: "SUM" }, num(3)],
    });
  });

  it("accepts a call written with a space before the parenthesis", () => {
    expect(tree("SUM (1,2)")).toMatchObject({ type: "call", name: "SUM" });
  });

  it("accepts exactly the documented argument ceiling", () => {
    const args = Array.from({ length: MAX_ARGUMENTS }, () => "1").join(",");
    expect(tree(`SUM(${args})`)).toMatchObject({ args: { length: MAX_ARGUMENTS } });
  });

  it("rejects one argument past the ceiling", () => {
    const args = Array.from({ length: MAX_ARGUMENTS + 1 }, () => "1").join(",");
    expect(parseError(`SUM(${args})`).code).toBe("too-many-arguments");
  });
});

describe("the leading equals sign", () => {
  it("is optional, because stored formulas have no prefix", () => {
    expect(tree("=A1+B2")).toEqual(tree("A1+B2"));
    expect(tree("=  A1")).toEqual(tree("A1"));
  });

  it("only sheds the first one", () => {
    expect(parseError("==A1").code).toBe("unexpected-token");
  });

  it("does not eat a comparison in the middle", () => {
    expect(tree("A1=B1")).toMatchObject({ type: "binary", op: "=" });
    expect(tree("=A1=B1")).toMatchObject({ type: "binary", op: "=" });
  });

  it("leaves source offsets pointing at the original text", () => {
    const ast = raw("=A1+B2");
    expect(ast).toMatchObject({ type: "binary", start: 1, end: 6 });
    if (ast.type !== "binary") throw new Error("expected a binary node");
    expect(ast.left).toMatchObject({ start: 1, end: 3 });
    expect(ast.right).toMatchObject({ start: 4, end: 6 });
  });
});

describe("source spans", () => {
  it("spans a call from its name to its closing parenthesis", () => {
    const ast = raw("SUM(A1:A10)");
    expect(ast).toMatchObject({ type: "call", start: 0, end: 11 });
  });

  it("spans a ref exactly, for editor highlighting", () => {
    const ast = raw("1+[Total Cost]");
    if (ast.type !== "binary") throw new Error("expected a binary node");
    expect(ast.right).toMatchObject({ start: 2, end: 14 });
  });

  it("spans a percent through its operator", () => {
    expect(raw("50%")).toMatchObject({ type: "percent", start: 0, end: 3 });
  });
});

describe("malformed input", () => {
  it("reports an empty formula", () => {
    expect(parseError("").code).toBe("empty-formula");
    expect(parseError("   ").code).toBe("empty-formula");
    expect(parseError("=").code).toBe("empty-formula");
  });

  it("reports a dangling operator", () => {
    const error = parseError("1+");
    expect(error.code).toBe("unexpected-end");
    expect(error).toMatchObject({ start: 2, end: 2 });
    expect(parseError("1+2*").code).toBe("unexpected-end");
    expect(parseError("-").code).toBe("unexpected-end");
  });

  it("does not accept percent as a binary operator", () => {
    expect(parseError("1%2").code).toBe("unexpected-token");
  });

  it("reports an operator with nothing on its left", () => {
    expect(parseError("*3").code).toBe("unexpected-token");
    expect(parseError("%3").code).toBe("unexpected-token");
    expect(parseError(",1").code).toBe("unexpected-token");
  });

  it("reports unbalanced parentheses on the side that is missing", () => {
    expect(parseError("(1").code).toBe("missing-closing-paren");
    expect(parseError("(1+2").code).toBe("missing-closing-paren");
    expect(parseError("SUM(1").code).toBe("missing-closing-paren");
    expect(parseError("1)").code).toBe("unexpected-token");
    expect(parseError("(1 2)").code).toBe("missing-closing-paren");
  });

  it("reports an omitted argument instead of shifting the rest along", () => {
    expect(parseError("IF(A1,,1)").code).toBe("empty-argument");
    expect(parseError("SUM(1,)").code).toBe("empty-argument");
    expect(parseError("SUM(,1)").code).toBe("empty-argument");
    expect(parseError("SUM(,)").code).toBe("empty-argument");
  });

  it("reports two arguments with no separator", () => {
    const error = parseError("SUM(1 2)");
    expect(error.code).toBe("unexpected-token");
    expect(error.message).toMatch(/Expected ',' or '\)'/);
  });

  it("reports two expressions with no operator", () => {
    const error = parseError("1 2");
    expect(error.code).toBe("unexpected-token");
    expect(error).toMatchObject({ start: 2, end: 3 });
    expect(parseError("A1 B1").code).toBe("unexpected-token");
  });

  it("explains a range written with spaces", () => {
    for (const source of ["A1 : B1", "SUM(A1 : B1)", "SUM(:)"]) {
      const error = parseError(source);
      expect(error.code).toBe("invalid-range");
      expect(error.message).toMatch(/without spaces/);
    }
  });

  it("passes lexer failures straight through", () => {
    expect(parseError("1@2").code).toBe("unexpected-character");
    expect(parseError('"unclosed').code).toBe("unterminated-string");
    expect(parseError("[").code).toBe("unterminated-header");
    expect(parseError("A0").code).toBe("invalid-reference");
    expect(parseError("SUM(#WAT)").code).toBe("unexpected-character");
  });

  it("never returns a partial tree with an error", () => {
    const result = parseFormula("SUM(1,");
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("ast");
  });

  it("never returns an error alongside a tree", () => {
    const result = parseFormula("SUM(1,2)");
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("error");
  });

  it("always reports a span inside the source", () => {
    for (const source of ["1+", "(1", "SUM(1 2)", "1 2", "@", "A0", ""]) {
      const error = parseError(source);
      expect(error.start).toBeGreaterThanOrEqual(0);
      expect(error.end).toBeGreaterThanOrEqual(error.start);
      expect(error.end).toBeLessThanOrEqual(Math.max(source.length, 1));
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});

describe("nesting depth", () => {
  it("parses deep but reasonable nesting", () => {
    const depth = 60;
    const source = `${"(".repeat(depth)}1${")".repeat(depth)}`;
    expect(tree(source)).toEqual(num(1));

    let calls = "1";
    for (let i = 0; i < 30; i++) calls = `ABS(${calls})`;
    expect(tree(calls)).toMatchObject({ type: "call", name: "ABS" });
  });

  it("refuses runaway parentheses instead of overflowing the stack", () => {
    const depth = MAX_PARSE_DEPTH + 10;
    const source = `${"(".repeat(depth)}1${")".repeat(depth)}`;
    expect(parseError(source).code).toBe("nesting-too-deep");
  });

  it("refuses a runaway prefix run", () => {
    expect(parseError(`${"-".repeat(1000)}1`).code).toBe("nesting-too-deep");
  });

  it("refuses a runaway power chain", () => {
    expect(parseError(`${"2^".repeat(1000)}2`).code).toBe("nesting-too-deep");
  });

  it("refuses runaway call nesting", () => {
    let source = "1";
    for (let i = 0; i < MAX_PARSE_DEPTH + 10; i++) source = `ABS(${source})`;
    expect(parseError(source).code).toBe("nesting-too-deep");
  });

  it("does not recurse on a long flat chain", () => {
    // Left associative loops, not recursion, so length is not depth.
    const source = Array.from({ length: 1000 }, (_, i) => i).join("+");
    expect(parseFormula(source).ok).toBe(true);
  });
});

describe("parseTokens", () => {
  it("parses tokens produced elsewhere", () => {
    const lexed = tokenize("1+2");
    if (!lexed.ok) throw new Error("expected tokens");
    const result = parseTokens(lexed.tokens);
    expect(result.ok).toBe(true);
    expect(result.ok && strip(result.ast)).toEqual(bin("+", num(1), num(2)));
  });

  it("does not strip a leading equals sign of its own", () => {
    const lexed = tokenize("=1");
    if (!lexed.ok) throw new Error("expected tokens");
    expect(parseTokens(lexed.tokens).ok).toBe(false);
  });

  it("reports an empty token list", () => {
    const result = parseTokens([]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("empty-formula");
  });
});

describe("robustness", () => {
  it("returns a result and never throws, for any garbage", () => {
    // Deterministic LCG so a failure is reproducible.
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pool = "=+-*/^%&<>()[],:\"'#$ABZaz019 .\t\\@;{}";
    for (let n = 0; n < 2000; n++) {
      const length = 1 + Math.floor(rand() * 24);
      let source = "";
      for (let i = 0; i < length; i++) {
        source += pool[Math.floor(rand() * pool.length)];
      }
      const result = parseFormula(source);
      expect(typeof result.ok).toBe("boolean");
      if (!result.ok) {
        expect(typeof result.error.code).toBe("string");
        expect(Number.isInteger(result.error.start)).toBe(true);
        expect(Number.isInteger(result.error.end)).toBe(true);
        expect(result.error.end).toBeGreaterThanOrEqual(result.error.start);
      }
    }
  });
});
