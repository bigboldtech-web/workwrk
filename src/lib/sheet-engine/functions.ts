// The function library for the Tables formula engine. Pure: no React, no DOM,
// no I/O and no ambient clock. Nothing here throws — a function that cannot
// answer returns an error VALUE, because a spreadsheet keeps working around a
// broken cell instead of collapsing.
//
// SHAPE OF A FUNCTION. Every entry declares its arity and receives its
// arguments as thunks. Arity is checked BEFORE any thunk runs and a bad count
// is #N/A, so `SUM()` reports rather than reading `undefined`. Almost every
// function is eager and its arguments are forced once, in order; only IF and
// IFERROR are lazy, so `IF(TRUE,1,1/0)` is 1 and not #DIV/0!, matching Sheets.
// AND/OR are NOT lazy — Sheets evaluates all their arguments — so an error in
// any argument surfaces even when an earlier FALSE settles the answer.
//
// A LAST-RESORT try/catch wraps every call. It should never fire; it exists so
// that a bug in one function degrades one cell to #ERROR! instead of taking
// down a recalc of the whole table.
//
// THE CLOCK IS INJECTED. `TODAY`/`NOW` read `FunctionContext.now`, a serial
// captured once per recalc. Nothing in this file reads `Date.now`, so every
// NOW() in one pass agrees and a recalc is reproducible in a test.
//
// DELIBERATE DIVERGENCES FROM GOOGLE SHEETS, all of them narrowing:
//   - No array results. A function handed a multi-cell range where one value
//     is expected returns #VALUE! rather than an array (`LEFT(A1:A3,2)`).
//     INDEX's whole-row/whole-column form (index 0) is #VALUE! for the same
//     reason.
//   - SQRT of a negative is #VALUE!, where Sheets says #NUM!. Chosen by the
//     Phase 3 brief; both beat returning NaN.
//   - CONCAT is variadic here (Sheets caps it at two arguments and sends you
//     to CONCATENATE); it also joins the cells of a range.
//   - DATEDIF "MD"/"YD" clamp at 0 instead of reproducing Excel's documented
//     negative results for end-of-month inputs.
//   - Approximate VLOOKUP/MATCH scan linearly and take the LAST row that
//     qualifies. On sorted input — which those modes require — that is what a
//     binary search finds; on unsorted input Sheets is undefined anyway.

import {
  argBoolean,
  argInteger,
  argNumber,
  argText,
  classifyValue,
  collectNumbers,
  compareValues,
  divide,
  finiteOrError,
  firstArgError,
  firstScalarError,
  isBlank,
  isRangeValue,
  parseNumberText,
  partsFromSerial,
  rangeCells,
  rangeHeight,
  rangeValue,
  rangeWidth,
  roundHalfAwayFromZero,
  serialFromParts,
  toBoolean,
  toRange,
  toScalar,
  toText,
  valuesEqual,
  wholeDays,
  type FunctionArg,
  type RangeValue,
} from "./coerce";
import {
  cellError,
  isErrorValue,
  type CellValue,
  type ErrorValue,
} from "./types";

// --- Contract -------------------------------------------------------------

export interface FunctionContext {
  /**
   * "Now" as a date serial (days since 1899-12-30, fraction = time of day),
   * captured ONCE for a whole recalc so every NOW() in the pass agrees.
   * Build it with `serialFromLocalDate(new Date())` at the call site.
   */
  readonly now: number;
}

/**
 * An argument, deferred. The evaluator hands these over so a lazy function
 * can skip a branch; each thunk is invoked at most once per call.
 */
export type ArgThunk = () => FunctionArg;

export interface SheetFunction {
  /** Upper-case, matching `CallNode.name`. */
  readonly name: string;
  readonly minArgs: number;
  readonly maxArgs: number;
  /** True when the implementation decides which arguments to evaluate. */
  readonly lazy: boolean;
  /** For the formula-bar autocomplete of the UI wave. */
  readonly signature: string;
  readonly summary: string;
  /** A function may return a RangeValue (a 2D array); at the TOP LEVEL of a
   *  formula that array spills into neighbouring cells, and anywhere else it
   *  narrows to #VALUE! (the engine has no implicit broadcast). */
  readonly call: (args: readonly ArgThunk[], ctx: FunctionContext) => CellValue | RangeValue;
}

/**
 * Matches the parser's own per-call ceiling, so a formula that parses can
 * always be called.
 */
const MANY = 255;

/** Excel's per-cell text ceiling; past it a text result is a runaway. */
export const MAX_TEXT_LENGTH = 32_767;

/**
 * Which arguments are scanned for errors before the implementation runs.
 *   all     — any error, including one inside a range, is the result.
 *   scalars — only errors passed directly; functions that look into a range
 *             without consuming all of it decide for themselves.
 *   none    — the implementation handles errors (IFERROR, COUNTA).
 */
type ErrorPolicy = "all" | "scalars" | "none";

interface Spec {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly signature: string;
  readonly summary: string;
  readonly errors?: ErrorPolicy;
}

function fn(
  spec: Spec,
  impl: (args: readonly FunctionArg[], ctx: FunctionContext) => CellValue | RangeValue,
): SheetFunction {
  const policy = spec.errors ?? "all";
  return {
    name: spec.name,
    minArgs: spec.min,
    maxArgs: spec.max,
    lazy: false,
    signature: spec.signature,
    summary: spec.summary,
    call(thunks, ctx) {
      if (thunks.length < spec.min || thunks.length > spec.max) {
        return cellError("#N/A");
      }
      try {
        const args = thunks.map((thunk) => thunk());
        const failure =
          policy === "all"
            ? firstArgError(args)
            : policy === "scalars"
              ? firstScalarError(args)
              : null;
        if (failure) return failure;
        return impl(args, ctx);
      } catch {
        return cellError("#ERROR!");
      }
    },
  };
}

function lazyFn(
  spec: Spec,
  impl: (args: readonly ArgThunk[], ctx: FunctionContext) => CellValue | RangeValue,
): SheetFunction {
  return {
    name: spec.name,
    minArgs: spec.min,
    maxArgs: spec.max,
    lazy: true,
    signature: spec.signature,
    summary: spec.summary,
    call(thunks, ctx) {
      if (thunks.length < spec.min || thunks.length > spec.max) {
        return cellError("#N/A");
      }
      try {
        return impl(thunks, ctx);
      } catch {
        return cellError("#ERROR!");
      }
    },
  };
}

// --- Shared helpers -------------------------------------------------------

/**
 * The logical population of AND/OR: booleans and numbers, whether they come
 * in as scalars or as cells. Text and blanks inside a range are ignored the
 * way Sheets ignores them, but a text SCALAR is a mistake worth reporting, so
 * it comes back as #VALUE! from the strict coercion.
 */
function collectBooleans(args: readonly FunctionArg[]): boolean[] | ErrorValue {
  const out: boolean[] = [];
  for (const arg of args) {
    if (isRangeValue(arg)) {
      for (const cell of rangeCells(arg)) {
        if (isErrorValue(cell)) return cell;
        if (typeof cell === "boolean") out.push(cell);
        else if (typeof cell === "number") out.push(cell !== 0);
      }
      continue;
    }
    const bool = toBoolean(arg);
    if (isErrorValue(bool)) return bool;
    out.push(bool);
  }
  return out;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `*` is any run, `?` is one character, `~` escapes either (and itself).
 * Returns null only when the text holds neither a wildcard nor an escape, so
 * the caller can use plain equality and stay fast. An escape still needs the
 * pattern: "a~*b" must match the literal "a*b" and not the text "a~*b".
 */
function wildcardRegExp(pattern: string): RegExp | null {
  let hasWildcard = false;
  let hasEscape = false;
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~") {
      const next = pattern[i + 1];
      if (next === "*" || next === "?" || next === "~") {
        hasEscape = true;
        source += escapeRegExp(next);
        i++;
        continue;
      }
      source += "~";
      continue;
    }
    if (ch === "*") {
      hasWildcard = true;
      source += "[\\s\\S]*";
      continue;
    }
    if (ch === "?") {
      hasWildcard = true;
      source += "[\\s\\S]";
      continue;
    }
    source += escapeRegExp(ch);
  }
  if (!hasWildcard && !hasEscape) return null;
  return new RegExp(`^${source}$`, "i");
}

type Predicate = (cell: CellValue) => boolean;

/**
 * Equality as the *IF family and the lookups mean it, which is NOT the `=`
 * operator: a blank cell matches only a blank or empty criterion, never the
 * 0 that `A1=0` would accept. Counting empty rows as zeros is the classic way
 * a spreadsheet lies about its data.
 */
