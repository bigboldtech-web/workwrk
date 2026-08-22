// Evaluator for the Tables formula engine. Pure: no React, no DOM, no I/O, and
// importable in plain node.
//
// Errors are VALUES. Nothing here signals a cell-level failure by throwing, and
// the entry points wrap the whole walk in a catch so a defect in this module
// degrades one cell to #ERROR! instead of taking down a render pass.
//
// THE FUNCTION LIBRARY IS INJECTED. `functions.ts` and `coerce.ts` are separate
// modules wired together in `index.ts`; this file never imports them, so the
// evaluator can be tested against a stub registry and neither module blocks the
// other. `BASIC_COERCIONS` below is a self-contained fallback so `evaluate` is
// usable with nothing injected at all — `coerce.ts` is authoritative once it is
// passed in.
//
// SCALAR VERSUS ARRAY CONTEXT. A whole-column reference (`A`, `A:A`,
// `[Total Cost]`) means two different things depending on where it sits, and
// the split is the same one Excel makes with structured references:
//
//   scalar context  `A*2`         → the current row's cell in column A
//   array  context  `SUM(A)`      → every cell in column A
//
// Only a function argument is array context, and only for the parameters that
// actually take a range. Which parameters those are is a property of the
// function, so it belongs in the registry (`FunctionEntry.rangeArgs`).
// `DEFAULT_RANGE_ARGUMENTS` is the fallback for registries that declare
// nothing; a declaration always wins over it.

import { parseFormula } from "./parser";
import {
  cellError,
  isErrorValue,
  type Ast,
  type CellValue,
  type ErrorValue,
  type Ref,
  type RefNode,
} from "./types";

/** 0-based, matching `CellAddress`. */
export interface CellPoint {
  row: number;
  col: number;
}

/**
 * A materialised rectangle of cells, row-major. Structurally identical to the
 * `RangeValue` in `coerce.ts` on purpose: the two modules are written in
 * parallel and this keeps them interchangeable without either importing the
 * other. `index.ts` re-exports the `coerce.ts` copy as the canonical one, and
 * tsc catches any drift where the two are wired together.
 */
export interface RangeValue {
  readonly kind: "range";
  readonly rows: readonly (readonly CellValue[])[];
}

export type FunctionArg = CellValue | RangeValue;

export function isRangeValue(value: FunctionArg): value is RangeValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "range"
  );
}

/**
 * Everything the evaluator reads from the host. Row and column counts bound
 * every range, so a formula can never materialise more cells than the table
 * holds.
 */
export interface SheetAccess {
  /** The value at an address. `null` is an empty cell. */
  getCell(row: number, col: number): CellValue;
  rowCount(): number;
  columnCount(): number;
  /** Human header to 0-based column index, or null when no column matches. */
  resolveHeader(name: string): number | null;
  /** Named ranges and constants. Absent means every bare name is #NAME?. */
  resolveName?(name: string): CellValue | undefined;
  /** Injected clock so TODAY/NOW are deterministic under test. */
  clock?(): Date;
}

export interface FunctionContext {
  now(): Date;
  /** The cell being computed, or null when a formula is evaluated rowless. */
  origin: CellPoint | null;
  coercions: Coercions;
}

export type FunctionImpl = (
  args: readonly FunctionArg[],
  ctx: FunctionContext,
) => CellValue;

export interface FunctionEntry {
  call: FunctionImpl;
  minArgs?: number;
  maxArgs?: number;
  /**
   * Default false: the evaluator returns the first error argument without
   * calling. IFERROR, IF, ISERROR and friends must set this to true.
   */
  acceptsErrors?: boolean;
  /**
   * Which parameters take a range: `true` for all of them, or the 0-based
   * indices. Overrides `DEFAULT_RANGE_ARGUMENTS`.
   */
  rangeArgs?: boolean | readonly number[];
}

/** A registry may hold bare functions or entries; both are accepted. */
export type RegisteredFunction = FunctionImpl | FunctionEntry;

/** `ReadonlyMap<string, RegisteredFunction>` satisfies this structurally. */
export interface FunctionLookup {
  get(name: string): RegisteredFunction | undefined;
}

/** Scalar conversions. `coerce.ts` supplies the real implementation. */
export interface Coercions {
  toNumber(value: CellValue): number | ErrorValue;
  toText(value: CellValue): string | ErrorValue;
  toBoolean(value: CellValue): boolean | ErrorValue;
  /** Spreadsheet ordering as -1 | 0 | 1. */
  compare(a: CellValue, b: CellValue): number | ErrorValue;
}

