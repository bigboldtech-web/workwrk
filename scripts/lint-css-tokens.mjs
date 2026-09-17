#!/usr/bin/env node
// Stylesheet half of the design-system lint (design-system.md 8.4 rule 4).
//
// stylelint is not a dependency of this repo, and adding one to package.json
// without touching the lockfile would break `npm ci`; this dependency-free
// script enforces the same two rules over every stylesheet under src:
//
//   4a  `var(--os-dot-`  may appear only in src/components/brand/*.css
//       -> error (zero hits today; stays an error)
//   4b  raw hex `#rgb / #rrggbb / #rrggbbaa` may appear only in the token
//       file (src/app/(dashboard)/tokens.css), os.css (until the sweep)
//       and src/components/brand/*.css
//       -> warning until the Phase 5 colour sweep; pass --strict to make it
//          an error (that is the flag CI flips at step 5)
//
// Usage: node scripts/lint-css-tokens.mjs [--strict]
// Exit code 1 on any error (or on any warning with --strict).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const strict = process.argv.includes("--strict");

const HEX_ALLOWED = new Set(["src/app/(dashboard)/tokens.css", "src/app/(dashboard)/os.css"]);
const DOT_ALLOWED_DIR = "src/components/brand/";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".css")) out.push(full);
  }
  return out;
}

function stripComments(css) {
  // Keep line count stable so reported line numbers stay right.
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const DOT_RE = /var\(\s*--os-dot-/g;

let errors = 0;
let warnings = 0;
const report = (level, file, line, msg) => {
  if (level === "error") errors++;
  else warnings++;
  console.log(`${file}:${line}: ${level}: ${msg}`);
};

for (const abs of walk(SRC)) {
  const rel = relative(ROOT, abs).split(sep).join("/");
  const inBrand = rel.startsWith(DOT_ALLOWED_DIR);
  const lines = stripComments(readFileSync(abs, "utf8")).split("\n");
  lines.forEach((text, i) => {
    if (!inBrand && DOT_RE.test(text)) {
      report("error", rel, i + 1, "var(--os-dot-*) outside src/components/brand: the brand dots are quarantined (design-system 1.6).");
    }
    DOT_RE.lastIndex = 0;
    if (!inBrand && !HEX_ALLOWED.has(rel)) {
      const hits = text.match(HEX_RE);
      if (hits) {
        report(
          strict ? "error" : "warning",
          rel,
          i + 1,
          `raw hex ${hits.join(", ")}: colour reaches stylesheets only through --os-* tokens (design-system 8.4; error after the Phase 5 sweep).`,
        );
      }
    }
  });
}

console.log(`\ncss-tokens: ${errors} error(s), ${warnings} warning(s)${strict ? " (strict)" : ""}`);
process.exit(errors > 0 ? 1 : 0);
