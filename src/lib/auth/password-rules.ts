// The live rule checklist under every place a person chooses a password
// (spec-account-auth `PasswordField`, B8): /signup, /join, /reset-password
// and the Change password dialog. The rules shown are EXACTLY the rules
// src/lib/password-policy.ts validatePassword enforces on the server, from
// the same policy object, so the page can never promise a rule the server
// does not check or hide one it does (a test holds the two together).
//
// Pure and client-safe: password-policy.ts has no imports.

import { DEFAULT_PASSWORD_POLICY, type SecurityPolicy, validatePassword } from "@/lib/password-policy";

/** What GET /api/auth/password-policy returns: the policy as the checklist needs it. */
export interface PasswordPolicyView {
  minLength: number;
  requireUppercase: boolean;
  requireNumbers: boolean;
}

export interface PasswordRule {
  key: "length" | "uppercase" | "number";
  label: string;
  met: boolean;
}

export function policyView(policy?: SecurityPolicy | null): PasswordPolicyView {
  const p = { ...DEFAULT_PASSWORD_POLICY, ...(policy ?? {}) };
  return {
    // The same floor validatePassword applies: a policy can never go below 8.
    minLength: Math.max(8, Number.isFinite(p.minPasswordLength) ? Number(p.minPasswordLength) : 8),
    requireUppercase: p.requireUppercase !== false,
    requireNumbers: p.requireNumbers !== false,
  };
}

/** A view that arrived over the wire, made safe: anything missing or odd reads as the platform default. */
export function parsePolicyView(raw: unknown): PasswordPolicyView {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return policyView({
    minPasswordLength: typeof r.minLength === "number" ? r.minLength : undefined,
    requireUppercase: typeof r.requireUppercase === "boolean" ? r.requireUppercase : undefined,
    requireNumbers: typeof r.requireNumbers === "boolean" ? r.requireNumbers : undefined,
  });
}

export function passwordChecklist(password: string, view: PasswordPolicyView): PasswordRule[] {
  const rules: PasswordRule[] = [
    { key: "length", label: `At least ${view.minLength} characters`, met: password.length >= view.minLength },
  ];
  if (view.requireUppercase) rules.push({ key: "uppercase", label: "One uppercase letter", met: /[A-Z]/.test(password) });
  if (view.requireNumbers) rules.push({ key: "number", label: "One number", met: /[0-9]/.test(password) });
  return rules;
}

/** True when the server would accept this password under this policy. */
export function passwordMeets(password: string, view: PasswordPolicyView): boolean {
  return (
    validatePassword(password, {
      minPasswordLength: view.minLength,
      requireUppercase: view.requireUppercase,
      requireNumbers: view.requireNumbers,
    }) === null
  );
}