function equalityPredicate(operand: CellValue): Predicate {
  if (isBlank(operand) || operand === "") {
    return (cell) => isBlank(cell) || cell === "";
  }
  const pattern = typeof operand === "string" ? wildcardRegExp(operand) : null;
  if (pattern) return (cell) => typeof cell === "string" && pattern.test(cell);
  return (cell) => !isBlank(cell) && valuesEqual(cell, operand);
}

const CRITERION_OP_RE = /^(<=|>=|<>|=|<|>)/;

/** ">5" and "TRUE" are a number and a boolean; anything else stays text. */
function criterionOperand(text: string): CellValue {
  const num = parseNumberText(text, { allowDates: false });
  if (num !== null) return num;
  const word = text.trim().toUpperCase();
  if (word === "TRUE") return true;
  if (word === "FALSE") return false;
  return text;
}

/** COUNTIF/SUMIF/AVERAGEIF criteria: a value, or text carrying an operator. */
function criterionPredicate(criterion: CellValue): Predicate {
  if (typeof criterion !== "string") return equalityPredicate(criterion);

  const match = CRITERION_OP_RE.exec(criterion);
  const op = match ? match[1] : "=";
  // A bare "5" is the NUMBER five, not the text: COUNTIF(range,"5") has to
  // find numeric fives, which is the only reason the criterion is text here.
  const operand = criterionOperand(match ? criterion.slice(match[1].length) : criterion);

  if (op === "=" || op === "<>") {
    const equals = equalityPredicate(operand);
    return op === "=" ? equals : (cell) => !equals(cell);
  }

  return (cell) => {
    // A blank is not "greater than 5"; it is nothing at all.
    if (isBlank(cell) || isErrorValue(cell)) return false;
    if (classifyValue(cell) !== classifyValue(operand)) return false;
    const order = compareValues(cell, operand);
    if (order === null) return false;
    if (op === "<") return order < 0;
    if (op === "<=") return order <= 0;
    if (op === ">") return order > 0;
    return order >= 0;
  };
}

/**
 * Approximate lookup: the last row whose value is on the correct side of the
 * key and of the same type. Cross-type "matches" (text against a number) are
 * skipped rather than ordered, because numbers < text is a sorting rule, not
 * a statement that "apple" is a plausible answer for 5.
 */
function approximateIndex(
  cells: readonly CellValue[],
  key: CellValue,
  descending: boolean,
): number | null {
  const keyClass = classifyValue(key);
  if (keyClass === "blank" || keyClass === "error") return null;
  let found: number | null = null;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (classifyValue(cell) !== keyClass) continue;
    const order = compareValues(cell, key);
    if (order === null) continue;
    if (descending ? order >= 0 : order <= 0) found = i;
  }
  return found;
}

/** Lookup keys match like criteria, wildcards included, minus the operators. */
function exactIndex(cells: readonly CellValue[], key: CellValue): number | null {
  const matches = equalityPredicate(key);
  for (let i = 0; i < cells.length; i++) {
    if (isErrorValue(cells[i])) continue;
    if (matches(cells[i])) return i;
  }
  return null;
}

/** A found-but-empty cell reads as 0, as it does in Sheets and Excel. */
function lookupResult(cell: CellValue): CellValue {
  return isBlank(cell) ? 0 : cell;
}

function firstColumn(table: RangeValue): CellValue[] {
  return table.rows.map((row) => row[0] ?? null);
}

function cappedText(text: string): CellValue {
  return text.length > MAX_TEXT_LENGTH ? cellError("#VALUE!") : text;
}

// --- Aggregates -----------------------------------------------------------

const SUM_FN = fn(
  {
    name: "SUM",
    min: 1,
    max: MANY,
    signature: "SUM(value1, [value2, …])",
    summary: "Adds numbers; text and blanks in a range are skipped.",
  },
  (args) => {
    const numbers = collectNumbers(args);
    if (isErrorValue(numbers)) return numbers;
    return finiteOrError(sum(numbers));
  },
);

const AVERAGE_IMPL = (args: readonly FunctionArg[]): CellValue => {
  const numbers = collectNumbers(args);
  if (isErrorValue(numbers)) return numbers;
  if (numbers.length === 0) return cellError("#DIV/0!");
  return divide(sum(numbers), numbers.length);
};

const AVERAGE_FN = fn(
  {
    name: "AVERAGE",
    min: 1,
    max: MANY,
    signature: "AVERAGE(value1, [value2, …])",
    summary: "Mean of the numbers; blanks are not part of the population.",
  },
  AVERAGE_IMPL,
);

// The pre-Phase-3 column engine shipped AVG, so stored formulas use it.
const AVG_FN: SheetFunction = {
  ...AVERAGE_FN,
  name: "AVG",
  signature: "AVG(value1, [value2, …])",
  summary: "Alias of AVERAGE, kept for formulas written before Phase 3.",
};

const MIN_FN = fn(
  {
    name: "MIN",
    min: 1,
    max: MANY,
    signature: "MIN(value1, [value2, …])",
    summary: "Smallest number, or 0 when there is no number at all.",
  },
  (args) => {
    const numbers = collectNumbers(args);
    if (isErrorValue(numbers)) return numbers;
    return numbers.length === 0 ? 0 : Math.min(...numbers);
  },
);

const MAX_FN = fn(
  {
    name: "MAX",
    min: 1,
    max: MANY,
    signature: "MAX(value1, [value2, …])",
    summary: "Largest number, or 0 when there is no number at all.",
  },
  (args) => {
    const numbers = collectNumbers(args);
    if (isErrorValue(numbers)) return numbers;
    return numbers.length === 0 ? 0 : Math.max(...numbers);
  },
);

const COUNT_FN = fn(
  {
    name: "COUNT",
    min: 1,
    max: MANY,
    signature: "COUNT(value1, [value2, …])",
    summary: "Counts numbers only. Blanks, text and errors do not count.",
    errors: "scalars",
  },
  (args) => {
    let count = 0;
    for (const arg of args) {
      if (isRangeValue(arg)) {
        for (const cell of rangeCells(arg)) {
          if (typeof cell === "number" && Number.isFinite(cell)) count++;
        }
        continue;
      }
      if (isBlank(arg)) continue;
      // A number typed straight into the call counts even as text ("3"),
      // which is Excel's rule for direct arguments.
      if (!isErrorValue(argNumber(arg))) count++;
    }
    return count;
  },
);

const COUNTA_FN = fn(
  {
    name: "COUNTA",
    min: 1,
    max: MANY,
    signature: "COUNTA(value1, [value2, …])",
    summary: "Counts everything that is not blank, errors included.",
    errors: "none",
  },
  (args) => {
    let count = 0;
    for (const arg of args) {
      if (isRangeValue(arg)) {
        for (const cell of rangeCells(arg)) if (!isBlank(cell)) count++;
        continue;
      }
      if (!isBlank(arg)) count++;
    }
    return count;
  },
);

// --- Logic ----------------------------------------------------------------

const IF_FN = lazyFn(
  {
    name: "IF",
    min: 2,
    max: 3,
    signature: "IF(condition, then, [otherwise])",
    summary: "Evaluates only the branch it returns.",
  },
  (args) => {
    const condition = toBoolean(toScalar(args[0]()));
    if (isErrorValue(condition)) return condition;
    if (condition) return toScalar(args[1]());
    return args.length > 2 ? toScalar(args[2]()) : false;
  },
);

const IFERROR_FN = lazyFn(
  {
    name: "IFERROR",
    min: 1,
    max: 2,
    signature: "IFERROR(value, [fallback])",
    summary: "Replaces an error VALUE; it does not catch a crash.",
  },
  (args) => {
    // A multi-cell range narrows to #VALUE! here and so takes the fallback.
    // That is the honest reading while the engine has no array results: the
    // formula did fail to produce one value.
    const value = toScalar(args[0]());
    if (!isErrorValue(value)) return value;
    return args.length > 1 ? toScalar(args[1]()) : "";
  },
);

const AND_FN = fn(
  {
    name: "AND",
    min: 1,
    max: MANY,
    signature: "AND(logical1, [logical2, …])",
    summary: "True when every logical value is true.",
  },
  (args) => {
    const values = collectBooleans(args);
    if (isErrorValue(values)) return values;
    if (values.length === 0) return cellError("#VALUE!");
    return values.every(Boolean);
  },
);

const OR_FN = fn(
  {
    name: "OR",
    min: 1,
    max: MANY,
    signature: "OR(logical1, [logical2, …])",
    summary: "True when any logical value is true.",
  },
  (args) => {
    const values = collectBooleans(args);
    if (isErrorValue(values)) return values;
    if (values.length === 0) return cellError("#VALUE!");
    return values.some(Boolean);
  },
);

