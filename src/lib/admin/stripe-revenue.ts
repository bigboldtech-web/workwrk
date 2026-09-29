// What Stripe charges WorkwrK's customers, for the Staff console's Overview
// and Analytics (spec-admin-backoffice 2.1, 2.5, section 4 step 6). Server only.
//
//   Monthly revenue     every WorkwrK Stripe subscription that is active or
//                       past due (the same "Paying" the Companies list and
//                       Overview count), at Stripe's own price for each item
//                       times its quantity, AFTER the discounts on the item
//                       and on the subscription, spread over the price's
//                       interval. One line per currency; never converted.
//   Charged per bucket  what paid invoices of WorkwrK subscriptions took in
//                       each bucket of the range (by the day they were paid),
//                       before refunds, one series per currency.
//
// "WorkwrK's" (isWorkwrkStripe): one of the priceCatalog price ids, or a
// customer or subscription our database holds, or checkout's
// metadata.organizationId naming a company that exists. The same Stripe
// account may bill other things; those are never counted here.
//
// Both reads are cached for an hour (Stripe is not asked on every page load),
// a burst of loads shares one request, and a failure is cached for 30 seconds
// only so Retry works soon after Stripe recovers. A read has a total time
// budget (it stops and says the figure is partial), and a page never waits on
// it for more than STRIPE_WAIT_MS: past that the card offers Retry while the
// read finishes in the background and fills the cache. When billing is not
// connected (no STRIPE_SECRET_KEY, `isBillingLive` false) nothing is fetched
// and the answer is "unavailable": the page shows "Not connected", never a
// zero and never a number computed from a price list.

import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { isBillingLive, stripe, workwrkPriceIds } from "@/services/billing";
import {
  DAY_MS,
  chargedSeries,
  isWorkwrkStripe,
  revenueLines,
  type CouponLite,
  type PaidInvoiceLite,
  type RangeWindow,
  type RevenueLine,
  type StripeSubscriptionLite,
  type WorkwrkStripeKeys,
} from "@/lib/admin/numbers";

const HOUR_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
/** One retry per page request, not the SDK's default two. */
const REQUEST_RETRIES = 1;
/** A whole read (every page of a list) stops after this long and is marked partial. */
const READ_BUDGET_MS = 40_000;
/** The longest a page's request waits on Stripe before the card offers Retry. */
export const STRIPE_WAIT_MS = 6_000;
/** Past this many a list stops and the page says the figure is partial. */
export const STRIPE_LIST_CAP = 10_000;
/** An invoice is listed from this long before the window, so one created earlier but paid inside it is counted. */
const INVOICE_LOOKBACK_MS = 45 * DAY_MS;

