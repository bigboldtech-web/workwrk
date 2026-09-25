// Fail the build when a route segment exists on disk but not in the proxy's
// APP_PREFIXES allowlist.
//
// WHY THIS EXISTS. Under HARD_HOST_SPLIT the proxy decides "app route or
// marketing route?" from a hand-written list of first path segments. A segment
// missing from that list is NOT a 404: on the app host it is taken for a
// marketing route and answered with the marketing site. There is no error, no
// log line, and it looks fine locally, because the split is only on in
// production.
//
// Phase 2 shipped /home and /my-work as the product's landing pages and pointed
// /today, /dashboard, /tasks and /tasks/personal-list at them with permanent
// redirects. The list was not updated. So in production the landing page of the
// product served the marketing page, and every old bookmark redirected into it.
// It was found by warming routes locally and noticing /my-work behaving oddly,
// which is luck, not a process. This script is the process.
//
// A SEGMENT IS ROUTABLE WHEN IT OR ANY DESCENDANT HOLDS A PAGE OR A ROUTE.
// The first version looked for page.tsx or route.ts in the segment's own
// directory only, so a segment whose pages are all nested (/work, whose only
// pages are /work/docs/[id] and its four siblings; /item and /folders, whose
// pages sit under [id]) could be missing from the list and pass. The rule now
// walks the whole subtree, for both lists. A segment that is routable on disk
// and deliberately NOT served by that list's host goes in the list's EXEMPT
// set below, with the reason, so the exception is written down instead of
// being a hole in the check.
//
// Run: node scripts/check-app-prefixes.mjs   (exit 1 on drift)
// The pure half (findMissing) is imported by scripts/check-app-prefixes.test.ts.

import { readdirSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

const PROXY = "src/proxy.ts";

// Each list in the proxy, and the route groups it is responsible for. The
// marketing half was added after /product, /tuesday, /how-it-connects, /roadmap
// and /snap were found answering the marketing 404 in production: the same bug
// as /home, in the other list, and this script only knew about one of them.
export const LISTS = [
  {
    name: "APP_PREFIXES",
    groups: ["src/app/(dashboard)", "src/app/(auth)"],
    wrong: "served the MARKETING site on the app host",
    exempt: new Map(),
  },
  {
    name: "MARKETING_PREFIXES",
    groups: ["src/app/(marketing)"],
    wrong: "answered the MARKETING 404 instead of rendering",
    exempt: new Map([
      // The design-system foundations preview. Its page calls notFound() in
      // production, so the marketing host must never be told it serves it.
      ["dev", "the foundations preview; it 404s in production and must never be served by the marketing host"],
    ]),
  },
];

const PAGE_FILES = new Set(["page.tsx", "page.ts", "route.ts", "route.tsx"]);

/** True when this directory, or any directory below it, holds a page or a route. */
export function isRoutable(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((e) => e.isFile() && PAGE_FILES.has(e.name))) return true;
  return entries.some((e) => e.isDirectory() && isRoutable(join(dir, e.name)));
}

/**
 * The routable first-level segments of `groups` that `allow` does not list
 * and `exempt` does not excuse, as "name  (dir)" lines.
 */
export function findMissing(groups, allow, exempt = new Map()) {
  const missing = [];
  for (const group of groups) {
    if (!existsSync(group)) continue;
    for (const entry of readdirSync(group, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Route groups "(x)", parallel slots "@x", private folders "_x" and
      // dynamic segments "[x]" are never a literal first path segment.
      if (/^[([@_]/.test(entry.name)) continue;
      const dir = join(group, entry.name);
      if (!isRoutable(dir)) continue;
      if (allow.has(entry.name) || exempt.has(entry.name)) continue;
      missing.push(`${entry.name}  (${dir})`);
    }
  }
  return missing;
}

/** The quoted names of one `const NAME = new Set([...])` in the proxy source. */
export function readList(src, name) {
  const block = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(src);
  if (!block) return null;
  return new Set([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

function main() {
  const src = readFileSync(PROXY, "utf8");
  let failed = false;
  for (const list of LISTS) {
    const allow = readList(src, list.name);
    if (!allow) {
      console.error(`check-app-prefixes: could not find ${list.name} in ${PROXY}`);
      process.exit(1);
    }
    const missing = findMissing(list.groups, allow, list.exempt);
    if (missing.length > 0) {
      failed = true;
      console.error(`check-app-prefixes: these segments are NOT in ${list.name}.`);
      console.error(`Under the hard host split each one ${list.wrong}:\n`);
      for (const m of missing) console.error(`  ${m}`);
      console.error("");
    } else {
      const exempted = list.exempt.size > 0 ? `, ${list.exempt.size} exempt: ${[...list.exempt.keys()].join(", ")}` : "";
      console.log(`check-app-prefixes: ${list.name} ok (${allow.size} entries${exempted})`);
    }
  }
  if (failed) {
    console.error(`Add the missing segments to the named list in ${PROXY}.`);
    process.exit(1);
  }
}

// The CLI runs only when this file is executed, never when a test imports it.
const invokedAs = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedAs === fileURLToPath(import.meta.url)) main();
