// The pure rules of a staff member's change to a company: which values are
// valid, what the body must look like, and which statuses revoke sessions.
// No database import, so it is unit-tested directly
// (src/lib/admin/company-patch-rules.test.ts). The write is company-patch.ts.

import type { EnterpriseFeature } from "@/lib/enterprise-features";

export const VALID_PLANS = ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"] as const;
export const VALID_STATUSES = ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"] as const;
export const VALID_FEATURES = ["byok", "whiteLabel", "customDomain"] as const;

export type CompanyPlan = (typeof VALID_PLANS)[number];
export type CompanyStatus = (typeof VALID_STATUSES)[number];

/** The names a customer reads for the Enterprise add-ons. */
export const FEATURE_LABELS: Record<EnterpriseFeature, string> = {
  byok: "Bring your own AI key",
  whiteLabel: "White label",
  customDomain: "Custom domain",
};

export interface CompanyPatch {
  plan?: CompanyPlan;
  status?: CompanyStatus;
  feature?: { key: EnterpriseFeature; enabled: boolean };
}

export type ValidatedPatch = { ok: true; patch: CompanyPatch } | { ok: false; error: string };

/**
 * Body → patch, or the one sentence that says why not. Pure. Accepts `plan`,
 * `status`, and `feature` + `enabled`; anything else in the body is ignored.
 * An empty patch is valid and applies nothing.
 */
export function validateCompanyPatch(body: unknown): ValidatedPatch {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: CompanyPatch = {};

  if (b.plan !== undefined) {
    if (typeof b.plan !== "string" || !(VALID_PLANS as readonly string[]).includes(b.plan)) {
      return { ok: false, error: "Invalid plan" };
    }
    patch.plan = b.plan as CompanyPlan;
  }
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !(VALID_STATUSES as readonly string[]).includes(b.status)) {
      return { ok: false, error: "Invalid status" };
    }
    patch.status = b.status as CompanyStatus;
  }
  if (b.feature !== undefined) {
    if (typeof b.feature !== "string" || !(VALID_FEATURES as readonly string[]).includes(b.feature)) {
      return { ok: false, error: "Unknown feature" };
    }
    if (typeof b.enabled !== "boolean") return { ok: false, error: "`enabled` must be a boolean" };
    patch.feature = { key: b.feature as EnterpriseFeature, enabled: b.enabled };
  }
  return { ok: true, patch };
}

/** Sign-in dies for everyone at the company on these two. */
export function statusRevokesSessions(status: CompanyStatus): boolean {
  return status === "SUSPENDED" || status === "CANCELLED";
}
