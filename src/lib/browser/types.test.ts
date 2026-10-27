// The words the computer writes are the words its tables take
// (src/lib/browser/types.ts against prisma/sql/2026-10-11-ai-teammates-phase4.sql):
// every status, end reason, step kind, outcome and provider the code can
// write passes the table's CHECK, and the partial unique index of one live
// browser per person counts exactly the live statuses. Worst case of drift:
// a write the database refuses at the moment a browser should end.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BROWSER_PROVIDERS, END_HOLDS, END_REASONS, HELD_END_REASONS, LIVE_STATUSES, SESSION_STATUSES, STEP_KINDS, STEP_OUTCOMES } from "./types";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SQL = readFileSync(path.join(ROOT, "prisma/sql/2026-10-11-ai-teammates-phase4.sql"), "utf8").replace(/--[^\n]*/g, "");

/** The quoted words of the first `"<column>" IN (...)` after `after`. */
function listIn(column: string, after: string): string[] {
  const from = SQL.indexOf(after);
  expect(from, after).toBeGreaterThanOrEqual(0);
  const m = new RegExp(`"${column}"\\s+IN\\s*\\(([^)]*)\\)`).exec(SQL.slice(from));
  expect(m, `${column} after ${after}`).not.toBeNull();
  return [...(m?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("the computer's words and its tables", () => {
  it("are the same lists", () => {
    // The providers' list is the browser host's file's (below); the Phase 4 file keeps its own.
    expect(listIn("provider", "TeammateBrowserSession_values_check")).toEqual(["browserbase", "stand-in"]);
    expect(listIn("status", "TeammateBrowserSession_values_check")).toEqual([...SESSION_STATUSES]);
    expect(listIn("endReason", "TeammateBrowserSession_values_check")).toEqual([...END_REASONS]);
    expect(listIn("kind", "TeammateBrowserStep_values_check")).toEqual([...STEP_KINDS]);
    expect(listIn("outcome", "TeammateBrowserStep_values_check")).toEqual([...STEP_OUTCOMES]);
    expect(listIn("status", "TeammateBrowserSession_one_live_per_person")).toEqual([...LIVE_STATUSES]);
  });

  it("cascade a browser with its workspace, its person and its teammate, and its steps and pictures with it", () => {
    for (const [table, column, target] of [
      ["TeammateBrowserPolicy", "organizationId", "Organization"],
      ["TeammateBrowserSession", "organizationId", "Organization"],
      ["TeammateBrowserSession", "userId", "User"],
      ["TeammateBrowserSession", "agentId", "Agent"],
      ["TeammateBrowserStep", "browserSessionId", "TeammateBrowserSession"],
      ["TeammateBrowserShot", "browserSessionId", "TeammateBrowserSession"],
    ]) {
      const fk = new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_${column}_fkey"\\s+FOREIGN KEY \\("${column}"\\) REFERENCES "${target}"\\("id"\\) ON DELETE CASCADE`);
      expect(SQL, `${table}.${column}`).toMatch(fk);
    }
  });

  // Review of Phase 4 step 1: with the two ADD COLUMNs in the tables' file,
  // "Agent" and "AgentAction" were held ACCESS EXCLUSIVE while that
  // transaction waited on "Organization" and "User" for its keys.
  it("keeps the two columns and the Agent CHECK in their own file, catalogue-guarded, listed before the tables' file", () => {
    const COLUMNS = readFileSync(path.join(ROOT, "prisma/sql/2026-10-11-ai-teammates-phase4-columns.sql"), "utf8").replace(/--[^\n]*/g, "");
    expect(COLUMNS).toMatch(/ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "browserSites" TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\]/);
    expect(COLUMNS).toMatch(/ALTER TABLE "AgentAction" ADD COLUMN IF NOT EXISTS "readWeb" BOOLEAN NOT NULL DEFAULT false/);
    expect(COLUMNS).toMatch(/ADD CONSTRAINT "Agent_browserSites_check" CHECK \(cardinality\("browserSites"\) <= 50\) NOT VALID/);
    expect(COLUMNS.replace(/DO \$\$[\s\S]*?\$\$;/g, "").trim()).toBe("");
    expect(COLUMNS).toMatch(/pg_attribute[\s\S]*attname = 'browserSites'/);
    expect(COLUMNS).toMatch(/pg_attribute[\s\S]*attname = 'readWeb'/);
    expect(COLUMNS).toMatch(/pg_constraint WHERE conname = 'Agent_browserSites_check'/);
    // The tables' file alters neither table.
    expect(SQL).not.toMatch(/ADD COLUMN/);
    expect(SQL).not.toMatch(/Agent_browserSites_check/);
    expect(SQL).not.toMatch(/ALTER TABLE "Agent"\s/);
    expect(SQL).not.toMatch(/ALTER TABLE "AgentAction"/);
    // The manifest runs the columns first (read as text: the script runs on import). The runner also tries a deadlock again.
    const manifest = readFileSync(path.join(ROOT, "scripts/deploy-migrations.mjs"), "utf8");
    const at = (name: string) => manifest.indexOf(`"${name}",`);
    expect(at("2026-10-11-ai-teammates-phase4-columns.sql")).toBeGreaterThan(0);
    expect(at("2026-10-11-ai-teammates-phase4-columns.sql")).toBeLessThan(at("2026-10-11-ai-teammates-phase4.sql"));
    expect(manifest).toMatch(/lock timeout\|55P03\|deadlock detected\|40P01/);
  });

  it("guards every statement after the new tables by the catalogue, so a later deploy takes no lock", () => {
    // Each index, column, key and check is behind IF NOT EXISTS (SELECT ... ) in a DO block.
    const outsideDo = SQL.replace(/DO \$\$[\s\S]*?\$\$;/g, "");
    expect(outsideDo).not.toMatch(/CREATE (UNIQUE )?INDEX/);
    expect(outsideDo).not.toMatch(/ALTER TABLE/);
    expect((SQL.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length).toBe(4);
  });
});

// Review round 4 of Phase 4: whether an end holds for the rest of its answer, decided for every end there is.
describe("which ends hold for their answer", () => {
  it("classifies every end reason, and lists the held ones in the same order", () => {
    expect(Object.keys(END_HOLDS).sort()).toEqual([...END_REASONS].sort());
    expect([...HELD_END_REASONS]).toEqual(END_REASONS.filter((r) => END_HOLDS[r]));
    // The person's Stop, an Owner or Admin's Stop every browser and the switch hold; the system's ends do not.
    expect([END_HOLDS.stopped, END_HOLDS.admin_stopped, END_HOLDS.turned_off]).toEqual([true, true, true]);
    expect([END_HOLDS.idle, END_HOLDS.provider_ended, END_HOLDS.restarted, END_HOLDS.start_failed]).toEqual([false, false, false, false]);
  });
});

// docs/plans/browser-host.md section 2 (Decision 16): the session CHECK gains
// the provider "workwrk", replaced under its own name NOT VALID, validated in
// a file of its own. Fails on the code before it: the files are missing.
/**
 * The body of the ADD of "TeammateBrowserSession_values_check" in `sql`: from
 * its CHECK's opening parenthesis to the one that closes it, white space read
 * as one space.
 */
function checkBody(sql: string): string {
  const at = sql.indexOf('ADD CONSTRAINT "TeammateBrowserSession_values_check" CHECK (');
  expect(at, "the CHECK's ADD").toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("(", sql.indexOf("CHECK (", at));
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")" && --depth === 0) return sql.slice(open + 1, i).replace(/\s+/g, " ").trim();
  }
  throw new Error("the CHECK never closes");
}

describe("the browser host's provider CHECK (browser-host.md section 2)", () => {
  const read = (name: string) => readFileSync(path.join(ROOT, "prisma/sql", name), "utf8").replace(/--[^\n]*/g, "");
  const HOST_FILE = "2026-10-20-browser-host-provider.sql";
  const VALIDATE_FILE = "2026-10-20-browser-host-provider-validate.sql";

  /** The quoted words of the first `"<column>" IN (...)` in `sql`. */
  const listOf = (sql: string, column: string) => {
    const m = new RegExp(`"${column}"\\s+IN\\s*\\(([^)]*)\\)`).exec(sql);
    expect(m, column).not.toBeNull();
    return [...(m?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  it("holds the providers the code can write, and the Phase 4 file's statuses and end reasons", () => {
    const sql = read(HOST_FILE);
    expect(listOf(sql, "provider")).toEqual([...BROWSER_PROVIDERS]);
    expect(BROWSER_PROVIDERS).toContain("workwrk");
    expect(listOf(sql, "status")).toEqual(listIn("status", "TeammateBrowserSession_values_check"));
    expect(listOf(sql, "endReason")).toEqual(listIn("endReason", "TeammateBrowserSession_values_check"));
    expect(listOf(sql, "status")).toEqual([...SESSION_STATUSES]);
    expect(listOf(sql, "endReason")).toEqual([...END_REASONS]);
    // The whole CHECK word for word but its provider list, so nothing it held
    // is lost (review of browser-host step 4, L10: before, only up to the
    // first parenthesis was compared).
    const phase4 = checkBody(SQL);
    const host = checkBody(sql);
    expect(phase4).toContain(`"provider" IN ('browserbase', 'stand-in') AND "status" IN`);
    expect(host).toContain(`"provider" IN ('browserbase', 'stand-in', 'workwrk') AND "status" IN`);
    expect(host.replace(/"provider" IN \([^)]*\)/, "PROVIDERS")).toBe(phase4.replace(/"provider" IN \([^)]*\)/, "PROVIDERS"));
    for (const rule of ['"reservedMinutes" BETWEEN 1 AND 120', '("billedMinutes" IS NULL OR "billedMinutes" >= 0)', '"stopAttempts" >= 0', '"endsBy" > "startedAt"']) expect(host).toContain(rule);
  });

  it("reads a CHECK's whole body, to its own closing parenthesis", () => {
    const body = checkBody(`ALTER TABLE "TeammateBrowserSession" ADD CONSTRAINT "TeammateBrowserSession_values_check" CHECK (
      "a" IN ('x') AND ("b" IS NULL OR "b" >= 0)
      AND "c" > "d"
    ) NOT VALID;`);
    expect(body).toBe(`"a" IN ('x') AND ("b" IS NULL OR "b" >= 0) AND "c" > "d"`);
  });

  it("replaces the CHECK under its own name, guarded on its definition, NOT VALID, and validates it in its own file", () => {
    const sql = read(HOST_FILE);
    const validate = read(VALIDATE_FILE);
    // Wholly inside catalogue-guarded DO blocks.
    for (const f of [sql, validate]) {
      expect(f.replace(/DO \$\$[\s\S]*?\$\$;/g, "").trim()).toBe("");
      expect(f).toMatch(/pg_constraint[\s\S]*conname = 'TeammateBrowserSession_values_check'/);
    }
    expect(sql).toMatch(/pg_get_constraintdef\(oid\) LIKE '%''workwrk''%'/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS "TeammateBrowserSession_values_check"/);
    expect(sql).toMatch(/ADD CONSTRAINT "TeammateBrowserSession_values_check" CHECK \([\s\S]*\) NOT VALID;/);
    expect(sql).not.toMatch(/VALIDATE CONSTRAINT/);
    expect(validate).toMatch(/AND NOT convalidated/);
    expect(validate).toMatch(/VALIDATE CONSTRAINT "TeammateBrowserSession_values_check"/);
    expect(validate).not.toMatch(/ADD CONSTRAINT|DROP CONSTRAINT/);
    // The manifest lists both last, the validate file after the other (read as text: the script runs on import).
    const manifest = readFileSync(path.join(ROOT, "scripts/deploy-migrations.mjs"), "utf8");
    const at = (name: string) => manifest.indexOf(`"${name}",`);
    expect(at(HOST_FILE)).toBeGreaterThan(at("2026-10-17-ai-teammates-phase5-step1-fixes.sql"));
    expect(at(VALIDATE_FILE)).toBeGreaterThan(at(HOST_FILE));
    // After them only the MCP server's tables (docs/plans/mcp-server.md section 5)
    // the ended sessions (src/lib/auth/ended-sessions.ts) and recurring goals
    // (docs/plans/recurring-goals.md section 3).
    expect(manifest.slice(at(VALIDATE_FILE)).match(/"[^"]+\.sql",/g)).toEqual([`"${VALIDATE_FILE}",`, `"2026-10-21-mcp-server.sql",`, `"2026-10-22-ended-sessions.sql",`, `"2026-10-27-recurring-goals.sql",`]);
    // The schema's comment names every provider.
    expect(readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")).toContain('/// "browserbase" | "stand-in" | "workwrk"\n  provider          String');
  });
});
