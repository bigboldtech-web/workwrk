// Recursive-descent parser for the Tables formula grammar. Pure: no React, no
// DOM, no I/O, and it never throws into the caller. Every failure comes back
// as a `FormulaParseError` with source offsets, and a failed parse returns no
// tree at all, never a half-built one.
//
// PRECEDENCE, lowest binding to highest:
//
//   comparison   =  <>  <  <=  >  >=     left associative
//   concat       &                       left associative
//   additive     +  -                    left associative
//   multiplic.   *  /                    left associative
//   unary        -x  +x                  prefix
//   power        ^                       RIGHT associative
//   percent      x%                      postfix
//
// Two rungs of that ladder are locked by the Phase 3 brief and differ from
// Excel and Google Sheets, deliberately:
//   1. Unary minus binds LOOSER than `^`, so `-2^2` is -4 here and 4 in Excel.
//   2. `^` is right associative, so `2^3^2` is 512 here and 64 in Excel.
// Both follow ordinary mathematical convention. Flag this to the user before
// the UI wave if Excel muscle memory is judged to matter more.
//
// The right operand of `^` is parsed as a unary expression, so `2^-3` works
// without disturbing the right associativity of `2^3^2`.
//
// A LEADING `=` IS ACCEPTED here and is optional. Stored formulas live as
// `{ "=": "A1+B2" }` with no prefix, while a user types `=A1+B2`, and both must
// parse. Source offsets stay relative to the ORIGINAL string, the `=` is
// dropped as a token rather than by slicing the text, so editor highlighting
// lines up either way.
//
// Parentheses produce no node: the tree shape already records grouping.
// Omitted arguments (`IF(A1,,1)`) are rejected rather than silently shifting
// every later argument by one position.

import { tokenize, type Token } from "./tokenizer";
import type {
  Ast,
  BinaryOperator,
  FormulaParseError,
  ParseErrorCode,
  ParseResult,
  UnaryOperator,
} from "./types";

/**
 * Nesting cap. Excel stops at 64 nested functions; this counts every
 * recursive descent (parens, call arguments, prefix runs, `^` chains), and
 * exists so adversarial input returns an error instead of overflowing the
 * JavaScript stack.
 */
export const MAX_PARSE_DEPTH = 128;

/** Excel's own per-call argument ceiling. */
export const MAX_ARGUMENTS = 255;

const RANGE_HINT = "A range is written without spaces, for example A1:B10.";

const COMPARISON_OPERATORS: readonly BinaryOperator[] = [
  "=",
  "<>",
  "<",
  "<=",
  ">",
  ">=",
];
const CONCAT_OPERATORS: readonly BinaryOperator[] = ["&"];
const ADDITIVE_OPERATORS: readonly BinaryOperator[] = ["+", "-"];
const MULTIPLICATIVE_OPERATORS: readonly BinaryOperator[] = ["*", "/"];

class ParseAbort extends Error {
  readonly info: FormulaParseError;

  constructor(info: FormulaParseError) {
    super(info.message);
    this.name = "ParseAbort";
    this.info = info;
  }
}

function describe(token: Token): string {
  switch (token.type) {
    case "number":
      return `number ${token.text}`;
    case "string":
      return `text ${token.text}`;
    case "boolean":
      return `${token.text}`;
    case "error":
      return `error value ${token.text}`;
    case "ref":
      return `reference ${token.text}`;
    case "identifier":
      return `name '${token.text}'`;
    default:
      return `'${token.text}'`;
  }
}

/**
 * Parse an already-lexed formula. `sourceLength` positions end-of-input
 * errors; pass the length of the original string when the tokens came from a
 * source that had a leading `=` stripped.
 */
