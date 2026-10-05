import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import type { Plan, Prisma, SubscriptionStatus } from "@/generated/prisma";
import { PLAN_LIMITS } from "@/lib/plan-limits-data";

/**
 * Billing service — thin wrapper around Stripe.
 *
 * Behavior:
 *   • If STRIPE_SECRET_KEY is set, checkout + webhook are fully live.
 *   • If not set, the helpers throw with a clear error so the admin
 *     UI can fall back to "contact us" flow.
 *
 * Canonical Subscription state lives in Prisma (`Subscription` model).
 * Stripe is the source of truth only for `stripeSubscriptionId`'s
 * current_period_end and status — webhook keeps us in sync.
 */

const secret = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const isBillingLive = Boolean(secret);

export const stripe = secret ? new Stripe(secret) : null;

// ── Price catalogue ────────────────────────────────────────────────
// Map internal (plan, billingMode) → Stripe Price ID via env vars. Set
// these in the Stripe dashboard and wire them in via .env. Defaults are
// null so we can detect "unconfigured" and surface a helpful error.
export type BillingKey =
  | "growth-per-user"
  | "team-flat"
  | "growth-flat"
  | "scale-flat";

const priceCatalog: Record<BillingKey, string | undefined> = {
  "growth-per-user": process.env.STRIPE_PRICE_GROWTH_PER_USER,
  "team-flat": process.env.STRIPE_PRICE_TEAM_FLAT,
  "growth-flat": process.env.STRIPE_PRICE_GROWTH_FLAT,
  "scale-flat": process.env.STRIPE_PRICE_SCALE_FLAT,
};

/** Every configured WorkwrK price id (the Staff console counts only these subscriptions as ours). */
export function workwrkPriceIds(): string[] {
  return Object.values(priceCatalog).filter((v): v is string => !!v);
}

/** Whether a price is set up for this key (an unset one makes checkout throw). */
export function priceConfigured(key: BillingKey): boolean {
  return Boolean(priceCatalog[key]);
}

export function getPriceId(key: BillingKey): string {
  const id = priceCatalog[key];
  if (!id) throw new Error(`Stripe price not configured for "${key}"`);
  return id;
}

/**
 * Ensure a Stripe customer exists for this org; reuse if it does.
 */
export async function ensureStripeCustomer(params: {
  organizationId: string;
  organizationName: string;
  adminEmail: string;
}, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");

  const existing = await db.subscription.findUnique({
    where: { organizationId: params.organizationId },
    select: { stripeCustomerId: true },
  });
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const customer = await stripe.customers.create({
    name: params.organizationName,
    email: params.adminEmail,
    metadata: { organizationId: params.organizationId },
  });

  // Upsert the Subscription row so the customer ID is persisted even
  // before the user completes checkout.
  await db.subscription.upsert({
    where: { organizationId: params.organizationId },
    create: {
      organizationId: params.organizationId,
      plan: "STARTER",
      status: "TRIALING",
      billingMode: "PER_USER",
      seats: 0,
      stripeCustomerId: customer.id,
    },
    update: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

/**
 * Create a Stripe Checkout session for a given billing key + seat count.
 * For PER_USER mode, pass `seats`. For FLAT_TIER, pass seats = 1.
 */
export async function createCheckoutSession(params: {
  organizationId: string;
  organizationName: string;
  adminEmail: string;
  key: BillingKey;
  seats: number;
  successUrl: string;
  cancelUrl: string;
}) {
  if (!stripe) throw new Error("Stripe not configured");
  const client = stripe;
  const priceId = getPriceId(params.key);
  const quantity = Math.max(1, params.seats);

  // ONE CHECKOUT AT A TIME PER WORKSPACE. A checkout session stays payable
  // for 24 hours, so two opened before either was paid (the Owner and a
  // billing Admin, or two tabs) both billed. Under this workspace's lock the
  // Stripe customer is made once, and every checkout still open for it is
  // closed before the new one opens: only the newest can be paid.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"stripe-checkout:" + params.organizationId}))`;
    const customerId = await ensureStripeCustomer({
      organizationId: params.organizationId,
      organizationName: params.organizationName,
      adminEmail: params.adminEmail,
    }, tx);
    const open = await client.checkout.sessions.list({ customer: customerId, status: "open", limit: 20 });
    for (const old of open.data) await client.checkout.sessions.expire(old.id);
    const session = await client.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity,
          // A per-person price lets the buyer choose the seats at checkout,
          // from the seats already in use up to Growth's people limit.
          ...(params.key === "growth-per-user"
            ? { adjustable_quantity: { enabled: true, minimum: quantity, maximum: Math.max(quantity, PLAN_LIMITS.GROWTH.users) } }
            : {}),
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      allow_promotion_codes: true,
      metadata: {
        organizationId: params.organizationId,
        billingKey: params.key,
      },
      subscription_data: {
        metadata: {
          organizationId: params.organizationId,
          billingKey: params.key,
        },
      },
    });
    return { url: session.url, sessionId: session.id };
  }, { maxWait: 10_000, timeout: 30_000 });
}

