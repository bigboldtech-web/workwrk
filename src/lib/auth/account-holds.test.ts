// The holds, decided in one place (docs/plans/mcp-server.md 3.4 consent step
// 4, 3.8 steps 9 and 10, step 1 tests "account-holds: matches auth.ts"). The
// session revalidation in src/lib/auth.ts calls accountHolds, and its answer
// equals the rule the revalidation wrote inline before, on every case below.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { orgRoleOfMembership } from "@/lib/access/org-role";
import { mfaRequiredFor, passwordAgeOf, passwordMaxAgeDaysOf } from "@/lib/auth/security-policy";
import { settingsKey } from "@/lib/org-settings-write";
import { signInPolicyOf } from "@/lib/settings/org-policy";
import { accountHolds, heldBy } from "./account-holds";

const NOW = new Date("2026-10-21T12:00:00Z");

/** The revalidation's inline rule as auth.ts wrote it before the extraction (lines 760 to 781); orgRoleOfMembership is orgRoleOf on the level. */
function inlineRule(account: { mfaEnabled: boolean; passwordChangedAt: Date | null }, level: string, holdOrg: { settings: unknown } | null) {
  const mfaHold = !account.mfaEnabled && mfaRequiredFor(holdOrg?.settings, orgRoleOfMembership(level));
  const signedOutAt = Date.parse(String(settingsKey(holdOrg?.settings, "security").signedOutEveryoneAt ?? ""));
  const policy = holdOrg
    ? {
        sessionIdleMinutes: signInPolicyOf(holdOrg.settings).sessionIdleMinutes,
        sessionMaxDays: signInPolicyOf(holdOrg.settings).sessionMaxDays,
        passwordHold: passwordAgeOf(account.passwordChangedAt, passwordMaxAgeDaysOf(holdOrg.settings), NOW).kind === "expired",
      }
    : null;
  return { mfaHold, signedOutEveryoneAt: Number.isFinite(signedOutAt) ? signedOutAt : null, policy };
}

const ORGS: Array<{ settings: unknown } | null> = [
  null,
  { settings: {} },
  { settings: { security: { mfaRequired: "admins" } } },
  { settings: { security: { mfaRequired: "everyone", passwordMaxAgeDays: 30, sessionIdleMinutes: 60, sessionMaxDays: 7 } } },
  { settings: { security: { signedOutEveryoneAt: "2026-10-20T10:00:00.000Z", passwordMaxAgeDays: 400 } } },
  { settings: { security: { signedOutEveryoneAt: "not a date" } } },
];
const ACCOUNTS = [
  { mfaEnabled: false, passwordChangedAt: null },
  { mfaEnabled: true, passwordChangedAt: new Date("2026-01-01T00:00:00Z") },
  { mfaEnabled: false, passwordChangedAt: new Date("2026-10-15T00:00:00Z") },
];
const LEVELS = ["EMPLOYEE", "COMPANY_ADMIN", "SUPER_ADMIN", "GUEST"];

describe("accountHolds", () => {
  it("answers exactly what the revalidation's inline rule answered, on every case", () => {
    for (const org of ORGS) for (const account of ACCOUNTS) for (const level of LEVELS) {
      expect(accountHolds(account, orgRoleOfMembership(level), org, NOW), JSON.stringify({ org, account, level })).toEqual(inlineRule(account, level, org));
    }
  });

  it("holds an unenrolled Admin where Admins need two step verification, and an expired password", () => {
    const admins = { settings: { security: { mfaRequired: "admins", passwordMaxAgeDays: 30 } } };
    expect(heldBy(accountHolds({ mfaEnabled: false, passwordChangedAt: null }, "ADMIN", admins, NOW))).toBe("mfa");
    expect(heldBy(accountHolds({ mfaEnabled: false, passwordChangedAt: null }, "MEMBER", admins, NOW))).toBeNull();
    expect(heldBy(accountHolds({ mfaEnabled: true, passwordChangedAt: new Date("2026-01-01T00:00:00Z") }, "MEMBER", admins, NOW))).toBe("password");
    expect(accountHolds({ mfaEnabled: true, passwordChangedAt: null }, "MEMBER", { settings: { security: { signedOutEveryoneAt: "2026-10-20T10:00:00.000Z" } } }, NOW).signedOutEveryoneAt).toBe(
      Date.parse("2026-10-20T10:00:00.000Z"),
    );
  });

  it("is what src/lib/auth.ts's revalidation calls, with no copy of the rule left inline", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/auth.ts"), "utf8");
    expect(src).toContain('import { accountHolds } from "@/lib/auth/account-holds"');
    expect(src).toMatch(/const holds = accountHolds\(account_, orgRoleOf\(\{ accessLevel: token\.accessLevel as AccessLevel \| null \| undefined \}\), holdOrg\)/);
    expect(src).toContain("token.mfaHold = holds.mfaHold;");
    expect(src).toContain("token.passwordHold = holds.policy.passwordHold;");
    expect(src).not.toMatch(/passwordAgeOf\(/);
    expect(src).not.toMatch(/signedOutEveryoneAt \?\? ""/);
  });
});
