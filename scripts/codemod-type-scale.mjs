#!/usr/bin/env node
// The type codemod (design-system.md 8.2, refresh step 2).
//
//   node scripts/codemod-type-scale.mjs --dry-run   per-file summary, no writes
//   node scripts/codemod-type-scale.mjs --write     apply, then flip globals.css
//
// Deterministic and idempotent. Three phases (see src/lib/type-scale-codemod.mjs):
//
//   R  rename the five standard names from their pre-flip meaning to the name
//      that holds the same size after the flip. Gated on globals.css still
//      carrying the pre-flip binding `--text-xs: 0.8125rem`; --write flips
//      that binding as its LAST action, so a second run skips R and cannot
//      chain text-xs -> text-sm -> text-base.
//   P  arbitrary text-[Npx] -> the nearest named size per the 8.2 table.
//      Sizes the table does not reach are refused and listed.
//   W  700+ weights -> 600 (2.4: never 700 in product UI).
//
// Scope: every src/**/*.{ts,tsx} except src/generated. R runs everywhere,
// because the @theme flip is global and a marketing text-base would otherwise
// shrink from 16 to 14. R picks its table by the root font size the file
// renders under (isRoot14 below): the marketing dirs, onboard and the other
// non-dashboard trees have the 16px default. P and W run only in the product:
// the marketing sheet (src/app/(marketing), src/components/{landing,
// marketing,bento,pricing}), the brand quarantine (src/components/brand) and
// the generated image routes keep their own type until refresh step 9.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSource } from "../src/lib/type-scale-codemod.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const GLOBALS = join(ROOT, "src/app/globals.css");

const args = new Set(process.argv.slice(2));
const WRITE = args.has("--write");
const DRY = args.has("--dry-run") || !WRITE;
const VERBOSE = args.has("--verbose");
if (args.has("--help")) {
  console.log("usage: node scripts/codemod-type-scale.mjs [--dry-run | --write] [--verbose]");
  process.exit(0);
}

// ── The globals.css flip (phase R's gate) ─────────────────────────

// The whole pre-flip @theme size block, verbatim, so the flip is one exact
// replacement and the gate cannot half-match. Bound in px on purpose: the OS
// shell sets the root font size to 14px (tokens.css `:root, .workwrk-os`), so
// a rem binding renders at 14/16 of the size 2.2 names (0.875rem was 12.25px,
// not 14) and the four sizes the token step bound in rem were off the same way
// (text-row 0.9375rem rendered 13.125px). px is what the table says.
const PRE_FLIP = [
  "  --text-xs: 0.8125rem;",
  "  --text-xs--line-height: 1.25rem;",
  "",
  "  --text-row: 0.9375rem;",
  "  --text-row--line-height: 1.375rem;",
  "  --text-micro: 0.6875rem;",
  "  --text-micro--line-height: 0.875rem;",
  "  --text-micro--font-weight: 600;",
  "  --text-micro--letter-spacing: 0.06em;",
  "  --text-rail: 0.625rem;",
  "  --text-rail--line-height: 0.75rem;",
  "  --text-rail--font-weight: 500;",
  "  --text-prose: 0.9375rem;",
  "  --text-prose--line-height: 1.5rem;",
  "",
].join("\n");
const POST_FLIP = [
  "  --text-xs: 12px;",
  "  --text-xs--line-height: 16px;",
  "  --text-sm: 13px;",
  "  --text-sm--line-height: 18px;",
  "  --text-base: 14px;",
  "  --text-base--line-height: 20px;",
  "  --text-lg: 16px;",
  "  --text-lg--line-height: 22px;",
  "  --text-xl: 22px;",
  "  --text-xl--line-height: 28px;",
  "",
  "  --text-row: 15px;",
  "  --text-row--line-height: 22px;",
  "  --text-micro: 11px;",
  "  --text-micro--line-height: 14px;",
  "  --text-micro--font-weight: 600;",
  "  --text-micro--letter-spacing: 0.06em;",
  "  --text-rail: 10px;",
  "  --text-rail--line-height: 12px;",
  "  --text-rail--font-weight: 500;",
  "  --text-prose: 15px;",
  "  --text-prose--line-height: 24px;",
  "",
].join("\n");