export function parseTokens(tokens: Token[], sourceLength?: number): ParseResult {
  const endOffset =
    sourceLength ?? (tokens.length > 0 ? tokens[tokens.length - 1].end : 0);

  let pos = 0;
  let depth = 0;

  function fail(
    code: ParseErrorCode,
    message: string,
    start: number,
    end: number,
  ): never {
    throw new ParseAbort({ code, message, start, end });
  }

  function failAt(code: ParseErrorCode, message: string, token?: Token): never {
    if (token) fail(code, message, token.start, token.end);
    fail(code, message, endOffset, endOffset);
  }

  function peek(): Token | undefined {
    return tokens[pos];
  }

  /** `%` is postfix only, so it never answers here. */
  function peekOperator(ops: readonly BinaryOperator[]): BinaryOperator | null {
    const token = tokens[pos];
    if (!token || token.type !== "operator") return null;
    const op = token.op;
    if (op === "%") return null;
    return ops.includes(op) ? op : null;
  }

  function withDepth<T>(parse: () => T): T {
    depth++;
    try {
      if (depth > MAX_PARSE_DEPTH) {
        failAt(
          "nesting-too-deep",
          `This formula nests more than ${MAX_PARSE_DEPTH} levels deep.`,
          peek(),
        );
      }
      return parse();
    } finally {
      depth--;
    }
  }

  function binary(op: BinaryOperator, left: Ast, right: Ast): Ast {
    return { type: "binary", op, left, right, start: left.start, end: right.end };
  }

  function parseComparison(): Ast {
    let left = parseConcat();
    for (;;) {
      const op = peekOperator(COMPARISON_OPERATORS);
      if (!op) return left;
      pos++;
      left = binary(op, left, parseConcat());
    }
  }

  function parseConcat(): Ast {
    let left = parseAdditive();
    for (;;) {
      const op = peekOperator(CONCAT_OPERATORS);
      if (!op) return left;
      pos++;
      left = binary(op, left, parseAdditive());
    }
  }

  function parseAdditive(): Ast {
    let left = parseMultiplicative();
    for (;;) {
      const op = peekOperator(ADDITIVE_OPERATORS);
      if (!op) return left;
      pos++;
      left = binary(op, left, parseMultiplicative());
    }
  }

  function parseMultiplicative(): Ast {
    let left = parseUnary();
    for (;;) {
      const op = peekOperator(MULTIPLICATIVE_OPERATORS);
      if (!op) return left;
      pos++;
      left = binary(op, left, parseUnary());
    }
  }

  function parseUnary(): Ast {
    const token = peek();
    if (token && token.type === "operator" && (token.op === "-" || token.op === "+")) {
      const op: UnaryOperator = token.op;
      pos++;
      const operand = withDepth(parseUnary);
      return { type: "unary", op, operand, start: token.start, end: operand.end };
    }
    return parsePower();
  }

  function parsePower(): Ast {
    const left = parsePostfix();
    const token = peek();
    if (token && token.type === "operator" && token.op === "^") {
      pos++;
      const right = withDepth(parseUnary);
      return binary("^", left, right);
    }
    return left;
  }

  function parsePostfix(): Ast {
    let node = parsePrimary();
    for (;;) {
      const token = peek();
      if (!token || token.type !== "operator" || token.op !== "%") return node;
      pos++;
      node = { type: "percent", operand: node, start: node.start, end: token.end };
    }
  }

  function parseCall(nameToken: Token & { type: "identifier" }): Ast {
    pos++; // the "(" itself
    const args: Ast[] = [];
    const first = peek();
    if (first && first.type === "rparen") {
      pos++;
      return {
        type: "call",
        name: nameToken.name.toUpperCase(),
        args,
        start: nameToken.start,
        end: first.end,
      };
    }
    for (;;) {
      const token = peek();
      if (!token) {
        failAt(
          "missing-closing-paren",
          `'${nameToken.text}(' is never closed.`,
          undefined,
        );
      }
      if (token.type === "comma" || token.type === "rparen") {
        failAt(
          "empty-argument",
          `'${nameToken.text}' is missing an argument here.`,
          token,
        );
      }
      args.push(withDepth(parseComparison));
      if (args.length > MAX_ARGUMENTS) {
        failAt(
          "too-many-arguments",
          `'${nameToken.text}' takes at most ${MAX_ARGUMENTS} arguments.`,
          token,
        );
      }
      const next = peek();
      if (next && next.type === "comma") {
        pos++;
        continue;
      }
      if (next && next.type === "rparen") {
        pos++;
        return {
          type: "call",
          name: nameToken.name.toUpperCase(),
          args,
          start: nameToken.start,
          end: next.end,
        };
      }
      if (!next) {
        failAt(
          "missing-closing-paren",
          `'${nameToken.text}(' is never closed.`,
          undefined,
        );
      }
      if (next.type === "colon") failAt("invalid-range", RANGE_HINT, next);
      failAt(
        "unexpected-token",
        `Expected ',' or ')' in '${nameToken.text}', found ${describe(next)}.`,
        next,
      );
    }
  }

  function parsePrimary(): Ast {
    const token = peek();
    if (!token) {
      failAt("unexpected-end", "The formula ends before it is complete.", undefined);
    }
    switch (token.type) {
      case "number":
        pos++;
        return { type: "number", value: token.value, start: token.start, end: token.end };
      case "string":
        pos++;
        return { type: "string", value: token.value, start: token.start, end: token.end };
      case "boolean":
        pos++;
        return { type: "boolean", value: token.value, start: token.start, end: token.end };
      case "error":
        pos++;
        return { type: "error", value: token.value, start: token.start, end: token.end };
      case "ref":
        pos++;
        return { type: "ref", ref: token.ref, start: token.start, end: token.end };
      case "identifier": {
        pos++;
        const next = peek();
        if (next && next.type === "lparen") return parseCall(token);
        return { type: "name", name: token.name, start: token.start, end: token.end };
      }
      case "lparen": {
        pos++;
        const inner = withDepth(parseComparison);
        const close = peek();
        if (!close) {
          failAt("missing-closing-paren", "This '(' is never closed.", undefined);
        }
        if (close.type !== "rparen") {
          failAt(
            "missing-closing-paren",
            `Expected ')' but found ${describe(close)}.`,
            close,
          );
        }
        pos++;
        return inner;
      }
      case "colon":
        return failAt("invalid-range", RANGE_HINT, token);
      default:
        return failAt("unexpected-token", `Unexpected ${describe(token)}.`, token);
    }
  }

  if (tokens.length === 0) {
    return {
      ok: false,
      error: {
        code: "empty-formula",
        message: "This formula is empty.",
        start: 0,
        end: endOffset,
      },
    };
  }

  try {
    const ast = parseComparison();
    const leftover = peek();
    if (leftover) {
      // `A1 : B1` parses as a complete expression followed by junk, so the
      // range hint has to be reachable from here too, not only from an
      // operand position.
      if (leftover.type === "colon") failAt("invalid-range", RANGE_HINT, leftover);
      failAt(
        "unexpected-token",
        `Unexpected ${describe(leftover)} after the end of the formula.`,
        leftover,
      );
    }
    return { ok: true, ast };
  } catch (error) {
    if (error instanceof ParseAbort) return { ok: false, error: error.info };
    if (error instanceof RangeError) {
      // A stack overflow that slipped past MAX_PARSE_DEPTH still must not
      // reach the caller as an exception.
      return {
        ok: false,
        error: {
          code: "nesting-too-deep",
          message: "This formula is nested too deeply to read.",
          start: 0,
          end: endOffset,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "internal-error",
        message: "Could not read this formula.",
        start: 0,
        end: endOffset,
      },
    };
  }
}

/**
 * Tokenize and parse a formula. The leading `=` is optional; offsets in the
 * returned tree and in any error refer to `source` as given.
 */
export function parseFormula(source: string): ParseResult {
  const lexed = tokenize(source);
  if (!lexed.ok) return { ok: false, error: lexed.error };

  let tokens = lexed.tokens;
  const first = tokens[0];
  if (first && first.type === "operator" && first.op === "=") {
    tokens = tokens.slice(1);
  }
  return parseTokens(tokens, source.length);
}
