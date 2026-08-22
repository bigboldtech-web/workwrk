/* Selection statistics (Tables Phase 5b) — the numbers behind the
 * Google-Sheets-style bottom-bar readout: Sum / Avg / Min / Max / Count
 * over the values of the selected range.
 *
 * Pure and display-agnostic on purpose. This module decides WHAT the
 * numbers are; the caller decides what to show (Sheets shows the full
 * cluster only when the range holds >= 2 numeric values, and a bare
 * "Count: N" when it holds >= 2 non-empty cells but < 2 numeric ones)
 * and how to round for display. Sums are returned raw — 0.1 + 0.2 style
 * float dust included — because rounding is a presentation concern and
 * rounding here would make the stats disagree with a formula computed
 * over the same cells.
 *
 * What counts as a NUMBER is the strict trim-parse the number-column
 * display renderer uses (tables/[id]/page.tsx, renderDisplay's
 * number/currency/percent case: `Number(String(v).trim())` guarded by
 * non-empty-after-trim + Number.isFinite): the whole string must be
 * numeric, so " 42 ", "3.5", "-2", "1e3" qualify and "12abc" stays
 * text. The sort comparator (compareCells, same file: `parseFloat`
 * behind the same isFinite guard) agrees on every one of those but is
 * prefix-lenient — parseFloat reads "12abc" as 12. Stats deliberately
 * take the strict side of that gap: sorting "12abc" by its leading
 * digits is a reasonable ordering, but ADDING it into a Sum as 12
 * would fabricate a number the cell does not hold, and Sheets counts
 * such cells as text too.
 *
 * Excluded from numerics but still counted non-empty: formula error
 * codes ("#DIV/0!", "#REF!" — strings that don't parse), booleans,
 * objects/arrays (multi_select, attachments), NaN and Infinity.
 * Empty means null, undefined, or "" — a whitespace-only string is
 * content (non-empty) that parses to nothing (not numeric).
 */

export type SelectionStats = {
  /** Raw sum of the numeric values — caller rounds for display. */
  sum: number;
  /** sum / numeric. 0 when the range has no numeric values (the caller
   *  never shows Avg below numeric >= 2, so the placeholder is inert). */
  avg: number;
  /** 0 when the range has no numeric values — same placeholder rule. */
  min: number;
  max: number;
  /** How many values parsed as finite numbers. */
  numeric: number;
  /** How many values held anything at all (null / undefined / "" are empty). */
  nonEmpty: number;
};

/** Strict numeric reading of one cell value, or null when it has none. */
function toNumber(v: unknown): number | null {
  // NaN and ±Infinity are typeof "number" but are not values you can
  // honestly Sum — a single NaN would poison every stat in the readout.
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Booleans, arrays, objects: content, never numbers. (Sheets excludes
  // checkboxes from Sum the same way.)
  if (typeof v !== "string") return null;
  const t = v.trim();
  // Number("") is 0 — without this guard a whitespace-only cell would
  // silently contribute a zero to Sum and drag Avg toward 0.
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Stats over a selection's values, or null when fewer than 2 cells are
 *  non-empty — a single cell (or an empty range) gets no readout, matching
 *  Sheets. The CALLER gates which fields to display on `numeric`. */
export function selectionStats(values: unknown[]): SelectionStats | null {
  let nonEmpty = 0;
  let numeric = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v == null || v === "") continue; // empty cell — invisible to every count
    nonEmpty++;
    const n = toNumber(v);
    if (n == null) continue;
    numeric++;
    sum += n;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  if (nonEmpty < 2) return null;
  // No numeric values: return honest counts with inert zero placeholders
  // rather than the accumulator identities (min would be Infinity, avg
  // NaN) — those must never be one missed caller-side gate away from the
  // screen.
  if (numeric === 0) return { sum: 0, avg: 0, min: 0, max: 0, numeric, nonEmpty };
  return { sum, avg: sum / numeric, min, max, numeric, nonEmpty };
}
