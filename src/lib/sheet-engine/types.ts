// Shared vocabulary for the Tables formula engine (Phase 3).
//
// Two invariants the whole engine is built on:
//
// 1. Errors are VALUES, not exceptions. A spreadsheet never throws: a bad
//    divisor produces #DIV/0! and that value propagates through every formula
//    that touches the poisoned cell. `ErrorValue` is therefore a member of
//    `CellValue`, and no layer of this engine may signal a cell-level failure
//    by throwing.
// 2. Addresses are 0-based internally and 1-based only in A1 text. The `$`
//    markers are kept as flags instead of being folded into the numbers, so
//    the ref-rewrite pass that runs on row/column insert, delete and reorder
//    can move relative refs and leave absolute ones alone.

export const CELL_ERRORS = [
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#CYCLE!",
  "#N/A",
  "#NUM!",
  "#ERROR!",
] as const;

export type CellError = (typeof CELL_ERRORS)[number];

export interface ErrorValue {
  readonly err: CellError;
}

/** `null` is the empty cell. Everything else is a literal or a propagated error. */
export type CellValue = number | string | boolean | null | ErrorValue;

const ERROR_SINGLETONS = Object.freeze(
  Object.fromEntries(
    CELL_ERRORS.map((code) => [code, Object.freeze({ err: code })]),
  ),
) as Readonly<Record<CellError, ErrorValue>>;

/** Frozen singleton per code, so error values can be compared by identity. */
export function cellError(err: CellError): ErrorValue {
  return ERROR_SINGLETONS[err];
}

export function isCellErrorCode(text: string): text is CellError {
  return (CELL_ERRORS as readonly string[]).includes(text);
}

export function isErrorValue(value: unknown): value is ErrorValue {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { err?: unknown }).err;
  return typeof err === "string" && isCellErrorCode(err);
}

// --- Address model -------------------------------------------------------

/** Longest supported column label, "ZZZ", which is 18278 columns. */
export const MAX_COLUMN_LABEL_LENGTH = 3;
/** Index of column "ZZZ". */
export const MAX_COLUMN_INDEX = 18277;

export interface CellAddress {
  /** 0-based row index. A1 text row 1 is index 0. */
  row: number;
  /** 0-based column index. Column A is index 0. */
  col: number;
  /** Written as `A$1`: the row is pinned and survives a rewrite. */
  rowAbsolute: boolean;
  /** Written as `$A1`: the column is pinned and survives a rewrite. */
  colAbsolute: boolean;
}

export interface ColumnBound {
  col: number;
  absolute: boolean;
}

export interface CellRef {
  kind: "cell";
  addr: CellAddress;
}

/**
 * `A1:B10`. Deliberately NOT normalised: `B10:A1` keeps its source order so a
 * rewrite pass can round-trip the text the user typed. Consumers that need an
 * ordered box must normalise themselves.
 */
export interface RangeRef {
  kind: "range";
  from: CellAddress;
  to: CellAddress;
}

/**
 * A whole column or a span of whole columns, by letter: `A:A`, `A:C`, `$A:$C`.
 * A bare `A` produces the same shape with `from` equal to `to`, which is how
 * today's column formulas (`A*2`, `SUM(A)`) stay expressible.
 */
export interface ColumnRef {
  kind: "column";
  from: ColumnBound;
  to: ColumnBound;
}

/**
 * A whole column addressed by its human header, written `[Total Cost]`.
 * Resolution is the evaluator's job: in a row context (a per-row formula) a
 * single-column ref narrows to that row's cell, as Excel structured
 * references do; in an aggregate argument it stays the whole column.
 */
export interface HeaderRef {
  kind: "header";
  name: string;
}

export type Ref = CellRef | RangeRef | ColumnRef | HeaderRef;

// --- AST -----------------------------------------------------------------

export type BinaryOperator =
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "&"
  | "+"
  | "-"
  | "*"
  | "/"
  | "^";

export type UnaryOperator = "+" | "-";

/**
 * Half-open source offsets into the ORIGINAL formula text, including any
 * leading `=`. The formula editor uses these for ref highlighting and error
 * squiggles, so they must never be relative to a trimmed copy.
 */
export interface SourceSpan {
  start: number;
  end: number;
}

export interface NumberNode extends SourceSpan {
  type: "number";
  value: number;
}

