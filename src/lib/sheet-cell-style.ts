/**
 * Tables: per-cell formatting (Sheets' B / I / U / S / colour / fill /
 * alignment toolbar, plus the $ / % / .0 / .00 / 123 number format for
 * cells in OPEN columns).
 *
 * Pure module, no React, no fetch.
 *
 * Storage: NO schema change is available, so styles ride inside the row's
 * existing `values` Json under one RESERVED key, `values["$fmt"]`, as a
 * map of `{ [colId]: CellStyle }`. The leading `$` cannot collide with a
 * real column id (ids are cuids). Every reader in the codebase is
 * column-driven (it iterates `table.columns` and indexes `values[colId]`),
 * so the key is invisible to them by construction; the only code that
 * must skip it explicitly is anything KEY-driven (`Object.keys(values)`),
 * and `isReservedKey` is the one predicate those paths share. The engine
 * host in particular must never see "$fmt" as a column id.
 *
 * Everything here tolerates malformed persisted data without throwing: a
 * `$fmt` that is a string, null, an array, or carries non-object entries
 * is read as "no styles" rather than crashing a 1000-row render.
 */

export const CELL_STYLE_KEY = "$fmt";

/**
 * Reserved sibling of `$fmt`: `values["$rh"]` is the row's custom HEIGHT in
 * px (a plain number, clamped 16..400 by the writer; absent = the default
 * SHEET_ROW_H). It is NOT a style map — readCellStyle / withCellStyle never
 * touch it — but it rides the same reserved-key filter so the engine host,
 * conflict guard, CSV export, stats and absorb paths all keep skipping it
 * exactly as they skip `$fmt`.
 */
export const ROW_HEIGHT_KEY = "$rh";

/* One set, one predicate: every key-driven reader shares isReservedKey, so
 * adding a reserved key HERE is the whole change — no caller edits. */
const RESERVED_KEYS = new Set<string>([CELL_STYLE_KEY, ROW_HEIGHT_KEY]);

/** Flags are `true` or absent (never `false`) so an all-empty style is
 *  detectable by key count and the stored map stays as small as the
 *  formatting the user actually applied. */
export type CellStyle = {
  b?: true;
  i?: true;
  u?: true;
  s?: true;
  /** Text colour, any CSS colour string. */
  c?: string;
  /** Fill colour, any CSS colour string. */
  bg?: string;
  /** Horizontal alignment: left / center / right. */
  a?: "l" | "c" | "r";
  /**
   * Per-CELL number format, the $ / % / 123 toolbar on an OPEN column.
   * Legacy typed columns (number/currency/percent) keep their COLUMN-level
   * `col.format`; this exists because on an open sheet pressing $ must
   * format the selected cells, not retype the whole column. Names match
   * `ColumnFormat.style` so the page can hand them straight to the
   * sheet-format formatter. Not CSS: styleToCss ignores it.
   */
  nf?: "number" | "currency" | "percent";
  /** Decimal places for `nf`, 0..10 (same clamp as ColumnFormat.decimals). */
  dp?: number;
};

/** Keys of `row.values` that are NOT column ids. Key-driven readers must
 *  skip these; column-driven readers never encounter them. */
export function isReservedKey(k: string): boolean {
  return RESERVED_KEYS.has(k);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read the stored `$fmt` map, treating anything that isn't a plain object
 *  as empty. Returned object is the STORED one (not a copy); callers that
 *  mutate must copy first (withCellStyle does). */
function readStyleMap(values: Record<string, unknown> | undefined): Record<string, unknown> {
  const raw = values?.[CELL_STYLE_KEY];
  return isPlainObject(raw) ? raw : {};
}

const ALIGNS = new Set(["l", "c", "r"]);
const NUMBER_FORMATS = new Set(["number", "currency", "percent"]);
/** Same ceiling as sheet-format's clampDecimals so a cell can never ask
 *  Intl for more fraction digits than a column can. */
const MAX_DP = 10;

/** Normalise one stored entry into a CellStyle, dropping any key whose
 *  value is not the shape the contract allows (a persisted `b: false` or
 *  `a: "middle"` is ignored, not propagated). Returns undefined when
 *  nothing survives, so "styled" and "unstyled" stay distinguishable. */
function sanitize(raw: unknown): CellStyle | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: CellStyle = {};
  if (raw.b === true) out.b = true;
  if (raw.i === true) out.i = true;
  if (raw.u === true) out.u = true;
  if (raw.s === true) out.s = true;
  if (typeof raw.c === "string" && raw.c) out.c = raw.c;
  if (typeof raw.bg === "string" && raw.bg) out.bg = raw.bg;
  if (typeof raw.a === "string" && ALIGNS.has(raw.a)) out.a = raw.a as CellStyle["a"];
  if (typeof raw.nf === "string" && NUMBER_FORMATS.has(raw.nf)) out.nf = raw.nf as CellStyle["nf"];
  // dp is clamped rather than dropped: a persisted 99 still means "many
  // decimals", and a non-number ("2", null) carries no intent at all.
  // 0 is a real value (no decimals), so the check is on type, not truthiness.
  if (typeof raw.dp === "number" && Number.isFinite(raw.dp)) {
    out.dp = Math.min(MAX_DP, Math.max(0, Math.floor(raw.dp)));
  }
  return Object.keys(out).length ? out : undefined;
}

