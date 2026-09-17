// The type codemod's pure half (design-system.md 2.2, 2.4, 8.2).
//
// Plain JS on purpose: scripts/codemod-type-scale.mjs runs it under node with
// no TypeScript loader, and src/lib/type-scale-codemod.test.ts runs it under
// vitest. Nothing here reads a file or the clock; the script owns the I/O.
//
// Three phases, applied to one source string in this order:
//
//   R  rename: the five standard names at their PRE-flip meaning move to the
//      name that holds the same RENDERED pixel size after globals.css binds
//      the 2.2 values in px (see the two RENAMES_* tables for why the root
//      font size decides the table). This phase runs ONCE, on the same change
//      that flips globals.css; the script gates it on the pre-flip marker so a
//      second run cannot chain text-xs -> text-sm -> text-base.
//   P  pixels: every arbitrary text-[Npx] maps to the nearest named size per
//      the 8.2 table. Sizes above the scale are refused and listed, never
//      guessed.
//   W  weight: 700 and up become 600 (2.4: "600 is the ceiling; never 700 in
//      product UI"). Class utilities and inline fontWeight style values.
//
// P and W are idempotent by construction (their outputs are not inputs of any
// rule). R is idempotent only through the gate, which is why it is a flag.

/** The nine sizes (2.2) plus the two below-scale names, in px. */
export const SCALE_PX = Object.freeze({
  "text-rail": 10,
  "text-micro": 11,
  "text-xs": 12,
  "text-sm": 13,
  "text-base": 14,
  "text-row": 15,
  "text-lg": 16,
  "text-xl": 22,
});

/**
 * Phase R. Key: the utility as written today; value: the utility that holds
 * the same RENDERED size once the five names are bound in px.
 *
 * Two tables, because the pre-flip bindings were rem and the root font size
 * differs by route tree. The OS shell sets `:root, .workwrk-os { font-size:
 * 14px }` (tokens.css, and os.css before it), so wherever os.css loads (the
 * (dashboard) tree, onboard, and the shared components) a rem utility rendered
 * at 14/16 of its nominal size: text-xs 0.8125rem was 11.375px, not the 13px
 * the readability lift named, text-sm was 12.25, text-base 14, text-lg 15.75,
 * text-xl 17.5. Marketing and the other route trees have the 16px default, so
 * the nominal sizes are the rendered ones there.
 *
 * The 14px-root table keeps what the founder saw on screen (each move is under
 * a pixel except text-xl, 17.5 -> 16, one step). The 16px-root table is the
 * nominal one the token step recorded: text-lg goes 18 -> 16 (nearest step)
 * and text-xl 20 -> 22 (8.2: "20 -> text-xl").
 */
export const RENAMES_14PX_ROOT = Object.freeze({
  "text-xs": "text-xs",
  "text-sm": "text-xs",
  "text-base": "text-base",
  "text-lg": "text-lg",
  "text-xl": "text-lg",
});

export const RENAMES_16PX_ROOT = Object.freeze({
  "text-xs": "text-sm",
  "text-sm": "text-base",
  "text-base": "text-lg",
  "text-lg": "text-lg",
  "text-xl": "text-xl",
});

/** Kept for the table's readers; the script picks by root size. */
export const RENAMES = RENAMES_16PX_ROOT;

/** Sizes the 8.2 table does not reach. The script leaves them and lists them. */
export const REFUSE_ABOVE_PX = 26;
export const REFUSE_BELOW_PX = 10;

/**
 * Phase P, one size. `ctx.uppercase` says whether the same class string
 * carries `uppercase` (11 / 11.5 -> text-micro only then); `ctx.rail` says the
 * file is the rail (10 -> text-rail there, text-micro everywhere else).
 *
 * Returns the utility name, or null when the size is refused.
 */
export function mapPxSize(px, ctx = {}) {
  const n = Number(px);
  if (!Number.isFinite(n)) return null;
  if (n < REFUSE_BELOW_PX) return null;
  if (n > REFUSE_ABOVE_PX) return null;
  if (n < 11) return ctx.rail ? "text-rail" : "text-micro";
  if (n < 12) return ctx.uppercase ? "text-micro" : "text-xs";
  if (n < 13) return "text-xs";
  if (n < 13.5) return "text-sm";
  if (n <= 14.5) return "text-base";
  // 15 -> text-base: the .os-row container promotes rows to 15 (2.3). Nothing
  // sets 15 on its own.
  if (n <= 15) return "text-base";
  // 15.5 rounds up to the next scale step; half pixels go to zero (2.2).
  if (n < 19) return "text-lg";
  // 19 is equidistant from 16 and 22; ties round up. 20, 21, 22, 24, 26 -> 22.
  return "text-xl";
}

// A utility token is bounded by anything that is not part of a class name.
// `:` and `!` on the left admit variants (lg:text-xs, !text-xs); `/` on the
// right admits a leading modifier (text-sm/5), which the codebase does not use
// today but must not be swallowed if it appears.
const LEFT = "(^|[^A-Za-z0-9_\\-/.])";
const RIGHT = "(?![A-Za-z0-9_\\-])";

