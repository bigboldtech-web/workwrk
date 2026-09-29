// The pure half of the Staff console's audit trail: action keys, labels,
// the customer-facing sentence for each action, the IP and actor readers and
// the denial sampling window. No database import, so it is unit-tested
// directly (src/lib/staff-audit-helpers.test.ts). The writes live in
// staff-audit.ts.

export const STAFF_ACTIONS = [
  "admin.org.plan_changed",
  "admin.org.status_changed",
  "admin.org.seats_changed",
  "admin.org.module_changed",
  "admin.org.feature_changed",
  "admin.org.owner_set",
  "admin.staff.added",
  "admin.staff.removed",
  "admin.codes.imported",
  "admin.code.refunded",
  "admin.access.denied",
] as const;

export type StaffActionKey = (typeof STAFF_ACTIONS)[number];

/** The name a customer reads for any staff actor. Never the person's name. */
export const STAFF_ACTOR_LABEL = "WorkwrK Support";
export const STAFF_ACTOR_TYPE = "platform_staff";

/** A repeat denial within this long of the row's creation bumps `hits`. */
export const DENIAL_WINDOW_MS = 10 * 60 * 1000;

export interface StaffActor {
  /** Null when a denied probe does not resolve to a user row. */
  userId: string | null;
  email: string;
}

/* ───────────────────────── pure helpers ───────────────────────── */

const PLAN_LABELS: Record<string, string> = {
  STARTER: "Starter",
  GROWTH: "Growth",
  SCALE: "Scale",
  ENTERPRISE: "Enterprise",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  TRIAL: "Trial",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
};

/** "GROWTH" reads as "Growth"; an unknown value reads as itself. */
export function planLabel(plan: string | null | undefined): string {
  if (!plan) return "None";
  return PLAN_LABELS[plan] ?? plan;
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "None";
  return STATUS_LABELS[status] ?? status;
}

/**
 * The client IP from proxy headers (behind nginx: x-forwarded-for, then
 * x-real-ip). Accepts a Request, a Headers, or anything with a `headers`
 * that has `get`. Null when nothing is known; never a guess.
 */
export function requestIp(
  source: Request | Headers | { headers: Headers } | null | undefined,
): string | null {
  if (!source) return null;
  const headers: Headers | undefined =
    source instanceof Headers
      ? source
      : (source as { headers?: Headers }).headers instanceof Headers
        ? (source as { headers: Headers }).headers
        : undefined;
  if (!headers) return null;
  const raw = headers.get("x-forwarded-for") ?? headers.get("x-real-ip");
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first || null;
}

/** The staff actor from a NextAuth session: id when present, email lower-cased. */
export function staffActorFromSession(
  session: { user?: { id?: string; email?: string | null } | null } | null | undefined,
): StaffActor {
  const user = session?.user;
  return {
    userId: typeof user?.id === "string" && user.id ? user.id : null,
    email: (user?.email ?? "").trim().toLowerCase() || "unknown",
  };
}

/**
 * True when `createdAt` is still inside its ten-minute lifetime at `now`:
 * the window is measured from the row, not from a fixed clock bucket.
 */
export function isWithinDenialWindow(createdAt: Date, now: Date, windowMs: number = DENIAL_WINDOW_MS): boolean {
  const age = now.getTime() - createdAt.getTime();
  return age >= 0 && age < windowMs;
}

export interface TenantEvent {
  /** The customer's event key: staff.plan.changed and the other five. */
  type: string;
  /** The sentence the customer reads. Names "WorkwrK Support", never a person. */
  description: string;
  severity: "info" | "warning" | "critical";
}

type Rec = Record<string, unknown> | null | undefined;

const str = (r: Rec, k: string): string | undefined => {
  const v = r?.[k];
  return typeof v === "string" ? v : undefined;
};

/**
 * The customer-facing half of a staff action (spec section 1 Audit, the
 * six-row table). Null for the actions that never touch a workspace (the
 * staff list, code import, a denial). Pure, so the copy is testable.
 */
export function tenantEventFor(action: StaffActionKey, before: Rec, after: Rec): TenantEvent | null {
  switch (action) {
    case "admin.org.plan_changed":
      return {
        type: "staff.plan.changed",
        description: `${STAFF_ACTOR_LABEL} changed the plan from ${planLabel(str(before, "plan"))} to ${planLabel(str(after, "plan"))}`,
        severity: "info",
      };
    case "admin.org.status_changed": {
      const next = str(after, "status");
      const verb =
        next === "SUSPENDED"
          ? "suspended this workspace"
          : next === "CANCELLED"
            ? "closed this workspace"
            : next === "TRIAL"
              ? "moved this workspace to a trial"
              : "set this workspace to Active";
      return {
        type: "staff.status.changed",
        description: `${STAFF_ACTOR_LABEL} ${verb}`,
        severity: next === "CANCELLED" ? "critical" : "warning",
      };
    }
    case "admin.org.seats_changed": {
      const from = before?.seats == null ? "unlimited" : String(before.seats);
      const to = after?.seats == null ? "unlimited" : String(after.seats);
      return {
        type: "staff.seats.changed",
        description: `${STAFF_ACTOR_LABEL} changed seats from ${from} to ${to}`,
        severity: "info",
      };
    }
    case "admin.org.module_changed":
      return {
        type: "staff.module.changed",
        description: `${STAFF_ACTOR_LABEL} turned ${str(after, "label") ?? "a module"} ${after?.enabled ? "on" : "off"}`,
        severity: "info",
      };
    case "admin.org.feature_changed":
      return {
        type: "staff.feature.changed",
        description: `${STAFF_ACTOR_LABEL} turned ${str(after, "label") ?? "an add-on"} ${after?.enabled ? "on" : "off"}`,
        severity: "info",
      };
    case "admin.org.owner_set":
      return {
        type: "staff.owner.set",
        description: `${STAFF_ACTOR_LABEL} gave ${str(after, "name") ?? "a person"} Owner access`,
        severity: "warning",
      };
    default:
      return null;
  }
}

/** Text into an email's HTML: a staff name or email never becomes markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
