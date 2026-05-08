#!/usr/bin/env node
// Walk every locale file in messages/, add any keys present in
// en.json but missing in the target. The added value is the English
// string prefixed with the locale code in brackets so missing
// translations are visible in the UI ("[de] Save"). Real
// translations can be slotted in over time without losing context.
//
// Doesn't touch existing keys — translators' work is preserved.
//
// Usage: node scripts/sync-locales.mjs

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "messages");
const enPath = join(dir, "en.json");

const en = JSON.parse(readFileSync(enPath, "utf8"));

function fillMissing(target, source, prefix, locale) {
  let added = 0;
  for (const k of Object.keys(source)) {
    const sv = source[k];
    if (sv !== null && typeof sv === "object" && !Array.isArray(sv)) {
      if (target[k] == null || typeof target[k] !== "object") {
        target[k] = {};
      }
      added += fillMissing(target[k], sv, `${prefix}.${k}`, locale);
    } else if (target[k] == null) {
      target[k] = `[${locale}] ${sv}`;
      added += 1;
    }
  }
  return added;
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json");
const summary = [];
for (const f of files) {
  const path = join(dir, f);
  const locale = f.replace(/\.json$/, "");
  const data = JSON.parse(readFileSync(path, "utf8"));
  const added = fillMissing(data, en, "", locale);
  if (added > 0) {
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
    summary.push(`${locale}: +${added} keys`);
  } else {
    summary.push(`${locale}: up to date`);
  }
}

console.log(`Synced ${files.length} locales against en.json:`);
for (const line of summary) console.log(`  ${line}`);
