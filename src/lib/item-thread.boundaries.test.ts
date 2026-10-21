// item-thread.ts is the one writer of ItemActivity (docs/plans/mcp-server.md
// section 7, step 3 test "the boundaries check"): every task activity row
// goes through writeItemActivity, which marks a row written through a
// connected AI app "via <app> (MCP)". A row made anywhere else would carry
// no "via", so this reads every module under src and holds that no other
// one creates a row. Fails on the code before step 3: the public link
// (task-public-link.ts) and the meeting and purchase order log
// (activity/log.ts) wrote their own.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const WRITER = "src/lib/item-thread.ts";

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "generated" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** The code of a module, its comments taken out (a comment that names the writer writes nothing). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every place a module creates an ItemActivity row: a client's create,
 * createMany or upsert, by a dot or by brackets (db.itemActivity.create,
 * db["itemActivity"]["create"], tx.itemActivity["upsert"]), or raw SQL that
 * inserts, copies or merges into the table, with or without quotes or a
 * schema (INSERT INTO "ItemActivity", insert into public.itemactivity).
 */
function creates(source: string): number {
  const text = code(source);
  const client = text.match(/\bitemActivity\b["'`]?\s*\]?\s*(?:\.|\[\s*["'`])\s*(create|createMany|createManyAndReturn|upsert)\b/g) ?? [];
  const raw = text.match(/\b(?:INSERT\s+INTO|COPY|MERGE\s+INTO)\s+(?:["`]?\w+["`]?\s*\.\s*)?["`]?ItemActivity\b/gi) ?? [];
  return client.length + raw.length;
}

describe("the ItemActivity writer", () => {
  it("sees a create, a createMany split across lines, an upsert and a raw insert, and not a read", () => {
    expect(creates("await prisma.itemActivity.create({ data })")).toBe(1);
    expect(creates("tx.itemActivity\n    .createMany({ data })")).toBe(1);
    expect(creates("db.itemActivity.upsert({})")).toBe(1);
    expect(creates('await tx.$executeRaw`INSERT INTO "ItemActivity" ("id") VALUES (1)`')).toBe(1);
    expect(creates("prisma.itemActivity.findMany({ where })")).toBe(0);
    expect(creates('prisma["itemActivity"].create({ data })')).toBe(1);
    expect(creates("db['itemActivity']['createMany']({ data })")).toBe(1);
    expect(creates('tx.itemActivity["upsert"]({})')).toBe(1);
    expect(creates("await prisma.$executeRawUnsafe('insert into public.\"ItemActivity\" (id) values ($1)', id)")).toBe(1);
    expect(creates("await tx.$executeRaw`insert into itemactivity (id) values (1)`")).toBe(1);
    expect(creates('await db.$executeRaw`COPY "ItemActivity" FROM STDIN`')).toBe(1);
    expect(creates('prisma["itemActivity"].findMany({})')).toBe(0);
    expect(creates("// the one itemActivity.create\n/** or itemActivity.create here */ const x = 1;")).toBe(0);
  });

  it("is item-thread.ts alone, with one create, in writeItemActivity", () => {
    const found = files(SRC)
      .map((f) => [relative(ROOT, f).split("\\").join("/"), creates(readFileSync(f, "utf8"))] as const)
      .filter(([, n]) => n > 0);
    expect(found).toEqual([[WRITER, 1]]);
    const thread = readFileSync(join(ROOT, WRITER), "utf8");
    const fn = thread.slice(thread.indexOf("export function writeItemActivity("));
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toMatch(/db\.itemActivity\.create\(\{[\s\S]*meta: stampVia\(row\.meta\)/);
  });
});