export interface StringNode extends SourceSpan {
  type: "string";
  value: string;
}

export interface BooleanNode extends SourceSpan {
  type: "boolean";
  value: boolean;
}

/** A literal error typed into the formula, for example `#N/A`. */
export interface ErrorNode extends SourceSpan {
  type: "error";
  value: CellError;
}

export interface RefNode extends SourceSpan {
  type: "ref";
  ref: Ref;
}

/**
 * A bare word that is not a call and not ref-shaped, for example `Revenue`.
 * The grammar has no opinion on it: the evaluator resolves it or returns
 * #NAME?. This is the extension point for named ranges.
 */
export interface NameNode extends SourceSpan {
  type: "name";
  name: string;
}

export interface UnaryNode extends SourceSpan {
  type: "unary";
  op: UnaryOperator;
  operand: Ast;
}

/** Postfix `%`, the tightest-binding operator. */
export interface PercentNode extends SourceSpan {
  type: "percent";
  operand: Ast;
}

export interface BinaryNode extends SourceSpan {
  type: "binary";
  op: BinaryOperator;
  left: Ast;
  right: Ast;
}

/** `name` is upper-cased so the function registry can be a plain map. */
export interface CallNode extends SourceSpan {
  type: "call";
  name: string;
  args: Ast[];
}

/**
 * Parentheses produce no node: grouping is already encoded by the tree shape,
 * and a serialiser re-inserts parens from precedence.
 */
export type Ast =
  | NumberNode
  | StringNode
  | BooleanNode
  | ErrorNode
  | RefNode
  | NameNode
  | UnaryNode
  | PercentNode
  | BinaryNode
  | CallNode;

// --- Failures -------------------------------------------------------------

export type ParseErrorCode =
  | "empty-formula"
  | "formula-too-long"
  | "unexpected-character"
  | "unterminated-string"
  | "unterminated-header"
  | "empty-header"
  | "invalid-number"
  | "invalid-reference"
  | "invalid-range"
  | "unexpected-token"
  | "unexpected-end"
  | "missing-closing-paren"
  | "empty-argument"
  | "too-many-arguments"
  | "nesting-too-deep"
  | "internal-error";

/**
 * A syntax failure, reported as data. `start`/`end` are half-open offsets into
 * the original source so the editor can underline the offending text; a
 * zero-width span (`start === end`) means "at the end of the input".
 */
export interface FormulaParseError extends SourceSpan {
  code: ParseErrorCode;
  message: string;
}

export type ParseResult =
  | { ok: true; ast: Ast }
  | { ok: false; error: FormulaParseError };

// --- Storage shape --------------------------------------------------------

/**
 * A cell in `DataTableRow.values` holds a formula when it is an object with a
 * string under the `=` key. Anything else is a literal. Extra keys are
 * tolerated so a cached computed value can be added later without breaking
 * older readers.
 */
export const FORMULA_KEY = "=";

export interface FormulaCell {
  readonly "=": string;
}

export function isFormulaCell(value: unknown): value is FormulaCell {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return typeof (value as Record<string, unknown>)[FORMULA_KEY] === "string";
}

export function formulaCell(source: string): FormulaCell {
  return { [FORMULA_KEY]: source };
}

// --- A1 column labels -----------------------------------------------------

/**
 * 0 to "A", 25 to "Z", 26 to "AA". Throws on a non-integer or out-of-range
 * index: that is a programming error inside the engine, never user input, and
 * silently returning a wrong label would corrupt a rewritten formula.
 */
export function columnLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > MAX_COLUMN_INDEX) {
    throw new RangeError(
      `columnLabel: index must be an integer in 0..${MAX_COLUMN_INDEX}, got ${index}`,
    );
  }
  let label = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/**
 * Inverse of `columnLabel`, case-insensitive. Returns null for anything that
 * is not a label in range, so callers branch instead of catching.
 */
export function parseColumnLabel(label: string): number | null {
  if (label.length === 0 || label.length > MAX_COLUMN_LABEL_LENGTH) return null;
  let index = 0;
  for (let i = 0; i < label.length; i++) {
    const code = label.charCodeAt(i);
    const value =
      code >= 65 && code <= 90
        ? code - 64
        : code >= 97 && code <= 122
          ? code - 96
          : 0;
    if (value === 0) return null;
    index = index * 26 + value;
  }
  return index - 1;
}
