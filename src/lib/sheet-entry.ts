// Entry-time typing for OPEN cells, the Google Sheets rule: "5" becomes the
// number 5 the moment you press Enter, not later in the engine.
//
// WHY THIS EXISTS
//   Every new sheet is born with 26 "short_text" columns and the user types
//   anything into them. The engine (sheet-engine-host literalAt) reads a
//   stored JS number as a number in ANY column, but numeric TEXT only in
//   numeric-typed columns (number/currency/percent/rating). That rule is
//   deliberate and stays: it is what keeps "x"*2 an honest #VALUE! instead
//   of a silently invented 0. So on an open column the conversion has to
//   happen where the value enters storage: the plain editor commit, paste,
//   fill and CSV import all route their text through autoTypeEntry. Nothing
//   here touches React, the DOM or the database, so the import route can
//   use it server-side.
//
// THE GRAMMAR (strict on purpose; Sheets-faithful where it is safe to be)
//   * Surrounding whitespace is ignored ("  42  " is 42).
//   * Optional leading "-" only. A leading "+" stays text: Sheets accepts
//     it, but "+5" in a free-text column is far more often a phone prefix
//     or a diff marker than a number.
//   * Integer part: plain digits OR digits with thousands commas in strict
//     3-groups ("1,000", "12,345.67"). Bad grouping ("1,00") is text.
//   * Optional decimal part: "5.5", "5." (5) and ".5" (0.5, as in Sheets).
//   * No exponent: "1e3" stays text. Nobody types scientific notation into
//     a free-text cell by accident, and the ones who do mean the literal.
//   * LEADING ZEROS stay text ("007", "0123"): zip codes, IDs and account
//     numbers lose their zeros if they become numbers. "0" and "0.5" are
//     numbers, the zero there is the value, not padding.
//   * More than 15 significant digits stays text: a double cannot hold a
//     16-digit phone number or card/ID number without rounding the tail.
//   * "5%", "$5", "5 USD" stay TEXT in autoTypeEntry. It serves paste, fill
//     and CSV import, and a pasted TSV carries no cell format to attach the
//     % or $ to, so converting there would drop the symbol silently. The
//     plain editor commit uses autoTypeEntryRich instead (below), which
//     converts "5%" / "$5" AND reports the per-cell number format (nf) the
//     page stores in the cell's style so the symbol renders back honestly.
//   * Everything that is not a number comes back as the ORIGINAL string,
//     untrimmed, so a non-numeric commit stores exactly what was typed.

const NUMBER_ENTRY = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;

/** Largest digit count a double round-trips exactly (DBL_DIG). Anything
 *  longer is an identifier, not a quantity. */
const MAX_SIGNIFICANT_DIGITS = 15;

/**
 * Type a freshly entered cell value the way Sheets does on Enter.
 * Returns the number when the text is a number under the grammar above,
 * otherwise the original string, unmodified.
 */
export function autoTypeEntry(text: string): number | string {
  const trimmed = text.trim();
  if (trimmed === "") return text; // "" stays the empty cell; blanks stay blanks

  const match = NUMBER_ENTRY.exec(trimmed);
  if (!match) return text;
  const [, sign, intGroup, fracDigits] = match;

  // "." / "-." / "-" match the regex shape with no digits anywhere.
  const intDigits = intGroup === undefined ? "" : intGroup.replace(/,/g, "");
  const frac = fracDigits ?? "";
  if (intDigits === "" && frac === "") return text;

  // Padding zeros are data ("007"), not a number. "0" and "0.5" pass
  // because their integer part is a single zero.
  if (intDigits.length > 1 && intDigits.startsWith("0")) return text;

  // Significant digits: leading zeros of the whole figure and trailing
  // zeros of the fraction carry no precision ("0.5000" is 0.5 exactly).
  // Trailing zeros of the integer part DO count: "1000000000000000" would
  // survive a double, but once numbers pass 1e21 String(n) renders them in
  // exponent form, so a round 16-digit figure stays text for display
  // honesty as well as for the phone-number case.
  const significant = (intDigits + frac.replace(/0+$/, "")).replace(/^0+/, "");
  if (significant.length > MAX_SIGNIFICANT_DIGITS) return text;

  const n = Number(`${sign ?? ""}${intDigits === "" ? "0" : intDigits}.${frac === "" ? "0" : frac}`);
  if (!Number.isFinite(n)) return text;
  // "-0" normalises to 0: JSON has no negative zero, so a stored -0 would
  // come back as 0 and the conflict guard's expect/stored comparison would
  // have to special-case it. Collapse it before it ever reaches storage.
  return n === 0 ? 0 : n;
}

