/**
 * Tables Phase 4: column-level display formatting + conditional rules.
 *
 * Pure module, no React, no fetch. Formatting is DISPLAY ONLY: raw cell
 * values never change shape, sort and formulas keep reading raw, and a
 * column with no format renders exactly what the pre-Phase-4 cell
 * renderers rendered ("$12", "12%", "★★★", String(v)) so switching this
 * module on changes nothing until a user configures a format.
 *
 * Storage note: `ColumnFormat`/`ConditionalRule[]` ride inside the
 * existing DataTable.columns Json (optional keys), so everything here
 * must tolerate malformed persisted data without throwing.
 */

export interface ColumnFormat {
  decimals?: number; // 0..10; out-of-range or fractional input is clamped, never thrown on
  thousands?: boolean;
  style?: "number" | "currency" | "percent";
  currency?: string; // ISO 4217, used when style === "currency"
  negative?: "minus" | "parens" | "red" | "parens-red";
  dateFormat?: "iso" | "dmy" | "mdy" | "long"; // date columns only
}

export interface ConditionalRule {
  when: "gt" | "lt" | "gte" | "lte" | "eq" | "neq" | "contains" | "empty" | "nonempty";
  value?: string | number;
  bg: string;
}

/* ── Intl formatter cache ─────────────────────────────────────────
 * formatCellValue runs once per visible cell per render, and
 * Intl.NumberFormat construction is expensive. One formatter per
 * DISTINCT resolved format, keyed on the serialized options. The key
 * space is bounded: decimals are clamped to 0..10, currency is
 * normalized to a valid ISO code or USD, so the cache cannot be grown
 * unboundedly by junk stored formats. */
const numberFormatters = new Map<string, Intl.NumberFormat>();
let longDateFormatter: Intl.DateTimeFormat | null = null;

/** Clamp persisted decimals into the contract's 0..10, or undefined when unusable. */
function clampDecimals(d: unknown): number | undefined {
  if (typeof d !== "number" || !Number.isFinite(d)) return undefined;
  return Math.min(10, Math.max(0, Math.floor(d)));
}

/** Uppercased 3-letter code or USD; the legacy renderer's symbol is "$", so USD is the faithful fallback. */
function normalizeCurrency(code: unknown): string {
  return typeof code === "string" && /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : "USD";
}

function getNumberFormatter(style: "number" | "currency" | "percent", format: ColumnFormat): Intl.NumberFormat {
  const decimals = clampDecimals(format.decimals);
  // No decimals configured: show the stored number faithfully (up to 10
  // fraction digits, no forced trailing zeros). Intl's default max of 3
  // would silently round 1.23456, which would misrepresent stored data.
  const min = decimals ?? 0;
  const max = decimals ?? 10;
  // Intl groups by default; the legacy renderers never did, so grouping is opt-in.
  const grouping = format.thousands === true;
  const currency = style === "currency" ? normalizeCurrency(format.currency) : "";
  const key = `${style}|${currency}|${min}|${max}|${grouping ? 1 : 0}`;
  let fmt = numberFormatters.get(key);
  if (!fmt) {
    const base: Intl.NumberFormatOptions = {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      useGrouping: grouping,
    };
    if (style === "currency") {
      try {
        fmt = new Intl.NumberFormat("en-US", { ...base, style: "currency", currency });
      } catch {
        // A 3-letter code Intl still rejects (e.g. an ISO code retired
        // from the CLDR): fall back to USD rather than throw mid-render.
        fmt = new Intl.NumberFormat("en-US", { ...base, style: "currency", currency: "USD" });
      }
    } else {
      // percent uses decimal style too: percent columns store 12 to mean
      // "12%" (see the grid's editor and displayCell), so Intl's percent
      // style, which multiplies by 100, would change the value's meaning.
      fmt = new Intl.NumberFormat("en-US", base);
    }
    numberFormatters.set(key, fmt);
  }
  return fmt;
}

/** Does this format object actually configure NUMBER rendering? An empty
 *  or dateFormat-only object must leave numbers on the legacy path. */
function hasNumericFormat(format?: ColumnFormat): format is ColumnFormat {
  if (!format) return false;
  return (
    format.decimals !== undefined ||
    format.thousands !== undefined ||
    format.style !== undefined ||
    format.currency !== undefined ||
    format.negative !== undefined
  );
}

/** The style a column renders in when the format does not say: currency
 *  columns stay currency-shaped, percent stay percent, so setting only
 *  `decimals` on a currency column never strips its symbol. */
function resolveStyle(colType: string, format?: ColumnFormat): "number" | "currency" | "percent" {
  if (format?.style) return format.style;
  if (colType === "currency") return "currency";
  if (colType === "percent") return "percent";
  return "number";
}

function formatDate(raw: unknown, dateFormat?: ColumnFormat["dateFormat"]): string {
  if (typeof raw !== "string") return String(raw);
  if (!dateFormat || dateFormat === "iso") return raw; // iso is the stored shape: passthrough
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return raw; // not YYYY-MM-DD: pass through raw, never guess
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Round-trip check catches calendar-invalid strings like 2026-02-30,
  // which Date.UTC would silently roll into March.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return raw;
  switch (dateFormat) {
    case "dmy":
      return `${m[3]}/${m[2]}/${m[1]}`;
    case "mdy":
      return `${m[2]}/${m[3]}/${m[1]}`;
    case "long":
      // UTC keeps the rendered day equal to the stored day in every viewer timezone.
      longDateFormatter ??= new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
      return longDateFormatter.format(dt);
    default:
      return raw;
  }
}

