import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 2026-11-16: two settings saved at once lost one, 12 rounds in 12, on the
// local server (a person's own List filter lost to a sidebar save). The save
// now reads, merges and writes under the row's lock. Proven against Postgres
// by firing the two saves together; this keeps the lock from being undone.

describe("setUserPreference", () => {
  const src = readFileSync("src/lib/preferences.ts", "utf8");
  const body = src.slice(src.indexOf("export async function setUserPreference"), src.indexOf("export async function setUserHomeKey"));

  it("merges into the row it has locked, in one transaction", () => {
    expect(body).toMatch(/prisma\.\$transaction\(async \(tx\) =>/);
    expect(body).toMatch(/FROM "UserPreference" WHERE "userId" = \$\{userId\} FOR UPDATE/);
    expect(body).toMatch(/tx\.userPreference\.update\(/);
  });

  it("never reads the row outside the lock", () => {
    expect(body).not.toMatch(/prisma\.userPreference\.findUnique/);
  });
});
