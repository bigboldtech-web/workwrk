// Value coercion for the Tables formula engine. Pure: no React, no DOM, no
// I/O, and no clock — `TODAY`/`NOW` read their instant from the evaluation
// context so that a recalc is reproducible.
//
// Every layer above this one (operators, the function library, the evaluator)
// asks the same five questions of a cell: is it a number, is it text, is it
// true, is it blank, is it poison. Spreadsheets answer them in ways that look
// inconsistent until the rule is visible, so the rules live here, once.
//
// 1. ERRORS ARE VALUES AND THEY WIN. Any error operand makes the result that
//    same error, and the FIRST error in argument order wins, so the formula
//    reports the cause a user can fix rather than the last one seen.
//
// 2. BLANK IS 0 IN ARITHMETIC BUT IS NOT A NUMBER. `A1+1` with A1 empty is 1,
//    yet `AVERAGE(A1,2)` is 2, not 1: blank never joins the population that
//    AVERAGE divides by. Those two rules only coexist because a REFERENCE
//    reaches a function as a `RangeValue`, even when it covers a single cell,
//    and a cell inside a range that is not a number is SKIPPED, while a
//    scalar argument is coerced strictly. The evaluator must preserve that
//    distinction — pass refs as ranges — or COUNT and AVERAGE go wrong.
//
// 3. EMPTY TEXT IS NOT BLANK. `""+1` is #VALUE! while `<blank>+1` is 1.
//
// 4. TYPES DO NOT CROSS IN A COMPARISON. `1="1"` is FALSE. Where an order is
//    needed anyway (sorting, approximate lookup) it is numbers < text <
//    booleans, matching Sheets.
//
// 5. TEXT COMPARES CASE-INSENSITIVELY, by UTF-16 code unit over the
//    lowercased strings. No locale collation: two machines recalculating the
//    same table must agree, and `localeCompare` does not guarantee that.
//
// A NOTE ON PRECISION. Results are raw IEEE-754 doubles: `SUM(0.1,0.2)` is
// 0.30000000000000004 here exactly as it is inside Sheets. Rounding for
// display belongs to the formatting layer (Phase 4), not to the engine, so
// that a value never changes just by passing through another formula.
// `ROUND` is the exception and corrects representation error deliberately.

import { cellError, isErrorValue, type CellValue, type ErrorValue } from "./types";

// --- Ranges ---------------------------------------------------------------

/**
 * A rectangular block of cells: what a `RefNode` resolves to. Row-major, and
 * every row has the same length. A single-cell reference is a 1x1 range, not
 * a scalar — see rule 2 in the header.
 */
export interface RangeValue {
  readonly kind: "range";
  readonly rows: readonly (readonly CellValue[])[];
}

/** What a function argument can be after the evaluator has reduced it. */
export type FunctionArg = CellValue | RangeValue;

export function isRangeValue(value: unknown): value is RangeValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "range" &&
    Array.isArray((value as { rows?: unknown }).rows)
  );
}

/**
 * Ragged input is padded with blanks rather than rejected, because a ref that
 * runs past the last populated column of a sparse row is normal, not a bug.
 * Rectangular input is adopted as-is: values are treated as immutable
 * throughout the engine, so there is no defensive deep copy on a hot path.
 */
export function rangeValue(rows: readonly (readonly CellValue[])[]): RangeValue {
  let width = 0;
  for (const row of rows) if (row.length > width) width = row.length;
  const ragged = rows.some((row) => row.length !== width);
  if (!ragged) return { kind: "range", rows };
  return {
    kind: "range",
    rows: rows.map((row) =>
      row.length === width
        ? row
        : [...row, ...new Array<CellValue>(width - row.length).fill(null)],
    ),
  };
}

/** `A1:A10` and whole-column refs: n rows, one column. */
export function columnRange(values: readonly CellValue[]): RangeValue {
  return { kind: "range", rows: values.map((value) => [value]) };
}

/** `A1:J1`: one row, n columns. */
export function rowRange(values: readonly CellValue[]): RangeValue {
  return { kind: "range", rows: values.length > 0 ? [values] : [] };
}

export function rangeHeight(range: RangeValue): number {
  return range.rows.length;
}

export function rangeWidth(range: RangeValue): number {
  return range.rows.length > 0 ? range.rows[0].length : 0;
}

/** Flattened row-major, which is also the order the "first error wins". */
export function rangeCells(range: RangeValue): CellValue[] {
  const out: CellValue[] = [];
  for (const row of range.rows) for (const cell of row) out.push(cell);
  return out;
}

export function argCells(arg: FunctionArg): CellValue[] {
  return isRangeValue(arg) ? rangeCells(arg) : [arg];
}

/** A scalar argument seen as a 1x1 range, for functions that want a grid. */
export function toRange(arg: FunctionArg): RangeValue {
  return isRangeValue(arg) ? arg : { kind: "range", rows: [[arg]] };
}