const NOT_FN = fn(
  {
    name: "NOT",
    min: 1,
    max: 1,
    signature: "NOT(logical)",
    summary: "Inverts a logical value.",
  },
  (args) => {
    const value = argBoolean(args[0]);
    if (isErrorValue(value)) return value;
    return !value;
  },
);

// --- Text -----------------------------------------------------------------

const CONCAT_FN = fn(
  {
    name: "CONCAT",
    min: 1,
    max: MANY,
    signature: "CONCAT(value1, [value2, …])",
    summary: "Joins values, and the cells of a range, into one string.",
  },
  (args) => {
    let out = "";
    for (const arg of args) {
      if (isRangeValue(arg)) {
        for (const cell of rangeCells(arg)) {
          const text = toText(cell);
          if (isErrorValue(text)) return text;
          out += text;
          if (out.length > MAX_TEXT_LENGTH) return cellError("#VALUE!");
        }
        continue;
      }
      const text = toText(arg);
      if (isErrorValue(text)) return text;
      out += text;
      if (out.length > MAX_TEXT_LENGTH) return cellError("#VALUE!");
    }
    return out;
  },
);

function sideOfText(
  args: readonly FunctionArg[],
  take: (text: string, count: number) => string,
): CellValue {
  const text = argText(args[0]);
  if (isErrorValue(text)) return text;
  const count = args.length > 1 ? argInteger(args[1]) : 1;
  if (isErrorValue(count)) return count;
  if (count < 0) return cellError("#VALUE!");
  return take(text, count);
}

const LEFT_FN = fn(
  {
    name: "LEFT",
    min: 1,
    max: 2,
    signature: "LEFT(text, [count])",
    summary: "First `count` characters (default 1).",
  },
  (args) => sideOfText(args, (text, count) => text.slice(0, count)),
);

const RIGHT_FN = fn(
  {
    name: "RIGHT",
    min: 1,
    max: 2,
    signature: "RIGHT(text, [count])",
    summary: "Last `count` characters (default 1).",
  },
  (args) => sideOfText(args, (text, count) => text.slice(text.length - count)),
);

const MID_FN = fn(
  {
    name: "MID",
    min: 3,
    max: 3,
    signature: "MID(text, start, count)",
    summary: "`count` characters from 1-based position `start`.",
  },
  (args) => {
    const text = argText(args[0]);
    if (isErrorValue(text)) return text;
    const start = argInteger(args[1]);
    if (isErrorValue(start)) return start;
    const count = argInteger(args[2]);
    if (isErrorValue(count)) return count;
    if (start < 1 || count < 0) return cellError("#VALUE!");
    return text.slice(start - 1, start - 1 + count);
  },
);

const LEN_FN = fn(
  {
    name: "LEN",
    min: 1,
    max: 1,
    signature: "LEN(text)",
    summary: "Character count of the text form of a value.",
  },
  (args) => {
    const text = argText(args[0]);
    if (isErrorValue(text)) return text;
    return text.length;
  },
);

const TRIM_FN = fn(
  {
    name: "TRIM",
    min: 1,
    max: 1,
    signature: "TRIM(text)",
    summary: "Trims the ends and collapses inner runs of whitespace.",
  },
  (args) => {
    const text = argText(args[0]);
    if (isErrorValue(text)) return text;
    return text.replace(/\s+/g, " ").trim();
  },
);

const UPPER_FN = fn(
  {
    name: "UPPER",
    min: 1,
    max: 1,
    signature: "UPPER(text)",
    summary: "Upper case.",
  },
  (args) => {
    const text = argText(args[0]);
    if (isErrorValue(text)) return text;
    return text.toUpperCase();
  },
);

const LOWER_FN = fn(
  {
    name: "LOWER",
    min: 1,
    max: 1,
    signature: "LOWER(text)",
    summary: "Lower case.",
  },
  (args) => {
    const text = argText(args[0]);
    if (isErrorValue(text)) return text;
    return text.toLowerCase();
  },
);

const SUBSTITUTE_FN = fn(
  {
    name: "SUBSTITUTE",
    min: 3,
    max: 4,
    signature: "SUBSTITUTE(text, search, replacement, [instance])",
    summary: "Replaces every occurrence, or only the nth. Case-sensitive.",
  },
  (args) => {
    const text = argText(args[0]);
    if (isErrorValue(text)) return text;
    const search = argText(args[1]);
    if (isErrorValue(search)) return search;
    const replacement = argText(args[2]);
    if (isErrorValue(replacement)) return replacement;
    // An empty search would match at every position; Excel returns the text
    // untouched rather than interleaving the replacement.
    if (search === "") return text;

    if (args.length < 4) {
      return cappedText(text.split(search).join(replacement));
    }
    const instance = argInteger(args[3]);
    if (isErrorValue(instance)) return instance;
    if (instance < 1) return cellError("#VALUE!");

    let from = 0;
    for (let seen = 1; ; seen++) {
      const at = text.indexOf(search, from);
      if (at < 0) return text;
      if (seen === instance) {
        return cappedText(
          text.slice(0, at) + replacement + text.slice(at + search.length),
        );
      }
      from = at + search.length;
    }
  },
);

// --- Math -----------------------------------------------------------------

const ROUND_FN = fn(
  {
    name: "ROUND",
    min: 1,
    max: 2,
    signature: "ROUND(value, [places])",
    summary: "Half away from zero: ROUND(-2.5) is -3.",
  },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    const places = args.length > 1 ? argInteger(args[1]) : 0;
    if (isErrorValue(places)) return places;
    return finiteOrError(roundHalfAwayFromZero(value, places));
  },
);

const ABS_FN = fn(
  {
    name: "ABS",
    min: 1,
    max: 1,
    signature: "ABS(value)",
    summary: "Absolute value.",
  },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    return Math.abs(value);
  },
);

const POW_FN = fn(
  {
    name: "POW",
    min: 2,
    max: 2,
    signature: "POW(base, exponent)",
    summary: "base to the power of exponent.",
  },
  (args) => {
    const base = argNumber(args[0]);
    if (isErrorValue(base)) return base;
    const exponent = argNumber(args[1]);
    if (isErrorValue(exponent)) return exponent;
    // 0^-1 is a division by zero, not an overflow.
    if (base === 0 && exponent < 0) return cellError("#DIV/0!");
    const result = Math.pow(base, exponent);
    // A negative base with a fractional exponent has no real root.
    if (Number.isNaN(result)) return cellError("#NUM!");
    return finiteOrError(result);
  },
);

const SQRT_FN = fn(
  {
    name: "SQRT",
    min: 1,
    max: 1,
    signature: "SQRT(value)",
    summary: "Square root; a negative value is #VALUE!.",
  },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    if (value < 0) return cellError("#VALUE!");
    return Math.sqrt(value);
  },
);

const MOD_FN = fn(
  {
    name: "MOD",
    min: 2,
    max: 2,
    signature: "MOD(dividend, divisor)",
    summary: "Remainder carrying the SIGN OF THE DIVISOR, unlike JS %.",
  },
  (args) => {
    const dividend = argNumber(args[0]);
    if (isErrorValue(dividend)) return dividend;
    const divisor = argNumber(args[1]);
    if (isErrorValue(divisor)) return divisor;
    if (divisor === 0) return cellError("#DIV/0!");
    // MOD(-3,2) is 1 and MOD(3,-2) is -1; `%` would answer -1 and 1.
    return finiteOrError(dividend - divisor * Math.floor(dividend / divisor));
  },
);

// --- Dates ----------------------------------------------------------------

const TODAY_FN = fn(
  {
    name: "TODAY",
    min: 0,
    max: 0,
    signature: "TODAY()",
    summary: "Today's date serial, from the recalc's clock.",
  },
  (_args, ctx) => finiteOrError(wholeDays(ctx.now)),
);

const NOW_FN = fn(
  {
    name: "NOW",
    min: 0,
    max: 0,
    signature: "NOW()",
    summary: "Date serial including the time of day.",
  },
  (_args, ctx) => finiteOrError(ctx.now),
);

const DATE_FN = fn(
  {
    name: "DATE",
    min: 3,
    max: 3,
    signature: "DATE(year, month, day)",
    summary: "Builds a date serial; out-of-range parts roll over.",
  },
  (args) => {
    const year = argInteger(args[0]);
    if (isErrorValue(year)) return year;
    const month = argInteger(args[1]);
    if (isErrorValue(month)) return month;
    const day = argInteger(args[2]);
    if (isErrorValue(day)) return day;
    if (year < 0) return cellError("#NUM!");
    // 0..1899 is shorthand for 1900..3799, the rule Sheets inherited from
    // Excel. Year 1899 and earlier is therefore unreachable through DATE.
    const fullYear = year < 1900 ? year + 1900 : year;
    return finiteOrError(serialFromParts(fullYear, month, day));
  },
);

