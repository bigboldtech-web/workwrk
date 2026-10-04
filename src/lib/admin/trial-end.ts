// When a trial ends, as WorkwrK staff read it. Pure: no database import, so
// it is unit-tested directly (src/lib/admin/trial-end.test.ts).
//
// Two kinds of trial, one date each:
//
//   a Stripe trial       Subscription.trialEndsAt, which the Stripe webhook
//                        writes (src/services/billing.ts)
//   a self-serve trial   Organization.trialEndsAt, which signup sets to
//                        SELF_SERVE_TRIAL_DAYS after the company is created,
//                        and staff can change on the company page
//
// THE SELF-SERVE DATE IS FOR STAFF ONLY. The customer is never shown it, no
// marketing page names a trial length, and nothing in the product changes on
// it: it is the day WorkwrK staff follow a trial up. That is why it lives on
// the Organization and never on a Subscription row, which would invent a
// billing relationship nobody sold.
//
// It counts only while the company is on TRIAL with neither a Stripe
// subscription nor a lifetime deal. Neither of those moves a company off
// TRIAL (billing.ts mirrors only the plan, and /api/appsumo/redeem writes only
// the Subscription), so a paying company can still read TRIAL, and it must
// never show as a trial about to end. trialEndsWithinWhere in
// companies-list.ts is the same rule as a where clause; the two must agree.

export const SELF_SERVE_TRIAL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar day staff can pick: a real date between 2020 and 2099. */
export function isTrialEndDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2020 || y > 2099) return false;
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

/**
 * The instant a picked day is stored as: noon UTC, so the day reads the same
 * in every staff member's time zone from UTC-11 to UTC+11.
 */
export function trialEndFromDay(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

/** The self-serve trial end for a company created at `createdAt`. */
export function selfServeTrialEnd(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SELF_SERVE_TRIAL_DAYS * DAY_MS);
}

export interface TrialEndFacts {
  status: string;
  trialEndsAt: Date | null;
  subscription: { stripeSubscriptionId: string | null; billingMode: string; trialEndsAt: Date | null } | null;
}

export type ConsoleTrialEnd = { at: Date; source: "stripe" | "self_serve" };

/**
 * The trial end staff read for a company, or null when it has none:
 *   1. a Stripe trial's own date, wherever there is one
 *   2. none, for a company with a Stripe subscription or a lifetime deal
 *   3. the company's own date, while it is on TRIAL
 */
export function consoleTrialEnd(org: TrialEndFacts): ConsoleTrialEnd | null {
  const sub = org.subscription;
  if (sub?.trialEndsAt) return { at: sub.trialEndsAt, source: "stripe" };
  if (sub && (sub.stripeSubscriptionId !== null || sub.billingMode === "FLAT_TIER")) return null;
  if (org.status === "TRIAL" && org.trialEndsAt) return { at: org.trialEndsAt, source: "self_serve" };
  return null;
}

/**
 * Whether staff may set this company's own trial end: on TRIAL, with no
 * Stripe trial, Stripe subscription or lifetime deal deciding it instead.
 * The one sentence for the refusal, or null when they may.
 */
export function trialEndRefusal(org: TrialEndFacts): string | null {
  const sub = org.subscription;
  if (sub?.trialEndsAt || sub?.stripeSubscriptionId) return "Stripe sets this company's trial end, so it cannot be changed here.";
  if (sub && sub.billingMode === "FLAT_TIER") return "This company has a lifetime deal, so it has no trial to end.";
  if (org.status !== "TRIAL") return "Only a company on Trial has a trial end. Set its status to Trial first.";
  return null;
}
