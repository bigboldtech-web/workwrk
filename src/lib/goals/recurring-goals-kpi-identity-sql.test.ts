// prisma/sql/2026-10-27-recurring-goals-kpi-identity.sql (the step 2 review,
// M6): the KPI and the person a period's KPI row reads, two nullable bare-id
// columns on "KeyResultPeriod", additive, idempotent, catalogue-guarded
// (pg_attribute), listed in the manifest after File 1 and before step 4's
// item completions file (read as text: the script runs on import),
// declared in the Prisma schema, with a README row; and the schema guard
// refuses the tree without it.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FILE = "2026-10-27-recurring-goals-kpi-identity.sql";
const SQL = read(`prisma/sql/${FILE}`);
const BODY = SQL.replace(/\/\*[\s\S]*?\*\//g, "");

describe(FILE, () => {
  it("adds the two columns, each only when pg_attribute says it is missing, and nothing else", () => {
    for (const col of ["kpiId", "kpiUserId"]) {
      expect(BODY).toContain(`attrelid = '"KeyResultPeriod"'::regclass AND attname = '${col}' AND NOT attisdropped`);
      expect(BODY).toContain(`ALTER TABLE "KeyResultPeriod" ADD COLUMN IF NOT EXISTS "${col}" TEXT;`);
    }
    expect(BODY).not.toMatch(/REFERENCES|DROP |UPDATE |DELETE |CREATE INDEX|NOT NULL|DEFAULT/);
    expect(BODY.match(/ALTER TABLE/g)).toHaveLength(2);
  });

  it("says in its header what it changes and that it goes before the code", () => {
    const header = /^\/\*([\s\S]*?)\*\//.exec(SQL)?.[1] ?? "";
    for (const words of ["EXISTING ROWS ARE UNCHANGED", "APPLY THIS FILE BEFORE THE CODE", "NO BACKFILL", "Rollback:", "CATALOGUE-GUARDED"]) expect(header).toContain(words);
    expect(SQL).not.toMatch(/—|–| -- /);
  });

  it("is listed in SQL_MANIFEST once, followed only by step 4's item completions file, with its README row", () => {
    const block = (/const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(read("scripts/deploy-migrations.mjs"))?.[1] ?? "").replace(/\/\/[^\n]*/g, "");
    const files = [...block.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    expect(files.slice(files.indexOf(FILE))).toEqual([FILE, "2026-10-27-item-completions.sql"]);
    expect(files.filter((f) => f === FILE)).toHaveLength(1);
    expect(read("prisma/sql/README.md")).toMatch(new RegExp(`^\\| \`${FILE}\` \\| Recurring goals, the KPI a period reads .* \\| \\*\\*pending\\*\\* \\|$`, "m"));
  });

  it("is declared in the Prisma schema as two optional strings, with no relation", () => {
    const model = /^model KeyResultPeriod \{([\s\S]*?)^\}/m.exec(read("prisma/schema.prisma"))?.[1] ?? "";
    expect(model).toMatch(/^\s+kpiId\s+String\?\s*$/m);
    expect(model).toMatch(/^\s+kpiUserId\s+String\?\s*$/m);
    expect(model).not.toMatch(/\s+KPI\??\s+@relation/);
  });
});

describe("scripts/check-schema-sql.mjs with the KPI identity file", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "recurring-goals-kpi-sql-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("rejects the same tree without this file in the manifest, naming the columns", () => {
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
    expect(r.stderr).toMatch(/kpiId/);
    expect(r.stderr).toMatch(/kpiUserId/);
  });
});
