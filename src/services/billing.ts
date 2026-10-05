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
    await expireOpenCheckouts(customerId);
    // Stripe knows of a paid checkout before our webhook does (the buyer is
    // sent back to Plan & billing at once): a second checkout is refused on
    // what Stripe holds, not only on the row.
    if ((await openSubscriptionsOf(customerId)).length > 0) {
      throw new BillingRefusal("This workspace already has a subscription. Change it from Manage billing.");
    }
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

/** A billing action refused for a reason the person can read (the routes answer 409 with it). */
export class BillingRefusal extends Error {}

/** Close every checkout still open for this Stripe customer, so none of them can be paid. */
export async function expireOpenCheckouts(customerId: string): Promise<void> {
  if (!stripe) throw new Error("Stripe not configured");
  const open = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 50 });
  for (const s of open.data) await stripe.checkout.sessions.expire(s.id);
}

/** The customer's subscriptions that can still bill or come back, by Stripe's own status. */
export async function openSubscriptionsOf(customerId: string): Promise<string[]> {
  if (!stripe) throw new Error("Stripe not configured");
  const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  return list.data.filter((x) => STILL_OPEN.has(x.status)).map((x) => x.id);
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

export type SubscriptionEventResult = "applied" | "older" | "lifetime" | "duplicate" | "closed";

/**
 * A billing event a person has to act on (a charge to refund, a seat count put
 * back): kept in the workspace's audit log, and emailed to OPS_ALERT_EMAIL
 * when it is set, never only a server log line.
 */
async function billingAlert(organizationId: string | null, what: string): Promise<void> {
  console.error(`[billing] ${what}`);
  if (organizationId) {
    const { logActivity } = await import("@/lib/activity");
    await logActivity({ type: "billing_alert", actorId: null, actorType: "system", actorLabel: "Billing", organizationId, description: what.slice(0, 500), targetType: "subscription", severity: "warning" });
  }
  const to = process.env.OPS_ALERT_EMAIL?.trim();
  if (!to) return;
  const [{ queueEmail }, { escapeHtml }] = await Promise.all([import("@/lib/email"), import("@/lib/email-templates/escape")]);
  await queueEmail({
    to,
    subject: "WorkwrK: a billing event needs a person",
    template: "ops-billing-alert",
    html: `<p>${escapeHtml(what)}</p><p>Workspace: <code>${escapeHtml(organizationId ?? "deleted")}</code>. ${new Date().toISOString()}</p>`,
    variables: { organizationId },
  }).catch(() => {});
}

/**
 * Apply a subscription's state. `eventAt` is when Stripe created the event
 * that carried it (Stripe's clock, never this server's): Stripe
 * delivers events out of order and retries them for days, so a state older
 * than the one already applied is skipped (Subscription.stripeEventAt). The
 * workspace's row is locked first, so two deliveries at once apply one after
 * the other.
 *
 * The row's plan is ALWAYS the plan Stripe now gives (the price's plan while
 * paying, Starter once ended, unchanged while the first payment is
 * incomplete); the workspace's own plan follows it only while the two are the
 * same, so a plan staff set, or a code gave, is not Stripe's to change.
 *
 * Never applied, and stopped in Stripe when it is paying (an alert says to
 * refund what it took):
 *   - a subscription for a lifetime deal (an AppSumo code: no Stripe
 *     subscription, a flat tier, live), which no Stripe event may overwrite;
 *   - a second subscription while the row follows another one that is still
 *     live;
 *   - a subscription for a workspace that is deleted, or being deleted.
 * Checkout refuses a second subscription first (it asks Stripe), so these
 * are the backstop.
 *
 * Seats bought are never fewer than the seats in use: a paying per-person
 * subscription lowered below the people and open invitations (in the billing
 * portal) is put back up to them.
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
  const paying = PAYING.has(sub.status);
  const result = await prisma.$transaction(async (tx): Promise<SubscriptionEventResult> => {
    const org = await tx.$queryRaw<{ plan: string | null; status: string | null }[]>`
      SELECT "plan"::text AS plan, "status"::text AS status FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;
    if (org.length === 0 || String(org[0].status) === "CANCELLED") return "closed";
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
    const orgPlan = String(org[0].plan ?? "STARTER");
    // The plan Stripe last gave (a workspace with no row: the plan it signed
    // up on), and the plan it gives now.
    const stripesPlan = row ? String(row.plan) : orgPlan;
    const givesNow = (paying ? mapped.plan : ENDED.has(sub.status) ? "STARTER" : stripesPlan) as Plan;
    const owned = orgPlan === stripesPlan;
    const rowData = { ...data, plan: givesNow };
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
    if (owned && givesNow !== orgPlan) await tx.organization.update({ where: { id: orgId }, data: { plan: givesNow } });
    if (paying) {
      await tx.organization.updateMany({ where: { id: orgId, status: "TRIAL" }, data: { status: "ACTIVE" } });
    }
    return "applied";
  });

  if (result !== "applied" && result !== "older" && paying) {
    const why = result === "lifetime"
      ? "the workspace has a lifetime plan from a code"
      : result === "duplicate"
        ? "the workspace already pays through another subscription"
        : "the workspace is deleted or being deleted";
    try {
      const stopped = await stopSubscription(sub.id);
      if (stopped === "cancelled") await billingAlert(result === "closed" ? null : orgId, `A card subscription (${sub.id}) was cancelled because ${why}. Refund what it charged in Stripe (customer ${typeof sub.customer === "string" ? sub.customer : sub.customer.id}).`);
    } catch (err) {
      await billingAlert(result === "closed" ? null : orgId, `A card subscription (${sub.id}) should be cancelled because ${why}, and cancelling it failed (${err instanceof Error ? err.message : String(err)}). Cancel and refund it in Stripe.`);
    }
  }

  // Seats bought never fall below the seats in use.
  if (result === "applied" && paying && mapped.billingMode === "PER_USER" && item?.id && stripe) {
    const { seatUse } = await import("@/lib/seats");
    const use = await seatUse(orgId);
    const floor = Math.max(1, use.members + use.pending);
    if (seats < floor) {
      try {
        await stripe.subscriptions.update(sub.id, { items: [{ id: item.id, quantity: floor }], proration_behavior: "create_prorations" });
      } catch (err) {
        await billingAlert(orgId, `The seats on subscription ${sub.id} were lowered to ${seats}, below the ${floor} in use, and putting them back failed (${err instanceof Error ? err.message : String(err)}). Set the quantity to ${floor} in Stripe.`);
      }
    }
  }
  return result;
}