/**
 * Narrow an argument to one value. A 1x1 range unwraps; anything larger is
 * #VALUE! because this engine has no array formulas — returning the top-left
 * cell instead would answer a question the user did not ask. An empty range
 * (a column ref on a table with no rows) is #VALUE! for the same reason:
 * silently reading as 0 hides that there was nothing there.
 */
export function toScalar(arg: FunctionArg): CellValue {
  if (!isRangeValue(arg)) return arg;
  const cells = rangeCells(arg);
  return cells.length === 1 ? cells[0] : cellError("#VALUE!");
}

// --- Blanks and errors ----------------------------------------------------

/** Only an absent value is blank. `""` is text; see rule 3. */
export function isBlank(value: CellValue | undefined): boolean {
  return value === null || value === undefined;
}

export function firstError(values: Iterable<CellValue>): ErrorValue | null {
  for (const value of values) if (isErrorValue(value)) return value;
  return null;
}

/** Descends into ranges, so poison anywhere in a scanned block surfaces. */
export function firstArgError(args: Iterable<FunctionArg>): ErrorValue | null {
  for (const arg of args) {
    if (isRangeValue(arg)) {
      const inner = firstError(rangeCells(arg));
      if (inner) return inner;
      continue;
    }
    if (isErrorValue(arg)) return arg;
  }
  return null;
}

/**
 * Errors in scalar positions only. Functions that look INTO a range without
 * consuming every cell (COUNT, the *IF family, the lookups) use this: a
 * poisoned cell three rows below the one that matched is not their problem.
 */
export function firstScalarError(args: Iterable<FunctionArg>): ErrorValue | null {
  for (const arg of args) {
    if (!isRangeValue(arg) && isErrorValue(arg)) return arg;
  }
  return null;
}

// --- Numbers --------------------------------------------------------------

const NUMBER_TEXT_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
// JavaScript's \s already covers the non-breaking space that pasted web
// data carries, so trimming with it is enough.
const OUTER_SPACE_RE = /^\s+|\s+$/g;

export interface NumberTextOptions {
  /**
   * Whether ISO date text converts to its serial. On by default, because
   * arithmetic on a date column has to work. COUNTIF and friends turn it OFF
   * so a criterion of "2026-08-22" still matches a cell holding that TEXT —
   * and ISO-8601 sorts chronologically as text anyway, so ">2026-01-01"
   * keeps working over a text date column.
   */
  readonly allowDates?: boolean;
}

/**
 * Text that a spreadsheet reads as a number: an optional sign, digits, an
 * optional exponent, an optional trailing `%`, or an ISO-ish date. Returns
 * null when the text is not numeric, which callers turn into #VALUE!.
 *
 * Thousands separators are NOT accepted: "1,000" means one thousand in en-US
 * and one in de-DE, and the engine has no locale. The import path is where a
 * grouped number should become a real number.
 */
export function parseNumberText(
  text: string,
  options: NumberTextOptions = {},
): number | null {
  const trimmed = text.replace(OUTER_SPACE_RE, "");
  if (trimmed === "") return null;

  let body = trimmed;
  let scale = 1;
  if (body.endsWith("%")) {
    body = body.slice(0, -1).replace(OUTER_SPACE_RE, "");
    scale = 0.01;
  }
  if (body === "") return null;

  if (NUMBER_TEXT_RE.test(body)) {
    const parsed = Number(body) * scale;
    return Number.isFinite(parsed) ? parsed : null;
  }
  // "2026-08-22%" is not a percentage of a date.
  if (scale !== 1) return null;
  if (options.allowDates === false) return null;
  return parseDateText(trimmed);
}

/**
 * Strict, scalar-position coercion. Blank is 0, booleans are 1/0, numeric and
 * date text converts, other text is #VALUE!, and an error passes through
 * untouched. Cells scanned out of a RANGE do not come through here — see
 * `collectNumbers`.
 */
export function toNumber(value: CellValue): number | ErrorValue {
  if (isErrorValue(value)) return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : cellError("#NUM!");
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === undefined) return 0;
  const parsed = parseNumberText(value);
  return parsed === null ? cellError("#VALUE!") : parsed;
}

/**
 * The population an aggregate works on. Scalars are coerced strictly (so
 * `SUM("abc")` is #VALUE!); cells inside a range contribute only if they are
 * already numbers (so text and blanks are skipped, not guessed at), and an
 * error cell poisons the whole aggregate.
 */
export function collectNumbers(args: readonly FunctionArg[]): number[] | ErrorValue {
  const out: number[] = [];
  for (const arg of args) {
    if (isRangeValue(arg)) {
      for (const row of arg.rows) {
        for (const cell of row) {
          if (isErrorValue(cell)) return cell;
          if (typeof cell === "number" && Number.isFinite(cell)) out.push(cell);
        }
      }
      continue;
    }
    const num = toNumber(arg);
    if (isErrorValue(num)) return num;
    out.push(num);
  }
  return out;
}

