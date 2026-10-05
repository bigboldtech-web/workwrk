// The pure rules of a staff member's change to a company: which values are
// valid, what the body must look like, and which statuses revoke sessions.
// No database import, so it is unit-tested directly
// (src/lib/admin/company-patch-rules.test.ts). The write is company-patch.ts.

import type { EnterpriseFeature } from "@/lib/enterprise-features";
import { MODULES } from "@/lib/modules";
import { isTrialEndDay } from "@/lib/admin/trial-end";

export const VALID_PLANS = ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"] as const;
export const VALID_STATUSES = ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"] as const;
/**
 * The add-ons staff can switch. Custom domain is NOT here (spec 2.3 card 4):
 * nothing reads its flag, so a switch for it changed nothing. Stored values
 * of `settings.features.customDomain` are left in place, unread, so the
 * flag can come back with the routing without a data loss.
 */
export const VALID_FEATURES = ["byok", "whiteLabel"] as const;
/** Module app keys (MODULES[].appKey): the same switch an Owner sees in Settings > Apps & modules. */
export const VALID_MODULES: readonly string[] = MODULES.map((m) => m.appKey);
/** The largest seat count staff may type; anything above reads as Unlimited anyway. */
export const MAX_SEATS = 1_000_000;

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
  /** A seat count; 0 means unlimited (an empty field). */
  seats?: number;
  /** A premium module by app key ("chat" is Talk, "tables" is Tables). */
  module?: { key: string; enabled: boolean };
  /**
   * A self-serve trial's end, for staff only, as a calendar day
   * ("2026-10-19"), or null to clear it (src/lib/admin/trial-end.ts).
   */
  trialEndsOn?: string | null;
  /**
   * The company name as the staff member typed it. Required, and checked on
   * the server, for SUSPENDED and CANCELLED: the typed confirmation is not
   * only a dialog, so a script or a replayed request cannot sign a whole
   * company out without it.
   */
  confirm?: string;
}

export type ValidatedPatch = { ok: true; patch: CompanyPatch } | { ok: false; error: string };

/**
 * Body to patch, or the one sentence that says why not. Pure. Accepts
 * `plan`, `status`, `trialEndsOn` (a calendar day, or null or "" to clear),
 * `seats` (a whole number, or null or "" for unlimited),
 * `feature` + `enabled` and `module` + `enabled`; anything else in the body
 * is ignored. A feature and a module share `enabled`, so one body carries
 * at most one of the two. An empty patch is valid and applies nothing.
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
  if (b.module !== undefined) {
    if (patch.feature) return { ok: false, error: "Change one switch at a time" };
    if (typeof b.module !== "string" || !VALID_MODULES.includes(b.module)) {
      return { ok: false, error: "Unknown module" };
    }
    if (typeof b.enabled !== "boolean") return { ok: false, error: "`enabled` must be a boolean" };
    patch.module = { key: b.module, enabled: b.enabled };
  }
  if (b.seats !== undefined) {
    // Unlimited is only ever an empty box (null or ""), stored as the
    // internal 0. A typed 0 is refused rather than read as unlimited: staff
    // typing 0 mean "none", and turning it into its opposite in silence
    // wrote "Unlimited" onto the record.
    if (b.seats === null || b.seats === "") patch.seats = 0;
    else if (typeof b.seats === "number" && Number.isInteger(b.seats) && b.seats >= 1 && b.seats <= MAX_SEATS) {
      patch.seats = b.seats;
    } else {
      return { ok: false, error: "Seats must be a whole number from 1 to 1,000,000, or empty for unlimited" };
    }
  }
  if (b.trialEndsOn !== undefined) {
    if (b.trialEndsOn === null || b.trialEndsOn === "") patch.trialEndsOn = null;
    else if (typeof b.trialEndsOn === "string" && isTrialEndDay(b.trialEndsOn)) patch.trialEndsOn = b.trialEndsOn;
    else return { ok: false, error: "The trial end must be a day from 2020 to 2099, or empty to clear it" };
  }
  if (b.confirm !== undefined) {
    if (typeof b.confirm !== "string") return { ok: false, error: "`confirm` must be the company name" };
    patch.confirm = b.confirm;
  }
  return { ok: true, patch };
}

/**
 * Does the typed text confirm an action on `name`? Ignores case and
 * surrounding spaces, never anything else (the same rule as the console's
 * TypedConfirmDialog).
 */
