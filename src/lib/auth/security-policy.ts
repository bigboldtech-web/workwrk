// The org sign-in rules a signed-in person is held to, read in ONE place
// (spec-account-auth `/account/security`, the Security hold dialog and
// `/login` step 2b). Pure: the callers load Organization.settings and the
// person's own columns and pass them in.
//
// Two rules, both read from Organization.settings.security and both written
// only by Workspace settings > Security (settings unit S5, a later stage):
//
//   mfaRequired         "off" | "admins" | "everyone". Stored `true` reads as
//                       "everyone" (the spec's migrate-on-read). The legacy
//                       `twoFactorEnabled` key is NOT read: nothing ever
//                       enforced it, and honouring it now would switch a rule
//                       on under people who never chose it.
//   passwordMaxAgeDays  a whole number of days, or absent for "never".
//
// Until S5 ships no org carries either key, so every answer below is "no
// rule", which is the correct behaviour rather than a stub: the hold dialog
// never fires and the login flow never asks anyone to enrol.
//
// ENFORCE_MFA_AT_LOGIN stays the floor for people who ARE enrolled (auth.ts);
// these rules only ever add a requirement, never remove one.

import type { OrgRole } from "@/lib/access/types";

export type MfaRequirement = "off" | "admins" | "everyone";

function securityOf(settings: unknown): Record<string, unknown> {
  const s = (settings as { security?: unknown } | null | undefined)?.security;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : {};
}

export function mfaRequirementOf(settings: unknown): MfaRequirement {
  const raw = securityOf(settings).mfaRequired;
  if (raw === true || raw === "everyone") return "everyone";
  if (raw === "admins") return "admins";
  return "off";
}

/** Whether the org requires two step verification for someone with this role. */
export function mfaRequiredFor(settings: unknown, orgRole: OrgRole): boolean {
  const req = mfaRequirementOf(settings);
  if (req === "everyone") return true;
  if (req === "admins") return orgRole === "OWNER" || orgRole === "ADMIN";
  return false;
}

export function passwordMaxAgeDaysOf(settings: unknown): number | null {
  const raw = securityOf(settings).passwordMaxAgeDays;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const days = Math.floor(raw);
  return days >= 1 && days <= 3650 ? days : null;
}

export type PasswordAge =
  | { kind: "unknown" }
  | { kind: "ok"; changedAt: Date }
  | { kind: "soon"; changedAt: Date; daysLeft: number }
  | { kind: "expired"; changedAt: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Expires in N days" shows inside this window. */
export const PASSWORD_EXPIRY_WARNING_DAYS = 7;

/**
 * The password age row. A null `changedAt` is "unknown" and no rule acts on
 * it (every account made before the column existed): an expiry that fires on
 * a guess would force a change on everyone at once.
 */
export function passwordAgeOf(changedAt: Date | string | null | undefined, maxDays: number | null, now: Date = new Date()): PasswordAge {
  if (!changedAt) return { kind: "unknown" };
  const at = changedAt instanceof Date ? changedAt : new Date(changedAt);
  if (Number.isNaN(at.getTime())) return { kind: "unknown" };
  if (!maxDays) return { kind: "ok", changedAt: at };
  const expiresAt = at.getTime() + maxDays * DAY_MS;
  const left = expiresAt - now.getTime();
  if (left <= 0) return { kind: "expired", changedAt: at };
  const daysLeft = Math.ceil(left / DAY_MS);
  if (daysLeft <= PASSWORD_EXPIRY_WARNING_DAYS) return { kind: "soon", changedAt: at, daysLeft };
  return { kind: "ok", changedAt: at };
}

export type SecurityHold = "mfa" | "password" | null;

/**
 * The hold the shell raises for a signed-in person (Security hold dialog).
 * MFA first: it is the stronger rule, and changing a password does not
 * satisfy it.
 */
export function securityHoldFor(input: {
  settings: unknown;
  orgRole: OrgRole;
  mfaEnabled: boolean;
  passwordChangedAt: Date | string | null | undefined;
  now?: Date;
}): SecurityHold {
  if (mfaRequiredFor(input.settings, input.orgRole) && !input.mfaEnabled) return "mfa";
  const age = passwordAgeOf(input.passwordChangedAt, passwordMaxAgeDaysOf(input.settings), input.now);
  if (age.kind === "expired") return "password";
  return null;
}