const RENAME_RE = new RegExp(`${LEFT}(text-(?:xs|sm|base|lg|xl))${RIGHT}`, "g");
const PX_RE = new RegExp(`${LEFT}text-\\[(\\d+(?:\\.\\d+)?)px\\]${RIGHT}`, "g");
const WEIGHT_CLASS_RE = new RegExp(`${LEFT}font-(?:bold|extrabold|black)${RIGHT}`, "g");
// fontWeight: 700 / "700" / 'bold' inside a style object. 600 and below untouched.
const WEIGHT_STYLE_RE = /(fontWeight\s*:\s*)(?:(["']?)(?:700|800|900|bold|bolder)\2)(?=\s*[,}\n])/g;

/** Quote characters that bound one class string in TS/TSX source. */
const QUOTES = new Set(['"', "'", "`"]);

/**
 * The stretch of `src` that belongs to the same string literal as `index`,
 * approximated as the text between the nearest quote characters on either
 * side. Good enough to see `uppercase` beside an 11px size; a template literal
 * that splits its classes over lines can hide it, which is the documented gap.
 */
export function enclosingLiteral(src, index) {
  let start = index;
  while (start > 0 && !QUOTES.has(src[start - 1]) && src[start - 1] !== "\n") start--;
  let end = index;
  while (end < src.length && !QUOTES.has(src[end]) && src[end] !== "\n") end++;
  return src.slice(start, end);
}

/** @returns {Record<string, number>} */
function emptyCounts() {
  return {};
}

/** @param {Record<string, number>} counts */
function bump(counts, key, by = 1) {
  counts[key] = (counts[key] ?? 0) + by;
}

/**
 * Phase R over a whole source string. Every occurrence is rewritten through a
 * single pass, so chained keys (xs -> sm -> base) cannot compound.
 *
 * @param {string} src
 * @param {Readonly<Record<string, string>>} table one of the RENAMES_* tables
 */
export function renameStandardSizes(src, table = RENAMES_16PX_ROOT) {
  const counts = emptyCounts();
  const out = src.replace(RENAME_RE, (whole, left, name) => {
    const to = table[name];
    if (to === name) return whole;
    bump(counts, `${name} -> ${to}`);
    return `${left}${to}`;
  });
  return { out, counts };
}

/**
 * Phase P over a whole source string. `refused` lists the sizes left in place
 * with their line numbers.
 */
export function mapArbitrarySizes(src, opts = {}) {
  const counts = emptyCounts();
  const refused = [];
  const out = src.replace(PX_RE, (whole, left, px, offset) => {
    const literal = enclosingLiteral(src, offset + left.length);
    const uppercase = /(^|[^A-Za-z0-9_-])uppercase(?![A-Za-z0-9_-])/.test(literal);
    const to = mapPxSize(px, { uppercase, rail: opts.rail === true });
    if (!to) {
      refused.push({ line: lineOf(src, offset), token: `text-[${px}px]` });
      return whole;
    }
    bump(counts, to);
    return `${left}${to}`;
  });
  return { out, counts, refused };
}

/** Phase W over a whole source string. */
export function capWeights(src) {
  const counts = emptyCounts();
  let out = src.replace(WEIGHT_CLASS_RE, (whole, left) => {
    bump(counts, `${whole.slice(left.length)} -> font-semibold`);
    return `${left}font-semibold`;
  });
  out = out.replace(WEIGHT_STYLE_RE, (whole, head) => {
    bump(counts, `fontWeight ${whole.slice(head.length).trim()} -> 600`);
    return `${head}600`;
  });
  return { out, counts };
}

export function lineOf(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/**
 * The whole transform for one file.
 *
 * opts.rename   run phase R (only while globals.css is pre-flip)
 * opts.root14   the file renders under the OS shell's 14px root (os.css
 *               loaded), so phase R uses RENAMES_14PX_ROOT; otherwise the
 *               nominal RENAMES_16PX_ROOT table
 * opts.product  run phases P and W (false for marketing and brand files, which
 *               keep their own sheet until refresh step 9)
 * opts.rail     the file is the rail, so 10px -> text-rail
 *
 * @param {string} src
 * @param {{ rename?: boolean, root14?: boolean, product?: boolean, rail?: boolean }} opts
 * @returns {{ out: string, counts: Record<string, number>, refused: Array<{ line: number, token: string }>, changed: boolean }}
 */
export function transformSource(src, opts = {}) {
  const counts = emptyCounts();
  /** @type {Array<{ line: number, token: string }>} */
  const refused = [];
  let out = src;

  if (opts.rename) {
    const r = renameStandardSizes(out, opts.root14 ? RENAMES_14PX_ROOT : RENAMES_16PX_ROOT);
    out = r.out;
    for (const [k, v] of Object.entries(r.counts)) bump(counts, `rename ${k}`, v);
  }
  if (opts.product) {
    const p = mapArbitrarySizes(out, { rail: opts.rail });
    out = p.out;
    for (const [k, v] of Object.entries(p.counts)) bump(counts, `px -> ${k}`, v);
    refused.push(...p.refused);

    const w = capWeights(out);
    out = w.out;
    for (const [k, v] of Object.entries(w.counts)) bump(counts, `weight ${k}`, v);
  }
  return { out, counts, refused, changed: out !== src };
}
