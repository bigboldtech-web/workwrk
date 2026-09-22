#!/usr/bin/env node
// Does every marketing route survive the host split?
//
//   node src/components/marketing/lint/routes-reachable.mjs
//
// THE DEFECT THIS EXISTS TO CATCH, which shipped and which nothing caught.
//
// In production HARD_HOST_SPLIT is true and the marketing group answers on
// the bare host. src/proxy.ts decides what that host will serve BEFORE
// routing:
//
//     if (onMarketing && !isMarketingPath(path)) rewrite to /404
//
// and `isMarketingPath` is `MARKETING_PREFIXES.has(firstSeg(path))`, a
// hardcoded Set. So a route directory under src/app/(marketing) whose first
// segment is not in that Set answers with the marketing 404 on workwrk.com,
// however correct the page file is.
//
// This phase added /tuesday, /snap, /how-it-connects, /roadmap and eight
// /product/[module] pages. None of those five segments is in the Set, so
// twelve new routes, the nav's "How it connects" and "Tuesday" rows, the
// footer's Roadmap and eight module rows, the "Share this Tuesday" link, the
// 404 page's own recovery link, the changelog's roadmap link and eleven
// sitemap URLs all pointed at the marketing 404 in production.
//
// It went unnoticed because LOCALLY there is no host split: every one of
// them answers 200 on the dev server, so curl, the screenshot harness and a
// browser walk all agree the pages work. Only the production host disagrees,
// and by then it is live.
//
// The mirror-image check for the APP side already exists as
// scripts/check-app-prefixes.mjs and runs in CI. This is the missing half.
//
// It READS src/proxy.ts and never writes it: the proxy belongs to the auth
// and shell unit. When this fails, the fix is one line there, and the report
// prints exactly which segments to add.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(here, "..", "..", "..", "..");
const PROXY = join(ROOT, "src", "proxy.ts");
const MARKETING_DIR = join(ROOT, "src", "app", "(marketing)");

/** Pull a `const NAME = new Set([...])` literal out of the proxy source. */
function readPrefixSet(source, name) {
  const start = source.indexOf(`const ${name} = new Set([`);
  if (start === -1) return null;
  const open = source.indexOf("[", start);
  const close = source.indexOf("]);", open);
  if (close === -1) return null;
  const body = source.slice(open, close);
  return new Set([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/**
 * The first url segment of every route under the marketing group.
 *
 * Route GROUPS, the parenthesised directories, contribute no segment, and a
 * directory with neither a page nor a route handler under it is not a route.
 */
function marketingSegments() {
  const out = new Set();
  for (const entry of readdirSync(MARKETING_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("(") || entry.name.startsWith("_") || entry.name.startsWith("@")) continue;
    // A dynamic segment is not a literal first segment and cannot be listed.
    if (entry.name.startsWith("[")) continue;
    // /dev is EXCLUDED on purpose, and it is the one exclusion.
    //
    // src/app/(marketing)/dev/foundations is an internal token gallery and
    // its page calls notFound() when NODE_ENV is production, so it is
    // already 404 on the public host by its own hand. Being absent from
    // MARKETING_PREFIXES is a second lock on the same door rather than a
    // defect, and listing it would ask somebody to publish it.
    if (entry.name === "dev") continue;
    // A route HANDLER is a route too. /snap is route.ts and nothing else:
    // it is the 301 to /tuesday that decision 14 names, and it needs the
    // prefix exactly as a page does or the redirect never runs.
    if (!hasRoute(join(MARKETING_DIR, entry.name))) continue;
    out.add(entry.name);
  }
  return out;
}

function hasRoute(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && /^(page|route)\.(tsx|ts|jsx|js|mdx)$/.test(entry.name)) return true;
    if (entry.isDirectory() && hasRoute(join(dir, entry.name))) return true;
  }
  return false;
}

/**
 * The app-host paths the marketing site sends people to.
 *
 * Same class of failure, other direction: a relative href the marketing host
 * does not recognise as an app path is never forwarded to the app host, so
 * it lands on the marketing 404. spec-account-auth section 0 predicts it in
 * those words for "Start free", and every primary CTA on this site points at
 * /signup.
 */
const APP_DESTINATIONS = ["signup", "join", "login"];

const proxy = readFileSync(PROXY, "utf8");
const marketingPrefixes = readPrefixSet(proxy, "MARKETING_PREFIXES");
const appPrefixes = readPrefixSet(proxy, "APP_PREFIXES");

if (!marketingPrefixes || !appPrefixes) {
  process.stdout.write(
    "routes reachable: could not read MARKETING_PREFIXES / APP_PREFIXES out of src/proxy.ts.\n" +
      "  The sets moved or changed shape. Fix this script rather than deleting it.\n",
  );
  process.exit(2);
}

const segments = [...marketingSegments()].sort();
const missingMarketing = segments.filter((s) => !marketingPrefixes.has(s));
const missingApp = APP_DESTINATIONS.filter((s) => !appPrefixes.has(s));

for (const s of missingMarketing) {
  process.stdout.write(
    `error  src/app/(marketing)/${s}  not in MARKETING_PREFIXES\n` +
      `        answers with the marketing 404 on the production host\n`,
  );
}
for (const s of missingApp) {
  process.stdout.write(
    `error  /${s}  not in APP_PREFIXES\n` +
      `        a relative link to it on the marketing host is never sent to the app host\n`,
  );
}

const total = missingMarketing.length + missingApp.length;
process.stdout.write(
  `\nroutes reachable under HARD_HOST_SPLIT: ${segments.length} marketing segment(s) checked\n` +
    `  ${total} unreachable  ${total > 0 ? "FAIL" : "(gate passes)"}\n`,
);
if (total > 0) {
  process.stdout.write(
    "\n  The fix is in src/proxy.ts, which belongs to the auth and shell unit:\n" +
      (missingMarketing.length > 0
        ? `    MARKETING_PREFIXES: add ${missingMarketing.map((s) => `"${s}"`).join(", ")}\n`
        : "") +
      (missingApp.length > 0 ? `    APP_PREFIXES: add ${missingApp.map((s) => `"${s}"`).join(", ")}\n` : ""),
  );
}
process.exit(total > 0 ? 1 : 0);
