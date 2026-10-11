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
import { BROWSER_PROVIDERS, END_REASONS, LIVE_STATUSES, SESSION_STATUSES, STEP_KINDS, STEP_OUTCOMES } from "./types";

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
    expect(listIn("provider", "TeammateBrowserSession_values_check")).toEqual([...BROWSER_PROVIDERS]);
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
