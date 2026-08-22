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
  readonly call: (args: readonly ArgThunk[], ctx: FunctionContext) => CellValue;
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
  impl: (args: readonly FunctionArg[], ctx: FunctionContext) => CellValue,
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
  impl: (args: readonly ArgThunk[], ctx: FunctionContext) => CellValue,
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
];

/**
 * Which parameters of each function receive a RANGE rather than a single
 * cell. This lives beside the definitions on purpose: the evaluator's
 * fallback table drifted out of sync with this library (it listed eleven
 * functions that do not exist here and omitted CONCAT/AND/OR, so
 * =CONCAT([Name]) collapsed a whole column to one row's value). Anything
 * absent here is scalar. Keep it in step when adding a function.
 */
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
): CellValue {
  const entry = getFunction(name);
  if (!entry) return cellError("#NAME?");
  return entry.call(args, ctx);
}

/** `callFunction` for arguments that are already evaluated. */
export function callFunctionWith(
  name: string,
  values: readonly FunctionArg[],
  ctx: FunctionContext,
): CellValue {
  return callFunction(
    name,
    values.map((value) => () => value),
    ctx,
  );
}
