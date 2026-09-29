// A contract over the SOURCE of the list readers that moved onto the one
// node-access resolver (src/lib/access/node-access.ts), because the routes
// need a database, a session and next-auth, none of which the unit suite
// carries. It pins three promises a later edit could silently undo:
//
//   1. ONE WORLD PER REQUEST. A list reader asks the resolver once, for every
//      row it holds (nodeRoles, nodeRoleMap, idsWithRole), and never once per
//      row. A resolver call inside a .map( or a Promise.all( is one database
//      round trip per row: /docs with a thousand pages was a thousand chain
//      loads before this release (problems 19 to 21).
//   2. ACCESS ROWS STAY IN THE AUDIT SURFACES. Who was given access to what
//      is recorded as activity (grants.ts), and the home feed, the AI context
//      and a teammate's work feed never show it (problems 4 and 44).
//   3. THE GRANT ROUTES READ THE SESSION ONE WAY. Every route under
//      src/app/api/access builds its context with nodeCtxFromSession (which
//      also refuses a deleted or deactivated account) and never reads a
//      legacy accessLevel of its own.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Blank out comments (keeping line numbers) so prose that names a helper never trips a rule. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

/** The balanced (...) that opens at `open`. */
function argsFrom(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")" && (depth -= 1) === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

const PER_ROW_CALLS = ["nodeRole", "docAccessible", "getBoardForReader", "readableTable", "folderReadable"];

/** Every resolver call that sits inside a .map( or a Promise.all( argument, as "helper( at line n". */
function perRowResolverCalls(raw: string): string[] {
  const src = stripComments(raw);
  const found = new Set<string>();
  const wrapper = /\.map\(|Promise\.all\(/g;
  for (let m = wrapper.exec(src); m; m = wrapper.exec(src)) {
    const inside = argsFrom(src, m.index + m[0].length - 1);
    for (const name of PER_ROW_CALLS) {
      if (new RegExp(`\\b${name}\\(`).test(inside)) {
        found.add(`${name}( at line ${src.slice(0, m.index).split("\n").length}`);
      }
    }
  }
  return [...found];
}

const LIST_READERS = [
  "src/app/api/docs/route.ts",
  "src/app/api/search/route.ts",
  "src/lib/notification-readability.ts",
  "src/app/api/me/favorites/route.ts",
  "src/app/api/me/favorites/boards/route.ts",
  "src/app/api/me/favorites/docs/route.ts",
  "src/app/api/me/favorites/files/route.ts",
  "src/app/api/me/favorites/folders/route.ts",
  "src/app/api/me/favorites/spaces/route.ts",
  "src/app/api/me/favorites/tables/route.ts",
  "src/app/api/me/favorites/whiteboards/route.ts",
  "src/app/api/me/pins/route.ts",
  "src/app/api/backlinks/route.ts",
  "src/app/api/me/mentions/route.ts",
  "src/app/api/me/home/route.ts",
  "src/app/api/tables/route.ts",
  "src/app/api/whiteboards/route.ts",
  "src/app/api/boards/route.ts",
  "src/app/api/folders/route.ts",
  "src/app/(dashboard)/team/workload/page.tsx",
  "src/app/api/lists/pick/route.ts",
];

describe("list readers ask the resolver once per request", () => {
  it("the detector sees a per-row call, and not one named only in a comment", () => {
    expect(perRowResolverCalls("const ok = await Promise.all(rows.map((r) => docAccessible(r, u, l)));")).toEqual([
      "docAccessible( at line 1",
    ]);
    expect(perRowResolverCalls("rows.map((b) => getBoardForReader(b.id, o, u, l))")).toEqual(["getBoardForReader( at line 1"]);
    expect(perRowResolverCalls("// rows.map((r) => nodeRole(ctx, r))\nconst m = await nodeRoleMap(ctx, 'doc', ids);")).toEqual([]);
    expect(perRowResolverCalls("const d = await nodeRole(ctx, ref);\nconst names = rows.map((r) => r.name);")).toEqual([]);
  });

  for (const file of LIST_READERS) {
    it(`${file} never calls a single-node gate per row`, () => {
      expect(perRowResolverCalls(read(file)), file).toEqual([]);
    });
  }
});

describe("access activity stays out of the feeds", () => {
  const FEEDS = ["src/app/api/dashboard/route.ts", "src/app/api/ai/route.ts", "src/app/api/team/members-work/route.ts"];

  for (const file of FEEDS) {
    it(`${file} excludes ACCESS_ACTIVITY_TYPES from every activity read`, () => {
      const src = stripComments(read(file));
      expect(src).toMatch(/import\s*\{[^}]*\bACCESS_ACTIVITY_TYPES\b[^}]*\}\s*from\s*"@\/lib\/access\/access-activity"/);
      // findMany and groupBy both read rows (My team's "Last active" is a
      // groupBy), so both must leave the access records out.
      const reads = [...src.matchAll(/activityLog\.(?:findMany|groupBy)\(/g)];
      expect(reads.length, `${file} reads no activity`).toBeGreaterThan(0);
      for (const r of reads) {
        const call = argsFrom(src, (r.index ?? 0) + r[0].length - 1);
        expect(call).toMatch(/type:\s*\{\s*notIn:\s*\[\s*\.\.\.ACCESS_ACTIVITY_TYPES\s*\]\s*\}/);
      }
    });
  }

  it("the home feed and the AI context keep only rows whose node the viewer can open", () => {
    for (const file of ["src/app/api/dashboard/route.ts", "src/app/api/ai/route.ts"]) {
      expect(stripComments(read(file)), file).toMatch(/activityTargetsReadable\(/);
    }
  });
});

describe("the grant routes", () => {
  function routeFiles(dir: string): string[] {
    const out: string[] = [];
    if (!existsSync(path.join(ROOT, dir))) return out;
    for (const name of readdirSync(path.join(ROOT, dir))) {
      const rel = path.join(dir, name);
      if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...routeFiles(rel));
      else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
    }
    return out;
  }
  const files = routeFiles("src/app/api/access");

  it("exist: the panel read and the grant writes", () => {
    expect(files.map((f) => f.split(path.sep).join("/")).sort()).toEqual([
      "src/app/api/access/[kind]/[id]/grants/route.ts",
      "src/app/api/access/[kind]/[id]/route.ts",
    ]);
  });

  for (const file of files) {
    it(`${file} builds its context with nodeCtxFromSession and reads no accessLevel`, () => {
      const src = stripComments(read(file));
      expect(src).toMatch(/import\s*\{[^}]*\bnodeCtxFromSession\b[^}]*\}\s*from\s*"@\/lib\/access\/node-access"/);
      expect(src).toMatch(/await nodeCtxFromSession\(\)/);
      expect(src).not.toMatch(/accessLevel/);
      expect(src).not.toMatch(/getServerSession\(/);
    });
  }
});