export function confirmMatches(typed: string | undefined, name: string): boolean {
  const want = name.trim().toLowerCase();
  return want.length > 0 && (typed ?? "").trim().toLowerCase() === want;
}

/** Sign-in dies for everyone at the company on these two. */
export function statusRevokesSessions(status: CompanyStatus): boolean {
  return status === "SUSPENDED" || status === "CANCELLED";
}

export type DeletionSchedule = {
  cancelledAt: string | null;
  cancelledById: string | null;
  scheduledHardDeleteAt: string | null;
};

const DELETION_KEYS = ["cancelledAt", "cancelledById", "scheduledHardDeleteAt"] as const;

/**
 * The self-service deletion keys held in Organization.settings (written by
 * /api/organizations/delete, read by /api/cron/org-hard-delete), or null
 * when none of the three keys is present.
 */
export function deletionSchedule(settings: unknown): DeletionSchedule | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const s = settings as Record<string, unknown>;
  if (!DELETION_KEYS.some((k) => k in s)) return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    cancelledAt: str(s.cancelledAt),
    cancelledById: str(s.cancelledById),
    scheduledHardDeleteAt: str(s.scheduledHardDeleteAt),
  };
}

/* Set workspace Owner (spec 2.3 card 5): the POST body's rules. */

export const OWNER_REASON_MIN = 3;
export const OWNER_REASON_MAX = 500;

export type OwnerBody = { ok: true; userId: string; reason: string; confirm: string } | { ok: false; error: string };

/** Pure: the POST body, or the one sentence that says why not. */
export function validateOwnerBody(body: unknown): OwnerBody {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const userId = typeof b.userId === "string" ? b.userId.trim() : "";
  if (!userId || userId.length > 64) return { ok: false, error: "Choose the person to make an Owner" };
  const reason = typeof b.reason === "string" ? b.reason.replace(/\s+/g, " ").trim() : "";
  if (reason.length < OWNER_REASON_MIN) return { ok: false, error: "Say why, in a few words. It goes on the audit row." };
  if (reason.length > OWNER_REASON_MAX) return { ok: false, error: "Keep the reason under 500 characters" };
  const confirm = typeof b.confirm === "string" ? b.confirm : "";
  return { ok: true, userId, reason, confirm };
}

/**
 * Which save of a company field is the newest (the company page's autosave).
 *
 * A failed save offers Retry twice, on the toast and inline, and both hold
 * the body that failed. Without a check, a staff member who then picked the
 * value they really wanted (and it saved) and clicked the still showing
 * Retry sent the OLD value again over the newer one: a failed Growth, a
 * saved Enterprise, then Retry, left the company on Growth, and the same for
 * status (a stale Active over a Suspend) and the module switches. Every
 * write to a field takes a ticket from here, and a Retry runs only while its
 * ticket is still the field's newest; editing the field again also retires
 * the old ticket (`retire`).
 */
export interface WriteLedger {
  /** A write to `field` starts: returns its ticket, which retires every earlier one. */
  begin(field: string): number;
  /** True while no later write to `field` (or `retire`) has happened since `ticket`. */
  isLatest(field: string, ticket: number): boolean;
  /** The person changed the field again without saving yet: earlier tickets are stale. */
  retire(field: string): void;
}

export function createWriteLedger(): WriteLedger {
  const latest = new Map<string, number>();
  const bump = (field: string) => {
    const n = (latest.get(field) ?? 0) + 1;
    latest.set(field, n);
    return n;
  };
  return {
    begin: bump,
    isLatest: (field, ticket) => (latest.get(field) ?? 0) === ticket,
    retire: (field) => {
      bump(field);
    },
  };
}