/** What the editor commit gets: the typed value plus, when the user typed
 *  the symbol themselves, the per-cell number format it implies. `nf` is
 *  ABSENT (not undefined) for a plain number or text so callers can
 *  compare against the stored style with a simple `===`. */
export type RichEntry = { value: number | string; nf?: "percent" | "currency" };

/** Fraction digits kept after the /100 of a percent entry. 7/100 is
 *  0.07000000000000001 in a double; rounding to 12 places kills that
 *  noise while keeping every percentage anyone would type exactly. */
const PERCENT_ROUND_PLACES = 12;

/**
 * The editor-commit grammar: everything autoTypeEntry accepts, plus
 *   * "<number>%"  -> { value: number / 100, nf: "percent" }  ("5%" is 0.05,
 *     what Sheets stores; "5 %" with a space before the sign is accepted
 *     too, Sheets takes it). "%5" and "5%%" are text.
 *   * "$<number>" / "-$<number>" -> { value, nf: "currency" }. The minus
 *     goes BEFORE the symbol as people write it; "$-5", "$ 5", "5$" and a
 *     bare "$" are text. The number after the symbol is unsigned and obeys
 *     the full grammar, so "$007" and a 16-digit "$1234567890123456" stay
 *     text for the same reasons "007" and the 16-digit figure do.
 * Anything else is exactly autoTypeEntry's answer with no nf, so a plain
 * "5" typed into a cell never invents a format and a cell that already has
 * one keeps it (Sheets keeps cell formatting on a bare-number entry).
 */
export function autoTypeEntryRich(text: string): RichEntry {
  const trimmed = text.trim();

  if (trimmed.endsWith("%")) {
    // autoTypeEntry trims, so the whitespace of "5 %" is absorbed there;
    // "5%%" leaves "5%" as the body, which it rejects, as does "%".
    const body = autoTypeEntry(trimmed.slice(0, -1));
    if (typeof body !== "number") return { value: text };
    const pct = Number((body / 100).toFixed(PERCENT_ROUND_PLACES));
    // toFixed of a tiny negative yields "-0.000…" which parses to -0.
    return { value: pct === 0 ? 0 : pct, nf: "percent" };
  }

  const currency = /^(-)?\$(.*)$/.exec(trimmed);
  if (currency) {
    const [, sign, rest] = currency;
    // The body must start with a digit or the decimal point: a leading
    // space ("$ 5") or a second sign ("$-5") is not how a currency amount
    // is written, and autoTypeEntry would otherwise accept both.
    if (!/^[\d.]/.test(rest)) return { value: text };
    const body = autoTypeEntry(rest);
    if (typeof body !== "number") return { value: text };
    const n = sign ? -body : body;
    return { value: n === 0 ? 0 : n, nf: "currency" };
  }

  return { value: autoTypeEntry(text) };
}

/**
 * The open-cell column type: the one new sheets are born with, where the
 * user types anything and Sheets decides the type on entry. long_text,
 * email, url and the other text-shaped types stay text on purpose: a
 * URL column that turns "2024" into a number has lost its meaning.
 */
export function isOpenColumnType(type: string): boolean {
  return type === "short_text";
}

/**
 * Convenience for the entry points: auto-type only when the column is
 * open, pass the text through untouched otherwise. Numeric-typed columns
 * keep storing text because the engine already reads numeric text there.
 */
export function autoTypeForColumn(columnType: string, text: string): number | string {
  return isOpenColumnType(columnType) ? autoTypeEntry(text) : text;
}