function wholeMonthsBetween(
  from: { year: number; month: number; day: number },
  to: { year: number; month: number; day: number },
): number {
  const months = (to.year - from.year) * 12 + (to.month - from.month);
  return to.day < from.day ? months - 1 : months;
}

const DATEDIF_FN = fn(
  {
    name: "DATEDIF",
    min: 3,
    max: 3,
    signature: 'DATEDIF(start, end, unit)  unit: "Y" "M" "D" "MD" "YM" "YD"',
    summary: "Whole units between two dates; end before start is #NUM!.",
  },
  (args) => {
    const start = argNumber(args[0]);
    if (isErrorValue(start)) return start;
    const end = argNumber(args[1]);
    if (isErrorValue(end)) return end;
    const unitText = argText(args[2]);
    if (isErrorValue(unitText)) return unitText;

    const startDay = wholeDays(start);
    const endDay = wholeDays(end);
    if (endDay < startDay) return cellError("#NUM!");
    const from = partsFromSerial(startDay);
    const to = partsFromSerial(endDay);
    if (!from || !to) return cellError("#NUM!");

    switch (unitText.trim().toUpperCase()) {
      case "D":
        return endDay - startDay;
      case "M":
        return wholeMonthsBetween(from, to);
      case "Y":
        return Math.floor(wholeMonthsBetween(from, to) / 12);
      case "YM":
        return wholeMonthsBetween(from, to) % 12;
      case "MD": {
        let year = to.year;
        let month = to.month;
        if (to.day < from.day) {
          month -= 1;
          if (month === 0) {
            month = 12;
            year -= 1;
          }
        }
        // Clamped: a 31st anchored into a short month rolls forward, which is
        // where Excel starts returning negatives.
        return Math.max(0, endDay - serialFromParts(year, month, from.day));
      }
      case "YD": {
        const year =
          to.month < from.month || (to.month === from.month && to.day < from.day)
            ? to.year - 1
            : to.year;
        return Math.max(0, endDay - serialFromParts(year, from.month, from.day));
      }
      default:
        return cellError("#NUM!");
    }
  },
);

// --- Conditional aggregates -----------------------------------------------

interface ConditionalParts {
  readonly cells: CellValue[];
  readonly targets: CellValue[];
  readonly matches: Predicate;
}

function conditionalParts(
  args: readonly FunctionArg[],
): ConditionalParts | ErrorValue {
  const range = toRange(args[0]);
  const criterion = toScalar(args[1]);
  if (isErrorValue(criterion)) return criterion;
  const target = args.length > 2 ? toRange(args[2]) : range;
  // Sheets refuses a mismatched second range rather than guessing an
  // alignment; a silently offset sum is worse than an error.
  if (
    rangeHeight(target) !== rangeHeight(range) ||
    rangeWidth(target) !== rangeWidth(range)
  ) {
    return cellError("#VALUE!");
  }
  return {
    cells: rangeCells(range),
    targets: rangeCells(target),
    matches: criterionPredicate(criterion),
  };
}

/** Numbers of the cells whose companion in the test range matched. */
function matchedNumbers(parts: ConditionalParts): number[] | ErrorValue {
  const out: number[] = [];
  for (let i = 0; i < parts.cells.length; i++) {
    const cell = parts.cells[i];
    if (isErrorValue(cell) || !parts.matches(cell)) continue;
    const target = parts.targets[i];
    // A matched cell that is poison cannot be summed around.
    if (isErrorValue(target)) return target;
    if (typeof target === "number" && Number.isFinite(target)) out.push(target);
  }
  return out;
}

const COUNTIF_FN = fn(
  {
    name: "COUNTIF",
    min: 2,
    max: 2,
    signature: "COUNTIF(range, criterion)",
    summary: 'Counts matches. Criterion may be ">5", "<>x" or use * and ?.',
    errors: "scalars",
  },
  (args) => {
    const criterion = toScalar(args[1]);
    if (isErrorValue(criterion)) return criterion;
    const matches = criterionPredicate(criterion);
    let count = 0;
    for (const cell of rangeCells(toRange(args[0]))) {
      if (isErrorValue(cell)) continue;
      if (matches(cell)) count++;
    }
    return count;
  },
);

const SUMIF_FN = fn(
  {
    name: "SUMIF",
    min: 2,
    max: 3,
    signature: "SUMIF(range, criterion, [sum_range])",
    summary: "Adds the cells whose companion matched.",
    errors: "scalars",
  },
  (args) => {
    const parts = conditionalParts(args);
    if (isErrorValue(parts)) return parts;
    const numbers = matchedNumbers(parts);
    if (isErrorValue(numbers)) return numbers;
    return finiteOrError(sum(numbers));
  },
);

const AVERAGEIF_FN = fn(
  {
    name: "AVERAGEIF",
    min: 2,
    max: 3,
    signature: "AVERAGEIF(range, criterion, [average_range])",
    summary: "Mean of the matched cells; #DIV/0! when nothing matches.",
    errors: "scalars",
  },
  (args) => {
    const parts = conditionalParts(args);
    if (isErrorValue(parts)) return parts;
    const numbers = matchedNumbers(parts);
    if (isErrorValue(numbers)) return numbers;
    if (numbers.length === 0) return cellError("#DIV/0!");
    return divide(sum(numbers), numbers.length);
  },
);

// --- Lookup ---------------------------------------------------------------

const VLOOKUP_FN = fn(
  {
    name: "VLOOKUP",
    min: 3,
    max: 4,
    signature: "VLOOKUP(key, range, index, [is_sorted])",
    summary: "is_sorted defaults to TRUE (approximate); pass FALSE for exact.",
    errors: "scalars",
  },
  (args) => {
    const key = toScalar(args[0]);
    if (isErrorValue(key)) return key;
    const table = toRange(args[1]);
    const index = argInteger(args[2]);
    if (isErrorValue(index)) return index;
    const sorted = args.length > 3 ? argBoolean(args[3]) : true;
    if (isErrorValue(sorted)) return sorted;

    if (index < 1) return cellError("#VALUE!");
    if (index > rangeWidth(table)) return cellError("#REF!");

    const column = firstColumn(table);
    const row = sorted
      ? approximateIndex(column, key, false)
      : exactIndex(column, key);
    if (row === null) return cellError("#N/A");
    return lookupResult(table.rows[row][index - 1]);
  },
);

function indexAt(range: RangeValue, row: number, col: number): CellValue {
  if (row < 1 || col < 1) return cellError("#VALUE!");
  if (row > rangeHeight(range) || col > rangeWidth(range)) {
    return cellError("#REF!");
  }
  return lookupResult(range.rows[row - 1][col - 1]);
}

const INDEX_FN = fn(
  {
    name: "INDEX",
    min: 2,
    max: 3,
    signature: "INDEX(range, row, [column])",
    summary: "1-based cell pick. Index 0 (whole row/column) is unsupported.",
    errors: "scalars",
  },
  (args) => {
    const range = toRange(args[0]);
    if (rangeHeight(range) === 0 || rangeWidth(range) === 0) {
      return cellError("#REF!");
    }
    const first = argInteger(args[1]);
    if (isErrorValue(first)) return first;
    if (args.length > 2) {
      const second = argInteger(args[2]);
      if (isErrorValue(second)) return second;
      return indexAt(range, first, second);
    }
    // One index is enough only for a vector, where there is no ambiguity.
    if (rangeWidth(range) === 1) return indexAt(range, first, 1);
    if (rangeHeight(range) === 1) return indexAt(range, 1, first);
    return cellError("#VALUE!");
  },
);

const MATCH_FN = fn(
  {
    name: "MATCH",
    min: 2,
    max: 3,
    signature: "MATCH(key, range, [type])",
    summary: "Position in a vector. type 1 (default) ascending, 0 exact, -1 descending.",
    errors: "scalars",
  },
  (args) => {
    const key = toScalar(args[0]);
    if (isErrorValue(key)) return key;
    const range = toRange(args[1]);
    const type = args.length > 2 ? argInteger(args[2]) : 1;
    if (isErrorValue(type)) return type;
    // MATCH walks a single row or column; a block has no linear position.
    if (rangeWidth(range) !== 1 && rangeHeight(range) !== 1) {
      return cellError("#N/A");
    }
    const cells = rangeCells(range);
    const found =
      type === 0
        ? exactIndex(cells, key)
        : approximateIndex(cells, key, type < 0);
    if (found === null) return cellError("#N/A");
    return found + 1;
  },
);