/** NaN and infinities are never legal cell values; they surface as #NUM!. */
export function finiteOrError(value: number): number | ErrorValue {
  return Number.isFinite(value) ? value : cellError("#NUM!");
}

/** The only division in the engine, so #DIV/0! can never be forgotten. */
export function divide(numerator: number, denominator: number): number | ErrorValue {
  if (denominator === 0) return cellError("#DIV/0!");
  return finiteOrError(numerator / denominator);
}

/**
 * Half away from zero — ROUND(-2.5) is -3, where `Math.round(-2.5)` is -2.
 *
 * The scaled value is re-read at 15 significant digits before the halfway
 * test because binary floating point puts 2.675 * 100 at 267.49999999999997,
 * which would round the wrong way. 15 digits is the precision a double
 * carries, so the correction cannot invent accuracy.
 */
export function roundHalfAwayFromZero(value: number, digits: number): number {
  if (!Number.isFinite(value)) return NaN;
  const places = Math.trunc(digits);
  // Beyond a double's precision the value is already "rounded"; beyond the
  // exponent range the factor would be 0 or Infinity and destroy the value.
  if (places > 100) return value;
  if (places < -308) return 0;
  const factor = Math.pow(10, places);
  const scaled = value * factor;
  if (!Number.isFinite(scaled)) return value;
  const corrected = Number(scaled.toPrecision(15));
  const rounded = Math.sign(corrected) * Math.round(Math.abs(corrected));
  const result = rounded / factor;
  // ROUND(-0.4) would otherwise be -0, which prints as "0" but fails an
  // identity check and confuses a diff of two recalcs.
  return result === 0 ? 0 : result;
}

// --- Text -----------------------------------------------------------------

/** `1e21` prints as `1E+21`, the way a spreadsheet shows it. */
export function numberToText(value: number): string {
  if (Object.is(value, -0)) return "0";
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  const text = String(value);
  return text.includes("e") ? text.replace("e", "E") : text;
}

export function toText(value: CellValue): string | ErrorValue {
  if (isErrorValue(value)) return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return numberToText(value);
}

// --- Booleans -------------------------------------------------------------

/**
 * Truthiness. A number is true when non-zero, blank is false, and only the
 * words TRUE/FALSE convert from text: `IF("1",…)` is #VALUE! in Sheets
 * because a string that merely looks numeric is not a condition.
 */
