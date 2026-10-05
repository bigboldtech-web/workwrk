import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import type { Plan, SubscriptionStatus } from "@/generated/prisma";
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

  const quantity = Math.max(1, params.seats);
  const session = await stripe.checkout.sessions.create({
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
//   paying (active, trialing, past_due)   the price's plan;
//   ended (canceled, unpaid, incomplete_expired, paused)   back to Starter:
//     a cancelled subscription used to leave the workspace on Growth for
//     good, because every event mirrored the price's plan whatever its status;
//   incomplete   nothing changes: the first payment has not gone through.
const PAYING = new Set<string>(["active", "trialing", "past_due"]);
const ENDED = new Set<string>(["canceled", "unpaid", "incomplete_expired", "paused"]);

/**
 * Apply a subscription's state. `eventAt` is when Stripe created the event
 * that carried it (Stripe's clock, never this server's): Stripe
 * delivers events out of order and retries them for days, so a state older
 * than the one already applied is skipped (Subscription.stripeEventAt), in
 * one conditional write, so two deliveries at once cannot interleave either.
 */
export async function applySubscriptionEvent(sub: Stripe.Subscription, eventAt: Date = new Date()) {
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
  await prisma.$transaction(async (tx) => {
    const applied = await tx.subscription.updateMany({
      where: { organizationId: orgId, OR: [{ stripeEventAt: null }, { stripeEventAt: { lte: eventAt } }] },
      data,
    });
    if (applied.count === 0) {
      const exists = await tx.subscription.findUnique({ where: { organizationId: orgId }, select: { id: true } });
      // A newer state is already applied: this event is older news.
      if (exists) return;
      await tx.subscription.create({
        data: {
          organizationId: orgId,
          stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          ...data,
        },
      });
    }
    if (PAYING.has(sub.status)) {
      await tx.organization.update({ where: { id: orgId }, data: { plan: mapped.plan } });
    } else if (ENDED.has(sub.status)) {
      await tx.organization.update({ where: { id: orgId }, data: { plan: "STARTER" } });
    }
  });
}
