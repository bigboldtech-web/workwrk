// Public surface of the Tables formula engine.
//
// The engine is four layers with one direction of flow:
//
//   tokenizer -> parser        text to a tree
//   evaluate                   a tree to a value, against a `SheetAccess`
//   graph                      which cells to recompute, and in what order
//   refs                       what a formula becomes when the table changes
//
// `coerce.ts` and `functions.ts` are injected into `evaluate` rather than
// imported by it; this module is the only place they are wired together, so
// the evaluator stays testable on its own and a host can substitute its own
// library.
//
// Nothing here reads or writes storage. A cell holding a formula is
// `{ "=": "A1+B2" }` (see `isFormulaCell`); loading those into a graph and
// writing computed values back is the UI wave's job.

import {
  compareValues,
  serialFromLocalDate,
  toBoolean,
  toNumber,
  toText,
} from "./coerce";
import {
  evaluate,
  evaluateFormula,
  type CellPoint,
  type Coercions,
  type FunctionEntry,
  type FunctionLookup,
  type SheetAccess,
} from "./evaluate";
import { FUNCTIONS, type SheetFunction, RANGE_ARGUMENTS } from "./functions";
import { SheetGraph } from "./graph";
import { cellError, isErrorValue, type Ast, type CellValue } from "./types";

// --- Wiring ----------------------------------------------------------------

/** `coerce.ts` as the evaluator's operator semantics. */
export const ENGINE_COERCIONS: Coercions = {
  toNumber,
  toText,
  toBoolean,
  compare(a, b) {
    const order = compareValues(a, b);
    if (order !== null) return order;
    // `compareValues` answers null only when an error is involved.
    if (isErrorValue(a)) return a;
    if (isErrorValue(b)) return b;
    return cellError("#VALUE!");
  },
};

const adapted = new Map<string, FunctionEntry>();

/**
 * `functions.ts` owns its own error policy, including the functions that must
 * see an error argument, so the evaluator's short-circuit is turned off.
 *
 * Arguments are evaluated eagerly and handed over as already-resolved thunks.
 * With errors as values that is equivalent to lazy evaluation for every
 * function in the library; wiring `SheetFunction.lazy` through as real
 * deferral is a performance change for the UI wave, not a semantic one.
 */
function adapt(entry: SheetFunction): FunctionEntry {
  const cached = adapted.get(entry.name);
  if (cached) return cached;
  const wrapped: FunctionEntry = {
    minArgs: entry.minArgs,
    maxArgs: entry.maxArgs,
    acceptsErrors: true,
    // Declared by the library, never inferred from the evaluator's fallback
    // table — that table cannot know about functions added here later.
    rangeArgs: RANGE_ARGUMENTS.get(entry.name),
    // Provably safe for per-pass memoization: the adapter below hands the
    // library ONLY the resolved arguments and the pass clock — a library
    // function cannot read ctx.origin even if it wanted to.
    cacheable: true,
    call: (args, ctx) =>
      entry.call(
        args.map((value) => () => value),
        { now: serialFromLocalDate(ctx.now()) },
      ),
  };
  adapted.set(entry.name, wrapped);
  return wrapped;
}

export const ENGINE_FUNCTIONS: FunctionLookup = {
  get(name) {
    const entry = FUNCTIONS.get(name.toUpperCase());
    return entry ? adapt(entry) : undefined;
  },
};

export interface EngineOptions {
  sheet: SheetAccess;
  /** Injected clock, so a recalc under test is reproducible. */
  now?: () => Date;
  maxRangeCells?: number;
}

/** A dependency graph with the real function library and coercions wired in. */
export function createSheetEngine(options: EngineOptions): SheetGraph {
  return new SheetGraph({
    sheet: options.sheet,
    functions: ENGINE_FUNCTIONS,
    coercions: ENGINE_COERCIONS,
    now: options.now,
    maxRangeCells: options.maxRangeCells,
  });
}

/**
 * One formula, one answer, no graph. For a preview or a validation pass;
 * anything that recomputes on edit wants `createSheetEngine`.
 */
export function computeFormula(
  formula: string | Ast,
  options: EngineOptions & { origin?: CellPoint | null },
): CellValue {
  const context = {
    sheet: options.sheet,
    origin: options.origin,
    functions: ENGINE_FUNCTIONS,
    coercions: ENGINE_COERCIONS,
    now: options.now,
    maxRangeCells: options.maxRangeCells,
  };
  return typeof formula === "string"
    ? evaluateFormula(formula, context)
    : evaluate(formula, context);
}

// --- Re-exports -------------------------------------------------------------

export * from "./types";
export * from "./refs";

export {
  MAX_FORMULA_LENGTH,
  MAX_ROW_NUMBER,
  tokenize,
  type OperatorToken,
  type Token,
  type TokenType,
  type TokenizeResult,
} from "./tokenizer";

export {
  MAX_ARGUMENTS,
  MAX_PARSE_DEPTH,
  parseFormula,
  parseTokens,
} from "./parser";

export {
  BASIC_COERCIONS,
  DEFAULT_RANGE_ARGUMENTS,
  EMPTY_FUNCTIONS,
  MAX_EVAL_DEPTH,
  MAX_RANGE_CELLS,
  argumentContext,
  createGridSheet,
  evaluate,
  evaluateFormula,
  normalizeFunction,
  resolveRefBox,
  walkRefs,
  type CellPoint,
  type Coercions,
  type EvaluateOptions,
  type FunctionContext,
  type FunctionEntry,
  type FunctionImpl,
  type FunctionLookup,
  type RefBox,
  type RefContext,
  type RefVisit,
  type RegisteredFunction,
  type SheetAccess,
} from "./evaluate";

export {
  SheetGraph,
  cellKey,
  keyCol,
  keyPoint,
  keyRow,
  stronglyConnected,
  type CellDependencies,
  type CellKey,
  type DependencyRect,
  type RecalcResult,
  type SheetGraphOptions,
} from "./graph";

export {
  PassCache,
  RANGE_CACHE_MIN_CELLS,
  type CacheRect,
} from "./pass-cache";

// The canonical range shape lives in `coerce.ts`; `evaluate.ts` declares a
// structurally identical copy so it can stand alone.
export {
  MS_PER_DAY,
  argCells,
  isRangeValue,
  partsFromSerial,
  serialFromLocalDate,
  serialFromUtcDate,
  toScalar,
  type DateParts,
  type FunctionArg,
  type RangeValue,
} from "./coerce";

export {
  FUNCTIONS,
  functionNames,
  getFunction,
  isFunctionName,
  type SheetFunction,
} from "./functions";