export function toBoolean(value: CellValue): boolean | ErrorValue {
  if (isErrorValue(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (value === null || value === undefined) return false;
  const word = value.trim().toUpperCase();
  if (word === "TRUE") return true;
  if (word === "FALSE") return false;
  return cellError("#VALUE!");
}

// --- Argument helpers -----------------------------------------------------

export function argNumber(arg: FunctionArg): number | ErrorValue {
  return toNumber(toScalar(arg));
}

/** Indices and counts truncate toward zero, as Excel's do: `LEFT(s, 2.9)`. */
export function argInteger(arg: FunctionArg): number | ErrorValue {
  const num = argNumber(arg);
  if (isErrorValue(num)) return num;
  return Math.trunc(num);
}

export function argText(arg: FunctionArg): string | ErrorValue {
  return toText(toScalar(arg));
}

export function argBoolean(arg: FunctionArg): boolean | ErrorValue {
  return toBoolean(toScalar(arg));
}

// --- Comparison -----------------------------------------------------------

export type ValueClass = "number" | "text" | "boolean" | "blank" | "error";

export function classifyValue(value: CellValue): ValueClass {
  if (isErrorValue(value)) return "error";
  if (value === null || value === undefined) return "blank";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "text";
  return "boolean";
}

// numbers < text < booleans is the Sheets order. Blank and error never reach
// the cross-class branch, but the map is total so indexing stays type-safe.
const CLASS_ORDER: Record<ValueClass, number> = {
  number: 0,
  text: 1,
  boolean: 2,
  blank: -1,
  error: 3,
};

function compareText(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** The value a blank stands in for when compared against `other`. */
function zeroOf(other: ValueClass): CellValue {
  if (other === "text") return "";
  if (other === "boolean") return false;
  return 0;
}

/**
 * Order for `<`, `>`, sorting and approximate lookup. Returns null when the
 * values cannot be ordered at all, which today means an error is involved.
 *
 * A blank takes the zero of whatever it is compared with — blank equals 0,
 * equals "" and equals FALSE — which is why `A1=0` is TRUE for an empty A1.
 * Across classes the order is numbers < text < booleans, so `2 < "apple"`.
 */
export function compareValues(a: CellValue, b: CellValue): number | null {
  const classA = classifyValue(a);
  const classB = classifyValue(b);
  if (classA === "error" || classB === "error") return null;

  if (classA === "blank" || classB === "blank") {
    if (classA === classB) return 0;
    return compareValues(
      classA === "blank" ? zeroOf(classB) : a,
      classB === "blank" ? zeroOf(classA) : b,
    );
  }

  if (classA !== classB) return CLASS_ORDER[classA] < CLASS_ORDER[classB] ? -1 : 1;

  if (classA === "number") {
    const left = a as number;
    const right = b as number;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (classA === "text") return compareText(a as string, b as string);
  const left = a as boolean;
  const right = b as boolean;
  return left === right ? 0 : left ? 1 : -1;
}

/** `=` semantics: an error never equals anything, not even itself. */
export function valuesEqual(a: CellValue, b: CellValue): boolean {
  return compareValues(a, b) === 0;
}

// --- Date serials ---------------------------------------------------------
//
// A date is a NUMBER: whole days since 1899-12-30, with the fraction being
// the time of day. That is the Sheets convention, and it is what makes
// `A1+30` mean "thirty days later" and `B1-A1` a duration for free.
//
// Excel's serials are one lower before 1900-03-01 because Excel keeps a
// non-existent 29 February 1900 for Lotus compatibility. This engine counts
// real days, like Sheets; the two agree from 1900-03-01 onward.
//
// All conversion is UTC-based so a serial does not change with the machine's
// timezone. An ISO string with a trailing `Z` is read as a wall clock, not
// shifted: a row stored as 2026-08-22T00:00:00Z must read back as the 22nd in
// every office.

export const MS_PER_DAY = 86_400_000;

/** Serial 0. */
export const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Widest serial `partsFromSerial` can answer for, from the ECMAScript range. */
const MAX_ABS_TIME_MS = 8.64e15;

export interface DateParts {
  year: number;
  /** 1-12, not the 0-11 of `Date`. */
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Out-of-range parts roll over the way `DATE(2026,13,1)` does: month 13 is
 * January of the next year. Years 0-99 are NOT remapped to 1900-1999 here
 * (`Date.UTC` would); `DATE` applies that spreadsheet rule itself, so text
 * coercion can still express year 0050.
 */
export function serialFromParts(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const wholeSeconds = Math.trunc(seconds);
  date.setUTCHours(
    hours,
    minutes,
    wholeSeconds,
    Math.round((seconds - wholeSeconds) * 1000),
  );
  const time = date.getTime();
  return Number.isFinite(time) ? (time - SERIAL_EPOCH_MS) / MS_PER_DAY : NaN;
}

/** Null when the serial lands outside the representable date range. */
export function partsFromSerial(serial: number): DateParts | null {
  if (!Number.isFinite(serial)) return null;
  const ms = Math.round(serial * MS_PER_DAY) + SERIAL_EPOCH_MS;
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_ABS_TIME_MS) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hours: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
    seconds: date.getUTCSeconds() + date.getUTCMilliseconds() / 1000,
  };
}

/** Midnight-truncated serial, correct for negative serials too. */
export function wholeDays(serial: number): number {
  return Math.floor(serial);
}

export function serialFromUtcDate(date: Date): number {
  const time = date.getTime();
  return Number.isFinite(time) ? (time - SERIAL_EPOCH_MS) / MS_PER_DAY : NaN;
}

/**
 * The serial a user in this machine's timezone would call "now". The UI wave
 * uses this to fill `FunctionContext.now`; nothing in the engine calls it, so
 * the engine has no ambient clock.
 */
export function serialFromLocalDate(date: Date): number {
  if (Number.isNaN(date.getTime())) return NaN;
  return serialFromParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds() + date.getMilliseconds() / 1000,
  );
}

const DATE_TEXT_RE =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*Z?)?$/;

/**
 * ISO-ish date text to a serial: `2026-08-22`, `2026/08/22`,
 * `2026-08-22T13:45:00Z`. Null for anything else.
 *
 * `08/22/2026` is deliberately NOT accepted: month-first and day-first are
 * indistinguishable and a wrong guess silently books a meeting in the wrong
 * month. An explicitly typed date belongs in `DATE(y,m,d)`.
 */
export function parseDateText(text: string): number | null {
  const match = DATE_TEXT_RE.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = match[4] ? Number(match[4]) : 0;
  const minutes = match[5] ? Number(match[5]) : 0;
  const seconds = match[6] ? Number(match[6]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hours > 23 || minutes > 59 || seconds >= 60) return null;

  const serial = serialFromParts(year, month, day, hours, minutes, seconds);
  const parts = partsFromSerial(serial);
  // Rejects 2026-02-30, which would otherwise roll over into March.
  if (!parts || parts.year !== year || parts.month !== month || parts.day !== day) {
    return null;
  }
  return serial;
}
