#!/usr/bin/env node
// CI contrast gate over the token file (design-system.md 8.4 rule 5).
//
// Parses src/app/(dashboard)/tokens.css (no CSS dependency: the file is a
// flat list of custom properties in a handful of known blocks), resolves
// every var() chain in each of the four contexts the product can be in
//   light / navy chrome, light / light chrome, dark / navy, dark / light
// and checks the pairs the spec names:
//   every *-text on its *-bg, --os-ink-2 on --os-surface-1 and -hov, the
//   chrome pairs, the user status hues, plus the ink / brand / inverse
//   pairs components rely on. Text pairs fail under 4.5:1, non-text (UI)
//   pairs under 3:1. Translucent colours are composited over the surface
//   they sit on before measuring.
//
// It also diffs the `:root.dark` blocks against their
// `@media (prefers-color-scheme: dark)` mirrors and fails if a declaration
// differs, so the two dark bindings cannot drift apart.
//
// Usage: node scripts/check-token-contrast.mjs [--verbose]
// Exit code 1 on any failing pair or mirror drift.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(process.cwd(), "src/app/(dashboard)/tokens.css");
const verbose = process.argv.includes("--verbose");

// ── Parse ───────────────────────────────────────────────────────────
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function parseRules(src, media = null, out = []) {
  let i = 0;
  for (;;) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const selector = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (depth && j < src.length) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (selector.startsWith("@media")) parseRules(body, selector, out);
    else out.push({ selector, media, decls: parseDecls(body) });
    i = j;
  }
  return out;
}

function parseDecls(body) {
  const decls = {};
  for (const part of body.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name.startsWith("--os-")) continue;
    decls[name] = part.slice(idx + 1).trim();
  }
  return decls;
}

const rules = parseRules(stripComments(readFileSync(FILE, "utf8")));
const firstSelector = (r) => r.selector.split(",")[0].trim();
const block = (sel, media = null) => {
  const r = rules.find((x) => x.media === media && firstSelector(x) === sel);
  if (!r) throw new Error(`tokens.css: block "${sel}"${media ? ` inside ${media}` : ""} not found`);
  return r.decls;
};

const MEDIA = "@media (prefers-color-scheme: dark)";
const base = block(":root");
const navy = block('html[data-chrome="navy"]');
const lightChrome = block('html[data-chrome="light"]');
const dark = block(":root.dark");
const darkLightChrome = block(':root.dark[data-chrome="light"]');
const darkHc = block(':root.dark[data-contrast="high"]');

// ── Mirror drift ────────────────────────────────────────────────────
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`FAIL  ${msg}`);
};

function diffBlocks(label, a, b) {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const n of names) {
    if (a[n] !== b[n]) fail(`${label}: ${n} is "${a[n] ?? "(missing)"}" under :root.dark but "${b[n] ?? "(missing)"}" under the prefers-color-scheme mirror`);
  }
}
diffBlocks("dark mirror", dark, block(':root:not([data-theme="light"])', MEDIA));
diffBlocks("dark light-chrome mirror", darkLightChrome, block(':root:not([data-theme="light"])[data-chrome="light"]', MEDIA));
diffBlocks("dark high-contrast mirror", darkHc, block(':root:not([data-theme="light"])[data-contrast="high"]', MEDIA));

// ── Colour maths ────────────────────────────────────────────────────
function resolveValue(name, ctx, seen = new Set()) {
  if (seen.has(name)) throw new Error(`cycle at ${name}`);
  seen.add(name);
  let v = ctx[name];
  if (v === undefined) throw new Error(`${name} is not defined`);
  v = v.replace(/var\((--os-[a-z0-9-]+)\)/g, (_, ref) => resolveValue(ref, ctx, new Set(seen)));
  return v;
}

function parseColor(v) {
  v = v.trim();
  let m = v.match(/^#([0-9a-fA-F]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error(`cannot parse colour "${v}"`);
}

const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});
const lum = ({ r, g, b }) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ── Contexts ────────────────────────────────────────────────────────
const contexts = {
  "light/navy": { ...base, ...navy },
  "light/light-chrome": { ...base, ...lightChrome },
  "dark/navy": { ...base, ...navy, ...dark },
  "dark/light-chrome": { ...base, ...lightChrome, ...dark, ...darkLightChrome },
};

