import { describe, expect, it } from "vitest";

import {
  MAX_FORMULA_LENGTH,
  MAX_ROW_NUMBER,
  tokenize,
  type Token,
} from "./tokenizer";
import { MAX_COLUMN_INDEX, type FormulaParseError } from "./types";

function lex(source: string): Token[] {
  const result = tokenize(source);
  if (!result.ok) {
    throw new Error(
      `expected tokens for ${JSON.stringify(source)}, got ${result.error.code}: ${result.error.message}`,
    );
  }
  return result.tokens;
}

function lexError(source: string): FormulaParseError {
  const result = tokenize(source);
  if (result.ok) {
    throw new Error(
      `expected an error for ${JSON.stringify(source)}, got ${result.tokens.length} tokens`,
    );
  }
  return result.error;
}

function types(source: string): string[] {
  return lex(source).map((token) => token.type);
}

function cell(
  row: number,
  col: number,
  rowAbsolute = false,
  colAbsolute = false,
) {
  return { row, col, rowAbsolute, colAbsolute };
}

describe("whitespace and empty input", () => {
  it("produces no tokens for an empty or blank formula", () => {
    expect(lex("")).toEqual([]);
    expect(lex("   \t\n ")).toEqual([]);
  });

  it("skips whitespace between tokens and keeps true offsets", () => {
    const tokens = lex("  A1  +  2 ");
    expect(tokens.map((t) => [t.type, t.start, t.end])).toEqual([
      ["ref", 2, 4],
      ["operator", 6, 7],
      ["number", 9, 10],
    ]);
  });
});

describe("numbers", () => {
  it("reads integers, decimals and a leading dot", () => {
    expect(lex("1")).toEqual([
      { type: "number", value: 1, text: "1", start: 0, end: 1 },
    ]);
    expect(lex("3.14")[0]).toMatchObject({ type: "number", value: 3.14 });
    expect(lex(".5")[0]).toMatchObject({ type: "number", value: 0.5, text: ".5" });
    expect(lex("5.")[0]).toMatchObject({ type: "number", value: 5, text: "5." });
    expect(lex("0")[0]).toMatchObject({ type: "number", value: 0 });
  });

  it("reads scientific notation", () => {
    expect(lex("1e3")[0]).toMatchObject({ type: "number", value: 1000 });
    expect(lex("1.5E-3")[0]).toMatchObject({ type: "number", value: 0.0015 });
    expect(lex("2E+2")[0]).toMatchObject({ type: "number", value: 200 });
  });

  it("stops the exponent when no digits follow, leaving a ref behind", () => {
    // "1e" is the number 1 and then column E, which the parser rejects.
    expect(types("1e")).toEqual(["number", "ref"]);
  });

  it("rejects a number that cannot be represented", () => {
    const error = lexError("1e999");
    expect(error.code).toBe("invalid-number");
    expect(error.start).toBe(0);
    expect(error.end).toBe(5);
  });

  it("does not merge a second decimal point into one number", () => {
    const tokens = lex("2.5.5");
    expect(tokens.map((t) => t.type)).toEqual(["number", "number"]);
    expect(tokens[0]).toMatchObject({ value: 2.5 });
    expect(tokens[1]).toMatchObject({ value: 0.5 });
  });

  it("treats a lone dot as an unknown character", () => {
    expect(lexError(".").code).toBe("unexpected-character");
  });
});

describe("strings", () => {
  it("reads both quote styles", () => {
    expect(lex('"hi"')[0]).toMatchObject({ type: "string", value: "hi" });
    expect(lex("'hi'")[0]).toMatchObject({ type: "string", value: "hi" });
  });

  it("escapes the closing quote by doubling it", () => {
    expect(lex('"say ""hi"""')[0]).toMatchObject({
      type: "string",
      value: 'say "hi"',
    });
    expect(lex("'it''s'")[0]).toMatchObject({ type: "string", value: "it's" });
  });

  it("leaves the other quote style alone inside a string", () => {
    expect(lex("\"it's\"")[0]).toMatchObject({ type: "string", value: "it's" });
    expect(lex("'say \"hi\"'")[0]).toMatchObject({
      type: "string",
      value: 'say "hi"',
    });
  });

  it("does not treat a backslash as an escape", () => {
    expect(lex('"C:\\temp"')[0]).toMatchObject({
      type: "string",
      value: "C:\\temp",
    });
  });

  it("reads the empty string", () => {
    expect(lex('""')[0]).toMatchObject({ type: "string", value: "" });
  });

  it("keeps operators and refs inert inside a string", () => {
    expect(types('"A1+B2"')).toEqual(["string"]);
  });

  it("reports an unterminated string with a span to the end", () => {
    const error = lexError('"hi');
    expect(error.code).toBe("unterminated-string");
    expect(error).toMatchObject({ start: 0, end: 3 });
  });

  it("reports a trailing doubled quote as unterminated", () => {
    // The final `""` is an escaped quote, so the string never closes.
    expect(lexError('"a""').code).toBe("unterminated-string");
  });
});

