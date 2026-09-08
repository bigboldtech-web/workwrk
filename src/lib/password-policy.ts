// password-policy — enforce an organization's password rules wherever a person
// CHOOSES a password (signup, invite-accept, reset). The rules live in
// Organization.settings.security and are surfaced read-only in Settings →
// Security and Account → Security; until now nothing actually enforced them.

export type SecurityPolicy = {
  minPasswordLength?: number;
  requireUppercase?: boolean;
  requireNumbers?: boolean;
};

// The baseline every account meets, and what a brand-new org (no settings yet)
// gets. Matches the defaults the settings API seeds.
export const DEFAULT_PASSWORD_POLICY: Required<SecurityPolicy> = {
  minPasswordLength: 8,
  requireUppercase: true,
  requireNumbers: true,
};

/** Pull the security policy out of an org's `settings` JSON, with defaults. */
export function policyFromOrgSettings(settings: unknown): SecurityPolicy {
  const sec = (settings as { security?: SecurityPolicy } | null | undefined)?.security;
  return {
    minPasswordLength: sec?.minPasswordLength ?? DEFAULT_PASSWORD_POLICY.minPasswordLength,
    requireUppercase: sec?.requireUppercase ?? DEFAULT_PASSWORD_POLICY.requireUppercase,
    requireNumbers: sec?.requireNumbers ?? DEFAULT_PASSWORD_POLICY.requireNumbers,
  };
}

/**
 * Validate a candidate password against a policy. Returns a human-readable
 * error string to reject with, or `null` when the password is acceptable.
 * The minimum length is floored at 8 so a mis-set org policy can never make
 * passwords WEAKER than the old hardcoded rule.
 */
export function validatePassword(password: string, policy?: SecurityPolicy): string | null {
  const p = { ...DEFAULT_PASSWORD_POLICY, ...(policy ?? {}) };
  const min = Math.max(8, p.minPasswordLength ?? 8);
  if (!password || password.length < min) {
    return `Password must be at least ${min} characters.`;
  }
  if (p.requireUppercase && !/[A-Z]/.test(password)) {
    return "Password must include an uppercase letter.";
  }
  if (p.requireNumbers && !/[0-9]/.test(password)) {
    return "Password must include a number.";
  }
  return null;
}
