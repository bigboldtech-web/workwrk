// prisma/sql/2026-10-27-item-completions.sql (docs/plans/recurring-goals.md
// section 3, File 2, C4): one new append-only table, column for column the
// spec's, its three indexes catalogue-guarded (so a second apply is a no-op),
// NO key to "Item" and nothing on "Item", listed last in the manifest (read
// as text: the script runs on import), declared in the Prisma schema with
// no relation, a README row, and the schema guard refuses the tree without
// it. Fails on the code before step 4: no file, no entry, no model.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FILE = "2026-10-27-item-completions.sql";
const SQL = read(`prisma/sql/${FILE}`);
const BODY = SQL.replace(/\/\*[\s\S]*?\*\//g, "");
const INDEXES: Array<[string, string]> = [
  ["ItemCompletion_organizationId_doneAt_idx", '("organizationId", "doneAt")'],
  ["ItemCompletion_itemId_doneAt_idx", '("itemId", "doneAt")'],
  ["ItemCompletion_boardId_doneAt_idx", '("boardId", "doneAt")'],
];

/** `"col" TYPE` pairs of a CREATE TABLE, in order. */
function columnsOf(sql: string, table: string): Array<[string, string]> {
  const block = new RegExp(`CREATE TABLE IF NOT EXISTS "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? "";
  return [...block.matchAll(/^\s+"(\w+)"\s+([A-Z]+(?:\(3\))?(?: NOT NULL)?)/gm)].map((m) => [m[1], m[2]]);
}

describe(`prisma/sql/${FILE}`, () => {
  it("creates the spec's table, column for column, and nothing on Item", () => {
    const plan = read("docs/plans/recurring-goals.md");
    const at = plan.indexOf("**File 2: `prisma/sql/2026-10-27-item-completions.sql`**");
    const spec = /```sql\n([\s\S]*?)```/.exec(plan.slice(at))?.[1] ?? "";
    expect(spec.length).toBeGreaterThan(300);
    const mine = columnsOf(SQL, "ItemCompletion");
    expect(mine).toHaveLength(7);
    expect(mine).toEqual(columnsOf(spec, "ItemCompletion"));
    expect(SQL).toContain('CONSTRAINT "ItemCompletion_pkey" PRIMARY KEY ("id")');
    expect(BODY).not.toMatch(/REFERENCES|ALTER TABLE|DROP |UPDATE |DELETE |INSERT /);
    expect(BODY).not.toMatch(/ON "Item"\b/);
  });

  it("builds each index only when pg_indexes says it is missing, so a second apply does nothing", () => {
    for (const [name, cols] of INDEXES) {
      expect(BODY).toContain(`IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = '${name}') THEN`);
      expect(BODY).toContain(`CREATE INDEX "${name}" ON "ItemCompletion" ${cols};`);
    }
    expect(BODY.match(/CREATE INDEX/g)).toHaveLength(3);
    expect(BODY).toMatch(/CREATE TABLE IF NOT EXISTS "ItemCompletion"/);
  });

  it("says in its header what it changes, that it goes before the code, and where the backfill is", () => {
    const header = /^\/\*([\s\S]*?)\*\//.exec(SQL)?.[1] ?? "";
    for (const words of ["EXISTING ROWS ELSEWHERE ARE UNCHANGED", "APPLY THIS FILE BEFORE THE CODE", "NO BACKFILL IN THE DEPLOY", "scripts/backfill-item-completions.ts", "CATALOGUE-GUARDED", "Rollback:", "NO KEY to \"Item\""]) {
      expect(header).toContain(words);
    }
    expect(SQL).not.toMatch(/—|–| -- /);
  });

  it("is listed last in SQL_MANIFEST, once, with its README row", () => {
    const block = (/const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(read("scripts/deploy-migrations.mjs"))?.[1] ?? "").replace(/\/\/[^\n]*/g, "");
    const files = [...block.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    expect(files[files.length - 1]).toBe(FILE);
    expect(files.filter((f) => f === FILE)).toHaveLength(1);
    expect(read("prisma/sql/README.md")).toMatch(new RegExp(`^\\| \`${FILE}\` \\| Item completions .* \\| \\*\\*pending\\*\\* \\|$`, "m"));
  });

  it("is declared in the Prisma schema with every column, its indexes, and no relation", () => {
    const model = /^model ItemCompletion \{([\s\S]*?)^\}/m.exec(read("prisma/schema.prisma"))?.[1] ?? "";
    for (const [c] of columnsOf(SQL, "ItemCompletion")) expect(model, c).toMatch(new RegExp(`^\\s+${c}\\s`, "m"));
    expect(model).toMatch(/^\s+actorId\s+String\?\s*$/m);
    expect(model).toMatch(/@@index\(\[organizationId, doneAt\]\)/);
    expect(model).toMatch(/@@index\(\[itemId, doneAt\]\)/);
    expect(model).toMatch(/@@index\(\[boardId, doneAt\]\)/);
    expect(model).not.toMatch(/@relation/);
  });
});

describe("scripts/check-schema-sql.mjs with the item completions file", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "item-completions-sql-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("rejects the same tree without this file in the manifest, naming the table", () => {
    // A copy of what the guard reads. The manifest is written as its array
    // alone, so nothing in the copy could ever reach a database.
    mkdirSync(path.join(scratch, "scripts"), { recursive: true });
    cpSync(path.join(ROOT, "prisma/schema.prisma"), path.join(scratch, "prisma/schema.prisma"));
    cpSync(path.join(ROOT, "prisma/migrations"), path.join(scratch, "prisma/migrations"), { recursive: true });
    cpSync(path.join(ROOT, "prisma/sql"), path.join(scratch, "prisma/sql"), { recursive: true });
    cpSync(path.join(ROOT, "scripts/schema-sql-baseline.json"), path.join(scratch, "scripts/schema-sql-baseline.json"));
    cpSync(path.join(ROOT, "scripts/check-schema-sql.mjs"), path.join(scratch, "scripts/check-schema-sql.mjs"));
    const block = /const SQL_MANIFEST = \[[\s\S]*?\];/.exec(read("scripts/deploy-migrations.mjs"))?.[0] ?? "";
    expect(block).toContain(`"${FILE}",`);
    writeFileSync(path.join(scratch, "scripts/deploy-migrations.mjs"), `${block.replace(`  "${FILE}",\n`, "")}\n`);
    const r = spawnSync(process.execPath, [path.join(scratch, "scripts/check-schema-sql.mjs")], { cwd: scratch, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ItemCompletion/);
  });

  it("accepts the tree with it", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/check-schema-sql.mjs")], { cwd: ROOT, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("a company's hard delete takes its completions (the step 4 review L11)", () => {
  it("ItemCompletion is a workspace orphan table: no key to Organization or Item, so only the delete by organizationId reaches it", async () => {
    const { WORKSPACE_ORPHAN_TABLES } = await import("@/lib/admin/workspace-orphans");
    expect(WORKSPACE_ORPHAN_TABLES).toContain("ItemCompletion");
    // The purge script for companies deleted earlier reads the same list.
    expect(read("scripts/purge-deleted-workspace-orphans.ts")).toMatch(/for \(const table of WORKSPACE_ORPHAN_TABLES\)/);
  });
});
