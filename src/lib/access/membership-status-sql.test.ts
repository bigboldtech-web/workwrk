// prisma/sql/2026-11-01-membership-status.sql (docs/plans/workspace-status.md
// D1, D16): a person's status and removal in each workspace, two columns on
// "OrganizationMembership", additive, idempotent, catalogue-guarded
// (pg_attribute), with a ONE-TIME step marked on the "status" column that
// copies an ended account's state onto its memberships; listed last in the
// manifest (read as text: the script runs on import), declared in the
// Prisma schema, with a README row; and the schema guard refuses the tree
// without it.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FILE = "2026-11-01-membership-status.sql";
const SQL = read(`prisma/sql/${FILE}`);
const BODY = SQL.replace(/\/\*[\s\S]*?\*\//g, "");
const MARKER = "membership-status-2026-11-01";

describe(FILE, () => {
  it("adds the three columns, each only when pg_attribute says it is missing", () => {
    for (const [col, type] of [["status", `"UserStatus" NOT NULL DEFAULT 'ACTIVE'`], ["removedAt", "TIMESTAMP(3)"], ["endedWithAccount", "BOOLEAN NOT NULL DEFAULT false"]]) {
      expect(BODY).toMatch(new RegExp(`attrelid = '"OrganizationMembership"'::regclass AND attname = '${col}' AND NOT attisdropped\\) THEN\\s+ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "${col}" ${type.replace(/[()]/g, "\\$&")};`));
    }
    expect(BODY.match(/ALTER TABLE/g)).toHaveLength(12);
    expect(BODY).not.toMatch(/REFERENCES|DROP |DELETE |CREATE INDEX|TRUNCATE/);
  });

  it("copies an ended account's state onto every one of its memberships, once, under the column's marker", () => {
    const once = BODY.slice(BODY.indexOf("col_description"));
    expect(once).toMatch(new RegExp(`col_description\\('"OrganizationMembership"'::regclass,[\\s\\S]*attname = 'status' AND NOT attisdropped\\)\\), ''\\)\\s+NOT LIKE '%${MARKER}%' THEN\\s+UPDATE`));
    // INACTIVE for a deactivated or removed account; its deletedAt as removedAt, an earlier one kept.
    // Each seat it ends is marked as ended with the account (step 1 review M1).
    expect(once).toMatch(/UPDATE "OrganizationMembership" m\s+SET "status" = 'INACTIVE',\s+"removedAt" = COALESCE\(m\."removedAt", u\."deletedAt"\),\s+"endedWithAccount" = true\s+FROM "User" u\s+WHERE m\."userId" = u\."id"\s+AND \(u\."status" = 'INACTIVE' OR u\."deletedAt" IS NOT NULL\);/);
    // Nothing else ever sets the mark.
    expect(BODY.match(/"endedWithAccount" = true/g)).toHaveLength(1);
    // The HR labels are not copied: no membership status is set from the account's.
    expect(BODY).not.toMatch(/"status" = u\."status"/);
    // Two here, six in the profile's own one-time block (D18, below).
    expect(BODY.match(/UPDATE /g)).toHaveLength(8);
    // The step 2 review H1: in the same one-time block, each address's open
    // invitations end in each workspace whose seat it ends (expiresAt now, in
    // UTC as the columns hold it), the address in any case.
    expect(once).toMatch(/UPDATE "Invitation" i\s+SET "expiresAt" = \(now\(\) AT TIME ZONE 'UTC'\)\s+FROM "OrganizationMembership" m\s+JOIN "User" u ON u\."id" = m\."userId"\s+WHERE i\."organizationId" = m\."organizationId"\s+AND lower\(i\."email"\) = lower\(u\."email"\)\s+AND i\."accepted" = false\s+AND i\."expiresAt" > \(now\(\) AT TIME ZONE 'UTC'\)\s+AND \(u\."status" = 'INACTIVE' OR u\."deletedAt" IS NOT NULL\);/);
    expect(once.indexOf('UPDATE "Invitation"')).toBeLessThan(once.indexOf("COMMENT ON COLUMN"));
    // The marker is written after the step, in the same block.
    expect(once).toMatch(new RegExp(`COMMENT ON COLUMN "OrganizationMembership"\\."status" IS\\s+'[^;]*${MARKER}';`));
    expect(once.indexOf("UPDATE")).toBeLessThan(once.indexOf("COMMENT ON COLUMN"));
    expect(BODY.match(/DO \$\$/g)).toHaveLength(3);
  });

  // The step 3 review H2 and D18: the profile moves with the account too.
  it("adds the nine profile columns, each only when pg_attribute says it is missing, with no key to another table", () => {
    for (const [col, type] of [
      ["departmentId", "TEXT"],
      ["roleId", "TEXT"],
      ["officeId", "TEXT"],
      ["joinDate", "TIMESTAMP(3)"],
      ["weeklyCapacityHours", "DOUBLE PRECISION"],
      ["workSchedule", "JSONB"],
      ["customFields", "JSONB"],
      ["orgRole", "TEXT"],
      ["isAgent", "BOOLEAN NOT NULL DEFAULT false"],
    ]) {
      expect(BODY).toMatch(new RegExp(`attrelid = '"OrganizationMembership"'::regclass AND attname = '${col}' AND NOT attisdropped\\) THEN\\s+ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "${col}" ${type.replace(/[()]/g, "\\$&")};`));
    }
  });

  it("moves a department, job role or office of another workspace the account belongs to onto its membership there, once, under its own marker", () => {
    const PROFILE = "membership-profile-2026-11-02";
    const once = BODY.slice(BODY.indexOf(`attname = 'departmentId' AND NOT attisdropped)), '')`));
    expect(once).toMatch(new RegExp(`NOT LIKE '%${PROFILE}%' THEN`));
    for (const [col, table] of [["departmentId", "Department"], ["roleId", "Role"], ["officeId", "Office"]]) {
      // Onto the membership in the workspace that owns the row, only from a workspace other than the anchor, never over a value there.
      expect(once).toMatch(new RegExp(`UPDATE "OrganizationMembership" m\\s+SET "${col}" = u\\."${col}"\\s+FROM "User" u\\s+JOIN "${table}" x ON x\\."id" = u\\."${col}"\\s+WHERE m\\."userId" = u\\."id"\\s+AND m\\."organizationId" = x\\."organizationId"\\s+AND x\\."organizationId" <> u\\."organizationId"\\s+AND m\\."${col}" IS NULL;`));
      // Off the account only where it moved: one from a workspace it no longer belongs to stays (nothing deleted).
      expect(once).toMatch(new RegExp(`UPDATE "User" u\\s+SET "${col}" = NULL\\s+FROM "${table}" x\\s+WHERE x\\."id" = u\\."${col}"\\s+AND x\\."organizationId" <> u\\."organizationId"\\s+AND EXISTS \\(SELECT 1 FROM "OrganizationMembership" m WHERE m\\."userId" = u\\."id" AND m\\."organizationId" = x\\."organizationId" AND m\\."${col}" = u\\."${col}"\\);`));
    }
    // The marker is written after the moves, in the same block, on "departmentId".
    expect(once).toMatch(new RegExp(`COMMENT ON COLUMN "OrganizationMembership"\\."departmentId" IS\\s+'[^;]*${PROFILE}';`));
    expect(once.indexOf("UPDATE")).toBeLessThan(once.indexOf("COMMENT ON COLUMN"));
    const header = (/^\/\*([\s\S]*?)\*\//.exec(SQL)?.[1] ?? "").replace(/\s+/g, " ");
    for (const words of ["A PERSON'S PROFILE IN EACH WORKSPACE", `its own marker, ${PROFILE}, which a later COMMENT ON that column MUST KEEP`, "nothing is deleted", "DROP COLUMN IF EXISTS \"isAgent\""]) {
      expect(header).toContain(words);
    }
  });

  it("says in its header why, what the one-time step keeps and marks, where its marker lives, why it is here, and that it goes before the code", () => {
    const header = (/^\/\*([\s\S]*?)\*\//.exec(SQL)?.[1] ?? "").replace(/\s+/g, " ");
    for (const words of [
      "WHY.",
      "EXISTING ROWS KEEP WHAT THEY SHOW TODAY",
      "ONE-TIME",
      "HR labels",
      "are not copied",
      "EVERY SEAT IT ENDS CARRIES \"endedWithAccount\" = true",
      "the worst case is exactly today's behaviour",
      // Step 1 review L4: where the marker lives, and that a later comment must keep it.
      "THE ONE-TIME MARKER LIVES IN THE COMMENT ON \"OrganizationMembership\".\"status\"",
      "MUST KEEP the text membership-status-2026-11-01",
      "WHY THE DATA STEP IS HERE AND NOT IN scripts/",
      "ITS OPEN INVITATIONS END WITH IT",
      "APPLY THIS FILE BEFORE THE CODE",
      "CATALOGUE-GUARDED",
      "Rollback:",
      "DROP COLUMN IF EXISTS \"endedWithAccount\"",
    ]) {
      expect(header).toContain(words);
    }
    expect(SQL).not.toMatch(/—|–|--/);
  });

  it("is listed last in SQL_MANIFEST, once, with its README row", () => {
    const block = (/const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(read("scripts/deploy-migrations.mjs"))?.[1] ?? "").replace(/\/\/[^\n]*/g, "");
    const files = [...block.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    expect(files[files.length - 1]).toBe(FILE);
    expect(files.filter((f) => f === FILE)).toHaveLength(1);
    const row = new RegExp(`^\\| \`${FILE}\` \\| A person's status in each workspace .* \\| \\*\\*pending\\*\\* \\|$`, "m").exec(read("prisma/sql/README.md"))?.[0] ?? "";
    expect(row).not.toBe("");
    expect(row).toContain("`endedWithAccount`");
    expect(row).toContain("a later `COMMENT ON` that column must keep the text `membership-status-2026-11-01`");
    expect(row).toContain("a later `COMMENT ON` that column must keep the text `membership-profile-2026-11-02`");
  });

  it("is declared in the Prisma schema: a status that defaults to ACTIVE, and an optional removal", () => {
    const model = /^model OrganizationMembership \{([\s\S]*?)^\}/m.exec(read("prisma/schema.prisma"))?.[1] ?? "";
    expect(model).toMatch(/^\s+status\s+UserStatus\s+@default\(ACTIVE\)\s*$/m);
    expect(model).toMatch(/^\s+removedAt\s+DateTime\?\s*$/m);
    expect(model).toMatch(/^\s+endedWithAccount\s+Boolean\s+@default\(false\)\s*$/m);
    // D18: the profile, no relation (a membership names them by id).
    for (const [col, type] of [["departmentId", "String\\?"], ["roleId", "String\\?"], ["officeId", "String\\?"], ["joinDate", "DateTime\\?"], ["weeklyCapacityHours", "Float\\?"], ["workSchedule", "Json\\?"], ["customFields", "Json\\?"], ["orgRole", "String\\?"]]) {
      expect(model).toMatch(new RegExp(`^\\s+${col}\\s+${type}\\s*$`, "m"));
    }
    expect(model).toMatch(/^\s+isAgent\s+Boolean\s+@default\(false\)\s*$/m);
    expect(model).not.toMatch(/@relation\(fields: \[(departmentId|roleId|officeId)\]/);
    expect(model).toContain(`prisma/sql/${FILE}`);
  });
});

describe("scripts/check-schema-sql.mjs with the membership status file", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "membership-status-sql-"));
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
    expect(r.stderr).toMatch(/OrganizationMembership\.status/);
    expect(r.stderr).toMatch(/OrganizationMembership\.removedAt/);
    expect(r.stderr).toMatch(/OrganizationMembership\.endedWithAccount/);
    expect(r.stderr).toMatch(/OrganizationMembership\.departmentId/);
    expect(r.stderr).toMatch(/OrganizationMembership\.isAgent/);
  });

  it("accepts the tree with it", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/check-schema-sql.mjs")], { cwd: ROOT, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
