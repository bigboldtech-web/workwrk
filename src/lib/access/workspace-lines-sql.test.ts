// prisma/sql/2026-11-03-workspace-lines.sql (docs/plans/workspace-status-2.md
// E1, E2, E11, step 1): a person's manager and dotted lines in each
// workspace. Two columns and three indexes, catalogue-guarded; ONE one-time
// step, marked on the comment of "OrganizationMembership"."managerId", that
// copies the membership lines, clears the account lines no workspace reads
// (each with its Audit row), gives each dotted line its workspace (copies for
// the others, a line no workspace reads removed with its Audit row), then NOT
// NULL and the new unique; then the keys, NOT VALID and validated. Listed
// last in the manifest (read as text: the script runs on import), declared in
// the Prisma schema, with a README row; the schema guard refuses the tree
// without it. Checked as text: the coordinator runs it on a local database.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FILE = "2026-11-03-workspace-lines.sql";
const SQL = read(`prisma/sql/${FILE}`);
const BODY = SQL.replace(/\/\*[\s\S]*?\*\//g, "");
const MARKER = "workspace-lines-2026-11-03";
const HEADER = (/^\/\*([\s\S]*?)\*\//.exec(SQL)?.[1] ?? "").replace(/\s+/g, " ");
/** The one-time block: from its marker check to the end of its DO statement. */
const ONCE = (() => {
  const from = BODY.indexOf("col_description");
  return BODY.slice(from, BODY.indexOf("END\n$$;", from));
})();
/** Where a statement of the one-time block starts. */
const at = (needle: string) => {
  const i = ONCE.indexOf(needle);
  expect(i, needle).toBeGreaterThanOrEqual(0);
  return i;
};

describe(FILE, () => {
  it("adds the two columns, the dotted one nullable, each only when pg_attribute says it is missing", () => {
    expect(BODY).toMatch(/attrelid = '"OrganizationMembership"'::regclass AND attname = 'managerId' AND NOT attisdropped\) THEN\s+ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "managerId" TEXT;/);
    // Nullable when added: NOT NULL only once every row has a workspace (inside the one-time step).
    expect(BODY).toMatch(/attrelid = '"UserDottedLine"'::regclass AND attname = 'organizationId' AND NOT attisdropped\) THEN\s+ALTER TABLE "UserDottedLine" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;/);
    expect(BODY.match(/ADD COLUMN/g)).toHaveLength(2);
  });

  it("adds the three indexes, each only when pg_indexes says it is missing", () => {
    for (const [name, table, cols] of [
      // Leading with the manager (the step 1 review L4): the key's SET NULL finds a deleted account's memberships by it.
      ["OrganizationMembership_managerId_organizationId_idx", "OrganizationMembership", `"managerId", "organizationId"`],
      ["UserDottedLine_organizationId_managerId_idx", "UserDottedLine", `"organizationId", "managerId"`],
      ["UserDottedLine_organizationId_userId_idx", "UserDottedLine", `"organizationId", "userId"`],
    ]) {
      expect(BODY).toContain(`IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = '${name}') THEN\n    CREATE INDEX IF NOT EXISTS "${name}" ON "${table}"(${cols});`);
    }
  });

  it("runs the one-time step once, under its marker on the membership's managerId column, written last in the same block", () => {
    // The marker, and a second guard only this step changes (the step 1 review L2): the dotted column still nullable.
    expect(ONCE).toMatch(new RegExp(`^col_description\\('"OrganizationMembership"'::regclass,[\\s\\S]*?attname = 'managerId' AND NOT attisdropped\\)\\), ''\\)\\s+NOT LIKE '%${MARKER}%'\\s+AND NOT \\(SELECT attnotnull FROM pg_attribute WHERE attrelid = '"UserDottedLine"'::regclass AND attname = 'organizationId' AND NOT attisdropped\\) THEN`));
    // The marker is written with the moment the step ran (T0 of the window check, the step 1 review H1).
    expect(ONCE).toMatch(new RegExp(`EXECUTE format\\('COMMENT ON COLUMN "OrganizationMembership"\\."managerId" IS %L',\\s+'[^;]*${MARKER}, applied '\\s+\\|\\| to_char\\(now\\(\\) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS\\.MS'\\) \\|\\| ' UTC'\\);`));
    // Every write of the step comes before the marker.
    const marker = at("COMMENT ON COLUMN");
    for (const w of ["UPDATE ", "INSERT INTO", "DELETE FROM", "DROP INDEX", "ALTER TABLE", "CREATE UNIQUE INDEX"]) expect(ONCE.lastIndexOf(w)).toBeLessThan(marker);
    // One marker check, in one DO statement; four DO statements in all.
    expect(BODY.match(/NOT LIKE '%/g)).toHaveLength(1);
    expect(BODY.match(/DO \$\$/g)).toHaveLength(4);
  });

  it("runs in the plan's order: the membership lines, the account lines cleared, the old unique dropped, the dotted lines placed, copied and the stranded removed, NOT NULL, the new unique", () => {
    const order = [
      'UPDATE "OrganizationMembership" m',
      'UPDATE "User" u',
      'INSERT INTO "ActivityLog"',
      'DROP INDEX IF EXISTS "UserDottedLine_userId_managerId_key"',
      'UPDATE "UserDottedLine" d',
      'INSERT INTO "UserDottedLine"',
      'DELETE FROM "UserDottedLine" d',
      'ALTER TABLE "UserDottedLine" ALTER COLUMN "organizationId" SET NOT NULL',
      'CREATE UNIQUE INDEX IF NOT EXISTS "UserDottedLine_userId_managerId_organizationId_key" ON "UserDottedLine"("userId", "managerId", "organizationId")',
      'COMMENT ON COLUMN "OrganizationMembership"."managerId"',
    ];
    const where = order.map(at);
    expect(where).toEqual([...where].sort((a, b) => a - b));
  });

  // The final review, integrity H1: the window check and its recovery read what the lines were before the step.
  it("snapshots every account's line and every dotted line first, in the same statement as the change, into two plainly named tables", () => {
    const snapshot = ONCE.slice(0, at('UPDATE "OrganizationMembership" m'));
    expect(snapshot).toContain(`CREATE TABLE "_deploy_lines_2026_11_03_accounts" AS SELECT u."id", u."organizationId", u."managerId" FROM "User" u;`);
    expect(snapshot).toContain(`CREATE UNIQUE INDEX "_deploy_lines_2026_11_03_accounts_id_key" ON "_deploy_lines_2026_11_03_accounts" ("id");`);
    expect(snapshot).toContain(`CREATE TABLE "_deploy_lines_2026_11_03_dotted" AS SELECT d."id", d."userId", d."managerId", d."role", d."weight", d."startDate", d."endDate", d."createdAt" FROM "UserDottedLine" d;`);
    expect(snapshot).toContain(`CREATE UNIQUE INDEX "_deploy_lines_2026_11_03_dotted_id_key" ON "_deploy_lines_2026_11_03_dotted" ("id");`);
    // Nothing of the snapshot alters a table: the step's one ALTER TABLE is still its NOT NULL.
    expect(snapshot).not.toContain("ALTER TABLE");
    // Before any write of the step, inside its one DO statement, after its two guards.
    for (const w of ['UPDATE "OrganizationMembership" m', "WITH stale AS", "DROP INDEX", 'UPDATE "UserDottedLine" d']) {
      expect(ONCE.indexOf(`CREATE TABLE "_deploy_lines_2026_11_03_dotted"`)).toBeLessThan(at(w));
    }
    expect(ONCE.indexOf("NOT LIKE '%workspace-lines-2026-11-03%'")).toBeLessThan(ONCE.indexOf(`CREATE TABLE "_deploy_lines_2026_11_03_accounts"`));
    // A snapshot left by an apply rolled back by hand stops the step before it changes anything; no file drops one.
    expect(snapshot).toMatch(/IF to_regclass\('"_deploy_lines_2026_11_03_accounts"'\) IS NOT NULL OR to_regclass\('"_deploy_lines_2026_11_03_dotted"'\) IS NOT NULL THEN\s+RAISE EXCEPTION 'The snapshot tables [^;]*Nothing was changed\./);
    expect(snapshot.indexOf("RAISE EXCEPTION")).toBeLessThan(snapshot.indexOf("CREATE TABLE"));
    expect(BODY.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(BODY).not.toMatch(/DROP TABLE/);
    // In no Prisma model: the schema guard reads the schema's tables, so the snapshot cannot trip it.
    expect(read("prisma/schema.prisma")).not.toContain("_deploy_lines_2026_11_03");
  });

  it("says in its header what the snapshot holds, that the check reads it, and the exact statements that drop it by hand", () => {
    for (const words of [
      "THE SNAPSHOT (the final review, integrity H1).",
      `"_deploy_lines_2026_11_03_accounts", and every dotted line`,
      "so the snapshot never exists without it",
      "They hold ids only, no names and no addresses.",
      "DROP THEM BY HAND once the window check is clean (a later file never drops them), with exactly:",
      `DROP TABLE IF EXISTS "_deploy_lines_2026_11_03_accounts"; DROP TABLE IF EXISTS "_deploy_lines_2026_11_03_dotted";`,
      // The check reads the snapshot, so a move back after the reload hides nothing; it is run at once all the same.
      "So the check reads the snapshot above, not what the rows happen to hold.",
      "a move back after the reload included",
      "the check is as complete an hour after the reload as a minute after it; run it at once all the same",
    ]) {
      expect(HEADER).toContain(words);
    }
    expect(HEADER).not.toContain("and the deploy tries again. A deadlock");
  });

  // The final review, integrity L3.
  it("says truly what a failed validation does: the file rolls back and the deploy stops, retrying only lock waits and deadlocks", () => {
    for (const words of [
      "the deploy then STOPS before the build (its retries are for lock waits and deadlocks only)",
      "It cannot happen while the file runs: it holds ACCESS EXCLUSIVE on \"OrganizationMembership\" to the end, and every delete of a \"User\" row cascades into that table",
      "IS tried again (scripts/deploy-migrations.mjs)",
    ]) {
      expect(HEADER).toContain(words);
    }
    // The retry the header names is the one the deploy has: lock waits and deadlocks, nothing else.
    expect(read("scripts/deploy-migrations.mjs")).toContain("const lockWait = /lock timeout|55P03|deadlock detected|40P01/i.test(out);");
  });

  // E11 (i): any state, where the manager holds a row in W, never the anchor's own row, never the person.
  it("copies the account's line onto each membership of another workspace where that manager holds a row, in any state", () => {
    const copy = ONCE.slice(at('UPDATE "OrganizationMembership" m'), at("WITH stale AS"));
    expect(copy).toMatch(/UPDATE "OrganizationMembership" m\s+SET "managerId" = u\."managerId"\s+FROM "User" u\s+WHERE m\."userId" = u\."id"\s+AND m\."organizationId" <> u\."organizationId"\s+AND m\."managerId" IS NULL\s+AND u\."managerId" IS NOT NULL\s+AND u\."managerId" <> u\."id"/);
    // The manager holds a row there: anchored there, or a membership there.
    expect(copy).toMatch(/EXISTS \(\s+SELECT 1 FROM "User" x\s+WHERE x\."id" = u\."managerId"\s+AND \(x\."organizationId" = m\."organizationId"\s+OR EXISTS \(SELECT 1 FROM "OrganizationMembership" y WHERE y\."userId" = x\."id" AND y\."organizationId" = m\."organizationId"\)\)\);/);
    // In ANY state: no seat condition on either side.
    expect(copy).not.toMatch(/status|removedAt|deletedAt/);
  });

  // E11 (ii): cleared only where the manager holds no row in the anchored workspace, its old value kept.
  it("clears the account's line only where the manager holds no row in the anchored workspace, each with an Audit row there, through one data-modifying statement", () => {
    const clear = ONCE.slice(at("WITH stale AS"), at('DROP INDEX'));
    expect(clear).toMatch(/WITH stale AS \(\s+SELECT u\."id", u\."organizationId", u\."managerId"\s+FROM "User" u\s+WHERE u\."managerId" IS NOT NULL\s+AND NOT EXISTS \(\s+SELECT 1 FROM "User" x\s+WHERE x\."id" = u\."managerId"\s+AND \(x\."organizationId" = u\."organizationId"\s+OR EXISTS \(SELECT 1 FROM "OrganizationMembership" y WHERE y\."userId" = x\."id" AND y\."organizationId" = u\."organizationId"\)\)\)\s+\), cleared AS \(\s+UPDATE "User" u\s+SET "managerId" = NULL\s+FROM stale s\s+WHERE u\."id" = s\."id"\s+AND u\."managerId" = s\."managerId"\s+RETURNING u\."id", s\."organizationId", s\."managerId" AS "oldManagerId"\s+\)\s+INSERT INTO "ActivityLog"/);
    // The Audit row: its own id, the line's type, actor the system, in the anchored workspace, the person as target, the old manager in oldValue.
    expect(clear).toMatch(/INSERT INTO "ActivityLog" \("id", "type", "actorId", "actorType", "organizationId", "description", "targetId", "targetType", "severity", "oldValue", "newValue", "metadata", "createdAt"\)\s+SELECT 'deploy-line-cleared-' \|\| c\."id", 'reporting_line_changed', NULL, 'system', c\."organizationId",/);
    expect(clear).toMatch(/c\."id", 'user', 'info',\s+jsonb_build_object\('managerId', c\."oldManagerId"\),\s+jsonb_build_object\('managerId', NULL\),/);
    expect(clear).toMatch(/FROM cleared c\s+ON CONFLICT \("id"\) DO NOTHING;/);
    // A description naming nobody: no name or address is read into it.
    const description = /c\."organizationId",\s+('(?:[^']|'')*'),/.exec(clear)?.[1] ?? "";
    // Customer words (the final review, product L1): the Audit log reads them, so no deploy words.
    expect(description).toBe("'Cleared a manager during a WorkwrK update: they don''t work in this workspace, so no screen here showed them. Each workspace now keeps its own reporting lines.'");
    expect(clear).not.toMatch(/firstName|lastName|email/);
    // The account's line is written in this one place only.
    expect(BODY.match(/UPDATE "User"/g)).toHaveLength(1);
  });

  // E11 (iii).
  it("places each dotted line in the person's anchored workspace when it qualifies there, otherwise the first by id, in any state", () => {
    const place = ONCE.slice(at('UPDATE "UserDottedLine" d'), at('INSERT INTO "UserDottedLine"'));
    expect(place).toMatch(/SET "organizationId" = COALESCE\(\s+\(SELECT u\."organizationId" FROM "User" u\s+WHERE u\."id" = d\."userId"\s+AND \(EXISTS \(SELECT 1 FROM "User" x WHERE x\."id" = d\."managerId" AND x\."organizationId" = u\."organizationId"\)\s+OR EXISTS \(SELECT 1 FROM "OrganizationMembership" y WHERE y\."userId" = d\."managerId" AND y\."organizationId" = u\."organizationId"\)\)\),/);
    expect(place).toMatch(/\(SELECT p\."organizationId" FROM "OrganizationMembership" p\s+WHERE p\."userId" = d\."userId"[\s\S]*ORDER BY p\."organizationId"\s+LIMIT 1\)\)\s+WHERE d\."organizationId" IS NULL;/);
    expect(place).not.toMatch(/status|removedAt|deletedAt/);
  });

  it("copies each dotted line into every other workspace where both hold a row, keeping its note, weight, dates and age", () => {
    const copy = ONCE.slice(at('INSERT INTO "UserDottedLine"'), at("WITH stranded AS"));
    expect(copy).toMatch(/INSERT INTO "UserDottedLine" \("id", "userId", "managerId", "organizationId", "role", "weight", "startDate", "endDate", "createdAt", "updatedAt"\)\s+SELECT 'deploy-dotted-' \|\| d\."id" \|\| '-' \|\| w\."organizationId", d\."userId", d\."managerId", w\."organizationId",\s+d\."role", d\."weight", d\."startDate", d\."endDate", d\."createdAt", \(now\(\) AT TIME ZONE 'UTC'\)/);
    // The person's workspaces: anchored, and every membership.
    expect(copy).toMatch(/JOIN \(SELECT u\."id" AS "userId", u\."organizationId" FROM "User" u\s+UNION\s+SELECT p\."userId", p\."organizationId" FROM "OrganizationMembership" p\) w ON w\."userId" = d\."userId"/);
    expect(copy).toMatch(/WHERE d\."organizationId" IS NOT NULL\s+AND w\."organizationId" <> d\."organizationId"\s+AND \(EXISTS \(SELECT 1 FROM "User" x WHERE x\."id" = d\."managerId" AND x\."organizationId" = w\."organizationId"\)\s+OR EXISTS \(SELECT 1 FROM "OrganizationMembership" y WHERE y\."userId" = d\."managerId" AND y\."organizationId" = w\."organizationId"\)\)\s+ON CONFLICT \("id"\) DO NOTHING;/);
    expect(copy).not.toMatch(/status|removedAt|deletedAt/);
  });

  it("removes only the dotted lines no workspace reads, each carried in an Audit row in the person's anchored workspace, in the same statement", () => {
    const strand = ONCE.slice(at("WITH stranded AS"), at("ALTER TABLE"));
    expect(strand).toMatch(/WITH stranded AS \(\s+DELETE FROM "UserDottedLine" d\s+WHERE d\."organizationId" IS NULL\s+RETURNING d\."id", d\."userId", d\."managerId", d\."role", d\."weight", d\."startDate", d\."endDate", d\."createdAt"\s+\)\s+INSERT INTO "ActivityLog"/);
    expect(strand).toMatch(/SELECT 'deploy-dotted-removed-' \|\| s\."id", 'reporting_line_changed', NULL, 'system', u\."organizationId",/);
    expect(strand).toMatch(/s\."userId", 'user', 'info',\s+jsonb_build_object\('dottedManagerId', s\."managerId"\),\s+jsonb_build_object\('dottedManagerId', NULL\),/);
    // It carries the line: the manager, the note, the weight, both dates, its age.
    expect(strand).toMatch(/'managerId', s\."managerId", 'note', s\."role", 'weight', s\."weight", 'startDate', s\."startDate", 'endDate', s\."endDate", 'createdAt', s\."createdAt"\)/);
    expect(strand).toMatch(/FROM stranded s\s+JOIN "User" u ON u\."id" = s\."userId"\s+ON CONFLICT \("id"\) DO NOTHING;/);
    // The only delete in the file, and the two inserts into the Audit log beside the one of the copies.
    expect(BODY.match(/DELETE FROM/g)).toHaveLength(1);
    expect(BODY.match(/DELETE /g)).toHaveLength(3); // that one, and the two keys' ON DELETE
    expect(BODY.match(/INSERT INTO "ActivityLog"/g)).toHaveLength(2);
    expect(BODY.match(/INSERT INTO/g)).toHaveLength(3);
    expect(BODY).not.toMatch(/TRUNCATE|DROP TABLE|DROP COLUMN|DROP CONSTRAINT/);
    // The one DROP is the old unique, replaced in the same step.
    expect(BODY.match(/DROP /g)).toHaveLength(1);
  });

  it("adds the two keys last, NOT VALID, then validates each only while it is not yet", () => {
    const keys = BODY.slice(BODY.indexOf(`COMMENT ON COLUMN "OrganizationMembership"."managerId"`));
    // After the one-time step: nothing in it names a key.
    expect(BODY.indexOf("OrganizationMembership_managerId_fkey")).toBeGreaterThan(BODY.indexOf(`COMMENT ON COLUMN "OrganizationMembership"."managerId"`));
    expect(BODY.indexOf("UserDottedLine_organizationId_fkey")).toBeGreaterThan(BODY.indexOf(`COMMENT ON COLUMN "OrganizationMembership"."managerId"`));
    expect(keys).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationMembership_managerId_fkey' AND conrelid = '"OrganizationMembership"'::regclass\) THEN\s+ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_managerId_fkey"\s+FOREIGN KEY \("managerId"\) REFERENCES "User"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;/);
    expect(keys).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'UserDottedLine_organizationId_fkey' AND conrelid = '"UserDottedLine"'::regclass\) THEN\s+ALTER TABLE "UserDottedLine" ADD CONSTRAINT "UserDottedLine_organizationId_fkey"\s+FOREIGN KEY \("organizationId"\) REFERENCES "Organization"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;/);
    for (const [name, table] of [["OrganizationMembership_managerId_fkey", "OrganizationMembership"], ["UserDottedLine_organizationId_fkey", "UserDottedLine"]]) {
      expect(keys).toContain(`IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}' AND conrelid = '"${table}"'::regclass AND NOT convalidated) THEN\n    ALTER TABLE "${table}" VALIDATE CONSTRAINT "${name}";`);
      expect(keys.indexOf(`VALIDATE CONSTRAINT "${name}"`)).toBeGreaterThan(keys.indexOf(`ADD CONSTRAINT "${name}"`));
    }
    expect(BODY.match(/REFERENCES/g)).toHaveLength(2);
  });

  it("says in its header what it does, in order, why, the rules of the step and their records, where the marker lives, why it is here, and goes before the code", () => {
    for (const words of [
      "WHAT THIS FILE DOES, in order",
      `ONE-TIME, marker ${MARKER} on the comment of "OrganizationMembership"."managerId"`,
      "WHY.",
      "THE MEMBERSHIP LINES, (i).",
      "in ANY state, and is not the person",
      "THE ACCOUNT LINES, (ii).",
      "holds NO row in the anchored workspace",
      "a description naming nobody",
      "THE DOTTED LINES, (iii).",
      "otherwise the first qualifying one by id",
      "A line that qualifies nowhere is removed",
      "NOBODY'S MANAGER CHANGES ON THE DEPLOY",
      "CATALOGUE-GUARDED.",
      "THE KEYS COME LAST, added NOT VALID and then validated",
      "APPLY THIS FILE BEFORE THE CODE",
      `MUST KEEP the text ${MARKER}`,
      "WHY THE DATA STEP IS HERE AND NOT IN scripts/",
      // The step 1 review H1: what the release before loses in the window, and what to do.
      "THE WINDOW: FROM THIS FILE TO THE NEW RELEASE'S FIRST REQUEST",
      "the switcher, an end that moves the account (D3), a restore that moves it (D6), the sign-in and session repair (D7), an invitation joined with an existing account, and the hard delete's move home",
      "its handover (a manager deactivated or removed) plans from and moves account lines only",
      "a membership it makes gets no copy of the account's line",
      "RIGHT AFTER EVERY DEPLOY OF THIS RELEASE, run prisma/sql/after-deploy/2026-11-03-workspace-lines-window-check.sql",
      "prisma/sql/after-deploy/2026-11-03-workspace-lines-window-recovery.sql",
      "A DEPLOY THAT STOPS AFTER THIS FILE",
      "redeploy at once, then run the check and the recovery",
      // L1 and L2.
      "what keeps it short is its place",
      "a second guard only this step changes",
      "It deletes nothing but the dotted lines no workspace reads, and each one leaves an Audit row that carries it.",
    ]) {
      expect(HEADER).toContain(words);
    }
    expect(SQL).not.toMatch(/—|–|--/);
  });

  it("says how to roll back: the account lines from their audit rows, the copies deleted, the removed lines re-inserted, the columns dropped, the old unique restored", () => {
    const rollback = HEADER.slice(HEADER.indexOf("Rollback:"));
    const steps = [
      `DROP TABLE IF EXISTS "_deploy_lines_2026_11_03_accounts"; DROP TABLE IF EXISTS "_deploy_lines_2026_11_03_dotted";`,
      `UPDATE "User" u SET "managerId" = a."oldValue" ->> 'managerId' FROM "ActivityLog" a WHERE a."id" = 'deploy-line-cleared-' || u."id"`,
      `DELETE FROM "UserDottedLine" WHERE "id" LIKE 'deploy-dotted-%';`,
      `INSERT INTO "UserDottedLine" ("id", "userId", "managerId", "organizationId", "role", "weight", "startDate", "endDate", "createdAt", "updatedAt") SELECT substr(a."id", 23), a."targetId", a."metadata" ->> 'managerId'`,
      `WHERE a."id" LIKE 'deploy-dotted-removed-%'`,
      // L3: the re-insert never fails on the new unique, and the audit rows it consumed go, so a later apply writes its own.
      `ON CONFLICT DO NOTHING;`,
      `DELETE FROM "ActivityLog" WHERE "id" LIKE 'deploy-line-cleared-%' OR "id" LIKE 'deploy-dotted-removed-%';`,
      `ALTER TABLE "UserDottedLine" DROP COLUMN IF EXISTS "organizationId";`,
      `ALTER TABLE "OrganizationMembership" DROP COLUMN IF EXISTS "managerId";`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "UserDottedLine_userId_managerId_key" ON "UserDottedLine"("userId", "managerId")`,
    ];
    const where = steps.map((s) => rollback.indexOf(s));
    expect(where.every((i) => i >= 0), JSON.stringify(where)).toBe(true);
    expect(where).toEqual([...where].sort((a, b) => a - b));
    expect(rollback).not.toContain(`'deploy-dotted-removed-%' AND EXISTS (SELECT 1 FROM "User" x WHERE x."id" = a."targetId") AND EXISTS (SELECT 1 FROM "User" y WHERE y."id" = a."metadata" ->> 'managerId') ON CONFLICT ("id")`);
    expect(rollback).toContain("A line set in one workspace after the deploy, or moved by a swap since");
    // The re-insert reads the id the removal's audit row was given: "deploy-dotted-removed-" is 22 characters.
    expect("deploy-dotted-removed-".length + 1).toBe(23);
  });

  it("is listed in SQL_MANIFEST once, after the membership status file and followed only by the week rows file, with its README row", () => {
    const manifest = read("scripts/deploy-migrations.mjs");
    const block = (/const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(manifest)?.[1] ?? "").replace(/\/\/[^\n]*/g, "");
    const files = [...block.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    // The final review (security M1) adds the week rows per workspace after it.
    expect(files[files.length - 2]).toBe(FILE);
    expect(files.filter((f) => f === FILE)).toHaveLength(1);
    expect(files.slice(-3)).toEqual(["2026-11-01-membership-status.sql", FILE, "2026-11-04-week-rows-per-workspace.sql"]);
    const row = new RegExp(`^\\| \`${FILE}\` \\| A person's manager and dotted lines in each workspace .* \\| \\*\\*pending\\*\\* \\|$`, "m").exec(read("prisma/sql/README.md"))?.[0] ?? "";
    expect(row).not.toBe("");
    expect(row).toContain(`a later \`COMMENT ON\` that column must keep the text \`${MARKER}\``);
    expect(row).toContain("Ships with steps 2 to 4 of the plan, never alone");
    expect(row).toContain("each with its record");
    const comment = /\/\/ A person's manager and dotted lines in each workspace[\s\S]*?"2026-11-03-workspace-lines\.sql"/.exec(manifest)?.[0] ?? "";
    for (const words of [MARKER, "ON DELETE SET NULL", "ON DELETE CASCADE", "BEFORE\n  // THE RELOAD"]) expect(comment).toContain(words);
  });

  it("is declared in the Prisma schema: the membership's manager key (SET NULL) and index, the dotted line's workspace (cascade), its unique and indexes", () => {
    const schema = read("prisma/schema.prisma");
    const membership = /^model OrganizationMembership \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
    expect(membership).toMatch(/^\s+managerId\s+String\?\s*$/m);
    expect(membership).toMatch(/^\s+manager\s+User\?\s+@relation\("MembershipManager", fields: \[managerId\], references: \[id\], onDelete: SetNull\)\s*$/m);
    expect(membership).toMatch(/^\s+@@index\(\[managerId, organizationId\]\)\s*$/m);
    expect(membership).toContain(`prisma/sql/${FILE}`);
    const user = /^model User \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
    expect(user).toMatch(/^\s+membershipReports\s+OrganizationMembership\[\]\s+@relation\("MembershipManager"\)\s*$/m);
    const dotted = /^model UserDottedLine \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
    expect(dotted).toMatch(/^\s+organizationId\s+String\s*$/m);
    expect(dotted).toMatch(/^\s+organization\s+Organization\s+@relation\(fields: \[organizationId\], references: \[id\], onDelete: Cascade\)\s*$/m);
    expect(dotted).toMatch(/^\s+@@unique\(\[userId, managerId, organizationId\]\)\s*$/m);
    expect(dotted).not.toMatch(/@@unique\(\[userId, managerId\]\)/);
    expect(dotted).toMatch(/^\s+@@index\(\[organizationId, managerId\]\)\s*$/m);
    expect(dotted).toMatch(/^\s+@@index\(\[organizationId, userId\]\)\s*$/m);
    expect(dotted).toContain(`prisma/sql/${FILE}`);
  });
});

describe("scripts/check-schema-sql.mjs with the workspace lines file", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "workspace-lines-sql-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("rejects the same tree without this file in the manifest, naming both columns", () => {
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
    expect(r.stderr).toMatch(/OrganizationMembership\.managerId/);
    expect(r.stderr).toMatch(/UserDottedLine\.organizationId/);
  });

  it("accepts the tree with it", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/check-schema-sql.mjs")], { cwd: ROOT, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