/** Matches displayCell's rating branch (stars, nothing for 0/non-number),
 *  clamped to 0..5 like coercePaste writes, so a junk stored value can
 *  never explode into a thousand-star string or a repeat() RangeError. */
function formatRating(raw: unknown): string {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.min(5, Math.max(0, Math.floor(raw))) : 0;
  return n > 0 ? "★".repeat(n) : "";
}

/**
 * The display/CSV string for a cell. Raw values are never mutated; errors
 * ("#DIV/0!" etc.) and plain strings pass through untouched.
 */
export function formatCellValue(raw: unknown, colType: string, format?: ColumnFormat): string {
  if (raw === null || raw === undefined || raw === "") return "";

  if (colType === "date") return formatDate(raw, format?.dateFormat);
  if (colType === "rating") return formatRating(raw); // rating IS its display; numeric format keys do not apply

  // Only actual numbers get numeric formatting. Strings (including engine
  // errors and numeric-looking text in text columns) pass through: a
  // format must never reinterpret what a text column stores.
  if (typeof raw !== "number") return String(raw);
  if (!Number.isFinite(raw)) return String(raw); // NaN/Infinity: show the truth, do not let Intl prettify it

  const style = resolveStyle(colType, format);

  if (!hasNumericFormat(format)) {
    // Legacy parity path: byte-for-byte what the pre-Phase-4 renderers
    // produced, so unformatted columns are visually unchanged.
    if (style === "currency") return `$${raw}`;
    if (style === "percent") return `${raw}%`;
    return String(raw);
  }

  const negative = format.negative ?? "minus";
  const parens = (negative === "parens" || negative === "parens-red") && raw < 0;
  // Parens style drops the minus: format the magnitude, then wrap.
  const fmt = getNumberFormatter(style, format);
  let text = fmt.format(parens ? Math.abs(raw) : raw);
  if (style === "percent") text = `${text}%`;
  if (parens) text = `(${text})`; // percent wraps inside the parens: (12%), matching Excel's accounting display
  return text;
}

/** True when the UI should paint the cell's text red. The colour itself is
 *  the UI's job; this module only answers the question. */
export function isNegativeStyled(raw: unknown, format?: ColumnFormat): boolean {
  if (!format) return false;
  if (format.negative !== "red" && format.negative !== "parens-red") return false;
  return typeof raw === "number" && Number.isFinite(raw) && raw < 0;
}

/* ── Conditional formatting v1 ──────────────────────────────────── */

const RULE_OPS = new Set<ConditionalRule["when"]>([
  "gt", "lt", "gte", "lte", "eq", "neq", "contains", "empty", "nonempty",
]);

/** A cell counts as empty for rules when it holds null/undefined/"" only;
 *  0 and false are real values a rule may target with eq. */
function isEmptyCell(raw: unknown): boolean {
  return raw === null || raw === undefined || raw === "";
}

/** Finite number for comparison, or null when the side is not numeric.
 *  Numeric STRINGS count ("12" from a text column compares as 12 when the
 *  other side is numeric too), but "", booleans and objects do not. */
function asComparableNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ruleMatches(raw: unknown, rule: ConditionalRule): boolean {
  if (rule.when === "empty") return isEmptyCell(raw);
  if (rule.when === "nonempty") return !isEmptyCell(raw);

  // Every remaining operator compares against rule.value; an empty cell
  // never matches a comparison (empty/nonempty exist for that question).
  if (isEmptyCell(raw)) return false;

  if (rule.when === "contains") {
    return String(raw).toLowerCase().includes(String(rule.value).toLowerCase());
  }

  // Numeric compare only when BOTH sides are numeric; otherwise plain
  // string comparison, so "abc" vs 5 falls back to "abc" vs "5" instead of
  // silently never matching.
  const a = asComparableNumber(raw);
  const b = asComparableNumber(rule.value);
  if (a !== null && b !== null) {
    switch (rule.when) {
      case "gt": return a > b;
      case "lt": return a < b;
      case "gte": return a >= b;
      case "lte": return a <= b;
      case "eq": return a === b;
      case "neq": return a !== b;
    }
  }
  const as = String(raw);
  const bs = String(rule.value);
  switch (rule.when) {
    case "gt": return as > bs;
    case "lt": return as < bs;
    case "gte": return as >= bs;
    case "lte": return as <= bs;
    case "eq": return as === bs;
    case "neq": return as !== bs;
    default: return false;
  }
}

/**
 * First matching rule wins; returns its background colour, or null when
 * nothing matches. Malformed rules (wrong shape, unknown operator, missing
 * bg, comparison with no value) are skipped, never thrown on: rules live
 * in user-edited Json and a bad one must not take the grid down.
 */
export function matchRule(raw: unknown, rules: ConditionalRule[] | undefined): string | null {
  if (!Array.isArray(rules)) return null;
  for (const rule of rules) {
    if (typeof rule !== "object" || rule === null) continue;
    if (!RULE_OPS.has(rule.when)) continue;
    if (typeof rule.bg !== "string" || rule.bg === "") continue;
    const needsValue = rule.when !== "empty" && rule.when !== "nonempty";
    if (needsValue && (rule.value === undefined || rule.value === null)) continue;
    let hit = false;
    try {
      hit = ruleMatches(raw, rule);
    } catch {
      continue; // a rule that throws on exotic raw data is malformed by definition: skip it
    }
    if (hit) return rule.bg;
  }
  return null;
}