/** The style stored for one cell, or undefined when the cell has none. */
export function readCellStyle(
  values: Record<string, unknown> | undefined,
  colId: string,
): CellStyle | undefined {
  if (isReservedKey(colId)) return undefined;
  return sanitize(readStyleMap(values)[colId]);
}

/**
 * Return NEW row values with `patch` merged into `colId`'s style.
 *
 * - A key in `patch` whose value is `undefined`, `null`, `false` or `""`
 *   REMOVES that flag (so `{ b: undefined }` is "un-bold"); any other value
 *   goes through the same sanitiser as persisted data, so garbage can't be
 *   written either. `0` is NOT a removal value: `{ dp: 0 }` sets zero
 *   decimals, which is a format, not its absence.
 * - `patch === null`, or a merge whose result is empty, removes the
 *   column's entry entirely.
 * - When the map ends up empty the `$fmt` key itself is dropped, so a row
 *   whose formatting was fully cleared round-trips to exactly the values
 *   it had before any style was applied.
 * - Never mutates `values` or its nested `$fmt` map.
 */
export function withCellStyle(
  values: Record<string, unknown>,
  colId: string,
  patch: Partial<Record<keyof CellStyle, unknown>> | null,
): Record<string, unknown> {
  const map: Record<string, unknown> = { ...readStyleMap(values) };

  if (isReservedKey(colId)) {
    // The reserved key can never be a column, so there is nothing to style.
    return { ...values };
  }

  let next: CellStyle | undefined;
  if (patch === null) {
    next = undefined;
  } else {
    // Start from the sanitised current entry, then overlay the patch key
    // by key. Removal values delete; everything else is re-sanitised below.
    const merged: Record<string, unknown> = { ...(sanitize(map[colId]) ?? {}) };
    for (const k of Object.keys(patch) as (keyof CellStyle)[]) {
      const v = patch[k];
      if (v === undefined || v === null || v === false || v === "") delete merged[k];
      else merged[k] = v;
    }
    next = sanitize(merged);
  }

  if (next) map[colId] = next;
  else delete map[colId];

  const out: Record<string, unknown> = { ...values };
  if (Object.keys(map).length) out[CELL_STYLE_KEY] = map;
  else delete out[CELL_STYLE_KEY];
  return out;
}

/** Plain CSS-property object for a style. React-free on purpose (the kernel
 *  spreads it into `style`, tests assert on it directly). `{}` for an
 *  unstyled cell so callers can spread unconditionally. `nf` / `dp` are
 *  deliberately absent: they shape the TEXT (via the formatter), not the
 *  box. */
export function styleToCss(style: CellStyle | undefined): {
  fontWeight?: number;
  fontStyle?: "italic";
  textDecoration?: string;
  color?: string;
  backgroundColor?: string;
  textAlign?: "left" | "center" | "right";
} {
  if (!style) return {};
  const css: ReturnType<typeof styleToCss> = {};
  if (style.b) css.fontWeight = 600;
  if (style.i) css.fontStyle = "italic";
  if (style.u || style.s) {
    // Both decorations can coexist; CSS takes them space-separated.
    const parts: string[] = [];
    if (style.u) parts.push("underline");
    if (style.s) parts.push("line-through");
    css.textDecoration = parts.join(" ");
  }
  if (style.c) css.color = style.c;
  if (style.bg) css.backgroundColor = style.bg;
  if (style.a) css.textAlign = style.a === "l" ? "left" : style.a === "c" ? "center" : "right";
  return css;
}
