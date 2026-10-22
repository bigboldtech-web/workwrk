// The MCP server's data (docs/plans/mcp-server.md section 5): the SQL file is
// the spec's text exactly, additive and catalogue-guarded, listed last in the
// manifest (read as text: the script runs on import), and every table is a
// Prisma model with every column. Fails on the code before step 1: no file,
// no entry, no models.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FILE = "2026-10-21-mcp-server.sql";
const SQL = read(`prisma/sql/${FILE}`);
const TABLES = ["McpPolicy", "OAuthClient", "OAuthAuthorizationRequest", "OAuthGrant", "OAuthAuthorizationCode", "OAuthToken", "McpUsageDay"];

describe("prisma/sql/2026-10-21-mcp-server.sql", () => {
  it("is the spec's SQL, word for word", () => {
    const plan = read("docs/plans/mcp-server.md");
    const at = plan.indexOf("### 5.1 `prisma/sql/<build day>-mcp-server.sql`");
    const block = /```sql\n([\s\S]*?)```/.exec(plan.slice(at))?.[1] ?? "";
    expect(block.length).toBeGreaterThan(1000);
    expect(SQL).toBe(block.replace("<build day>", "2026-10-21"));
  });

  it("creates the seven tables if absent and guards every other statement on the catalogue", () => {
    for (const t of TABLES) expect(SQL, t).toContain(`CREATE TABLE IF NOT EXISTS "${t}" (`);
    const body = SQL.replace(/\/\*[\s\S]*?\*\//g, "");
    const rest = body.slice(body.lastIndexOf("CREATE TABLE IF NOT EXISTS"));
    const afterTables = rest.slice(rest.indexOf(");") + 2);
    // Only DO blocks after the tables, and inside them only guarded statements.
    expect(afterTables.replace(/DO \$\$[\s\S]*?\$\$;/g, "").trim()).toBe("");
    const creates = afterTables.match(/CREATE (UNIQUE )?INDEX|ADD CONSTRAINT/g) ?? [];
    const guards = afterTables.match(/IF NOT EXISTS \(SELECT 1 FROM pg_(indexes|constraint)/g) ?? [];
    expect(creates.length).toBe(guards.length);
    expect(SQL).toContain('CREATE UNIQUE INDEX "OAuthGrant_one_live" ON "OAuthGrant" ("clientId", "userId", "organizationId") WHERE "revokedAt" IS NULL;');
    expect(SQL).not.toMatch(/\bDROP\b(?![^*]*\*\/)/);
    // No row is read or written: no statement updates, deletes or inserts.
    expect(SQL).not.toMatch(/^\s*(UPDATE|DELETE FROM|INSERT INTO)\b/m);
  });

  it("is listed in SQL_MANIFEST once, with only the ended sessions' table after it", () => {
    const manifest = read("scripts/deploy-migrations.mjs");
    const block = (/const SQL_MANIFEST = \[([\s\S]*?)\]/.exec(manifest)?.[1] ?? "").replace(/\/\/[^\n]*/g, "");
    const files = [...block.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    // Then the ended sessions (src/lib/auth/ended-sessions.ts, 2026-10-22).
    expect(files.slice(files.indexOf(FILE))).toEqual([FILE, "2026-10-22-ended-sessions.sql"]);
    expect(files.filter((f) => f === FILE)).toHaveLength(1);
  });

  it("has a Prisma model for every table, with every column and no relation", () => {
    const schema = read("prisma/schema.prisma");
    for (const t of TABLES) {
      const model = new RegExp(`^model ${t} \\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1];
      expect(model, t).toBeTruthy();
      const table = new RegExp(`CREATE TABLE IF NOT EXISTS "${t}" \\(([\\s\\S]*?)\\n\\);`).exec(SQL)?.[1] ?? "";
      const cols = [...table.matchAll(/^\s+"(\w+)"\s/gm)].map((m) => m[1]);
      expect(cols.length, t).toBeGreaterThan(3);
      for (const c of cols) expect(model, `${t}.${c}`).toMatch(new RegExp(`^\\s+${c}\\s`, "m"));
      expect(model, t).not.toContain("@relation");
    }
    expect(schema).toContain('"OAuthGrant_one_live"');
    expect(schema).toMatch(/model McpUsageDay \{[\s\S]*?@@id\(\[grantId, day\]\)/);
  });
});
