// prisma/sql/2026-11-04-week-rows-per-workspace.sql (docs/plans/
// workspace-status-2.md, the final review, security M1): a person's weekly
// check-in and timesheet in each workspace. A check that every week row
// names its workspace, which stops the file with nothing changed when one
// does not; the unique keys on person, workspace and week added first; the
// old ones on person and week dropped after, as an index or a constraint;
// each catalogue-guarded. Nothing deleted, no row written. Listed last in the
// manifest (read as text: the script runs on import), declared in the Prisma
// schema, with a README row. Checked as text; the coordinator runs it on a
// local database (the planted cases in the plan, "Final review fixes, part A").

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FILE = "2026-11-04-week-rows-per-workspace.sql";
const SQL = read(`prisma/sql/${FILE}`);
const BODY = SQL.replace(/\/\*[\s\S]*?\*\//g, "");
const HEADER = (/^\/\*([\s\S]*?)\*\//.exec(SQL)?.[1] ?? "").replace(/\s+/g, " ");

describe(FILE, () => {
  it("first checks every week row names its workspace, and stops with nothing changed when one does not", () => {
    const check = BODY.slice(0, BODY.indexOf("END\n$$;"));
    expect(check).toMatch(/SELECT count\(\*\) INTO reviews FROM "WeeklyReview" WHERE "organizationId" IS NULL;\s+SELECT count\(\*\) INTO sheets FROM "Timesheet" WHERE "organizationId" IS NULL;\s+IF reviews > 0 OR sheets > 0 THEN\s+RAISE EXCEPTION '2026-11-04-week-rows-per-workspace\.sql changed nothing:/);
    // The check is its own statement, before any key is touched.
    expect(BODY.indexOf("RAISE EXCEPTION")).toBeLessThan(BODY.indexOf("CREATE UNIQUE INDEX"));
    for (const words of ["THE CHECK.", "the file stops with an exception naming the table and how many rows, before it changes anything", "Nothing is guessed and nothing is deleted"]) {
      expect(HEADER).toContain(words);
    }
  });

  it("adds the keys on person, workspace and week first, each only while the catalogue lacks it, then drops the old ones as an index or a constraint", () => {
    const keys = [
      ["WeeklyReview", "WeeklyReview_userId_organizationId_periodStart_key", `"userId", "organizationId", "periodStart"`, "WeeklyReview_userId_periodStart_key"],
      ["Timesheet", "Timesheet_userId_organizationId_weekStartDate_key", `"userId", "organizationId", "weekStartDate"`, "Timesheet_userId_weekStartDate_key"],
    ] as const;
    for (const [table, added, cols, old] of keys) {
      expect(BODY).toContain(`IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = '${added}') THEN\n    CREATE UNIQUE INDEX IF NOT EXISTS "${added}" ON "${table}"(${cols});`);
      expect(BODY).toContain(`IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${old}' AND conrelid = '"${table}"'::regclass) THEN\n    ALTER TABLE "${table}" DROP CONSTRAINT "${old}";\n  ELSIF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = '${old}') THEN\n    DROP INDEX IF EXISTS "${old}";`);
      // Added before the old one goes: never a moment with neither.
      expect(BODY.indexOf(`CREATE UNIQUE INDEX IF NOT EXISTS "${added}"`)).toBeLessThan(BODY.indexOf(`DROP INDEX IF EXISTS "${old}"`));
      expect(BODY.indexOf(`CREATE UNIQUE INDEX IF NOT EXISTS "${added}"`)).toBeLessThan(BODY.indexOf(`DROP CONSTRAINT "${old}"`));
    }
    // Both new keys before either old one goes.
    expect(BODY.lastIndexOf("CREATE UNIQUE INDEX")).toBeLessThan(BODY.indexOf("DROP"));
  });

  it("deletes nothing and writes no row: the only drops are the two old keys, the plain index stays", () => {
    expect(BODY).not.toMatch(/\b(DELETE|UPDATE|INSERT|TRUNCATE)\b|DROP TABLE|DROP COLUMN/);
    expect(BODY.match(/DROP (INDEX|CONSTRAINT)/g)).toHaveLength(4);
    expect(BODY).not.toContain("Timesheet_userId_weekStartDate_idx");
    expect(BODY.match(/DO \$\$/g)).toHaveLength(2);
    for (const words of ["Nothing is deleted and no row is written.", "THE ROWS ALREADY THERE are left exactly as they are", "BEFORE OR AFTER THE CODE.", "Rollback: the old keys come back only while nobody holds two rows of one week"]) {
      expect(HEADER).toContain(words);
    }
    expect(SQL).not.toMatch(/—|–|--/);
  });

  it("is listed last in SQL_MANIFEST, once, after the workspace lines file, with its README row", () => {
    const manifest = read("scripts/deploy-migrations.mjs");
    const block = (/const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(manifest)?.[1] ?? "").replace(/\/\/[^\n]*/g, "");
    const files = [...block.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    expect(files.slice(-2)).toEqual(["2026-11-03-workspace-lines.sql", FILE]);
    expect(files.filter((f) => f === FILE)).toHaveLength(1);
    const row = new RegExp(`^\\| \`${FILE.replace(/[.]/g, "\\.")}\` \\| A person's weekly check-in and timesheet in each workspace .* \\| \\*\\*pending\\*\\* \\|$`, "m").exec(read("prisma/sql/README.md"))?.[0] ?? "";
    expect(row).not.toBe("");
    for (const words of ["**First a check**", "**Then the unique keys on person, workspace and week are added first**", "**and only then the old keys on person and week are dropped**", "Nothing is deleted and no row is written"]) {
      expect(row).toContain(words);
    }
  });

  it("is declared in the Prisma schema: one week row per person, workspace and week, the old keys gone", () => {
    const schema = read("prisma/schema.prisma");
    const review = /^model WeeklyReview \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
    expect(review).toMatch(/^\s+@@unique\(\[userId, organizationId, periodStart\]\)\s*$/m);
    expect(review).not.toMatch(/@@unique\(\[userId, periodStart\]\)/);
    expect(review).toContain(`prisma/sql/${FILE}`);
    const sheet = /^model Timesheet \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
    expect(sheet).toMatch(/^\s+@@unique\(\[userId, organizationId, weekStartDate\]\)\s*$/m);
    expect(sheet).not.toMatch(/@@unique\(\[userId, weekStartDate\]\)/);
    expect(sheet).toMatch(/^\s+@@index\(\[userId, weekStartDate\]\)\s*$/m);
    expect(sheet).toContain(`prisma/sql/${FILE}`);
  });

  it("passes the schema guard", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/check-schema-sql.mjs")], { cwd: ROOT, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