// --- Registry -------------------------------------------------------------

// --- Rounding and integers ------------------------------------------------

/** Snap an IEEE-754 product or quotient to a double's real 15-digit
 *  precision before a ceil/floor/trunc, so 0.29 * 100 (which is actually
 *  28.999999999999996) is not cut down a whole unit to 28. This is the same
 *  correction ROUND makes in `roundHalfAwayFromZero`; without it ROUNDUP/
 *  ROUNDDOWN/TRUNC/CEILING/FLOOR are off by one on common money inputs. */
function snapPrecision(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(15)) : value;
}

/** Round `value` at `places` decimals: "up" is away from zero, "down" is
 *  toward it (so ROUNDDOWN and TRUNC share this). */
function scaledRound(value: number, places: number, away: boolean): number {
  const factor = 10 ** places;
  const scaled = snapPrecision(value * factor);
  const whole = away
    ? scaled >= 0
      ? Math.ceil(scaled)
      : Math.floor(scaled)
    : Math.trunc(scaled);
  return whole / factor;
}

const ROUNDUP_FN = fn(
  {
    name: "ROUNDUP",
    min: 1,
    max: 2,
    signature: "ROUNDUP(value, [places])",
    summary: "Rounds away from zero: ROUNDUP(3.141, 1) is 3.2.",
  },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    const places = args.length > 1 ? argInteger(args[1]) : 0;
    if (isErrorValue(places)) return places;
    return finiteOrError(scaledRound(value, places, true));
  },
);

const ROUNDDOWN_FN = fn(
  {
    name: "ROUNDDOWN",
    min: 1,
    max: 2,
    signature: "ROUNDDOWN(value, [places])",
    summary: "Rounds toward zero: ROUNDDOWN(3.99, 0) is 3.",
  },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    const places = args.length > 1 ? argInteger(args[1]) : 0;
    if (isErrorValue(places)) return places;
    return finiteOrError(scaledRound(value, places, false));
  },
);

const TRUNC_FN = fn(
  {
    name: "TRUNC",
    min: 1,
    max: 2,
    signature: "TRUNC(value, [places])",
    summary: "Drops digits past `places` without rounding (toward zero).",
  },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    const places = args.length > 1 ? argInteger(args[1]) : 0;
    if (isErrorValue(places)) return places;
    return finiteOrError(scaledRound(value, places, false));
  },
);

const INT_FN = fn(
  {
    name: "INT",
    min: 1,
    max: 1,
    signature: "INT(value)",
    summary: "Rounds down toward minus infinity: INT(-2.1) is -3.",
  },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    return finiteOrError(Math.floor(value));
  },
);

const CEILING_FN = fn(
  {
    name: "CEILING",
    min: 1,
    max: 2,
    signature: "CEILING(value, [factor])",
    summary: "Rounds up to the nearest multiple of factor (default 1).",
  },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    const factor = args.length > 1 ? argNumber(args[1]) : 1;
    if (isErrorValue(factor)) return factor;
    if (factor === 0) return 0;
    // Snap the quotient before the ceil AND the product after it: 3 * 0.1 is
    // 0.30000000000000004, so multiplying back by a non-power-of-ten factor
    // reintroduces the error the first snap removed.
    return finiteOrError(snapPrecision(Math.ceil(snapPrecision(value / factor)) * factor));
  },
);

const FLOOR_FN = fn(
  {
    name: "FLOOR",
    min: 1,
    max: 2,
    signature: "FLOOR(value, [factor])",
    summary: "Rounds down to the nearest multiple of factor (default 1).",
  },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    const factor = args.length > 1 ? argNumber(args[1]) : 1;
    if (isErrorValue(factor)) return factor;
    if (factor === 0) return 0;
    // Snap the quotient before the floor AND the product after it (see CEILING).
    return finiteOrError(snapPrecision(Math.floor(snapPrecision(value / factor)) * factor));
  },
);

const SIGN_FN = fn(
  {
    name: "SIGN",
    min: 1,
    max: 1,
    signature: "SIGN(value)",
    summary: "1, -1 or 0 for the sign of value.",
  },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    return value > 0 ? 1 : value < 0 ? -1 : 0;
  },
);

const PRODUCT_FN = fn(
  {
    name: "PRODUCT",
    min: 1,
    max: MANY,
    signature: "PRODUCT(value1, [value2, …])",
    summary: "Multiplies its numbers; empty ranges contribute nothing.",
  },
  (args) => {
    const numbers = collectNumbers(args);
    if (isErrorValue(numbers)) return numbers;
    if (numbers.length === 0) return 0;
    let out = 1;
    for (const n of numbers) out *= n;
    return finiteOrError(out);
  },
);

const MEDIAN_FN = fn(
  {
    name: "MEDIAN",
    min: 1,
    max: MANY,
    signature: "MEDIAN(value1, [value2, …])",
    summary: "The middle value; the mean of the two middles for an even count.",
  },
  (args) => {
    const numbers = collectNumbers(args);
    if (isErrorValue(numbers)) return numbers;
    if (numbers.length === 0) return cellError("#NUM!");
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : divide(sorted[mid - 1] + sorted[mid], 2);
  },
);

// POWER is the standard spelling of POW; share its implementation.
const POWER_FN: SheetFunction = {
  ...POW_FN,
  name: "POWER",
  signature: "POWER(base, exponent)",
};

// --- Logical (extended) ---------------------------------------------------

const XOR_FN = fn(
  {
    name: "XOR",
    min: 1,
    max: MANY,
    signature: "XOR(logical1, [logical2, …])",
    summary: "True when an odd number of the logical values are true.",
  },
  (args) => {
    const values = collectBooleans(args);
    if (isErrorValue(values)) return values;
    if (values.length === 0) return cellError("#VALUE!");
    return values.filter(Boolean).length % 2 === 1;
  },
);

const IFS_FN = lazyFn(
  {
    name: "IFS",
    min: 2,
    max: MANY,
    signature: "IFS(condition1, value1, [condition2, value2, …])",
    summary: "Returns the value of the first true condition; #N/A if none.",
  },
  (args) => {
    for (let i = 0; i + 1 < args.length; i += 2) {
      const cond = toBoolean(toScalar(args[i]()));
      if (isErrorValue(cond)) return cond;
      if (cond) return toScalar(args[i + 1]());
    }
    return cellError("#N/A");
  },
);

const SWITCH_FN = lazyFn(
  {
    name: "SWITCH",
    min: 3,
    max: MANY,
    signature: "SWITCH(expression, case1, value1, [case2, value2, …], [default])",
    summary: "Compares expression to each case; a lone trailing arg is the default.",
  },
  (args) => {
    const subject = toScalar(args[0]());
    if (isErrorValue(subject)) return subject;
    let i = 1;
    for (; i + 1 < args.length; i += 2) {
      const candidate = toScalar(args[i]());
      if (isErrorValue(candidate)) return candidate;
      if (valuesEqual(subject, candidate)) return toScalar(args[i + 1]());
    }
    // One argument left over is the default.
    return i < args.length ? toScalar(args[i]()) : cellError("#N/A");
  },
);

const IFNA_FN = lazyFn(
  {
    name: "IFNA",
    min: 2,
    max: 2,
    signature: "IFNA(value, value_if_na)",
    summary: "Replaces #N/A only; every other error passes through.",
  },
  (args) => {
    const value = toScalar(args[0]());
    if (isErrorValue(value) && value.err === "#N/A") return toScalar(args[1]());
    return value;
  },
);

// --- Text (extended) ------------------------------------------------------

// CONCATENATE is the legacy spelling of CONCAT with identical behaviour.
const CONCATENATE_FN: SheetFunction = {
  ...CONCAT_FN,
  name: "CONCATENATE",
  signature: "CONCATENATE(value1, [value2, …])",
};

const PROPER_FN = fn(
  {
    name: "PROPER",
    min: 1,
    max: 1,
    signature: "PROPER(text)",
    summary: "Capitalises the first letter of each word, lowercases the rest.",
  },
  (args) => {
    const text = argText(args[0]);
    if (isErrorValue(text)) return text;
    let out = "";
    let prevLetter = false;
    for (const ch of text) {
      const isLetter = /\p{L}/u.test(ch);
      out += isLetter && !prevLetter ? ch.toUpperCase() : ch.toLowerCase();
      prevLetter = isLetter;
    }
    return out;
  },
);

