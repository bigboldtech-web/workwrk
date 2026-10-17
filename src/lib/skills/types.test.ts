// The words a skill writes are the words its table takes
// (src/lib/skills/types.ts against prisma/sql/2026-10-17-ai-teammates-phase5*.sql,
// docs/plans/ai-teammates-phase5.md section 2): every status and recording end
// the code can write passes the CHECK, the caps are the CHECK's numbers, the
// keys on the existing tables are NOT VALID, every index, key and check is
// catalogue-guarded, and the manifest runs the columns first, last of all.
// Read as text: scripts/deploy-migrations.mjs runs on import.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RECORDING_ENDS, SKILL_LIMITS, SKILL_STATUSES } from "./types";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const SQL = noComments(read("prisma/sql/2026-10-17-ai-teammates-phase5.sql"));
const COLUMNS = noComments(read("prisma/sql/2026-10-17-ai-teammates-phase5-columns.sql"));

/** The quoted words of the first `"<column>" IN (...)` after `after`. */
function listIn(column: string, after: string): string[] {
  const from = SQL.indexOf(after);
  expect(from, after).toBeGreaterThanOrEqual(0);
  const m = new RegExp(`"${column}"\\s+IN\\s*\\(([^)]*)\\)`).exec(SQL.slice(from));
  expect(m, `${column} after ${after}`).not.toBeNull();
  return [...(m?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("a skill's words and its table", () => {
  it("are the same lists", () => {
    expect(listIn("status", "TeammateSkill_values_check")).toEqual([...SKILL_STATUSES]);
    expect(listIn("recordingEndReason", "TeammateSkill_values_check")).toEqual([...RECORDING_ENDS]);
    // One recording a person: the partial index counts the status the code writes while recording.
    expect(SQL).toMatch(/CREATE UNIQUE INDEX "TeammateSkill_one_recording_per_person" ON "TeammateSkill" \("organizationId", "userId"\) WHERE "status" = 'recording'/);
    expect(SKILL_STATUSES).toContain("recording");
  });

  it("hold the caps the code keeps", () => {
    expect(SQL).toContain(`char_length("name") BETWEEN 1 AND ${SKILL_LIMITS.nameMax}`);
    expect(SQL).toContain(`char_length("description") <= ${SKILL_LIMITS.descriptionMax}`);
    expect(SQL).toContain(`jsonb_array_length("steps") <= ${SKILL_LIMITS.recordedStepsMax}`);
    expect(SQL).toContain(`("status" <> 'ready' OR jsonb_array_length("steps") BETWEEN 1 AND ${SKILL_LIMITS.stepsMax})`);
    expect(SQL).toContain(`cardinality("sites") <= ${SKILL_LIMITS.sitesMax}`);
    expect(SQL).toContain(`"stepCount" = jsonb_array_length("steps")`);
    expect(SQL).toMatch(/pg_column_size\("steps"\) <= 400000/);
    // The session's step pointer reaches the most steps recorded.
    expect(COLUMNS).toContain(`"skillStepAt" BETWEEN -1 AND ${SKILL_LIMITS.recordedStepsMax}`);
  });

  it("find a skill by its name case aside, one per person and teammate", () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX "TeammateSkill_userId_agentId_name_key" ON "TeammateSkill" \("userId", "agentId", lower\("name"\)\)/);
  });

  it("cascade a skill with its workspace, its person and its teammate, a routine with its skill, and let a session forget it", () => {
    for (const [table, column, target, action] of [
      ["TeammateSkill", "organizationId", "Organization", "CASCADE"],
      ["TeammateSkill", "userId", "User", "CASCADE"],
      ["TeammateSkill", "agentId", "Agent", "CASCADE"],
      ["AgentRoutine", "skillId", "TeammateSkill", "CASCADE"],
      ["TeammateBrowserSession", "skillId", "TeammateSkill", "SET NULL"],
      ["TeammateBrowserSession", "recordingSkillId", "TeammateSkill", "SET NULL"],
    ]) {
      const fk = new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_${column}_fkey"\\s+FOREIGN KEY \\("${column}"\\) REFERENCES "${target}"\\("id"\\) ON DELETE ${action} ON UPDATE CASCADE`);
      expect(SQL, `${table}.${column}`).toMatch(fk);
    }
  });

  it("adds the keys on the existing tables NOT VALID, and the new table's own as plain keys", () => {
    for (const name of ["AgentRoutine_skillId_fkey", "TeammateBrowserSession_skillId_fkey", "TeammateBrowserSession_recordingSkillId_fkey"]) {
      const at = SQL.indexOf(`ADD CONSTRAINT "${name}"`);
      expect(at, name).toBeGreaterThan(0);
      expect(SQL.slice(at, SQL.indexOf(";", at)), name).toMatch(/NOT VALID$/);
    }
    for (const name of ["TeammateSkill_organizationId_fkey", "TeammateSkill_userId_fkey", "TeammateSkill_agentId_fkey"]) {
      const at = SQL.indexOf(`ADD CONSTRAINT "${name}"`);
      expect(SQL.slice(at, SQL.indexOf(";", at)), name).not.toMatch(/NOT VALID/);
    }
    // The session CHECK on its new columns is NOT VALID too, and pairs nothing a SET NULL would break.
    expect(COLUMNS).toMatch(/ADD CONSTRAINT "TeammateBrowserSession_skill_check" CHECK \([\s\S]*?\) NOT VALID;/);
    expect(COLUMNS).not.toMatch(/"skillId" IS NULL\s*=|"skillId" IS NOT NULL/);
  });

  it("guards every index, key and check by the catalogue, so a later deploy takes no lock", () => {
    const outsideDo = SQL.replace(/DO \$\$[\s\S]*?\$\$;/g, "");
    expect(outsideDo).not.toMatch(/CREATE (UNIQUE )?INDEX/);
    expect(outsideDo).not.toMatch(/ALTER TABLE/);
    expect((SQL.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length).toBe(1);
    // Each statement inside the blocks sits behind its own IF NOT EXISTS (SELECT ...): as many guards as statements.
    const statements = (SQL.match(/CREATE (UNIQUE )?INDEX|ADD CONSTRAINT/g) ?? []).length;
    const guards = (SQL.match(/IF NOT EXISTS \(SELECT 1 FROM pg_(indexes|constraint) WHERE/g) ?? []).length;
    expect(statements).toBe(14);
    expect(guards).toBe(statements);
    // The table's own times are UTC, as Prisma writes them.
    expect(SQL).toMatch(/"createdAt"\s+TIMESTAMP\(3\) NOT NULL DEFAULT \(now\(\) AT TIME ZONE 'UTC'\)/);
    expect(SQL).toMatch(/"updatedAt"\s+TIMESTAMP\(3\) NOT NULL DEFAULT \(now\(\) AT TIME ZONE 'UTC'\)/);
  });

  it("keeps the columns in their own file, each ADD COLUMN behind pg_attribute, and alters no existing table in the tables' file", () => {
    expect(COLUMNS.replace(/DO \$\$[\s\S]*?\$\$;/g, "").trim()).toBe("");
    for (const [table, column, type] of [
      ["TeammateBrowserPolicy", "skillsEnabled", "BOOLEAN NOT NULL DEFAULT false"],
      ["TeammateBrowserSession", "skillId", "TEXT"],
      ["TeammateBrowserSession", "skillVersion", "INTEGER"],
      ["TeammateBrowserSession", "skillStepAt", "INTEGER"],
      ["TeammateBrowserSession", "recordingSkillId", "TEXT"],
      ["AgentRoutine", "skillId", "TEXT"],
    ]) {
      expect(COLUMNS, `${table}.${column}`).toMatch(new RegExp(`attrelid = '"${table}"'::regclass AND attname = '${column}' AND NOT attisdropped\\) THEN\\s+ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type};`));
    }
    expect(COLUMNS).toMatch(/pg_constraint WHERE conname = 'TeammateBrowserSession_skill_check'/);
    expect(SQL).not.toMatch(/ADD COLUMN/);
  });

  it("is listed last in the manifest, the columns before the table (read as text: the script runs on import)", () => {
    const manifest = read("scripts/deploy-migrations.mjs");
    const block = (/const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(manifest)?.[1] ?? "").replace(/\/\/[^\n]*/g, "");
    const files = [...block.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    expect(files.slice(-2)).toEqual(["2026-10-17-ai-teammates-phase5-columns.sql", "2026-10-17-ai-teammates-phase5.sql"]);
    expect(new Set(files).size).toBe(files.length);
  });

  it("is declared in the Prisma schema, the indexes it cannot express named in a comment", () => {
    const schema = read("prisma/schema.prisma");
    const model = /^model TeammateSkill \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
    for (const col of ["organizationId", "userId", "agentId", "name", "description", "status", "version", "steps", "stepCount", "sites", "startUrl", "recordingSessionId", "recordingFull", "recordingEndedAt", "recordingEndReason", "orphanedAt", "lastRunAt", "runCount", "createdAt", "updatedAt"]) {
      expect(model, col).toMatch(new RegExp(`\\n\\s+${col}\\s`));
    }
    // No relation fields: the keys live in the SQL (Phase 1's convention).
    expect(model).not.toMatch(/@relation/);
    expect(schema).toMatch(/skillsEnabled\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/recordingSkillId\s+String\?/);
  });
});
