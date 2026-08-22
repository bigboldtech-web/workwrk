// Lexer for the Tables formula grammar. Pure: no React, no DOM, no I/O.
//
// It returns a result object and never throws, because the caller is an editor
// keystroke handler where a half-typed formula is the normal case, not an
// exceptional one.
//
// HEADER REFS ARE BRACKETED: `[Total Cost]`.
// A bare word cannot carry that job. Any 1 to 3 letter word is already a
// column ref (`A`, `SUM`, `ZZZ`) and any word followed by `(` is already a
// function call, so an unbracketed header would be ambiguous with both.
// Brackets are unambiguous at the first character, they are the convention
// users know from Excel structured references, and they admit the spaces and
// punctuation that real headers contain. A literal `]` inside a name is
// written by doubling it: `[Total ]] Cost]`. Names are not trimmed, because a
// header may legitimately contain leading or trailing spaces.
//
// STRINGS take either quote, `"a"` or `'a'`, and escape the closing quote by
// doubling it, as spreadsheets do: `"say ""hi"""`, `'it''s'`. There are no
// backslash escapes, so a Windows path pastes in unharmed.
//
// FUNCTION VERSUS REF: a ref-shaped word followed, after optional spaces, by
// `(` is read as a function name. That is what keeps `LOG10(2)` a call rather
// than cell LOG10, and it is why `SUM (A1)` still parses. A word carrying a
// `$` is never a function name.
//
// BARE COLUMN LETTERS are refs, not names: `A` lexes exactly like `A:A`. That
// keeps today's column formulas (`A*2`, `SUM(A)`) expressible, and it matters
// beyond nostalgia, only a Ref is visible to the ref-rewrite pass, so a bare
// letter modelled as a name would silently repoint when a column moved.

import {
  CELL_ERRORS,
  MAX_COLUMN_LABEL_LENGTH,
  parseColumnLabel,
  type BinaryOperator,
  type CellAddress,
  type CellError,
  type ColumnBound,
  type FormulaParseError,
  type ParseErrorCode,
  type Ref,
} from "./types";

/** Excel's own ceiling. A formula longer than this is a paste accident. */
export const MAX_FORMULA_LENGTH = 8192;

/** Highest row number accepted in A1 text (1-based), matching Excel. */
export const MAX_ROW_NUMBER = 1_048_576;

/** `%` is postfix only, every other operator glyph can be binary. */
export type OperatorToken = BinaryOperator | "%";

interface TokenBase {
  /** Raw source slice, kept for highlighting and for round-tripping. */
  text: string;
  start: number;
  end: number;
}

export type Token =
  | (TokenBase & { type: "number"; value: number })
  | (TokenBase & { type: "string"; value: string })
  | (TokenBase & { type: "boolean"; value: boolean })
  | (TokenBase & { type: "error"; value: CellError })
  | (TokenBase & { type: "ref"; ref: Ref })
  | (TokenBase & { type: "identifier"; name: string })
  | (TokenBase & { type: "operator"; op: OperatorToken })
  | (TokenBase & { type: "lparen" })
  | (TokenBase & { type: "rparen" })
  | (TokenBase & { type: "comma" })
  | (TokenBase & { type: "colon" });

export type TokenType = Token["type"];

export type TokenizeResult =
  | { ok: true; tokens: Token[] }
  | { ok: false; error: FormulaParseError };

const NUMBER_RE = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const CELL_RE = new RegExp(
  `(\\$?)([A-Za-z]{1,${MAX_COLUMN_LABEL_LENGTH}})(\\$?)(\\d+)`,
  "y",
);
const COLUMN_RE = new RegExp(
  `(\\$?)([A-Za-z]{1,${MAX_COLUMN_LABEL_LENGTH}})`,
  "y",
);
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

// Longest first, so `#N/A` can never shadow a longer literal sharing its prefix.
const ERROR_LITERALS: readonly CellError[] = [...CELL_ERRORS].sort(
  (a, b) => b.length - a.length,
);