type Entry<T> = { at: number; ok: true; value: T } | { at: number; ok: false };
const cache = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<Entry<unknown>>>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<Entry<T>> {
  const hit = cache.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < (hit.ok ? HOUR_MS : FAILURE_TTL_MS)) return hit;
  const running = inflight.get(key) as Promise<Entry<T>> | undefined;
  if (running) return running;
  const p = (async (): Promise<Entry<T>> => {
    try {
      const value = await load();
      const e: Entry<T> = { at: Date.now(), ok: true, value };
      // Windows move on by a day, so old keys are dropped rather than kept.
      if (cache.size > 32) cache.clear();
      cache.set(key, e);
      return e;
    } catch (err) {
      console.error(`[staff-console] Stripe read failed (${key}):`, err instanceof Error ? err.message : err);
      const e: Entry<T> = { at: Date.now(), ok: false };
      cache.set(key, e);
      return e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p as Promise<Entry<unknown>>);
  return p;
}

/**
 * A Stripe answer, or "error" once `ms` has passed. The read itself goes on
 * in the background (it is shared and cached), so the Retry the card offers
 * is answered from the cache as soon as Stripe finishes.
 */
export async function withStripeDeadline<T extends { source: string }>(p: Promise<T>, ms = STRIPE_WAIT_MS): Promise<T | { source: "error" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ source: "error" }>((resolve) => {
    timer = setTimeout(() => resolve({ source: "error" }), ms);
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const REQUEST_OPTS = { timeout: REQUEST_TIMEOUT_MS, maxNetworkRetries: REQUEST_RETRIES };

/** Every row of a Stripe list, up to the cap and the time budget. */
async function collect<T>(list: AsyncIterable<T>, startedAt: number): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for await (const row of list) {
    rows.push(row);
    if (rows.length >= STRIPE_LIST_CAP || Date.now() - startedAt > READ_BUDGET_MS) return { rows, truncated: true };
  }
  return { rows, truncated: false };
}

const idOf = (x: string | { id: string } | null | undefined): string | null => (x == null ? null : typeof x === "string" ? x : x.id);

function couponIdOf(d: string | Stripe.Discount): string | null {
  // An unexpanded discount (a bare id) names no coupon; subscriptionMonthly leaves that subscription out.
  if (typeof d === "string") return null;
  return idOf(d.source?.coupon as string | Stripe.Coupon | null | undefined);
}

function toLite(s: Stripe.Subscription): StripeSubscriptionLite {
  return {
    id: s.id,
    customer: idOf(s.customer as string | { id: string }),
    discounts: (s.discounts ?? []).map(couponIdOf),
    items: s.items.data.map((it) => ({
      currency: it.price.currency,
      unitAmount: it.price.unit_amount,
      quantity: it.quantity ?? null,
      interval: it.price.recurring?.interval ?? null,
      intervalCount: it.price.recurring?.interval_count ?? null,
      metered: it.price.recurring?.usage_type === "metered",
      product: idOf(it.price.product as string | { id: string }),
      discounts: (it.discounts ?? []).map(couponIdOf),
    })),
  };
}

function toCouponLite(c: Stripe.Coupon): CouponLite {
  const options: Record<string, number> = {};
  for (const [cur, o] of Object.entries(c.currency_options ?? {})) {
    if (typeof o?.amount_off === "number") options[cur.toUpperCase()] = o.amount_off;
  }
  return {
    id: c.id,
    percentOff: c.percent_off ?? null,
    amountOff: c.amount_off ?? null,
    currency: c.currency ?? null,
    currencyOptions: options,
    products: c.applies_to?.products?.length ? c.applies_to.products : null,
  };
}

/**
 * Which of these Stripe ids the database knows. Each list travels as ONE
 * array parameter, so ten thousand ids stay inside the bind-parameter limit.
 */
async function knownKeys(ids: { customers: string[]; subscriptions: string[]; organizationIds: string[] }): Promise<WorkwrkStripeKeys> {
  const [subs, orgs] = await Promise.all([
    ids.customers.length || ids.subscriptions.length
      ? prisma.$queryRaw<{ stripeCustomerId: string | null; stripeSubscriptionId: string | null }[]>`
          SELECT "stripeCustomerId", "stripeSubscriptionId" FROM "Subscription"
          WHERE "stripeCustomerId" = ANY(${ids.customers}::text[]) OR "stripeSubscriptionId" = ANY(${ids.subscriptions}::text[])`
      : Promise.resolve([]),
    ids.organizationIds.length
      ? prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Organization" WHERE "id" = ANY(${ids.organizationIds}::text[])`
      : Promise.resolve([]),
  ]);
  return {
    priceIds: new Set(workwrkPriceIds()),
    customers: new Set(subs.map((r) => r.stripeCustomerId).filter((v): v is string => !!v)),
    subscriptions: new Set(subs.map((r) => r.stripeSubscriptionId).filter((v): v is string => !!v)),
    organizationIds: new Set(orgs.map((r) => r.id)),
  };
}

const uniq = (xs: (string | null | undefined)[]): string[] => [...new Set(xs.filter((v): v is string => !!v))];

interface ActiveSubs {
  subs: StripeSubscriptionLite[];
  coupons: Map<string, CouponLite>;
  truncated: boolean;
}

async function loadActiveSubscriptions(client: Stripe): Promise<ActiveSubs> {
  const startedAt = Date.now();
  const expand = ["data.discounts", "data.items.data.discounts"];
  const lists = await Promise.all(
    (["active", "past_due"] as const).map((status) =>
      collect(client.subscriptions.list({ status, limit: 100, expand }, REQUEST_OPTS), startedAt),
    ),
  );
  const raw = lists.flatMap((l) => l.rows);
  const keys = await knownKeys({
    customers: uniq(raw.map((s) => idOf(s.customer as string | { id: string }))),
    subscriptions: uniq(raw.map((s) => s.id)),
    organizationIds: uniq(raw.map((s) => s.metadata?.organizationId)),
  });
  const ours = raw.filter((s) =>
    isWorkwrkStripe(
      {
        subscriptionId: s.id,
        customer: idOf(s.customer as string | { id: string }),
        organizationId: s.metadata?.organizationId ?? null,
        priceIds: s.items.data.map((it) => it.price.id),
      },
      keys,
    ),
  );
  const subs = ours.map(toLite);

  // Coupons are read only when a subscription carries a discount.
  const coupons = new Map<string, CouponLite>();
  let couponsTruncated = false;
  if (subs.some((s) => (s.discounts?.length ?? 0) > 0 || s.items.some((it) => (it.discounts?.length ?? 0) > 0))) {
    const c = await collect(client.coupons.list({ limit: 100, expand: ["data.applies_to", "data.currency_options"] }, REQUEST_OPTS), startedAt);
    for (const coupon of c.rows) coupons.set(coupon.id, toCouponLite(coupon));
    couponsTruncated = c.truncated;
  }
  return { subs, coupons, truncated: lists.some((l) => l.truncated) || couponsTruncated };
}

async function loadPaidInvoices(client: Stripe, since: Date): Promise<{ invoices: PaidInvoiceLite[]; truncated: boolean }> {
  const startedAt = Date.now();
  const listed = await collect(
    client.invoices.list(
      { status: "paid", created: { gte: Math.floor((since.getTime() - INVOICE_LOOKBACK_MS) / 1000) }, limit: 100 },
      REQUEST_OPTS,
    ),
    startedAt,
  );
  const subOf = (inv: Stripe.Invoice) => idOf(inv.parent?.subscription_details?.subscription as string | { id: string } | null | undefined);
  // "From Stripe subscriptions only": an invoice no subscription raised is not counted.
  const fromSubs = listed.rows.filter((inv) => !!subOf(inv));
  const keys = await knownKeys({
    customers: uniq(fromSubs.map((inv) => idOf(inv.customer as string | { id: string } | null))),
    subscriptions: uniq(fromSubs.map(subOf)),
    organizationIds: uniq(fromSubs.map((inv) => inv.parent?.subscription_details?.metadata?.organizationId)),
  });
  const invoices = fromSubs
    .filter((inv) =>
      isWorkwrkStripe(
        {
          subscriptionId: subOf(inv),
          customer: idOf(inv.customer as string | { id: string } | null),
          organizationId: inv.parent?.subscription_details?.metadata?.organizationId ?? null,
        },
        keys,
      ),
    )
    .map((inv) => ({
      currency: inv.currency,
      amountPaid: inv.amount_paid,
      // Bucketed by the day it was paid; chargedSeries drops what falls outside the window.
      paidAt: new Date(((inv.status_transitions?.paid_at ?? inv.created) as number) * 1000),
    }));
  return { invoices, truncated: listed.truncated };
}

export type StripeRevenue =
  | { source: "unavailable" }
  | { source: "error" }
  | {
      source: "stripe";
      lines: RevenueLine[];
      /** Subscriptions left out because a price or a discount has no exact amount (tiered, metered, an unknown coupon). */
      uncounted: number;
      /** The list stopped at STRIPE_LIST_CAP or the time budget, so the figure is a floor. */
      truncated: boolean;
      /** When Stripe was last asked (the figures are up to an hour old). */
      asOf: string;
    };

/** Monthly revenue per currency from WorkwrK's active and past-due Stripe subscriptions. */
export async function readMonthlyRevenue(): Promise<StripeRevenue> {
  if (!isBillingLive || !stripe) return { source: "unavailable" };
  const client = stripe;
  const e = await cached("subscriptions:paying", () => loadActiveSubscriptions(client));
  if (!e.ok) return { source: "error" };
  const { lines, uncounted } = revenueLines(e.value.subs, e.value.coupons);
  return { source: "stripe", lines, uncounted, truncated: e.value.truncated, asOf: new Date(e.at).toISOString() };
}

export type StripeCharged =
  | { source: "unavailable" }
  | { source: "error" }
  | { source: "stripe"; series: Map<string, number[]>; truncated: boolean; asOf: string };

/** What paid invoices of WorkwrK subscriptions took in each bucket of the window, per currency. */
export async function readChargedSeries(w: RangeWindow): Promise<StripeCharged> {
  if (!isBillingLive || !stripe) return { source: "unavailable" };
  const client = stripe;
  // Keyed by range and the window's first day, so the hour's cache never
  // serves a window that has since moved on by a day.
  const key = `invoices:${w.range}:${w.start.toISOString().slice(0, 10)}`;
  const e = await cached(key, () => loadPaidInvoices(client, w.start));
  if (!e.ok) return { source: "error" };
  return { source: "stripe", series: chargedSeries(e.value.invoices, w), truncated: e.value.truncated, asOf: new Date(e.at).toISOString() };
}