describe("booleans", () => {
  it("reads TRUE and FALSE in any case", () => {
    expect(lex("TRUE")[0]).toMatchObject({ type: "boolean", value: true });
    expect(lex("false")[0]).toMatchObject({ type: "boolean", value: false });
    expect(lex("TrUe")[0]).toMatchObject({ type: "boolean", value: true });
  });

  it("yields to a call so a TRUE() function can exist later", () => {
    expect(lex("TRUE()")[0]).toMatchObject({ type: "identifier", name: "TRUE" });
  });
});

describe("operators and punctuation", () => {
  it("reads every single character operator", () => {
    for (const op of ["+", "-", "*", "/", "^", "%", "&", "=", "<", ">"]) {
      expect(lex(op)).toEqual([
        { type: "operator", op, text: op, start: 0, end: 1 },
      ]);
    }
  });

  it("prefers the two character comparisons", () => {
    expect(lex("A1<>B1").map((t) => t.type)).toEqual([
      "ref",
      "operator",
      "ref",
    ]);
    expect(lex("A1<>B1")[1]).toMatchObject({ op: "<>", start: 2, end: 4 });
    expect(lex("1<=2")[1]).toMatchObject({ op: "<=" });
    expect(lex("1>=2")[1]).toMatchObject({ op: ">=" });
  });

  it("does not merge unrelated neighbours", () => {
    expect(lex("1<-2").map((t) => (t.type === "operator" ? t.op : t.type))).toEqual(
      ["number", "<", "-", "number"],
    );
  });

  it("reads parens, commas and a stray colon", () => {
    expect(types("(,)")).toEqual(["lparen", "comma", "rparen"]);
    expect(types("A1 : B1")).toEqual(["ref", "colon", "ref"]);
  });

  it("keeps the leading equals sign as an operator token", () => {
    expect(types("=A1+B2")).toEqual(["operator", "ref", "operator", "ref"]);
  });
});

describe("cell references", () => {
  it("reads a plain ref", () => {
    expect(lex("A1")[0]).toEqual({
      type: "ref",
      ref: { kind: "cell", addr: cell(0, 0) },
      text: "A1",
      start: 0,
      end: 2,
    });
  });

  it("keeps every mix of absolute markers", () => {
    expect(lex("$A$1")[0]).toMatchObject({
      ref: { kind: "cell", addr: cell(0, 0, true, true) },
    });
    expect(lex("A$1")[0]).toMatchObject({
      ref: { kind: "cell", addr: cell(0, 0, true, false) },
    });
    expect(lex("$A1")[0]).toMatchObject({
      ref: { kind: "cell", addr: cell(0, 0, false, true) },
    });
  });

  it("is case insensitive and 0-based internally", () => {
    expect(lex("b3")[0]).toMatchObject({
      ref: { kind: "cell", addr: cell(2, 1) },
    });
    expect(lex("AA10")[0]).toMatchObject({
      ref: { kind: "cell", addr: cell(9, 26) },
    });
  });

  it("reaches the last supported cell", () => {
    expect(lex(`ZZZ${MAX_ROW_NUMBER}`)[0]).toMatchObject({
      ref: { kind: "cell", addr: cell(MAX_ROW_NUMBER - 1, MAX_COLUMN_INDEX) },
    });
  });

  it("rejects row 0, which A1 notation has no name for", () => {
    const error = lexError("A0");
    expect(error.code).toBe("invalid-reference");
    expect(error.message).toMatch(/start at 1/);
    expect(error).toMatchObject({ start: 0, end: 2 });
  });

  it("rejects a row past the last row", () => {
    expect(lexError(`A${MAX_ROW_NUMBER + 1}`).code).toBe("invalid-reference");
  });

  it("treats a longer word as a word, not a ref plus a tail", () => {
    expect(lex("AB12CD")).toEqual([
      { type: "identifier", name: "AB12CD", text: "AB12CD", start: 0, end: 6 },
    ]);
    // Four letters is past the ZZZ ceiling, so this is a name, not a ref.
    expect(lex("ZZZZ1")[0]).toMatchObject({ type: "identifier", name: "ZZZZ1" });
  });
});

