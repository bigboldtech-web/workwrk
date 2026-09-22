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
// Run: node scripts/check-app-prefixes.mjs   (exit 1 on drift)

import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const PROXY = "src/proxy.ts";
// Each list in the proxy, and the route groups it is responsible for. The
// marketing half was added after /product, /tuesday, /how-it-connects, /roadmap
// and /snap were found answering the marketing 404 in production: the same bug
// as /home, in the other list, and this script only knew about one of them.
const LISTS = [
  { name: "APP_PREFIXES", groups: ["src/app/(dashboard)", "src/app/(auth)"], wrong: "served the MARKETING site on the app host" },
  { name: "MARKETING_PREFIXES", groups: ["src/app/(marketing)"], wrong: "answered the MARKETING 404 instead of rendering" },
];

const src = readFileSync(PROXY, "utf8");

let failed = false;
for (const list of LISTS) {
  const block = new RegExp(`const ${list.name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(src);
  if (!block) {
    console.error(`check-app-prefixes: could not find ${list.name} in ${PROXY}`);
    process.exit(1);
  }
  const allow = new Set([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const missing = [];
  for (const group of list.groups) {
    if (!existsSync(group)) continue;
    for (const name of readdirSync(group, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      // Route groups "(x)", parallel slots "@x", private folders "_x" and
      // dynamic segments "[x]" are never a literal first path segment.
      if (/^[([@_]/.test(name.name)) continue;
      const dir = join(group, name.name);
      const routable =
        existsSync(join(dir, "page.tsx")) ||
        existsSync(join(dir, "page.ts")) ||
        existsSync(join(dir, "route.ts")) ||
        existsSync(join(dir, "route.tsx"));
      if (routable && !allow.has(name.name)) missing.push(`${name.name}  (${dir})`);
    }
  }
  if (missing.length > 0) {
    failed = true;
    console.error(`check-app-prefixes: these segments are NOT in ${list.name}.`);
    console.error(`Under the hard host split each one ${list.wrong}:\n`);
    for (const m of missing) console.error(`  ${m}`);
    console.error("");
  } else {
    console.log(`check-app-prefixes: ${list.name} ok (${allow.size} entries)`);
  }
}
if (failed) {
  console.error(`Add the missing segments to the named list in ${PROXY}.`);
  process.exit(1);
}
