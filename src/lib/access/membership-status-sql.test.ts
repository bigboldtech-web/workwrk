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
    // Twelve on the membership, and "UserSkill"."managerRatings" (the final review, security M2).
    expect(BODY.match(/ALTER TABLE/g)).toHaveLength(13);
    expect(BODY).toMatch(/attrelid = '"UserSkill"'::regclass AND attname = 'managerRatings' AND NOT attisdropped\) THEN\s+ALTER TABLE "UserSkill" ADD COLUMN IF NOT EXISTS "managerRatings" JSONB NOT NULL DEFAULT '\{\}';/);
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
    // Two here, six in the profile's own one-time block (D18), three in the final review's (below).
    expect(BODY.match(/UPDATE /g)).toHaveLength(11);
    // The step 2 review H1: in the same one-time block, each address's open
    // invitations end in each workspace whose seat it ends (expiresAt now, in
    // UTC as the columns hold it), the address in any case.
    expect(once).toMatch(/UPDATE "Invitation" i\s+SET "expiresAt" = \(now\(\) AT TIME ZONE 'UTC'\)\s+FROM "OrganizationMembership" m\s+JOIN "User" u ON u\."id" = m\."userId"\s+WHERE i\."organizationId" = m\."organizationId"\s+AND lower\(i\."email"\) = lower\(u\."email"\)\s+AND i\."accepted" = false\s+AND i\."expiresAt" > \(now\(\) AT TIME ZONE 'UTC'\)\s+AND \(u\."status" = 'INACTIVE' OR u\."deletedAt" IS NOT NULL\);/);
    expect(once.indexOf('UPDATE "Invitation"')).toBeLessThan(once.indexOf("COMMENT ON COLUMN"));
    // The marker is written after the step, in the same block.
    expect(once).toMatch(new RegExp(`COMMENT ON COLUMN "OrganizationMembership"\\."status" IS\\s+'[^;]*${MARKER}';`));
    expect(once.indexOf("UPDATE")).toBeLessThan(once.indexOf("COMMENT ON COLUMN"));
    expect(BODY.match(/DO \$\$/g)).toHaveLength(4);
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

  // The final review (integrity M3 and L1, security M2 and L4): a third
  // one-time step, under its own marker on the new "UserSkill" column.
  it("copies the home's profile, keys each manager rating by its workspace and revokes the keys of people gone, once, under its own marker", () => {
    const FIXES = "membership-fixes-2026-11-03";
    const once = BODY.slice(BODY.indexOf(`col_description('"UserSkill"'::regclass`));
    expect(once).toMatch(new RegExp(`^col_description\\('"UserSkill"'::regclass,[\\s\\S]*?attname = 'managerRatings' AND NOT attisdropped\\)\\), ''\\)\\s+NOT LIKE '%${FIXES}%' THEN`));
    // M3: COPIED (never moved: no write of "User") onto the home row of an account anchored away, each only where the row holds none.
    expect(once).toMatch(/UPDATE "OrganizationMembership" m\s+SET "joinDate" = COALESCE\(m\."joinDate", u\."joinDate"\),\s+"weeklyCapacityHours" = COALESCE\(m\."weeklyCapacityHours", u\."weeklyCapacityHours"\),\s+"workSchedule" = COALESCE\(m\."workSchedule", u\."workSchedule"\),\s+"customFields" = COALESCE\(m\."customFields", u\."customFields"\)\s+FROM "User" u\s+WHERE m\."userId" = u\."id"\s+AND m\."isPrimary" = true\s+AND m\."organizationId" <> u\."organizationId"/);
    expect(once).not.toMatch(/UPDATE "User"/);
    // Security M2, keyed by the person's home workspace (the fixes review L3):
    // { <the isPrimary membership's workspace, else the account's>: rating },
    // a key already there winning; the old column is read, never written.
    expect(once).toMatch(/UPDATE "UserSkill" s\s+SET "managerRatings" = jsonb_build_object\(\s+COALESCE\(\(SELECT h\."organizationId" FROM "OrganizationMembership" h\s+WHERE h\."userId" = u\."id" AND h\."isPrimary" = true\s+ORDER BY h\."createdAt", h\."id" LIMIT 1\), u\."organizationId"\),\s+s\."managerRating"\) \|\| s\."managerRatings"\s+FROM "User" u\s+WHERE u\."id" = s\."userId"\s+AND s\."managerRating" IS NOT NULL;/);
    // Before L3: keyed by the workspace the account is anchored in.
    expect(once).not.toMatch(/jsonb_build_object\(u\."organizationId", s\."managerRating"\)/);
    expect(BODY).not.toMatch(/SET "managerRating" =/);
    // Security L4: api-auth.ts's rule, a live seat in the key's workspace, anchored or through a membership; revokedAt now, in UTC.
    expect(once).toMatch(/UPDATE "ApiKey" k\s+SET "revokedAt" = \(now\(\) AT TIME ZONE 'UTC'\)\s+WHERE k\."revokedAt" IS NULL/);
    expect(once).toMatch(/NOT EXISTS \(\s+SELECT 1 FROM "User" u\s+WHERE u\."id" = k\."createdById"\s+AND u\."organizationId" = k\."organizationId"\s+AND u\."status" <> 'INACTIVE'\s+AND u\."deletedAt" IS NULL\)/);
    expect(once).toMatch(/NOT EXISTS \(\s+SELECT 1 FROM "User" u\s+JOIN "OrganizationMembership" m ON m\."userId" = u\."id"\s+WHERE u\."id" = k\."createdById"\s+AND u\."organizationId" <> k\."organizationId"\s+AND m\."organizationId" = k\."organizationId"\s+AND m\."status" <> 'INACTIVE'\s+AND m\."removedAt" IS NULL\)\s+RETURNING k\."id", k\."name", k\."prefix", k\."organizationId", k\."createdById"\s+\)/);
    // The fixes review L7: one Audit row per revoked key, in the same
    // statement (the revocation's own RETURNING), every required field
    // filled: an id of its own, the type and severity endSeat's revocations
    // write, the key's workspace, the key as target, actor the system (no
    // person), the reason in the metadata, dated now in UTC.
    expect(once).toMatch(/WITH revoked AS \(\s+UPDATE "ApiKey" k/);
    expect(once).toMatch(/INSERT INTO "ActivityLog" \("id", "type", "actorId", "actorType", "organizationId", "description", "targetId", "targetType", "severity", "metadata", "createdAt"\)\s+SELECT 'deploy-key-revoked-' \|\| r\."id", 'api_key_revoked', NULL, 'system', r\."organizationId",\s+'Revoked API key "' \|\| r\."name" \|\| '" \(prefix ' \|\| r\."prefix" \|\| '\) on the deploy: the person who made it no longer works in this workspace',\s+r\."id", 'api_key', 'warning',\s+jsonb_build_object\('name', r\."name", 'prefix', r\."prefix", 'createdById', r\."createdById", 'reason', 'creator has no live seat, deploy step three'\),\s+\(now\(\) AT TIME ZONE 'UTC'\)\s+FROM revoked r\s+ON CONFLICT \("id"\) DO NOTHING;/);
    // The one insert in the file, and into the audit table only.
    expect(BODY.match(/INSERT INTO/g)).toHaveLength(1);
    expect(once.indexOf('INSERT INTO "ActivityLog"')).toBeLessThan(once.indexOf("COMMENT ON COLUMN"));
    // The marker is written after the three steps, in the same block.
    expect(once).toMatch(new RegExp(`COMMENT ON COLUMN "UserSkill"\\."managerRatings" IS\\s+'[^;]*${FIXES}';`));
    expect(once.lastIndexOf("UPDATE")).toBeLessThan(once.indexOf("COMMENT ON COLUMN"));
    // The two earlier blocks keep their own markers (they have run on the local database).
    expect(BODY).toMatch(/NOT LIKE '%membership-status-2026-11-01%'/);
    expect(BODY).toMatch(/NOT LIKE '%membership-profile-2026-11-02%'/);
    const header = (/^\/\*([\s\S]*?)\*\//.exec(SQL)?.[1] ?? "").replace(/\s+/g, " ");
    for (const words of [
      "WHAT THIS FILE DOES",
      "adds twelve columns to \"OrganizationMembership\"",
      "and one to \"UserSkill\" (\"managerRatings\")",
      "ONE-TIME step three, marker membership-fixes-2026-11-03",
      `its own marker, ${FIXES}, which a later COMMENT ON that column MUST KEEP`,
      "COPIED (never moved: the account keeps its own)",
      "API KEYS OF PEOPLE ALREADY GONE ARE REVOKED",
      "Nothing is deleted anywhere in this file",
      "ALTER TABLE \"UserSkill\" DROP COLUMN IF EXISTS \"managerRatings\"",
      // The fixes review: L3 (home), L7 (the Audit rows), M2 (the minutes before the reload).
      "each manager rating of a skill keyed by the person's home workspace",
      "Home is the workspace of the account's \"isPrimary\" membership when it has one, else the account's own \"organizationId\"",
      "reason: \"creator has no live seat, deploy step three\"",
      "A person the release before this one reactivates or restores in those minutes",
    ]) {
      expect(header).toContain(words);
    }
    // L1: the header no longer says three columns.
    expect(header).not.toContain("selects all three columns");
    expect(header).not.toContain("<the account's workspace now>");
    // The fixes review L6: the rollback copies each home workspace's rating back to the old column BEFORE it drops anything.
    const rollback = header.slice(header.indexOf("Rollback:"));
    const copyBack = `UPDATE "UserSkill" s SET "managerRating" = (s."managerRatings" ->> h."org")::int FROM (SELECT u."id", COALESCE((SELECT p."organizationId" FROM "OrganizationMembership" p WHERE p."userId" = u."id" AND p."isPrimary" = true ORDER BY p."createdAt", p."id" LIMIT 1), u."organizationId") AS "org" FROM "User" u) h WHERE h."id" = s."userId" AND jsonb_typeof(s."managerRatings" -> h."org") = 'number';`;
    expect(rollback).toContain(copyBack);
    expect(rollback.indexOf(copyBack)).toBeLessThan(rollback.indexOf("DROP COLUMN"));
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
      "WHY THE DATA STEPS ARE HERE AND NOT IN scripts/",
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

  it("is listed in SQL_MANIFEST once, followed only by the workspace lines file, with its README row", () => {
    const block = (/const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(read("scripts/deploy-migrations.mjs"))?.[1] ?? "").replace(/\/\/[^\n]*/g, "");
    const files = [...block.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    // After it only a person's manager and dotted lines in each workspace (docs/plans/workspace-status-2.md),
    // then their week rows in each (its final review, security M1).
    expect(files.slice(files.indexOf(FILE))).toEqual([FILE, "2026-11-03-workspace-lines.sql", "2026-11-04-week-rows-per-workspace.sql"]);
    expect(files.filter((f) => f === FILE)).toHaveLength(1);
    const row = new RegExp(`^\\| \`${FILE}\` \\| A person's status in each workspace .* \\| \\*\\*pending\\*\\* \\|$`, "m").exec(read("prisma/sql/README.md"))?.[0] ?? "";
    expect(row).not.toBe("");
    expect(row).toContain("`endedWithAccount`");
    expect(row).toContain("a later `COMMENT ON` that column must keep the text `membership-status-2026-11-01`");
    expect(row).toContain("a later `COMMENT ON` that column must keep the text `membership-profile-2026-11-02`");
    // The final review, integrity L1: the row, the header and the manifest comment say what the file does now.
    expect(row).toContain("a later `COMMENT ON` that column must keep the text `membership-fixes-2026-11-03`");
    expect(row).toContain("Thirteen columns");
    expect(row).toContain("`{ <the person's home workspace>: rating }`");
    expect(row).toContain("each with one `ActivityLog` row");
    const comment = /\/\/ A person's status in each workspace[\s\S]*?"2026-11-01-membership-status\.sql"/.exec(read("scripts/deploy-migrations.mjs"))?.[0] ?? "";
    for (const words of ["Thirteen columns", "membership-status-2026-11-01", "membership-profile-2026-11-02", "membership-fixes-2026-11-03", "\"managerRatings\"", "all thirteen columns", "keyed by the person's home workspace", "each with\n  // an ActivityLog row"]) {
      expect(comment).toContain(words);
    }
    expect(comment).not.toContain("all three columns");
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
    // The final review, security M2: a manager's rating per workspace, the old column kept.
    const skill = /^model UserSkill \{([\s\S]*?)^\}/m.exec(read("prisma/schema.prisma"))?.[1] ?? "";
    expect(skill).toMatch(/^\s+managerRatings\s+Json\s+@default\("\{\}"\)\s*$/m);
    expect(skill).toMatch(/^\s+managerRating\s+Int\?\s*$/m);
    expect(skill).toContain(`prisma/sql/${FILE}`);
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
    expect(r.stderr).toMatch(/UserSkill\.managerRatings/);
  });

  it("accepts the tree with it", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/check-schema-sql.mjs")], { cwd: ROOT, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