const TWO_CHAR_OPERATORS = new Set(["<=", ">=", "<>"]);
const ONE_CHAR_OPERATORS = new Set([
  "=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "^",
  "%",
  "&",
]);

function fail(
  code: ParseErrorCode,
  message: string,
  start: number,
  end: number,
): { ok: false; error: FormulaParseError } {
  return { ok: false, error: { code, message, start, end } };
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

/** A ref must not run straight into a longer word: `A1B` is one word. */
function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /[A-Za-z0-9_]/.test(ch);
}

function matchAt(re: RegExp, source: string, index: number): RegExpExecArray | null {
  re.lastIndex = index;
  return re.exec(source);
}

function nextNonSpaceIsLParen(source: string, index: number): boolean {
  let i = index;
  while (isWhitespace(source[i])) i++;
  return source[i] === "(";
}

interface RefCandidate {
  ref: Ref | null;
  end: number;
  /** Set when the shape is right but the numbers are not, for example `A0`. */
  invalid: { code: ParseErrorCode; message: string } | null;
  /** Only a lone cell or a lone column letter can also be a function name. */
  nameable: boolean;
  hasAbsolute: boolean;
}

function readCell(
  source: string,
  index: number,
): { addr: CellAddress | null; end: number; invalid: RefCandidate["invalid"]; hasAbsolute: boolean } | null {
  const m = matchAt(CELL_RE, source, index);
  if (!m) return null;
  const end = index + m[0].length;
  const hasAbsolute = m[1] === "$" || m[3] === "$";
  const col = parseColumnLabel(m[2]);
  if (col === null) {
    return {
      addr: null,
      end,
      invalid: {
        code: "invalid-reference",
        message: `'${m[0]}' is not a valid cell reference.`,
      },
      hasAbsolute,
    };
  }
  const rowNumber = Number(m[4]);
  if (rowNumber < 1) {
    return {
      addr: null,
      end,
      invalid: {
        code: "invalid-reference",
        message: `Row numbers start at 1, so '${m[0]}' is not a cell.`,
      },
      hasAbsolute,
    };
  }
  if (!Number.isFinite(rowNumber) || rowNumber > MAX_ROW_NUMBER) {
    return {
      addr: null,
      end,
      invalid: {
        code: "invalid-reference",
        message: `Row ${m[4]} is past the last row (${MAX_ROW_NUMBER}).`,
      },
      hasAbsolute,
    };
  }
  return {
    addr: {
      row: rowNumber - 1,
      col,
      rowAbsolute: m[3] === "$",
      colAbsolute: m[1] === "$",
    },
    end,
    invalid: null,
    hasAbsolute,
  };
}

function readColumnBound(
  source: string,
  index: number,
): { bound: ColumnBound | null; end: number; hasAbsolute: boolean } | null {
  const m = matchAt(COLUMN_RE, source, index);
  if (!m) return null;
  const col = parseColumnLabel(m[2]);
  return {
    bound: col === null ? null : { col, absolute: m[1] === "$" },
    end: index + m[0].length,
    hasAbsolute: m[1] === "$",
  };
}

/** `A1:B10`. */
function scanCellRange(source: string, index: number): RefCandidate | null {
  const from = readCell(source, index);
  if (!from) return null;
  if (source[from.end] !== ":") return null;
  const to = readCell(source, from.end + 1);
  if (!to) return null;
  const invalid = from.invalid ?? to.invalid;
  return {
    ref:
      invalid || !from.addr || !to.addr
        ? null
        : { kind: "range", from: from.addr, to: to.addr },
    end: to.end,
    invalid,
    nameable: false,
    hasAbsolute: from.hasAbsolute || to.hasAbsolute,
  };
}