// ── Pairs ───────────────────────────────────────────────────────────
// [foreground, background, minimum, ground the background composites over]
const TEXT = 4.5;
const UI = 3;
const surfaces = ["--os-canvas", "--os-surface", "--os-surface-1", "--os-surface-hov", "--os-surface-2", "--os-selected", "--os-selected-hov", "--os-widget-head-bg", "--os-table-head-bg", "--os-kbd-bg"];
const pairs = [];
const add = (fg, bg, min, ground = "--os-surface") => pairs.push({ fg, bg, min, ground });

for (const s of surfaces) add("--os-ink", s, TEXT);
for (const s of ["--os-canvas", "--os-surface", "--os-surface-1", "--os-surface-hov", "--os-selected", "--os-table-head-bg"]) add("--os-ink-2", s, TEXT);
for (const s of ["--os-surface-2", "--os-surface-hov", "--os-widget-head-bg"]) add("--os-ink-strong", s, TEXT);
for (const s of ["--os-canvas", "--os-surface", "--os-surface-1", "--os-brand-soft", "--os-selected"]) add("--os-brand-deep", s, TEXT);
add("--os-inverse-fg", "--os-inverse-bg", TEXT);
for (const k of ["success", "warning", "danger"]) {
  add(`--os-${k}-text`, `--os-${k}-bg`, TEXT);
  add(`--os-${k}-text`, "--os-surface", TEXT);
}
for (const b of ["--os-brand", "--os-brand-hover", "--os-brand-pressed", "--os-success-solid", "--os-danger-solid"]) add("--os-ink-inv", b, TEXT);
// The warning solid carries N800 in both themes (1.5: solids do not rebind).
add("--os-n800", "--os-warning-solid", TEXT);
// Chrome
for (const b of ["--os-chrome-bg", "--os-chrome-hov"]) {
  add("--os-chrome-fg", b, TEXT, "--os-chrome-bg");
  add("--os-chrome-fg-2", b, TEXT, "--os-chrome-bg");
}
add("--os-chrome-pill-fg", "--os-chrome-pill", TEXT, "--os-chrome-bg");
add("--os-chrome-field-fg", "--os-chrome-field", TEXT, "--os-chrome-bg");
add("--os-chrome-field-ph", "--os-chrome-field", TEXT, "--os-chrome-bg");
add("--os-chrome-presence", "--os-chrome-bg", UI, "--os-chrome-bg");
add("--os-chrome-attention", "--os-chrome-bg", UI, "--os-chrome-bg");
// Non-text UI pairs on the page
for (const s of ["--os-canvas", "--os-surface-1"]) {
  add("--os-focus", s, UI);
  add("--os-brand", s, UI);
}
add("--os-presence", "--os-canvas", UI);
add("--os-attention", "--os-canvas", UI);
add("--os-danger-solid", "--os-canvas", UI);

// User status hues: light values in light contexts, dark values in dark.
function userPairs(isDark) {
  const out = [];
  for (let i = 1; i <= 8; i++) {
    const fg = isDark ? `--os-status-user-${i}-dark` : `--os-status-user-${i}`;
    const bg = isDark ? `--os-status-user-${i}-dark-bg` : `--os-status-user-${i}-bg`;
    out.push({ fg, bg, min: TEXT, ground: "--os-surface" });
    out.push({ fg, bg: "--os-surface", min: TEXT, ground: "--os-surface" });
    if (!isDark) out.push({ fg: "--os-ink-inv", bg: fg, min: TEXT, ground: "--os-surface" });
  }
  return out;
}

// ── Run ─────────────────────────────────────────────────────────────
let checked = 0;
for (const [name, ctx] of Object.entries(contexts)) {
  const isDark = name.startsWith("dark");
  for (const p of [...pairs, ...userPairs(isDark)]) {
    let fg, bg;
    try {
      const ground = parseColor(resolveValue(p.ground, ctx));
      bg = parseColor(resolveValue(p.bg, ctx));
      if (bg.a < 1) bg = over(bg, ground);
      fg = parseColor(resolveValue(p.fg, ctx));
      if (fg.a < 1) fg = over(fg, bg);
    } catch (e) {
      fail(`${name}: ${p.fg} on ${p.bg}: ${e.message}`);
      continue;
    }
    const r = ratio(fg, bg);
    checked++;
    const line = `${name.padEnd(19)} ${p.fg.padEnd(28)} on ${p.bg.padEnd(28)} ${r.toFixed(2)}:1 (min ${p.min})`;
    if (r < p.min) fail(line);
    else if (verbose) console.log(`ok    ${line}`);
  }
}

console.log(`\ntoken-contrast: ${checked} pairs across ${Object.keys(contexts).length} contexts, ${failures} failure(s)`);
process.exit(failures > 0 ? 1 : 0);
