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
const GROUPS = ["src/app/(dashboard)", "src/app/(auth)"];

const src = readFileSync(PROXY, "utf8");
const block = /const APP_PREFIXES = new Set\(\[([\s\S]*?)\]\)/.exec(src);
if (!block) {
  console.error(`check-app-prefixes: could not find APP_PREFIXES in ${PROXY}`);
  process.exit(1);
}
const allow = new Set([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));

const missing = [];
for (const group of GROUPS) {
  if (!existsSync(group)) continue;
  for (const name of readdirSync(group, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    // Route groups "(x)", parallel slots "@x", private folders "_x" and dynamic
    // segments "[x]" are never a literal first path segment.
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
  console.error("check-app-prefixes: these route segments are NOT in APP_PREFIXES.");
  console.error("Under the hard host split each one is served the MARKETING site on the app host:\n");
  for (const m of missing) console.error(`  ${m}`);
  console.error(`\nAdd them to APP_PREFIXES in ${PROXY}.`);
  process.exit(1);
}

console.log(`check-app-prefixes: ok, every routable segment is allowlisted (${allow.size} entries)`);