export type RefContext = "scalar" | "array";

export interface RefVisit {
  ref: Ref;
  node: RefNode;
  context: RefContext;
  /**
   * True when the ref is a direct function argument. Argument refs are read as
   * whole ranges; refs in an operand position read a single cell. The
   * dependency graph needs both facts to mirror what evaluation actually
   * touches.
   */
  argument: boolean;
}

/** Guard for hand-built trees; the parser already caps its own depth at 128. */
export const MAX_EVAL_DEPTH = 256;

/** A range wider than this is a mistake, not a query: #NUM! rather than OOM. */
export const MAX_RANGE_CELLS = 500_000;

const REF_ERROR = cellError("#REF!");
const VALUE_ERROR = cellError("#VALUE!");
const NAME_ERROR = cellError("#NAME?");
const NUM_ERROR = cellError("#NUM!");
const DIV_ERROR = cellError("#DIV/0!");
const INTERNAL_ERROR = cellError("#ERROR!");

/**
 * Fallback range-parameter map for registries that declare nothing. Only
 * whole-column and multi-cell references are affected by the choice, so a
 * coarse per-function answer is enough.
 */
export const DEFAULT_RANGE_ARGUMENTS: ReadonlyMap<
  string,
  true | readonly number[]
> = new Map<string, true | readonly number[]>([
  ["SUM", true],
  ["SUMPRODUCT", true],
  ["PRODUCT", true],
  ["AVG", true],
  ["AVERAGE", true],
  ["MEDIAN", true],
  ["MIN", true],
  ["MAX", true],
  ["COUNT", true],
  ["COUNTA", true],
  ["COUNTBLANK", true],
  ["COUNTUNIQUE", true],
  ["STDEV", true],
  ["STDEVP", true],
  ["VAR", true],
  ["VARP", true],
  ["COUNTIF", [0]],
  ["SUMIF", [0, 2]],
  ["AVERAGEIF", [0, 2]],
  ["VLOOKUP", [1]],
  ["HLOOKUP", [1]],
  ["LOOKUP", [1, 2]],
  ["INDEX", [0]],
  ["MATCH", [1]],
]);

/** No functions at all: every call is #NAME?. */
export const EMPTY_FUNCTIONS: FunctionLookup = { get: () => undefined };

// --- Fallback coercions ---------------------------------------------------

// Deliberately strict: `Number("")` is 0 and `Number("0x10")` is 16, neither of
// which a spreadsheet accepts as a number typed into a cell.
const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function textToNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!NUMERIC_TEXT.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function emptyLike(other: CellValue): CellValue {
  if (typeof other === "number") return 0;
  if (typeof other === "boolean") return false;
  return "";
}