const REPT_FN = fn(
  {
    name: "REPT",
    min: 2,
    max: 2,
    signature: "REPT(text, count)",
    summary: "Repeats text count times.",
  },
  (args) => {
    const text = argText(args[0]);
    if (isErrorValue(text)) return text;
    const count = argInteger(args[1]);
    if (isErrorValue(count)) return count;
    if (count < 0) return cellError("#VALUE!");
    if (text.length * count > MAX_TEXT_LENGTH) return cellError("#VALUE!");
    return text.repeat(count);
  },
);

const EXACT_FN = fn(
  {
    name: "EXACT",
    min: 2,
    max: 2,
    signature: "EXACT(text1, text2)",
    summary: "True when the two texts match exactly, case included.",
  },
  (args) => {
    const a = argText(args[0]);
    if (isErrorValue(a)) return a;
    const b = argText(args[1]);
    if (isErrorValue(b)) return b;
    return a === b;
  },
);

const FIND_FN = fn(
  {
    name: "FIND",
    min: 2,
    max: 3,
    signature: "FIND(needle, haystack, [start])",
    summary: "Case-sensitive 1-based position of needle; #VALUE! if absent.",
  },
  (args) => {
    const needle = argText(args[0]);
    if (isErrorValue(needle)) return needle;
    const haystack = argText(args[1]);
    if (isErrorValue(haystack)) return haystack;
    const start = args.length > 2 ? argInteger(args[2]) : 1;
    if (isErrorValue(start)) return start;
    if (start < 1) return cellError("#VALUE!");
    const at = haystack.indexOf(needle, start - 1);
    return at < 0 ? cellError("#VALUE!") : at + 1;
  },
);

const SEARCH_FN = fn(
  {
    name: "SEARCH",
    min: 2,
    max: 3,
    signature: "SEARCH(needle, haystack, [start])",
    summary: "Case-insensitive 1-based position of needle; #VALUE! if absent.",
  },
  (args) => {
    const needle = argText(args[0]);
    if (isErrorValue(needle)) return needle;
    const haystack = argText(args[1]);
    if (isErrorValue(haystack)) return haystack;
    const start = args.length > 2 ? argInteger(args[2]) : 1;
    if (isErrorValue(start)) return start;
    if (start < 1) return cellError("#VALUE!");
    const at = haystack.toLowerCase().indexOf(needle.toLowerCase(), start - 1);
    return at < 0 ? cellError("#VALUE!") : at + 1;
  },
);

const VALUE_FN = fn(
  {
    name: "VALUE",
    min: 1,
    max: 1,
    signature: "VALUE(text)",
    summary: "Parses text to a number; #VALUE! when it is not numeric.",
  },
  (args) => {
    const text = argText(args[0]);
    if (isErrorValue(text)) return text;
    if (text.trim() === "") return 0;
    const parsed = parseNumberText(text);
    return parsed === null ? cellError("#VALUE!") : parsed;
  },
);

const TEXTJOIN_FN = fn(
  {
    name: "TEXTJOIN",
    min: 3,
    max: MANY,
    signature: "TEXTJOIN(delimiter, ignore_empty, value1, [value2, …])",
    summary: "Joins values with a delimiter, optionally skipping empty ones.",
  },
  (args) => {
    const delimiter = argText(args[0]);
    if (isErrorValue(delimiter)) return delimiter;
    const ignoreEmpty = argBoolean(args[1]);
    if (isErrorValue(ignoreEmpty)) return ignoreEmpty;
    const parts: string[] = [];
    let length = 0;
    for (let i = 2; i < args.length; i++) {
      const arg = args[i];
      const cells = isRangeValue(arg) ? rangeCells(arg) : [arg as CellValue];
      for (const cell of cells) {
        if (ignoreEmpty && (isBlank(cell) || cell === "")) continue;
        const text = toText(cell);
        if (isErrorValue(text)) return text;
        parts.push(text);
        length += text.length + delimiter.length;
        if (length > MAX_TEXT_LENGTH) return cellError("#VALUE!");
      }
    }
    return parts.join(delimiter);
  },
);

// --- Date parts -----------------------------------------------------------

/** Date components from a serial argument, or the #NUM! a bad serial gives. */
function serialParts(arg: FunctionArg) {
  const serial = argNumber(arg);
  if (isErrorValue(serial)) return serial;
  const parts = partsFromSerial(serial);
  return parts ?? cellError("#NUM!");
}

const YEAR_FN = fn(
  { name: "YEAR", min: 1, max: 1, signature: "YEAR(date)", summary: "The year of a date serial." },
  (args) => {
    const parts = serialParts(args[0]);
    return isErrorValue(parts) ? parts : parts.year;
  },
);

const MONTH_FN = fn(
  { name: "MONTH", min: 1, max: 1, signature: "MONTH(date)", summary: "The month (1-12) of a date serial." },
  (args) => {
    const parts = serialParts(args[0]);
    return isErrorValue(parts) ? parts : parts.month;
  },
);

const DAY_FN = fn(
  { name: "DAY", min: 1, max: 1, signature: "DAY(date)", summary: "The day of the month (1-31) of a date serial." },
  (args) => {
    const parts = serialParts(args[0]);
    return isErrorValue(parts) ? parts : parts.day;
  },
);

const HOUR_FN = fn(
  { name: "HOUR", min: 1, max: 1, signature: "HOUR(time)", summary: "The hour (0-23) of a date serial." },
  (args) => {
    const parts = serialParts(args[0]);
    return isErrorValue(parts) ? parts : parts.hours;
  },
);

const MINUTE_FN = fn(
  { name: "MINUTE", min: 1, max: 1, signature: "MINUTE(time)", summary: "The minute (0-59) of a date serial." },
  (args) => {
    const parts = serialParts(args[0]);
    return isErrorValue(parts) ? parts : parts.minutes;
  },
);

const WEEKDAY_FN = fn(
  {
    name: "WEEKDAY",
    min: 1,
    max: 2,
    signature: "WEEKDAY(date, [type])",
    summary: "Day of week. Type 1 (default) Sun=1..Sat=7; 2 Mon=1..Sun=7; 3 Mon=0..Sun=6.",
  },
  (args) => {
    const serial = argNumber(args[0]);
    if (isErrorValue(serial)) return serial;
    // Reject a serial outside the representable range, the way YEAR/MONTH/DAY
    // do through partsFromSerial; the modulo below would otherwise answer a
    // weekday for a date that has no calendar.
    if (!partsFromSerial(serial)) return cellError("#NUM!");
    const type = args.length > 1 ? argInteger(args[1]) : 1;
    if (isErrorValue(type)) return type;
    // Serial 0 is 1899-12-30, a Saturday; shift to a Sunday=0..Saturday=6 base.
    const sun0 = ((((wholeDays(serial) % 7) + 7) % 7) + 6) % 7;
    if (type === 1) return sun0 + 1;
    if (type === 2) return ((sun0 + 6) % 7) + 1;
    if (type === 3) return (sun0 + 6) % 7;
    return cellError("#NUM!");
  },
);

const DAYS_FN = fn(
  {
    name: "DAYS",
    min: 2,
    max: 2,
    signature: "DAYS(end_date, start_date)",
    summary: "Whole days from start to end (end minus start).",
  },
  (args) => {
    const end = argNumber(args[0]);
    if (isErrorValue(end)) return end;
    const start = argNumber(args[1]);
    if (isErrorValue(start)) return start;
    return wholeDays(end) - wholeDays(start);
  },
);

/** Last day-of-month for a (possibly out-of-range) year/month, via rollover. */
function lastDayOfMonth(year: number, month: number): number {
  const parts = partsFromSerial(serialFromParts(year, month + 1, 0));
  return parts ? parts.day : 28;
}

const EDATE_FN = fn(
  {
    name: "EDATE",
    min: 2,
    max: 2,
    signature: "EDATE(date, months)",
    summary: "Shifts a date by whole months, clamping to the month's last day.",
  },
  (args) => {
    const parts = serialParts(args[0]);
    if (isErrorValue(parts)) return parts;
    const months = argInteger(args[1]);
    if (isErrorValue(months)) return months;
    // Normalise year/month through a serial round-trip, then clamp the day.
    const normalized = partsFromSerial(serialFromParts(parts.year, parts.month + months, 1));
    if (!normalized) return cellError("#NUM!");
    const day = Math.min(parts.day, lastDayOfMonth(normalized.year, normalized.month));
    return finiteOrError(serialFromParts(normalized.year, normalized.month, day));
  },
);

const EOMONTH_FN = fn(
  {
    name: "EOMONTH",
    min: 2,
    max: 2,
    signature: "EOMONTH(date, months)",
    summary: "The last day of the month `months` away from date.",
  },
  (args) => {
    const parts = serialParts(args[0]);
    if (isErrorValue(parts)) return parts;
    const months = argInteger(args[1]);
    if (isErrorValue(months)) return months;
    return finiteOrError(serialFromParts(parts.year, parts.month + months + 1, 0));
  },
);

