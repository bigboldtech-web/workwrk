#!/usr/bin/env node
// The CI budget gate on the home route (marketing-concept.md 6.3).
//
//   "JS budget: under 200 KB gz first load before the GSAP island; GSAP
//    island at most 40 KB gz; fixture at most 40 KB. CI bundle-analyzer
//    gate on the budget."
//
// This script is the gate. It runs AFTER `next build` in CI, reads the
// build manifests Next writes, gzips each chunk the marketing home route
// loads, and fails when the total crosses the budget. It never runs a build
// itself, so it is safe to run on a machine with a dev server up.
//
//   node src/components/marketing/lint/budget-gate.mjs
//   BUDGET_KB=200 node src/components/marketing/lint/budget-gate.mjs
//
// THE DOCUMENT IS HALF THE WEIGHT, so it is measured too. The JS budget on
// its own has a blind spot exactly where this page is heavy: the surfaces
// and CTAs handed to the client islands as already rendered children stay
// out of the JS bundle, which is what the page is designed for, and come
// back serialized in the RSC flight payload inside the HTML, so the same
// tree ships twice in the document. A 200 KB JS budget passing while the
// document alone is 198 KB gz is a gate reporting on the smaller half.
//
// Point it at a running server, or at a built server, with DOC_URL:
//
//   DOC_URL=http://localhost:3007/ node .../budget-gate.mjs
//   DOC_BUDGET_KB=150 DOC_URL=... node .../budget-gate.mjs
//
// Without DOC_URL the document check is skipped and says so; it never
// invents a number, and it never fails a run it could not measure.
//
// Point it at a BUILT server, not at `next dev`. The dev server's flight
// encoding is far larger than a build's, so a dev reading is an upper bound
// and not the number the budget is about.
//
// The CI step, for whoever owns the workflow file:
//
//   - run: npm run build
//   - run: node src/components/marketing/lint/budget-gate.mjs
//
// Exit codes: 0 within budget, 1 over budget, 2 no build to measure (which
// CI should treat as a failure, because a gate that silently passes when it
// cannot measure is not a gate).

import { existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(here, "..", "..", "..", "..");
const NEXT = join(ROOT, ".next");

const BUDGET_KB = Number(process.env.BUDGET_KB ?? 200);
/** The home DOCUMENT's own gzipped budget, markup plus flight payload. */
const DOC_BUDGET_KB = Number(process.env.DOC_BUDGET_KB ?? 150);
const DOC_URL = process.env.DOC_URL ?? "";
/** The route key Next uses for the marketing group's home page. */
const ROUTE_KEYS = ["/(marketing)/page", "/page"];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The served home document, gzipped, split into markup and RSC flight.
 *
 * The flight payload is every `self.__next_f.push()` call in the HTML: it
 * is the server rendered tree handed back to React, and on this page it is
 * the larger half. Splitting the two is what makes the number actionable,
 * because they are reduced by different moves.
 */
async function measureDocument(url) {
  const response = await fetch(url, { headers: { "accept-encoding": "identity" } });
  const html = await response.text();
  const bytes = Buffer.from(html, "utf8");
  const flightChunks = html.match(/self\.__next_f\.push\([\s\S]*?\)<\/script>/g) ?? [];
  const flightBytes = flightChunks.reduce((n, c) => n + Buffer.byteLength(c, "utf8"), 0);
  return {
    status: response.status,
    raw: bytes.length,
    gz: gzipSync(bytes).length,
    flightRaw: flightBytes,
    flightShare: bytes.length > 0 ? flightBytes / bytes.length : 0,
  };
}

let docOver = false;
if (DOC_URL) {
  try {
    const doc = await measureDocument(DOC_URL);
    const docKb = doc.gz / 1024;
    docOver = docKb > DOC_BUDGET_KB;
    process.stdout.write(
      `\nHome document (${DOC_URL}), HTTP ${doc.status}\n` +
        `  ${(doc.raw / 1024).toFixed(1)} KB raw, ${docKb.toFixed(1)} KB gz\n` +
        `  of which ${(doc.flightRaw / 1024).toFixed(1)} KB raw is the RSC flight payload ` +
        `(${Math.round(doc.flightShare * 100)} percent of the document)\n` +
        `  budget ${DOC_BUDGET_KB} KB gz: ${docOver ? "OVER" : "within"}\n`,
    );
  } catch (error) {
    process.stderr.write(`budget gate: could not fetch ${DOC_URL} (${String(error)}). Document not measured.\n`);
    process.exit(2);
  }
} else {
  process.stdout.write(
    "\nHome document: not measured. Set DOC_URL to a running server to include it; the JS number below is only half the weight.\n",
  );
}

const appManifest = readJson(join(NEXT, "app-build-manifest.json"));
if (!appManifest || !appManifest.pages) {
  process.stderr.write(
    "budget gate: no .next/app-build-manifest.json. Run `next build` first; this script never builds.\n",
  );
  process.exit(2);
}

const routeKey = ROUTE_KEYS.find((k) => appManifest.pages[k]);
if (!routeKey) {
  process.stderr.write(
    `budget gate: none of ${ROUTE_KEYS.join(", ")} is in the manifest. Routes present: ${Object.keys(appManifest.pages).slice(0, 8).join(", ")}\n`,
  );
  process.exit(2);
}

const files = [...new Set(appManifest.pages[routeKey])].filter((f) => f.endsWith(".js"));

let total = 0;
const rows = [];
for (const f of files) {
  const full = join(NEXT, f);
  if (!existsSync(full)) continue;
  const raw = readFileSync(full);
  const gz = gzipSync(raw).length;
  total += gz;
  rows.push({ file: f, raw: statSync(full).size, gz });
}

rows.sort((a, b) => b.gz - a.gz);
const kb = (n) => (n / 1024).toFixed(1);

process.stdout.write(`\nHome route first load (${routeKey}), ${rows.length} chunks\n`);
for (const r of rows.slice(0, 12)) {
  process.stdout.write(`  ${kb(r.gz).padStart(7)} KB gz  ${r.file}\n`);
}
if (rows.length > 12) process.stdout.write(`  ...and ${rows.length - 12} more\n`);

const over = total / 1024 > BUDGET_KB;
process.stdout.write(`\ntotal ${kb(total)} KB gz, budget ${BUDGET_KB} KB gz: ${over ? "OVER" : "within"}\n`);

if (docOver) {
  process.stderr.write(
    "budget gate: the home DOCUMENT is over budget. The usual cause is more of the fixture rendering into the tree, which ships twice: once as markup and once as the flight payload.\n",
  );
  process.exit(1);
}
if (over) {
  process.stderr.write(
    "budget gate: the home route is over budget. The fixture, the scene island and any new dependency are the usual causes.\n",
  );
  process.exit(1);
}
process.exit(0);
