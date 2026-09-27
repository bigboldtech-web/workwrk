import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Decision 1 brings /dashboards back as a real page. Two things had to move
// with that page, and this guard fails the day either comes undone:
//
//   1. next.config.ts redirected /dashboards and /dashboards/:id to /home.
//      Config redirects run BEFORE filesystem routes, so a page under
//      src/app/(dashboard)/dashboards is unreachable while such a row exists,
//      while every other check (route-hub.test.ts included) stays green. The
//      rows left in the change that added the pages; one coming back would
//      hide the pages again.
//   2. "dashboards" must be in the proxy's APP_PREFIXES, or under the hard host
//      split the page is served the marketing site (check-app-prefixes.mjs
//      catches that too).
//
// The /dashboard (singular) redirect and its route handler stay forever. They
// pointed at /home while no dashboards page existed and point at /dashboards
// now; both halves are checked here, because the config row answers in
// production and the route handler answers under hot reload.

const ROOT = join(__dirname, "../../..");
const DASHBOARDS_DIR = join(ROOT, "src/app/(dashboard)/dashboards");

function routeFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...routeFilesUnder(p));
    else if (/^(page|route)\.(tsx?|jsx?)$/.test(d.name)) out.push(p);
  }
  return out;
}

/** The problems with the /dashboards route, from the three sources that decide it. */
export function dashboardsRouteProblems(i: { routeFiles: readonly string[]; nextConfig: string; proxy: string }): string[] {
  const problems: string[] = [];
  const config = i.nextConfig.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const redirects = /source:\s*["']\/dashboards(?:\/[^"']*)?["']/.test(config);
  if (i.routeFiles.length > 0 && redirects) problems.push("pages exist under /dashboards while next.config.ts still redirects /dashboards");
  const block = /const APP_PREFIXES = new Set\(\[([\s\S]*?)\]\)/.exec(i.proxy)?.[1] ?? "";
  const prefixes = new Set([...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  if (!prefixes.has("dashboards")) problems.push('"dashboards" is missing from APP_PREFIXES in src/proxy.ts');
  return problems;
}

/** Where the /dashboard (singular) row and its route handler send people. */
export function singularDashboardTargets(i: { nextConfig: string; routeHandler: string }): { config: string | null; handler: string | null } {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const row = /\{\s*source:\s*["']\/dashboard["'],\s*destination:\s*["']([^"']+)["'],\s*permanent:\s*true\s*\}/.exec(strip(i.nextConfig));
  const handler = /permanentRedirect\(\s*["']([^"']+)["']\s*\)/.exec(strip(i.routeHandler));
  return { config: row?.[1] ?? null, handler: handler?.[1] ?? null };
}

describe("the /dashboard (singular) redirect", () => {
  it("sends the old path to the dashboards list, permanently, in both places", () => {
    const targets = singularDashboardTargets({
      nextConfig: readFileSync(join(ROOT, "next.config.ts"), "utf8"),
      routeHandler: readFileSync(join(ROOT, "src/app/(dashboard)/dashboard/route.ts"), "utf8"),
    });
    expect(targets).toEqual({ config: "/dashboards", handler: "/dashboards" });
  });

  it("reads a row and a handler, and ignores ones only mentioned in comments", () => {
    expect(
      singularDashboardTargets({
        nextConfig: `// { source: "/dashboard", destination: "/home", permanent: true },\n{ source: "/dashboard", destination: "/dashboards", permanent: true },`,
        routeHandler: `// permanentRedirect("/home")\npermanentRedirect("/dashboards");`,
      }),
    ).toEqual({ config: "/dashboards", handler: "/dashboards" });
    expect(singularDashboardTargets({ nextConfig: `{ source: "/dashboard", destination: "/home", permanent: true }`, routeHandler: `permanentRedirect("/home")` })).toEqual({ config: "/home", handler: "/home" });
  });
});

describe("the /dashboards route guard", () => {
  it("holds for the repository as it is", () => {
    const problems = dashboardsRouteProblems({
      routeFiles: routeFilesUnder(DASHBOARDS_DIR),
      nextConfig: readFileSync(join(ROOT, "next.config.ts"), "utf8"),
      proxy: readFileSync(join(ROOT, "src/proxy.ts"), "utf8"),
    });
    expect(problems).toEqual([]);
  });

  const proxyWith = (list: string) => `const APP_PREFIXES = new Set([\n  ${list}\n]);`;
  const redirect = `{ source: "/dashboards", destination: "/home", permanent: false },\n{ source: "/dashboards/:id", destination: "/home", permanent: false },`;

  it("fails when a page arrives while the redirect is still there", () => {
    const problems = dashboardsRouteProblems({ routeFiles: ["x/page.tsx"], nextConfig: redirect, proxy: proxyWith('"dashboards"') });
    expect(problems).toHaveLength(1);
  });

  it("passes once the redirect leaves with the page, and before the page exists", () => {
    expect(dashboardsRouteProblems({ routeFiles: ["x/page.tsx"], nextConfig: "{ source: \"/dashboard\" }", proxy: proxyWith('"dashboards"') })).toEqual([]);
    expect(dashboardsRouteProblems({ routeFiles: [], nextConfig: redirect, proxy: proxyWith('"dashboards"') })).toEqual([]);
  });

  it("ignores a redirect that is only mentioned in a comment", () => {
    expect(dashboardsRouteProblems({ routeFiles: ["x/page.tsx"], nextConfig: `// { source: "/dashboards" }`, proxy: proxyWith('"dashboards"') })).toEqual([]);
  });

  it("fails when dashboards is missing from APP_PREFIXES", () => {
    expect(dashboardsRouteProblems({ routeFiles: [], nextConfig: "", proxy: proxyWith('"dashboard", "docs"') })).toHaveLength(1);
  });
});