// Stripe statuses under which a subscription can still bill or come back:
// the row stores unpaid, incomplete and paused all as INCOMPLETE, the same as
// the dead incomplete_expired, so only Stripe can say which it is.
const STILL_OPEN = new Set<string>(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

/** Whether a subscription can still bill (or be resumed), by Stripe's own status. Throws when Stripe cannot say. */
export async function subscriptionStillOpen(subscriptionId: string): Promise<boolean> {
  if (!stripe) throw new Error("Stripe not configured");
  const current = await stripe.subscriptions.retrieve(subscriptionId);
  return STILL_OPEN.has(current.status);
}

/**
 * Stop a subscription for good: cancelled, unless Stripe already holds it as
 * ended (cancelling an ended one throws). Throws when Stripe cannot be
 * reached or refuses, so the caller can keep what it was about to do.
 */
export async function stopSubscription(subscriptionId: string): Promise<"cancelled" | "already_ended"> {
  if (!stripe) throw new Error("Stripe not configured");
  if (!(await subscriptionStillOpen(subscriptionId))) return "already_ended";
  await stripe.subscriptions.cancel(subscriptionId);
  return "cancelled";
}

/**
 * Where Stripe sends the person back to: the address asked for when it is on
 * this site, else this site's own page. Never another site (Stripe would
 * redirect a signed-in admin wherever the request said).
 */
export function ownReturnUrl(candidate: unknown, fallbackPath: string): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const fallback = new URL(fallbackPath, base).toString();
  if (typeof candidate !== "string" || !candidate) return fallback;
  try {
    const url = new URL(candidate, base);
    return url.origin === new URL(base).origin ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Customer Portal — redirects the admin to Stripe's hosted UI to manage
 * card, cancel, update seat count, etc.
 */
export async function createPortalSession(params: {
  organizationId: string;
  returnUrl: string;
}): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");
  const sub = await prisma.subscription.findUnique({
    where: { organizationId: params.organizationId },
    select: { stripeCustomerId: true },
  });
  if (!sub?.stripeCustomerId) throw new Error("No Stripe customer on this org");
  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: params.returnUrl,
  });
  return portal.url;
}

/**
 * Verify + parse a webhook request. Returns the Stripe event or null.
 */