describe("ranges", () => {
  it("reads a cell range", () => {
    expect(lex("A1:B10")[0]).toEqual({
      type: "ref",
      ref: { kind: "range", from: cell(0, 0), to: cell(9, 1) },
      text: "A1:B10",
      start: 0,
      end: 6,
    });
  });

  it("keeps absolute markers on both ends", () => {
    expect(lex("$A$1:B$10")[0]).toMatchObject({
      ref: {
        kind: "range",
        from: cell(0, 0, true, true),
        to: cell(9, 1, true, false),
      },
    });
  });

  it("does not normalise a backwards range", () => {
    expect(lex("B10:A1")[0]).toMatchObject({
      ref: { kind: "range", from: cell(9, 1), to: cell(0, 0) },
    });
  });

  it("will not swallow a trailing word into the second end", () => {
    expect(types("A1:B2CD")).toEqual(["ref", "colon", "identifier"]);
  });

  it("rejects a range built on an impossible row", () => {
    expect(lexError("A0:B2").code).toBe("invalid-reference");
    expect(lexError("A1:B0").code).toBe("invalid-reference");
  });
});

describe("whole column references", () => {
  it("reads a column range", () => {
    expect(lex("A:C")[0]).toEqual({
      type: "ref",
      ref: {
        kind: "column",
        from: { col: 0, absolute: false },
        to: { col: 2, absolute: false },
      },
      text: "A:C",
      start: 0,
      end: 3,
    });
    expect(lex("$A:$C")[0]).toMatchObject({
      ref: {
        kind: "column",
        from: { col: 0, absolute: true },
        to: { col: 2, absolute: true },
      },
    });
  });

  it("reads a bare column letter as the whole column", () => {
    const bare = lex("A")[0];
    const spelled = lex("A:A")[0];
    expect(bare).toMatchObject({
      type: "ref",
      ref: {
        kind: "column",
        from: { col: 0, absolute: false },
        to: { col: 0, absolute: false },
      },
    });
    expect(bare.type === "ref" && bare.ref).toEqual(
      spelled.type === "ref" && spelled.ref,
    );
  });

  it("keeps the absolute marker on a bare column", () => {
    expect(lex("$B")[0]).toMatchObject({
      ref: {
        kind: "column",
        from: { col: 1, absolute: true },
        to: { col: 1, absolute: true },
      },
    });
  });

  it("does not read a cell as a column range", () => {
    // A:A1 is not a column range, so the tail stays separate for the parser.
    expect(types("A:A1")).toEqual(["ref", "colon", "ref"]);
  });
});

describe("header references", () => {
  it("reads a bracketed header name verbatim", () => {
    expect(lex("[Total Cost]")[0]).toEqual({
      type: "ref",
      ref: { kind: "header", name: "Total Cost" },
      text: "[Total Cost]",
      start: 0,
      end: 12,
    });
  });

  it("does not trim, because a header may really have spaces", () => {
    expect(lex("[ Total ]")[0]).toMatchObject({
      ref: { kind: "header", name: " Total " },
    });
  });

  it("escapes a closing bracket by doubling it", () => {
    expect(lex("[Total ]] Cost]")[0]).toMatchObject({
      ref: { kind: "header", name: "Total ] Cost" },
    });
  });

  it("allows punctuation that would otherwise be operators", () => {
    expect(lex("[Cost (USD) + tax]")[0]).toMatchObject({
      ref: { kind: "header", name: "Cost (USD) + tax" },
    });
  });

  it("rejects an empty name", () => {
    const error = lexError("[]");
    expect(error.code).toBe("empty-header");
    expect(error).toMatchObject({ start: 0, end: 2 });
  });

  it("rejects an unterminated bracket", () => {
    expect(lexError("[Total").code).toBe("unterminated-header");
  });

  it("sits beside arithmetic", () => {
    expect(types("[Price]*[Qty]")).toEqual(["ref", "operator", "ref"]);
  });

  it("is the only way to reach a non-ASCII header", () => {
    expect(lex("[Coût café]")[0]).toMatchObject({
      ref: { kind: "header", name: "Coût café" },
    });
    expect(lexError("Coût").code).toBe("unexpected-character");
  });
});

