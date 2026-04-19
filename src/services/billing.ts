import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import type { Plan, SubscriptionStatus } from "@/generated/prisma";

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
}): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");

  const existing = await prisma.subscription.findUnique({
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
  await prisma.subscription.upsert({
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

  const customerId = await ensureStripeCustomer({
    organizationId: params.organizationId,
    organizationName: params.organizationName,
    adminEmail: params.adminEmail,
  });
  const priceId = getPriceId(params.key);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: Math.max(1, params.seats) }],
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

export async function applySubscriptionEvent(sub: Stripe.Subscription) {
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
  };
  await prisma.subscription.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      ...data,
    },
    update: data,
  });
  // Mirror `plan` onto the Organization for lightweight feature gating.
  await prisma.organization.update({
    where: { id: orgId },
    data: { plan: mapped.plan },
  });
}