export function verifyWebhook(rawBody: string, sig: string | null): Stripe.Event | null {
  if (!stripe || !webhookSecret || !sig) return null;
  try {
    return stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch {
    return null;
  }
}

// ── Event handlers ─────────────────────────────────────────────────
// Idempotent — every handler is safe to run twice.

function mapStripeStatusToInternal(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}

function priceIdToPlan(priceId: string): { plan: Plan; billingMode: "PER_USER" | "FLAT_TIER" } {
  if (priceId === priceCatalog["growth-per-user"]) return { plan: "GROWTH", billingMode: "PER_USER" };
  if (priceId === priceCatalog["team-flat"]) return { plan: "GROWTH", billingMode: "FLAT_TIER" };
  if (priceId === priceCatalog["growth-flat"]) return { plan: "GROWTH", billingMode: "FLAT_TIER" };
  if (priceId === priceCatalog["scale-flat"]) return { plan: "SCALE", billingMode: "FLAT_TIER" };
  return { plan: "GROWTH", billingMode: "PER_USER" };
}

// What a Stripe status means for the workspace's own plan, the one every
// limit reads (PLAN_LIMITS[Organization.plan]):
//   paying (active, trialing, past_due)   the price's plan, and a workspace
//     still on its free trial status becomes ACTIVE (as an AppSumo code does);
//   ended (canceled, unpaid, incomplete_expired, paused)   back to Starter:
//     a cancelled subscription used to leave the workspace on Growth for
//     good, because every event mirrored the price's plan whatever its status;
//   incomplete   nothing changes: the first payment has not gone through.
// Either way, only while the workspace's plan is still the one Stripe set
// (the plan on the subscription row): a plan staff set, or a code gave,
// since then is not Stripe's to change.
const PAYING = new Set<string>(["active", "trialing", "past_due"]);
const ENDED = new Set<string>(["canceled", "unpaid", "incomplete_expired", "paused"]);
const LIVE_ROW = new Set<string>(["ACTIVE", "TRIALING", "PAST_DUE"]);

export type SubscriptionEventResult = "applied" | "older" | "lifetime" | "duplicate";

/**
 * Apply a subscription's state. `eventAt` is when Stripe created the event
 * that carried it (Stripe's clock, never this server's): Stripe
 * delivers events out of order and retries them for days, so a state older
 * than the one already applied is skipped (Subscription.stripeEventAt). The
 * workspace's row is locked first, so two deliveries at once apply one after
 * the other.
 *
 * Never applied:
 *   - to a lifetime deal (an AppSumo code: no Stripe subscription, a flat
 *     tier, live), which no Stripe event may overwrite;
 *   - for a second subscription while the row follows another one that is
 *     still live: two checkouts opened at once and both paid. The second is
 *     cancelled at once, so the customer is never billed twice, and logged so
 *     its first payment can be refunded.
 */
export async function applySubscriptionEvent(sub: Stripe.Subscription, eventAt: Date = new Date()): Promise<SubscriptionEventResult | undefined> {
  const orgId = sub.metadata?.organizationId;
  if (!orgId) return;
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? "";
  const seats = item?.quantity ?? 1;
  const mapped = priceIdToPlan(priceId);
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  const data = {
    plan: mapped.plan,
    billingMode: mapped.billingMode,
    status: mapStripeStatusToInternal(sub.status),
    seats,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    stripeCurrentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    stripeEventAt: eventAt,
  };
  const result = await prisma.$transaction(async (tx): Promise<SubscriptionEventResult> => {
    const org = await tx.$queryRaw<{ plan: string | null }[]>`
      SELECT "plan"::text AS plan FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;
    if (org.length === 0) return "older";
    const row = await tx.subscription.findUnique({
      where: { organizationId: orgId },
      select: { plan: true, status: true, billingMode: true, stripeSubscriptionId: true, stripeEventAt: true },
    });
    if (row) {
      if (!row.stripeSubscriptionId && row.billingMode === "FLAT_TIER" && LIVE_ROW.has(String(row.status))) return "lifetime";
      if (row.stripeSubscriptionId && row.stripeSubscriptionId !== sub.id && LIVE_ROW.has(String(row.status))) return "duplicate";
      // A newer state is already applied: this event is older news.
      if (row.stripeEventAt && row.stripeEventAt > eventAt) return "older";
    }
    // The row's plan is the plan Stripe last gave the workspace (a workspace
    // with no row has only the plan it signed up on). Stripe changes the
    // workspace's plan only while that is still its plan.
    const orgPlan = String(org[0].plan ?? "STARTER");
    const stripesPlan = row ? String(row.plan) : orgPlan;
    const owned = orgPlan === stripesPlan;
    const nextPlan = !owned ? null : PAYING.has(sub.status) ? mapped.plan : ENDED.has(sub.status) ? ("STARTER" as Plan) : null;
    const rowData = { ...data, plan: (nextPlan ?? stripesPlan) as Plan };
    if (row) {
      await tx.subscription.update({ where: { organizationId: orgId }, data: rowData });
    } else {
      await tx.subscription.create({
        data: {
          organizationId: orgId,
          stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          ...rowData,
        },
      });
    }
    if (nextPlan) await tx.organization.update({ where: { id: orgId }, data: { plan: nextPlan } });
    if (PAYING.has(sub.status)) {
      await tx.organization.updateMany({ where: { id: orgId, status: "TRIAL" }, data: { status: "ACTIVE" } });
    }
    return "applied";
  });
  if (result === "duplicate" && PAYING.has(sub.status) && stripe) {
    await stripe.subscriptions.cancel(sub.id);
    console.error(`[billing] a second subscription (${sub.id}) for workspace ${orgId} was cancelled: the workspace already pays through another one. Refund its first payment in Stripe.`);
  }
  return result;
}