export const BASIC_COERCIONS: Coercions = {
  toNumber(value) {
    if (isErrorValue(value)) return value;
    if (value === null) return 0;
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    const parsed = textToNumber(value);
    return parsed === null ? VALUE_ERROR : parsed;
  },
  toText(value) {
    if (isErrorValue(value)) return value;
    if (value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    return String(value);
  },
  toBoolean(value) {
    if (isErrorValue(value)) return value;
    if (value === null) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const upper = value.trim().toUpperCase();
    if (upper === "TRUE") return true;
    if (upper === "FALSE") return false;
    return VALUE_ERROR;
  },
  compare(a, b) {
    if (isErrorValue(a)) return a;
    if (isErrorValue(b)) return b;
    if (a === null && b === null) return 0;
    const left = a === null ? emptyLike(b) : a;
    const right = b === null ? emptyLike(a) : b;
    const rank = (v: CellValue) =>
      typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2;
    const ra = rank(left);
    const rb = rank(right);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (typeof left === "number" && typeof right === "number") {
      return left < right ? -1 : left > right ? 1 : 0;
    }
    if (typeof left === "string" && typeof right === "string") {
      // Case-insensitive like every spreadsheet, and locale-independent so a
      // recalc on a server and in a browser agree.
      const la = left.toUpperCase();
      const lb = right.toUpperCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    }
    const na = left === true ? 1 : 0;
    const nb = right === true ? 1 : 0;
    return na < nb ? -1 : na > nb ? 1 : 0;
  },
};

// --- Registry helpers ------------------------------------------------------

export function normalizeFunction(
  registered: RegisteredFunction | undefined,
): FunctionEntry | null {
  if (!registered) return null;
  if (typeof registered === "function") return { call: registered };
  return registered;
}

/** The context rule, defined once so dependency extraction cannot drift. */
export function argumentContext(
  name: string,
  entry: FunctionEntry | null,
  index: number,
): RefContext {
  const declared = entry?.rangeArgs ?? DEFAULT_RANGE_ARGUMENTS.get(name);
  if (declared === undefined) return "scalar";
  if (typeof declared === "boolean") return declared ? "array" : "scalar";
  return declared.includes(index) ? "array" : "scalar";
}

// --- Ref resolution --------------------------------------------------------

export interface RefBox {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** True when the ref names whole columns and so spans every row. */
  wholeColumn: boolean;
}

interface ResolveContext {
  sheet: SheetAccess;
  rows: number;
  cols: number;
}

/**
 * Turn a ref into a sheet rectangle. Row bounds for whole-column refs come
 * from the sheet, so an empty table yields an empty box rather than a million
 * rows. Returns an error value for a header no column answers to.
 */
export function resolveRefBox(ref: Ref, ctx: ResolveContext): RefBox | ErrorValue {
  switch (ref.kind) {
    case "cell":
      return {
        top: ref.addr.row,
        left: ref.addr.col,
        bottom: ref.addr.row,
        right: ref.addr.col,
        wholeColumn: false,
      };
    case "range":
      return {
        top: Math.min(ref.from.row, ref.to.row),
        left: Math.min(ref.from.col, ref.to.col),
        bottom: Math.max(ref.from.row, ref.to.row),
        right: Math.max(ref.from.col, ref.to.col),
        wholeColumn: false,
      };
    case "column":
      return {
        top: 0,
        left: Math.min(ref.from.col, ref.to.col),
        bottom: Math.max(ctx.rows - 1, 0),
        right: Math.max(ref.from.col, ref.to.col),
        wholeColumn: true,
      };
    case "header": {
      const col = ctx.sheet.resolveHeader(ref.name);
      if (col === null || col < 0) return NAME_ERROR;
      return {
        top: 0,
        left: col,
        bottom: Math.max(ctx.rows - 1, 0),
        right: col,
        wholeColumn: true,
      };
    }
  }
}

function readCell(ctx: ResolveContext, row: number, col: number): CellValue {
  if (row < 0 || col < 0 || row >= ctx.rows || col >= ctx.cols) return REF_ERROR;
  return ctx.sheet.getCell(row, col);
}

interface EvalContext extends ResolveContext {
  origin: CellPoint | null;
  functions: FunctionLookup;
  coercions: Coercions;
  now: () => Date;
  maxRangeCells: number;
  depth: number;
}

/** Narrow a ref to one value. Multi-cell refs are #VALUE! unless 1x1. */
function refToScalar(ref: Ref, ctx: EvalContext): CellValue {
  const box = resolveRefBox(ref, ctx);
  if (isErrorValue(box)) return box;
  if (box.wholeColumn) {
    if (box.left !== box.right) return VALUE_ERROR;
    if (!ctx.origin) return VALUE_ERROR;
    return readCell(ctx, ctx.origin.row, box.left);
  }
  if (box.top === box.bottom && box.left === box.right) {
    return readCell(ctx, box.top, box.left);
  }
  return VALUE_ERROR;
}

/** Materialise a box, clamped to the sheet. Out-of-sheet yields no cells. */
function materialize(box: RefBox, ctx: EvalContext): RangeValue | ErrorValue {
  const top = Math.max(box.top, 0);
  const left = Math.max(box.left, 0);
  const bottom = Math.min(box.bottom, ctx.rows - 1);
  const right = Math.min(box.right, ctx.cols - 1);
  if (top > bottom || left > right) return { kind: "range", rows: [] };
  const area = (bottom - top + 1) * (right - left + 1);
  if (area > ctx.maxRangeCells) return NUM_ERROR;
  const rows: CellValue[][] = [];
  for (let r = top; r <= bottom; r++) {
    const line: CellValue[] = [];
    for (let c = left; c <= right; c++) line.push(ctx.sheet.getCell(r, c));
    rows.push(line);
  }
  return { kind: "range", rows };
}

/**
 * A ref in an argument position reaches a function as a RANGE, even when it
 * covers one cell: that is what lets `AVERAGE(A1,2)` skip a blank A1 while
 * still counting the literal 2. The single exception is a whole-column ref in
 * a scalar parameter, which narrows to the current row.
 */
function refToArg(ref: Ref, ctx: EvalContext, context: RefContext): FunctionArg {
  const box = resolveRefBox(ref, ctx);
  if (isErrorValue(box)) return box;
  if (
    box.wholeColumn &&
    context === "scalar" &&
    box.left === box.right &&
    ctx.origin
  ) {
    const value = readCell(ctx, ctx.origin.row, box.left);
    if (isErrorValue(value)) return value;
    return { kind: "range", rows: [[value]] };
  }
  return materialize(box, ctx);
}

// --- Operators -------------------------------------------------------------

function finite(value: number): CellValue {
  return Number.isFinite(value) ? value : NUM_ERROR;
}

function applyBinary(
  op: string,
  left: CellValue,
  right: CellValue,
  ctx: EvalContext,
): CellValue {
  if (isErrorValue(left)) return left;
  if (isErrorValue(right)) return right;
  const { coercions } = ctx;

  if (op === "&") {
    const a = coercions.toText(left);
    if (isErrorValue(a)) return a;
    const b = coercions.toText(right);
    if (isErrorValue(b)) return b;
    return a + b;
  }

  if (op === "=" || op === "<>" || op === "<" || op === "<=" || op === ">" || op === ">=") {
    const cmp = coercions.compare(left, right);
    if (isErrorValue(cmp)) return cmp;
    switch (op) {
      case "=":
        return cmp === 0;
      case "<>":
        return cmp !== 0;
      case "<":
        return cmp < 0;
      case "<=":
        return cmp <= 0;
      case ">":
        return cmp > 0;
      default:
        return cmp >= 0;
    }
  }

  const a = coercions.toNumber(left);
  if (isErrorValue(a)) return a;
  const b = coercions.toNumber(right);
  if (isErrorValue(b)) return b;

  switch (op) {
    case "+":
      return finite(a + b);
    case "-":
      return finite(a - b);
    case "*":
      return finite(a * b);
    case "/":
      return b === 0 ? DIV_ERROR : finite(a / b);
    case "^": {
      if (a === 0 && b < 0) return DIV_ERROR;
      const result = Math.pow(a, b);
      return Number.isNaN(result) ? NUM_ERROR : finite(result);
    }
    default:
      return INTERNAL_ERROR;
  }
}

// --- The walk --------------------------------------------------------------

function evalNode(node: Ast, ctx: EvalContext): CellValue {
  if (ctx.depth > MAX_EVAL_DEPTH) return INTERNAL_ERROR;
  ctx.depth++;
  try {
    switch (node.type) {
      case "number":
        return node.value;
      case "string":
        return node.value;
      case "boolean":
        return node.value;
      case "error":
        return cellError(node.value);
      case "ref":
        return refToScalar(node.ref, ctx);
      case "name": {
        const resolved = ctx.sheet.resolveName?.(node.name);
        return resolved === undefined ? NAME_ERROR : resolved;
      }
      case "unary": {
        const operand = evalNode(node.operand, ctx);
        if (isErrorValue(operand)) return operand;
        const n = ctx.coercions.toNumber(operand);
        if (isErrorValue(n)) return n;
        return finite(node.op === "-" ? -n : n);
      }
      case "percent": {
        const operand = evalNode(node.operand, ctx);
        if (isErrorValue(operand)) return operand;
        const n = ctx.coercions.toNumber(operand);
        if (isErrorValue(n)) return n;
        return finite(n / 100);
      }
      case "binary":
        return applyBinary(
          node.op,
          evalNode(node.left, ctx),
          evalNode(node.right, ctx),
          ctx,
        );
      case "call":
        return evalCall(node.name, node.args, ctx);
    }
  } finally {
    ctx.depth--;
  }
}

function evalCall(name: string, args: Ast[], ctx: EvalContext): CellValue {
  const entry = normalizeFunction(ctx.functions.get(name));
  if (!entry) return NAME_ERROR;
  // #N/A, not #VALUE!: that is what Sheets reports for a wrong argument
  // count, and it is what the function library returns when it checks arity
  // itself — the two must agree or the same mistake reports two codes.
  if (entry.minArgs !== undefined && args.length < entry.minArgs) return cellError("#N/A");
  if (entry.maxArgs !== undefined && args.length > entry.maxArgs) return cellError("#N/A");

  const values: FunctionArg[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const context = argumentContext(name, entry, i);
    const value: FunctionArg =
      arg.type === "ref" ? refToArg(arg.ref, ctx, context) : evalNode(arg, ctx);
    // Errors inside a materialised range are the function's business; only a
    // scalar argument short-circuits, so IFERROR can still see its own input.
    if (!entry.acceptsErrors && !isRangeValue(value) && isErrorValue(value)) {
      return value;
    }
    values.push(value);
  }

  return entry.call(values, {
    now: ctx.now,
    origin: ctx.origin,
    coercions: ctx.coercions,
  });
}

export interface EvaluateOptions {
  sheet: SheetAccess;
  /** The cell being computed. Whole-column refs need it to narrow to a row. */
  origin?: CellPoint | null;
  functions?: FunctionLookup;
  coercions?: Coercions;
  now?: () => Date;
  maxRangeCells?: number;
}

function makeContext(options: EvaluateOptions): EvalContext {
  const { sheet } = options;
  const clock = options.now ?? (sheet.clock ? () => sheet.clock!() : () => new Date());
  return {
    sheet,
    rows: sheet.rowCount(),
    cols: sheet.columnCount(),
    origin: options.origin ?? null,
    functions: options.functions ?? EMPTY_FUNCTIONS,
    coercions: options.coercions ?? BASIC_COERCIONS,
    now: clock,
    maxRangeCells: options.maxRangeCells ?? MAX_RANGE_CELLS,
    depth: 0,
  };
}

/** Never throws: an unexpected failure anywhere below becomes #ERROR!. */
export function evaluate(ast: Ast, options: EvaluateOptions): CellValue {
  try {
    return evalNode(ast, makeContext(options));
  } catch {
    return INTERNAL_ERROR;
  }
}

/** A formula that does not parse is #ERROR!, the same as one that misbehaves. */
export function evaluateFormula(
  source: string,
  options: EvaluateOptions,
): CellValue {
  const parsed = parseFormula(source);
  if (!parsed.ok) return INTERNAL_ERROR;
  return evaluate(parsed.ast, options);
}

// --- Ref discovery ---------------------------------------------------------

/**
 * Visit every ref with the context it will be evaluated in. The dependency
 * graph uses this so a ref that narrows to one cell contributes one edge
 * instead of a whole column.
 */
export function walkRefs(
  ast: Ast,
  visit: (found: RefVisit) => void,
  options?: { functions?: FunctionLookup },
): void {
  const lookup = options?.functions;
  const walk = (
    node: Ast,
    context: RefContext,
    argument: boolean,
    depth: number,
  ): void => {
    if (depth > MAX_EVAL_DEPTH) return;
    switch (node.type) {
      case "ref":
        visit({ ref: node.ref, node, context, argument });
        return;
      case "unary":
      case "percent":
        walk(node.operand, "scalar", false, depth + 1);
        return;
      case "binary":
        walk(node.left, "scalar", false, depth + 1);
        walk(node.right, "scalar", false, depth + 1);
        return;
      case "call": {
        const entry = normalizeFunction(lookup?.get(node.name));
        for (let i = 0; i < node.args.length; i++) {
          walk(node.args[i], argumentContext(node.name, entry, i), true, depth + 1);
        }
        return;
      }
      default:
        return;
    }
  };
  walk(ast, "scalar", false, 0);
}

// --- Host helper -----------------------------------------------------------

/**
 * A `SheetAccess` over a dense row-major grid. Ragged rows read as empty, and
 * header matching is case-insensitive because that is what users expect of a
 * name they typed into a column heading.
 */
export function createGridSheet(
  grid: readonly (readonly CellValue[])[],
  headers?: readonly string[],
  extras?: { resolveName?: (name: string) => CellValue | undefined; clock?: () => Date },
): SheetAccess {
  const widest = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const columns = Math.max(widest, headers?.length ?? 0);
  const byHeader = new Map<string, number>();
  headers?.forEach((name, index) => {
    const key = name.trim().toUpperCase();
    if (!byHeader.has(key)) byHeader.set(key, index);
  });
  return {
    getCell(row, col) {
      const line = grid[row];
      if (!line) return null;
      const value = line[col];
      return value === undefined ? null : value;
    },
    rowCount: () => grid.length,
    columnCount: () => columns,
    resolveHeader: (name) => byHeader.get(name.trim().toUpperCase()) ?? null,
    resolveName: extras?.resolveName,
    clock: extras?.clock,
  };
}
