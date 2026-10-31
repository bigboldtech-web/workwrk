// SCIM deprovisioning of someone ANCHORED here who also belongs to another
// workspace (launch audit, 2026-10-31): their account moves there first and
// they leave only here, through the member path, never deactivated (status
// is the account's, so that switched them off in their own company). Read
// from the source: the order is the rule.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src/lib/scim-deprovision.ts"), "utf8");
const body = src.slice(src.indexOf("async function deprovision("), src.indexOf("type Gate = { kind: \"last_owner\" } | { kind: \"no_recipient\" } | { kind: \"owner\"; ownersNow: string[] } | { kind: \"member\"; recipientId: string; endLines"));

describe("an anchored person who belongs elsewhere leaves only here", () => {
  it("moves the account home under the role lock, never moving the last Owner, then takes the member path", () => {
    expect(body).toMatch(/await lockOrgRoles\(tx, organizationId\);\s*if \(await wouldRemoveLastOwner\(organizationId, userId, tx\)\) return false;\s*const to = await homeAfterRemoval\(userId, organizationId, tx\);/);
    expect(body).toMatch(/return reanchorUser\(\{ userId, to \}, tx\);/);
    expect(body).toMatch(/if \(movedHome\) return deprovisionMember\(organizationId, userId\);/);
  });

  it("does so before anything deactivates them", () => {
    expect(body.indexOf("movedHome")).toBeGreaterThan(0);
    expect(src.indexOf("if (movedHome) return deprovisionMember")).toBeLessThan(src.indexOf('data: { status: "INACTIVE", tokenVersion: { increment: 1 } }'));
  });
});
