// Recurring goals' data (docs/plans/recurring-goals.md section 3, File 1):
// the SQL file has the spec's tables, columns, keys and indexes, every
// statement after the tables catalogue-guarded (the columns too, through
// pg_attribute), listed last in the manifest (read as text: the script runs on
// import), declared in the Prisma schema with matching keys, a README row, and
// accepted by scripts/check-schema-sql.mjs BECAUSE of this file. Fails on the
// code before step 1: no file, no entry, no models.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FILE = "2026-10-27-recurring-goals.sql";
const SQL = read(`prisma/sql/${FILE}`);
const BODY = SQL.replace(/\/\*[\s\S]*?\*\//g, "");
const TABLES = ["GoalPeriod", "KeyResultPeriod"] as const;
const NEW_COLUMNS: Array<[string, string, string]> = [
  ["OKR", "repeat", "TEXT"],
  ["OKR", "repeatUntil", "TEXT"],
  ["KeyResult", "source", "JSONB"],
  ["KeyResult", "sourceById", "TEXT"],
  ["KeyResult", "sourceRefreshedAt", "TIMESTAMP(3)"],
  ["KeyResult", "sourcePausedReason", "TEXT"],
  ["KeyResult", "periodStart", "TEXT"],
  ["KRCheckIn", "periodId", "TEXT"],
];

/** `"col" TYPE` pairs of a CREATE TABLE, in order. */
function columnsOf(sql: string, table: string): Array<[string, string]> {
  const block = new RegExp(`CREATE TABLE IF NOT EXISTS "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? "";
  return [...block.matchAll(/^\s+"(\w+)"\s+([A-Z]+(?: PRECISION)?(?:\(3\))?)/gm)].map((m) => [m[1], m[2]]);
}

function modelOf(schema: string, name: string): string {
  return new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1] ?? "";
}

describe(`prisma/sql/${FILE}`, () => {
  it("creates the spec's two tables, column for column", () => {
    const plan = read("docs/plans/recurring-goals.md");
    const at = plan.indexOf("**File 1: `prisma/sql/2026-10-27-recurring-goals.sql`**");
    const spec = /```sql\n([\s\S]*?)```/.exec(plan.slice(at))?.[1] ?? "";
    expect(spec.length).toBeGreaterThan(1000);
    for (const t of TABLES) {
      const mine = columnsOf(SQL, t);
      expect(mine.length, t).toBeGreaterThan(10);
      expect(mine, t).toEqual(columnsOf(spec, t));
      expect(SQL).toContain(`CONSTRAINT "${t}_pkey" PRIMARY KEY ("id")`);
    }
    // Timestamps default the way the newest files do (UTC whatever the session zone).
    expect(SQL).not.toContain("CURRENT_TIMESTAMP");
    expect(SQL).toMatch(/"updatedAt"\s+TIMESTAMP\(3\) NOT NULL DEFAULT \(now\(\) AT TIME ZONE 'UTC'\)/);
  });

  it("adds every new column on the three goal tables, each guarded on pg_attribute", () => {
    for (const [table, column, type] of NEW_COLUMNS) {
      expect(BODY, `${table}.${column}`).toMatch(
        new RegExp(
          `IF NOT EXISTS \\(SELECT 1 FROM pg_attribute WHERE attrelid = '"${table}"'::regclass AND attname = '${column}' AND NOT attisdropped\\) THEN\\s+ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type.replace(/[()]/g, "\\$&")};`,
        ),
      );
    }
    expect(BODY.match(/ADD COLUMN/g)).toHaveLength(NEW_COLUMNS.length);
    // No column is NOT NULL or defaulted: nothing rewrites a row.
    expect(BODY).not.toMatch(/ADD COLUMN[^;]*(NOT NULL|DEFAULT)/);
  });

  it("guards every index, key and check on the catalogue, and keeps the spec's names and actions", () => {
    // Outside the two CREATE TABLEs there are only DO blocks.
    const outside = BODY.replace(/CREATE TABLE IF NOT EXISTS "\w+" \([\s\S]*?\n\);/g, "").replace(/DO \$\$[\s\S]*?\$\$;/g, "");
    expect(outside.trim()).toBe("");
    const indexes = BODY.match(/CREATE (UNIQUE )?INDEX/g) ?? [];
    expect(indexes.length).toBe((BODY.match(/IF NOT EXISTS \(SELECT 1 FROM pg_indexes/g) ?? []).length);
    const constraints = BODY.match(/ADD CONSTRAINT/g) ?? [];
    expect(constraints.length).toBe((BODY.match(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/g) ?? []).length);

    for (const line of [
      'CREATE UNIQUE INDEX "GoalPeriod_okrId_key_key" ON "GoalPeriod" ("okrId", "key");',
      'CREATE INDEX "GoalPeriod_okrId_startsAt_idx" ON "GoalPeriod" ("okrId", "startsAt");',
      'CREATE INDEX "GoalPeriod_status_closesAt_idx" ON "GoalPeriod" ("status", "closesAt");',
      'CREATE INDEX "GoalPeriod_organizationId_idx" ON "GoalPeriod" ("organizationId");',
      'CREATE UNIQUE INDEX "KeyResultPeriod_keyResultId_periodId_key" ON "KeyResultPeriod" ("keyResultId", "periodId");',
      'CREATE INDEX "KeyResultPeriod_periodId_idx" ON "KeyResultPeriod" ("periodId");',
      'CREATE INDEX "KRCheckIn_periodId_idx" ON "KRCheckIn" ("periodId");',
      'CREATE INDEX "OKR_repeat_idx" ON "OKR" ("repeat");',
      'ADD CONSTRAINT "GoalPeriod_okrId_fkey" FOREIGN KEY ("okrId") REFERENCES "OKR"("id") ON DELETE CASCADE',
      'ADD CONSTRAINT "KeyResultPeriod_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "KeyResult"("id") ON DELETE SET NULL',
      'ADD CONSTRAINT "KeyResultPeriod_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "GoalPeriod"("id") ON DELETE CASCADE',
      'ADD CONSTRAINT "KRCheckIn_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "GoalPeriod"("id") ON DELETE SET NULL',
    ]) {
      expect(BODY, line).toContain(line);
    }
    for (const name of [...BODY.matchAll(/(?:INDEX|ADD CONSTRAINT) "(\w+)"/g)].map((m) => m[1])) {
      expect(BODY, name).toMatch(new RegExp(`(indexname|conname) = '${name}'`));
    }
    // Nothing on "User", nothing dropped, no row read or written.
    expect(BODY).not.toMatch(/REFERENCES "User"/);
    expect(BODY).not.toMatch(/\bDROP\b/);
    expect(BODY).not.toMatch(/^\s*(UPDATE|DELETE FROM|INSERT INTO)\b/m);
  });

  it("checks the values goal-period.ts writes", () => {
    expect(BODY).toMatch(/"OKR_repeat_check" CHECK \([\s\S]*"repeat" IN \('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'\)/);
    expect(BODY).toMatch(/"GoalPeriod_values_check" CHECK \([\s\S]*"cadence" IN \('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'\)/);
    expect(BODY).toMatch(/"status" IN \('OPEN', 'CLOSED'\)/);
    expect(BODY).toMatch(/"result" IN \('HIT', 'PARTLY_HIT', 'MISSED', 'NOT_MEASURED'\)/);
    expect(BODY).toMatch(/"endsAt" > "startsAt"/);
  });

  it("says in its header what it changes and that it goes before the code", () => {
    const header = /^\/\*([\s\S]*?)\*\//.exec(SQL)?.[1] ?? "";
    expect(header).toContain("EXISTING ROWS ARE UNCHANGED");
    expect(header).toContain("APPLY THIS FILE BEFORE THE CODE");
    expect(header).toContain("NO BACKFILL");
    expect(header).toContain("Rollback:");
    expect(SQL).not.toMatch(/—|–/);
  });

  it("is listed last in SQL_MANIFEST, once, and has its README row", () => {
    const manifest = read("scripts/deploy-migrations.mjs");
    const block = (/const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(manifest)?.[1] ?? "").replace(/\/\/[^\n]*/g, "");
    const files = [...block.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    expect(files[files.length - 1]).toBe(FILE);
    expect(files.filter((f) => f === FILE)).toHaveLength(1);
    expect(read("prisma/sql/README.md")).toMatch(new RegExp(`^\\| \`${FILE}\` \\| Recurring goals, step 1 .* \\| \\*\\*pending\\*\\* \\|$`, "m"));
  });

  it("is declared in the Prisma schema, with the keys the SQL makes", () => {
    const schema = read("prisma/schema.prisma");
    for (const t of TABLES) {
      const model = modelOf(schema, t);
      expect(model, t).toBeTruthy();
      for (const [c] of columnsOf(SQL, t)) expect(model, `${t}.${c}`).toMatch(new RegExp(`^\\s+${c}\\s`, "m"));
    }
    for (const [table, column] of NEW_COLUMNS) expect(modelOf(schema, table), `${table}.${column}`).toMatch(new RegExp(`^\\s+${column}\\s+\\w+\\?`, "m"));
    const period = modelOf(schema, "GoalPeriod");
    expect(period).toMatch(/okr\s+OKR\s+@relation\(fields: \[okrId\], references: \[id\], onDelete: Cascade\)/);
    expect(period).toMatch(/@@unique\(\[okrId, key\]\)/);
    expect(period).toMatch(/@@index\(\[okrId, startsAt\]\)/);
    expect(period).toMatch(/@@index\(\[status, closesAt\]\)/);
    expect(period).toMatch(/@@index\(\[organizationId\]\)/);
    const krp = modelOf(schema, "KeyResultPeriod");
    expect(krp).toMatch(/keyResult\s+KeyResult\?\s+@relation\(fields: \[keyResultId\], references: \[id\], onDelete: SetNull\)/);
    expect(krp).toMatch(/period\s+GoalPeriod\s+@relation\(fields: \[periodId\], references: \[id\], onDelete: Cascade\)/);
    expect(krp).toMatch(/@@unique\(\[keyResultId, periodId\]\)/);
    expect(modelOf(schema, "KRCheckIn")).toMatch(/period\s+GoalPeriod\?\s+@relation\(fields: \[periodId\], references: \[id\], onDelete: SetNull\)/);
    expect(modelOf(schema, "KRCheckIn")).toMatch(/@@index\(\[periodId\]\)/);
    expect(modelOf(schema, "OKR")).toMatch(/@@index\(\[repeat\]\)/);
  });
});

describe("scripts/check-schema-sql.mjs", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "recurring-goals-sql-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const guard = (cwd: string) =>
    spawnSync(process.execPath, [path.join(cwd, "scripts/check-schema-sql.mjs")], { cwd, encoding: "utf8" });

  it("accepts the tree with this file", () => {
    const r = guard(ROOT);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^check-schema-sql: ok/);
  });

  it("rejects the same tree without this file in the manifest, naming the two new tables", () => {
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
    const r = guard(scratch);
    expect(r.status).toBe(1);
    const out = r.stderr;
    expect(out).toMatch(/^\s+GoalPeriod$/m);
    expect(out).toMatch(/^\s+KeyResultPeriod$/m);
  });

  it("cannot see the columns on OKR, KeyResult and KRCheckIn (baseline tables), so the file is checked for them above", () => {
    const baseline = JSON.parse(read("scripts/schema-sql-baseline.json")).known as string[];
    for (const t of ["OKR", "KeyResult", "KRCheckIn"]) expect(baseline).toContain(t);
  });
});
