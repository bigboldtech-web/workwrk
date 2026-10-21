// The holds a workspace's sign-in policy puts on an account there, decided in
// ONE place (docs/plans/mcp-server.md 3.4 step 4, 3.8 steps 9 and 10).
//
// Extracted from the session revalidation in src/lib/auth.ts, which calls it
// unchanged, so a session and an AI app's connection are held by exactly the
// same rules:
//   - mfaHold: the workspace requires two step verification of this
//     person's role and they have not set it up (security-policy.ts
//     mfaRequiredFor), the proxy's mfa_required;
//   - passwordHold: the password is past the workspace's maximum age, the
//     proxy's password_expired (a password with no recorded change date is
//     never held). Null when the workspace's settings could not be read:
//     the session keeps what it had;
//   - signedOutEveryoneAt: Workspace settings > Security > Sign everyone
//     out, as milliseconds, or null: anything signed in (or consented)
//     before it ends;
//   - the session windows, refreshed with the same read.
//
// Pure.

import type { OrgRole } from "@/lib/access/types";
import { mfaRequiredFor, passwordAgeOf, passwordMaxAgeDaysOf } from "@/lib/auth/security-policy";
import { settingsKey } from "@/lib/org-settings-write";
import { signInPolicyOf } from "@/lib/settings/org-policy";

export interface AccountForHolds {
  mfaEnabled: boolean;
  passwordChangedAt: Date | string | null;
}

export interface AccountHolds {
  mfaHold: boolean;
  signedOutEveryoneAt: number | null;
  /** Null when the workspace row could not be read (the session keeps its windows and password hold). */
  policy: { sessionIdleMinutes: number; sessionMaxDays: number; passwordHold: boolean } | null;
}

/**
 * The holds on `account` acting with `orgRole` (the four-role word for the
 * level it holds there, src/lib/access/org-role.ts) in a workspace whose row
 * is `org` (null when it could not be read).
 */
export function accountHolds(
  account: AccountForHolds,
  orgRole: OrgRole,
  org: { settings: unknown } | null,
  now: Date = new Date(),
): AccountHolds {
  const mfaHold = !account.mfaEnabled && mfaRequiredFor(org?.settings, orgRole);
  const stamp = Date.parse(String(settingsKey(org?.settings, "security").signedOutEveryoneAt ?? ""));
  const signedOutEveryoneAt = Number.isFinite(stamp) ? stamp : null;
  if (!org) return { mfaHold, signedOutEveryoneAt, policy: null };
  const p = signInPolicyOf(org.settings);
  return {
    mfaHold,
    signedOutEveryoneAt,
    policy: {
      sessionIdleMinutes: p.sessionIdleMinutes,
      sessionMaxDays: p.sessionMaxDays,
      passwordHold: passwordAgeOf(account.passwordChangedAt, passwordMaxAgeDaysOf(org.settings), now).kind === "expired",
    },
  };
}

/** Is anything holding this account here (the consent and the bearer check refuse a held one)? */
export function heldBy(h: AccountHolds): "mfa" | "password" | null {
  if (h.mfaHold) return "mfa";
  if (h.policy?.passwordHold) return "password";
  return null;
}