const globalsBefore = readFileSync(GLOBALS, "utf8");
const preFlip = globalsBefore.includes(PRE_FLIP);
const rename = preFlip;

// ── Scope ─────────────────────────────────────────────────────────

const MARKETING = [
  /^app\/\(marketing\)\//,
  /^components\/landing\//,
  /^components\/marketing\//,
  /^components\/bento\//,
  /^components\/pricing\//,
  /^components\/brand\//,
  /(^|\/)(opengraph-image|twitter-image|icon|apple-icon)\.tsx?$/,
];
const SKIP_DIRS = new Set(["generated", "node_modules"]);

function isProduct(rel) {
  return !MARKETING.some((re) => re.test(rel));
}
// Where os.css loads, the root font size is 14px and rem utilities rendered
// small (see RENAMES_14PX_ROOT). os.css is imported by src/app/(dashboard)/
// layout.tsx only (tokens.css `:root, .workwrk-os { font-size: 14px }`), so
// the (dashboard) tree and the shared components that render inside it take
// the 14px table. The marketing dirs are imported solely by the (marketing)
// tree and onboard/layout.tsx says it has no os.css dependency, so both keep
// the nominal 16px table. Shared components that also render on (auth),
// (admin), (public) and setup can be preserved for one root only; the
// product wins, and those trees are step 9's.
function isRoot14(rel) {
  if (MARKETING.some((re) => re.test(rel))) return false;
  return /^app\/\(dashboard\)\//.test(rel) || /^components\//.test(rel);
}
function isRail(rel) {
  return /(^|\/)[^/]*rail[^/]*\.tsx$/.test(rel) && rel.startsWith("components/layout/");
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      // Unit tests hold class strings as fixtures (this codemod's own suite
      // among them); rewriting fixtures would rewrite the assertions.
      yield full;
    }
  }
}

// ── Run ───────────────────────────────────────────────────────────

const totals = {};
const refusedAll = [];
const weightFiles = [];
let touched = 0;
let scanned = 0;

for (const file of walk(SRC)) {
  scanned++;
  const rel = relative(SRC, file);
  const src = readFileSync(file, "utf8");
  const product = isProduct(rel);
  const { out, counts, refused, changed } = transformSource(src, {
    rename,
    root14: isRoot14(rel),
    product,
    rail: isRail(rel),
  });

  for (const r of refused) refusedAll.push({ file: `src/${rel}`, ...r });
  const weightKeys = Object.keys(counts).filter((k) => k.startsWith("weight "));
  if (weightKeys.length) {
    weightFiles.push({ file: `src/${rel}`, changes: weightKeys.map((k) => `${k} x${counts[k]}`).join(", ") });
  }
  if (!changed) continue;

  touched++;
  for (const [k, v] of Object.entries(counts)) totals[k] = (totals[k] ?? 0) + v;
  if (VERBOSE || DRY) {
    const summary = Object.entries(counts)
      .map(([k, v]) => `${k} x${v}`)
      .join("; ");
    console.log(`${WRITE ? "write" : "would"}  src/${rel}: ${summary}`);
  }
  if (WRITE) writeFileSync(file, out);
}

if (WRITE && preFlip) {
  writeFileSync(GLOBALS, globalsBefore.replace(PRE_FLIP, POST_FLIP));
}

// ── Report ────────────────────────────────────────────────────────

console.log("");
console.log(`mode: ${WRITE ? "write" : "dry-run"}   phase R (rename): ${rename ? "on (globals.css pre-flip)" : "off (globals.css already flipped)"}`);
console.log(`files scanned: ${scanned}   files ${WRITE ? "written" : "that would change"}: ${touched}`);
console.log("");
console.log("replacements by rule:");
for (const k of Object.keys(totals).sort()) console.log(`  ${k}: ${totals[k]}`);
console.log("");
console.log(`refused (left in place, ${refusedAll.length}):`);
for (const r of refusedAll) console.log(`  ${r.file}:${r.line}  ${r.token}`);
console.log("");
console.log(`weight changes (${weightFiles.length} files):`);
for (const w of weightFiles) console.log(`  ${w.file}: ${w.changes}`);
if (WRITE && preFlip) console.log("\nglobals.css: the five standard sizes are now bound to 12/13/14/16/22.");
if (WRITE && !preFlip) console.log("\nglobals.css: already flipped, left as is.");