// --- Multi-criteria conditionals ------------------------------------------

/** AND across criteria pairs, aligned to `reference`'s shape. `pairs` is
 *  (range, criterion, range, criterion, …). A range whose shape differs from
 *  the reference is #VALUE!, matching Sheets' refusal to guess an offset. */
function criteriaMask(
  reference: RangeValue,
  pairs: readonly FunctionArg[],
): boolean[] | ErrorValue {
  const count = rangeHeight(reference) * rangeWidth(reference);
  const mask = new Array<boolean>(count).fill(true);
  for (let p = 0; p + 1 < pairs.length; p += 2) {
    const range = toRange(pairs[p]);
    if (
      rangeHeight(range) !== rangeHeight(reference) ||
      rangeWidth(range) !== rangeWidth(reference)
    ) {
      return cellError("#VALUE!");
    }
    const criterion = toScalar(pairs[p + 1]);
    if (isErrorValue(criterion)) return criterion;
    const predicate = criterionPredicate(criterion);
    const cells = rangeCells(range);
    for (let i = 0; i < count; i++) {
      if (mask[i] && !(!isErrorValue(cells[i]) && predicate(cells[i]))) mask[i] = false;
    }
  }
  return mask;
}

const COUNTIFS_FN = fn(
  {
    name: "COUNTIFS",
    min: 2,
    max: MANY,
    signature: "COUNTIFS(range1, criterion1, [range2, criterion2, …])",
    summary: "Counts rows that satisfy every range/criterion pair.",
    errors: "scalars",
  },
  (args) => {
    const mask = criteriaMask(toRange(args[0]), args);
    if (isErrorValue(mask)) return mask;
    return mask.filter(Boolean).length;
  },
);

const SUMIFS_FN = fn(
  {
    name: "SUMIFS",
    min: 3,
    max: MANY,
    signature: "SUMIFS(sum_range, range1, criterion1, [range2, criterion2, …])",
    summary: "Adds the sum_range cells whose row satisfies every criterion.",
    errors: "scalars",
  },
  (args) => {
    const sumRange = toRange(args[0]);
    const mask = criteriaMask(sumRange, args.slice(1));
    if (isErrorValue(mask)) return mask;
    const cells = rangeCells(sumRange);
    let total = 0;
    for (let i = 0; i < cells.length; i++) {
      if (!mask[i]) continue;
      const cell = cells[i];
      if (isErrorValue(cell)) return cell;
      if (typeof cell === "number" && Number.isFinite(cell)) total += cell;
    }
    return finiteOrError(total);
  },
);

const AVERAGEIFS_FN = fn(
  {
    name: "AVERAGEIFS",
    min: 3,
    max: MANY,
    signature: "AVERAGEIFS(average_range, range1, criterion1, [range2, criterion2, …])",
    summary: "Mean of the average_range cells whose row satisfies every criterion.",
    errors: "scalars",
  },
  (args) => {
    const avgRange = toRange(args[0]);
    const mask = criteriaMask(avgRange, args.slice(1));
    if (isErrorValue(mask)) return mask;
    const cells = rangeCells(avgRange);
    let total = 0;
    let n = 0;
    for (let i = 0; i < cells.length; i++) {
      if (!mask[i]) continue;
      const cell = cells[i];
      if (isErrorValue(cell)) return cell;
      if (typeof cell === "number" && Number.isFinite(cell)) {
        total += cell;
        n += 1;
      }
    }
    if (n === 0) return cellError("#DIV/0!");
    return divide(total, n);
  },
);

// --- Type tests -----------------------------------------------------------

const ISNUMBER_FN = fn(
  { name: "ISNUMBER", min: 1, max: 1, signature: "ISNUMBER(value)", summary: "True when value is a number.", errors: "none" },
  (args) => typeof toScalar(args[0]) === "number",
);

const ISTEXT_FN = fn(
  { name: "ISTEXT", min: 1, max: 1, signature: "ISTEXT(value)", summary: "True when value is text.", errors: "none" },
  (args) => typeof toScalar(args[0]) === "string",
);

const ISLOGICAL_FN = fn(
  { name: "ISLOGICAL", min: 1, max: 1, signature: "ISLOGICAL(value)", summary: "True when value is TRUE or FALSE.", errors: "none" },
  (args) => typeof toScalar(args[0]) === "boolean",
);

const ISBLANK_FN = fn(
  { name: "ISBLANK", min: 1, max: 1, signature: "ISBLANK(value)", summary: "True when the cell is empty (not just \"\").", errors: "none" },
  (args) => isBlank(toScalar(args[0])),
);

const ISERROR_FN = fn(
  { name: "ISERROR", min: 1, max: 1, signature: "ISERROR(value)", summary: "True when value is any error.", errors: "none" },
  (args) => isErrorValue(toScalar(args[0])),
);

const ISNA_FN = fn(
  { name: "ISNA", min: 1, max: 1, signature: "ISNA(value)", summary: "True when value is the #N/A error.", errors: "none" },
  (args) => {
    const value = toScalar(args[0]);
    return isErrorValue(value) && value.err === "#N/A";
  },
);

const ISEVEN_FN = fn(
  { name: "ISEVEN", min: 1, max: 1, signature: "ISEVEN(value)", summary: "True when the integer part of value is even." },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    return Math.abs(Math.trunc(value)) % 2 === 0;
  },
);

const ISODD_FN = fn(
  { name: "ISODD", min: 1, max: 1, signature: "ISODD(value)", summary: "True when the integer part of value is odd." },
  (args) => {
    const value = argNumber(args[0]);
    if (isErrorValue(value)) return value;
    return Math.abs(Math.trunc(value)) % 2 === 1;
  },
);

// --- Dynamic arrays (spill) -----------------------------------------------
//
// These RETURN a RangeValue. At the top level of a formula the graph spills it
// into neighbouring cells; nested anywhere else it narrows to #VALUE! (no
// implicit broadcast). A hard cell cap keeps a runaway SEQUENCE from spilling
// the sheet away.

const MAX_SPILL_CELLS = 50_000;

/** Stable signature of a row, for UNIQUE's de-dup. */
function cellSig(v: CellValue): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "number") return "n" + v;
  if (typeof v === "boolean") return "b" + (v ? 1 : 0);
  if (typeof v === "string") return "s" + v;
  if (isErrorValue(v)) return "e" + v.err;
  return "?";
}
function rowSig(row: readonly CellValue[]): string {
  return row.map(cellSig).join("");
}

const SEQUENCE_FN = fn(
  {
    name: "SEQUENCE",
    min: 1,
    max: 4,
    signature: "SEQUENCE(rows, [columns], [start], [step])",
    summary: "A rows×columns array counting from start (default 1) by step (default 1).",
  },
  (args) => {
    const rows = argInteger(args[0]);
    if (isErrorValue(rows)) return rows;
    const cols = args.length > 1 ? argInteger(args[1]) : 1;
    if (isErrorValue(cols)) return cols;
    const start = args.length > 2 ? argNumber(args[2]) : 1;
    if (isErrorValue(start)) return start;
    const step = args.length > 3 ? argNumber(args[3]) : 1;
    if (isErrorValue(step)) return step;
    if (rows < 1 || cols < 1) return cellError("#VALUE!");
    if (rows * cols > MAX_SPILL_CELLS) return cellError("#NUM!");
    const grid: CellValue[][] = [];
    let n = start;
    for (let r = 0; r < rows; r++) {
      const row: CellValue[] = [];
      for (let c = 0; c < cols; c++) { row.push(n); n += step; }
      grid.push(row);
    }
    return rangeValue(grid);
  },
);

const UNIQUE_FN = fn(
  {
    name: "UNIQUE",
    min: 1,
    max: 1,
    signature: "UNIQUE(range)",
    summary: "The distinct rows of a range, in first-seen order.",
    errors: "scalars",
  },
  (args) => {
    const range = toRange(args[0]);
    const seen = new Set<string>();
    const out: CellValue[][] = [];
    for (const row of range.rows) {
      const sig = rowSig(row);
      if (!seen.has(sig)) { seen.add(sig); out.push([...row]); }
    }
    return out.length > 0 ? rangeValue(out) : cellError("#N/A");
  },
);