/** `A:A`, `A:C`, `$A:$C`. */
function scanColumnRange(source: string, index: number): RefCandidate | null {
  const from = readColumnBound(source, index);
  if (!from) return null;
  if (source[from.end] !== ":") return null;
  const to = readColumnBound(source, from.end + 1);
  if (!to) return null;
  // `A:A1` is not a column range, the second half is a cell.
  if (/\d/.test(source[to.end] ?? "")) return null;
  return {
    ref:
      from.bound && to.bound
        ? { kind: "column", from: from.bound, to: to.bound }
        : null,
    end: to.end,
    invalid:
      from.bound && to.bound
        ? null
        : {
            code: "invalid-reference",
            message: `'${source.slice(index, to.end)}' is not a valid column range.`,
          },
    nameable: false,
    hasAbsolute: from.hasAbsolute || to.hasAbsolute,
  };
}

/** `A1`, `$A$1`. */
function scanCell(source: string, index: number): RefCandidate | null {
  const cell = readCell(source, index);
  if (!cell) return null;
  return {
    ref: cell.addr ? { kind: "cell", addr: cell.addr } : null,
    end: cell.end,
    invalid: cell.invalid,
    nameable: true,
    hasAbsolute: cell.hasAbsolute,
  };
}

/** A lone `A`, which means the whole column, exactly like `A:A`. */
function scanBareColumn(source: string, index: number): RefCandidate | null {
  const bound = readColumnBound(source, index);
  if (!bound || !bound.bound) return null;
  return {
    ref: {
      kind: "column",
      from: { col: bound.bound.col, absolute: bound.bound.absolute },
      to: { col: bound.bound.col, absolute: bound.bound.absolute },
    },
    end: bound.end,
    invalid: null,
    nameable: true,
    hasAbsolute: bound.hasAbsolute,
  };
}

const REF_SCANNERS = [scanCellRange, scanColumnRange, scanCell, scanBareColumn];

type ScanOutcome =
  | { token: Token }
  | { error: FormulaParseError };

/** Handles everything that starts with `$`, a letter or `_`. */
function scanWord(source: string, index: number): ScanOutcome {
  const identMatch = matchAt(IDENT_RE, source, index);
  const identEnd = identMatch ? index + identMatch[0].length : -1;

  for (const scan of REF_SCANNERS) {
    const candidate = scan(source, index);
    if (!candidate) continue;
    // The ref bleeds into a longer word, so it was never a ref: `AB12CD`.
    if (isWordChar(source[candidate.end])) continue;
    // A plain word that extends past the ref wins: `TOTAL` over column `TOT`.
    if (candidate.end < identEnd) continue;
    if (
      candidate.nameable &&
      !candidate.hasAbsolute &&
      nextNonSpaceIsLParen(source, candidate.end)
    ) {
      break; // It is a function name, fall through to the identifier branch.
    }
    if (candidate.invalid) {
      return {
        error: {
          code: candidate.invalid.code,
          message: candidate.invalid.message,
          start: index,
          end: candidate.end,
        },
      };
    }
    if (!candidate.ref) continue;
    return {
      token: {
        type: "ref",
        ref: candidate.ref,
        text: source.slice(index, candidate.end),
        start: index,
        end: candidate.end,
      },
    };
  }

  if (identEnd > index) {
    const text = source.slice(index, identEnd);
    const upper = text.toUpperCase();
    if (
      (upper === "TRUE" || upper === "FALSE") &&
      !nextNonSpaceIsLParen(source, identEnd)
    ) {
      return {
        token: {
          type: "boolean",
          value: upper === "TRUE",
          text,
          start: index,
          end: identEnd,
        },
      };
    }
    return {
      token: { type: "identifier", name: text, text, start: index, end: identEnd },
    };
  }

  return {
    error: {
      code: "unexpected-character",
      message: `Unexpected character '${source[index]}'.`,
      start: index,
      end: index + 1,
    },
  };
}