describe("error literals", () => {
  it("reads every error code the engine can raise", () => {
    for (const code of ["#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#CYCLE!", "#N/A"]) {
      expect(lex(code)[0]).toMatchObject({ type: "error", value: code });
    }
  });

  it("prefers the longest matching code", () => {
    expect(lex("#NAME?")[0]).toMatchObject({ value: "#NAME?" });
  });

  it("rejects an unknown code", () => {
    const error = lexError("#FOO");
    expect(error.code).toBe("unexpected-character");
    expect(error).toMatchObject({ start: 0, end: 1 });
  });
});

describe("function names versus references", () => {
  it("reads a call name that is not ref shaped", () => {
    expect(lex("SUMIF(A1)").map((t) => t.type)).toEqual([
      "identifier",
      "lparen",
      "ref",
      "rparen",
    ]);
  });

  it("reads a ref shaped name as a call when it is called", () => {
    expect(lex("SUM(A1)")[0]).toMatchObject({ type: "identifier", name: "SUM" });
    expect(lex("LOG10(2)")[0]).toMatchObject({
      type: "identifier",
      name: "LOG10",
    });
    expect(lex("IF(A1,1,2)")[0]).toMatchObject({ type: "identifier", name: "IF" });
  });

  it("tolerates a space before the parenthesis", () => {
    expect(lex("SUM (A1)")[0]).toMatchObject({ type: "identifier", name: "SUM" });
  });

  it("reads the same word as a column reference when it is not called", () => {
    // Column SUM is index 13402. Harmless: the evaluator answers #REF! for a
    // column a table does not have.
    expect(lex("SUM")[0]).toMatchObject({
      type: "ref",
      ref: {
        kind: "column",
        from: { col: 13402, absolute: false },
        to: { col: 13402, absolute: false },
      },
    });
  });

  it("never treats an absolute word as a call name", () => {
    expect(types("$A$1(2)")).toEqual(["ref", "lparen", "number", "rparen"]);
  });

  it("keeps the raw case of a name for the parser to normalise", () => {
    expect(lex("sum(A1)")[0]).toMatchObject({ name: "sum" });
  });

  it("reads an unknown bare word as a name", () => {
    expect(lex("Revenue")[0]).toEqual({
      type: "identifier",
      name: "Revenue",
      text: "Revenue",
      start: 0,
      end: 7,
    });
    expect(lex("_hidden")[0]).toMatchObject({ type: "identifier" });
  });
});

describe("unknown input", () => {
  it("reports the offending character and its position", () => {
    for (const [source, at] of [
      ["@", 0],
      ["1;2", 1],
      ["A1 { B1", 3],
      ["1\\2", 1],
      ["A1!B1", 2],
    ] as const) {
      const error = lexError(source);
      expect(error.code).toBe("unexpected-character");
      expect(error.start).toBe(at);
      expect(error.end).toBe(at + 1);
    }
  });

  it("never silently skips a character it cannot read", () => {
    expect(lexError("1 ~ 2").code).toBe("unexpected-character");
  });

  it("rejects a lone dollar sign", () => {
    expect(lexError("$5").code).toBe("unexpected-character");
    expect(lexError("$").code).toBe("unexpected-character");
  });

  it("refuses a formula past the length ceiling before scanning it", () => {
    const error = lexError("a".repeat(MAX_FORMULA_LENGTH + 1));
    expect(error.code).toBe("formula-too-long");
    expect(error.start).toBe(0);
    // One character under the ceiling still lexes, so the limit is not off by one.
    const atLimit = `1${"+1".repeat((MAX_FORMULA_LENGTH - 1) / 2)}`;
    expect(atLimit).toHaveLength(MAX_FORMULA_LENGTH - 1);
    expect(lex(atLimit)).toHaveLength(MAX_FORMULA_LENGTH - 1);
  });
});

describe("spans", () => {
  it("covers the source exactly, with gaps only where whitespace was", () => {
    const source = '=IF([Total Cost]>=100,"big",A1:B2)';
    for (const token of lex(source)) {
      expect(source.slice(token.start, token.end)).toBe(token.text);
    }
  });
});