const SORT_FN = fn(
  {
    name: "SORT",
    min: 1,
    max: 3,
    signature: "SORT(range, [sort_column], [is_ascending])",
    summary: "The rows of a range sorted by a column (1-based, default 1).",
    errors: "scalars",
  },
  (args) => {
    const range = toRange(args[0]);
    const col = args.length > 1 ? argInteger(args[1]) : 1;
    if (isErrorValue(col)) return col;
    const asc = args.length > 2 ? argBoolean(args[2]) : true;
    if (isErrorValue(asc)) return asc;
    if (col < 1 || col > rangeWidth(range)) return cellError("#VALUE!");
    const dir = asc ? 1 : -1;
    const rows = range.rows.map((r) => [...r]);
    // Stable sort; incomparable/cross-type pairs keep their order.
    rows.sort((a, b) => {
      const cmp = compareValues(a[col - 1], b[col - 1]);
      return cmp === null ? 0 : cmp * dir;
    });
    return rangeValue(rows);
  },
);

const FILTER_FN = fn(
  {
    name: "FILTER",
    min: 2,
    max: 3,
    signature: "FILTER(range, condition, [if_empty])",
    summary: "The rows of a range where the condition column is TRUE (or non-zero).",
    errors: "scalars",
  },
  (args) => {
    const range = toRange(args[0]);
    const condition = toRange(args[1]);
    const height = rangeHeight(range);
    if (rangeHeight(condition) !== height) return cellError("#VALUE!");
    const out: CellValue[][] = [];
    for (let r = 0; r < height; r++) {
      const flag = condition.rows[r][0];
      if (flag === true || (typeof flag === "number" && flag !== 0)) out.push([...range.rows[r]]);
    }
    if (out.length === 0) return args.length > 2 ? toScalar(args[2]) : cellError("#N/A");
    return rangeValue(out);
  },
);

const ARRAYFORMULA_FN = fn(
  {
    name: "ARRAYFORMULA",
    min: 1,
    max: 1,
    signature: "ARRAYFORMULA(range)",
    summary: "Spills a range into neighbouring cells.",
    errors: "scalars",
  },
  (args) => (isRangeValue(args[0]) ? args[0] : toScalar(args[0])),
);

const DEFINITIONS: readonly SheetFunction[] = [
  SUM_FN,
  AVERAGE_FN,
  AVG_FN,
  MIN_FN,
  MAX_FN,
  COUNT_FN,
  COUNTA_FN,
  IF_FN,
  AND_FN,
  OR_FN,
  NOT_FN,
  IFERROR_FN,
  CONCAT_FN,
  LEFT_FN,
  RIGHT_FN,
  MID_FN,
  LEN_FN,
  TRIM_FN,
  UPPER_FN,
  LOWER_FN,
  SUBSTITUTE_FN,
  ROUND_FN,
  ABS_FN,
  POW_FN,
  SQRT_FN,
  MOD_FN,
  TODAY_FN,
  NOW_FN,
  DATE_FN,
  DATEDIF_FN,
  COUNTIF_FN,
  SUMIF_FN,
  AVERAGEIF_FN,
  VLOOKUP_FN,
  INDEX_FN,
  MATCH_FN,
  // Rounding / integers
  ROUNDUP_FN,
  ROUNDDOWN_FN,
  TRUNC_FN,
  INT_FN,
  CEILING_FN,
  FLOOR_FN,
  SIGN_FN,
  PRODUCT_FN,
  MEDIAN_FN,
  POWER_FN,
  // Logical (extended)
  XOR_FN,
  IFS_FN,
  SWITCH_FN,
  IFNA_FN,
  // Text (extended)
  CONCATENATE_FN,
  PROPER_FN,
  REPT_FN,
  EXACT_FN,
  FIND_FN,
  SEARCH_FN,
  VALUE_FN,
  TEXTJOIN_FN,
  // Date parts
  YEAR_FN,
  MONTH_FN,
  DAY_FN,
  HOUR_FN,
  MINUTE_FN,
  WEEKDAY_FN,
  DAYS_FN,
  EDATE_FN,
  EOMONTH_FN,
  // Multi-criteria conditionals
  COUNTIFS_FN,
  SUMIFS_FN,
  AVERAGEIFS_FN,
  // Type tests
  ISNUMBER_FN,
  ISTEXT_FN,
  ISLOGICAL_FN,
  ISBLANK_FN,
  ISERROR_FN,
  ISNA_FN,
  ISEVEN_FN,
  ISODD_FN,
  // Dynamic arrays (spill)
  SEQUENCE_FN,
  UNIQUE_FN,
  SORT_FN,
  FILTER_FN,
  ARRAYFORMULA_FN,
];

/**
 * Which parameters of each function receive a RANGE rather than a single
 * cell. This lives beside the definitions on purpose: the evaluator's
 * fallback table drifted out of sync with this library (it listed eleven
 * functions that do not exist here and omitted CONCAT/AND/OR, so
 * =CONCAT([Name]) collapsed a whole column to one row's value). Anything
 * absent here is scalar. Keep it in step when adding a function.
 */
// COUNTIFS pairs are (range, criterion) from slot 0: ranges at every even
// slot. SUMIFS/AVERAGEIFS spend slot 0 on the data range, so their criteria
// ranges are the odd slots. Both cover the full 255-argument ceiling.
const COUNTIFS_RANGE_SLOTS: readonly number[] = Array.from({ length: 128 }, (_, i) => i * 2);
const SUMIFS_RANGE_SLOTS: readonly number[] = [
  0,
  ...Array.from({ length: 127 }, (_, i) => i * 2 + 1),
];

export const RANGE_ARGUMENTS: ReadonlyMap<string, true | readonly number[]> = new Map<
  string,
  true | readonly number[]
>([
  // Aggregates take a range in every position.
  ["SUM", true], ["AVERAGE", true], ["AVG", true], ["MIN", true], ["MAX", true],
  ["COUNT", true], ["COUNTA", true],
  // CONCAT / AND / OR are deliberately ABSENT. In a table the common
  // formula is per-row — =CONCAT([First]," ",[Last]) or =AND([Active],
  // [Approved]) — so a bare [Header] must narrow to the current row, the
  // same rule that makes =[Price]*[Qty] mean anything. An EXPLICIT range
  // (CONCAT(B1:B3)) still reaches them as a range, so folding a whole
  // column is still possible where it is actually wanted.
  // Positional: only these parameters are ranges.
  ["COUNTIF", [0]],
  ["SUMIF", [0, 2]],
  ["AVERAGEIF", [0, 2]],
  ["VLOOKUP", [1]],
  ["INDEX", [0]],
  ["MATCH", [1]],
  // PRODUCT / MEDIAN fold whatever they are given, like the other aggregates.
  ["PRODUCT", true],
  ["MEDIAN", true],
  // Multi-criteria families: the sum/average/count ranges and every
  // criteria RANGE are arrays; the criteria VALUES between them are scalar.
  // COUNTIFS pairs start at 0 (range, criterion); SUM/AVERAGEIFS reserve
  // slot 0 for the data range, so their criteria ranges are the odd slots.
  // The lists span the whole 255-argument ceiling so that even the 100th
  // criteria pair written as a bare [Header] ref still widens to its column
  // rather than narrowing to the current row.
  ["COUNTIFS", COUNTIFS_RANGE_SLOTS],
  ["SUMIFS", SUMIFS_RANGE_SLOTS],
  ["AVERAGEIFS", SUMIFS_RANGE_SLOTS],
  // Dynamic arrays: their source (and FILTER's condition) are whole ranges.
  ["UNIQUE", [0]],
  ["SORT", [0]],
  ["FILTER", [0, 1]],
  ["ARRAYFORMULA", [0]],
]);

export const FUNCTIONS: ReadonlyMap<string, SheetFunction> = new Map(
  DEFINITIONS.map((entry) => [entry.name, entry]),
);

export function getFunction(name: string): SheetFunction | undefined {
  return FUNCTIONS.get(name.toUpperCase());
}

export function isFunctionName(name: string): boolean {
  return FUNCTIONS.has(name.toUpperCase());
}

/** Sorted, for the formula-bar autocomplete. */
export function functionNames(): string[] {
  return [...FUNCTIONS.keys()].sort();
}

/**
 * Call by name. An unknown name is #NAME?, the error a user can act on, and
 * every other failure is an error value too: this never throws.
 */
export function callFunction(
  name: string,
  args: readonly ArgThunk[],
  ctx: FunctionContext,
): CellValue | RangeValue {
  const entry = getFunction(name);
  if (!entry) return cellError("#NAME?");
  return entry.call(args, ctx);
}

/** `callFunction` for arguments that are already evaluated. */
export function callFunctionWith(
  name: string,
  values: readonly FunctionArg[],
  ctx: FunctionContext,
): CellValue | RangeValue {
  return callFunction(
    name,
    values.map((value) => () => value),
    ctx,
  );
}