function scanQuoted(
  source: string,
  index: number,
  open: string,
  close: string,
  unterminated: ParseErrorCode,
): { value: string; end: number } | { error: FormulaParseError } {
  let value = "";
  let i = index + open.length;
  while (i < source.length) {
    const ch = source[i];
    if (ch === close) {
      if (source[i + 1] === close) {
        value += close;
        i += 2;
        continue;
      }
      return { value, end: i + 1 };
    }
    value += ch;
    i++;
  }
  return {
    error: {
      code: unterminated,
      message: `Missing closing ${close}.`,
      start: index,
      end: source.length,
    },
  };
}

export function tokenize(source: string): TokenizeResult {
  if (source.length > MAX_FORMULA_LENGTH) {
    return fail(
      "formula-too-long",
      `A formula may be at most ${MAX_FORMULA_LENGTH} characters, this one is ${source.length}.`,
      0,
      source.length,
    );
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (isWhitespace(ch)) {
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const scanned = scanQuoted(source, i, ch, ch, "unterminated-string");
      if ("error" in scanned) return { ok: false, error: scanned.error };
      tokens.push({
        type: "string",
        value: scanned.value,
        text: source.slice(i, scanned.end),
        start: i,
        end: scanned.end,
      });
      i = scanned.end;
      continue;
    }

    if (ch === "[") {
      const scanned = scanQuoted(source, i, "[", "]", "unterminated-header");
      if ("error" in scanned) return { ok: false, error: scanned.error };
      if (scanned.value.length === 0) {
        return fail(
          "empty-header",
          "A column reference needs a header name between the brackets.",
          i,
          scanned.end,
        );
      }
      tokens.push({
        type: "ref",
        ref: { kind: "header", name: scanned.value },
        text: source.slice(i, scanned.end),
        start: i,
        end: scanned.end,
      });
      i = scanned.end;
      continue;
    }

    if (/\d/.test(ch) || (ch === "." && /\d/.test(source[i + 1] ?? ""))) {
      const m = matchAt(NUMBER_RE, source, i);
      // The guard above guarantees a match, this is belt and braces.
      if (!m) {
        return fail("invalid-number", `'${ch}' is not a number.`, i, i + 1);
      }
      const end = i + m[0].length;
      const value = Number(m[0]);
      if (!Number.isFinite(value)) {
        return fail(
          "invalid-number",
          `'${m[0]}' is too large to be a number.`,
          i,
          end,
        );
      }
      tokens.push({ type: "number", value, text: m[0], start: i, end });
      i = end;
      continue;
    }

    if (ch === "#") {
      const literal = ERROR_LITERALS.find((code) => source.startsWith(code, i));
      if (!literal) {
        return fail(
          "unexpected-character",
          `'#' only starts an error value such as #N/A.`,
          i,
          i + 1,
        );
      }
      tokens.push({
        type: "error",
        value: literal,
        text: literal,
        start: i,
        end: i + literal.length,
      });
      i += literal.length;
      continue;
    }

    if (ch === "$" || /[A-Za-z_]/.test(ch)) {
      const scanned = scanWord(source, i);
      if ("error" in scanned) return { ok: false, error: scanned.error };
      tokens.push(scanned.token);
      i = scanned.token.end;
      continue;
    }

    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPERATORS.has(two)) {
      tokens.push({
        type: "operator",
        op: two as OperatorToken,
        text: two,
        start: i,
        end: i + 2,
      });
      i += 2;
      continue;
    }

    if (ONE_CHAR_OPERATORS.has(ch)) {
      tokens.push({
        type: "operator",
        op: ch as OperatorToken,
        text: ch,
        start: i,
        end: i + 1,
      });
      i++;
      continue;
    }

    if (ch === "(" || ch === ")" || ch === "," || ch === ":") {
      const type =
        ch === "(" ? "lparen" : ch === ")" ? "rparen" : ch === "," ? "comma" : "colon";
      tokens.push({ type, text: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    return fail(
      "unexpected-character",
      `Unexpected character '${ch}'.`,
      i,
      i + 1,
    );
  }

  return { ok: true, tokens };
}
