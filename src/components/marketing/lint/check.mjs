#!/usr/bin/env node
// The marketing copy checker.
//
//   node src/components/marketing/lint/check.mjs           report and exit 1 on an error
//   node src/components/marketing/lint/check.mjs --quiet    errors only
//
// It scans whole files rather than only string literals, so a rule catches
// a dash in a comment and in JSX text as well as in a quoted string. That is
// deliberate: the concept's copy rule is about the writing, and a comment is
// writing that the next person copies from.
//
// This exists as a script and not only as an ESLint rule because wiring a
// new plugin into eslint.config.mjs is a shared-file change that belongs to
// whoever owns that file. The plugin is written and exported beside these
// regexes; the wiring block is quoted in marketing-copy-rules.mjs.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, exemptFor, gateMarkerFlag, isCommentaryOrGate, isLegacy } from "./marketing-copy-rules.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(here, "..", "..", "..", "..");

// src/components/landing WAS where the live home page rendered from, which
// is why it was scanned. It is not any more: src/app/(marketing)/page.tsx
// renders from src/components/marketing, and a repo-wide grep for
// "components/landing" outside that directory returns no importers. It is
// dead code now, not marketing copy, so scanning it only inflated the
// legacy count and made this report harder to read. Deleting the directory
// is not this unit's call, so it is simply no longer scanned.
const ROOTS = [
  join(ROOT, "src", "app", "(marketing)"),
  join(ROOT, "src", "components", "marketing"),
];

/**
 * Files outside those two trees that nonetheless put words on a marketing
 * page, scanned one by one.
 *
 * The consent banner is the case that earned this list: the marketing
 * layout mounts it on every page of the site, it renders "We use cookies,
 * your choice" with an em dash in place of that comma, and it was the one
 * em dash actually on screen that this checker could not see. It is a
 * shared component owned outside this phase, so it is reported as legacy
 * debt rather than gated: see LEGACY_PREFIXES.
 */
/*
 * src/data/blog-posts.ts is the LARGEST such case by volume and it was not
 * on this list, which is how 42 em dashes shipped as visible marketing copy
 * on six sitemap listed routes while this checker reported a clean gate. It
 * supplies every word of eight blog posts and it is imported by nothing but
 * the blog index, the blog article route and the sitemap: a marketing
 * content file that happens to live under src/data.
 */
const EXTRA_FILES = [
  join(ROOT, "src", "components", "layout", "consent-banner.tsx"),
  join(ROOT, "src", "data", "blog-posts.ts"),
];
const SKIP_DIRS = new Set(["node_modules", ".next", "lint"]);
const EXTENSIONS = [".ts", ".tsx", ".css", ".json", ".md"];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const quiet = process.argv.includes("--quiet");
const showLegacy = process.argv.includes("--legacy");
const files = [...ROOTS.flatMap((r) => walk(r)), ...EXTRA_FILES.filter((f) => existsSync(f))];
const findings = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  // A test has to be able to quote the thing it forbids, so a test file is
  // code under test, not copy.
  if (/\.test\.tsx?$/.test(rel)) continue;
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (const rule of RULES) {
    if (rule.exempt && exemptFor(rule.exempt, file)) continue;
    lines.forEach((line, i) => {
      if (rule.copyOnly && isCommentaryOrGate(line)) return;
      if (rule.copyOnly && rule.flags) {
        const marker = gateMarkerFlag(line);
        if (marker && rule.flags.includes(marker)) return;
      }
      if (rule.test(line)) {
        findings.push({
          file: rel,
          line: i + 1,
          rule: rule.id,
          kind: isLegacy(rel) ? "legacy" : rule.kind,
          message: rule.message,
          text: line.trim().slice(0, 120),
        });
      }
    });
  }
}

const errors = findings.filter((f) => f.kind === "error");
const warns = findings.filter((f) => f.kind === "warn");
const legacy = findings.filter((f) => f.kind === "legacy");

const shown = quiet ? errors : showLegacy ? findings : [...errors, ...warns];
for (const f of shown) {
  const tag = f.kind === "error" ? "error" : f.kind === "warn" ? " warn" : "legcy";
  process.stdout.write(`${tag}  ${f.file}:${f.line}  ${f.rule}\n        ${f.text}\n`);
}

const legacyFiles = new Set(legacy.map((f) => f.file)).size;
// The headline number is the one that is still wrong. Printing "0 errors"
// first, on a site carrying hundreds of findings, is how a gate reports
// green while it is failing: the debt has to be the loud number, and the
// pass or fail has to be the quiet one.
process.stdout.write(
  `\nmarketing copy: ${files.length} files scanned\n` +
    `  ${legacy.length} finding(s) in ${legacyFiles} file(s) still on the old site:\n` +
    `    known debt, listed so it cannot be forgotten, and NOT gated by this run.\n` +
    `    Every marketing file that was on this list has been rewritten and is now\n` +
    `    held to every rule. What is left is owned OUTSIDE this phase and is not\n` +
    `    waiting on a later stage of it: see LEGACY_PREFIXES for who and what.\n` +
    (showLegacy ? "" : "    run with --legacy to list them\n") +
    `  ${warns.length} warning(s)\n` +
    `  ${errors.length} error(s) in rebuilt files  ${errors.length > 0 ? "FAIL" : "(gate passes)"}\n`,
);
process.exit(errors.length > 0 ? 1 : 0);
