// What Stripe charges, for the Staff console's Overview and Analytics
// (spec-admin-backoffice 2.1, 2.5, section 4 step 6). Server only.
//
//   Monthly revenue   every ACTIVE Stripe subscription, at Stripe's own price
//                     object for each item times its quantity, spread over the
//                     price's interval. One line per currency; never converted.
//   Charged per bucket  what paid Stripe invoices actually took in each bucket
//                     of the range, one series per currency.
//
// Both are cached for an hour (Stripe is not asked on every page load), a
// burst of loads shares one request, and a failure is cached for 30 seconds
// only so Retry works soon after Stripe recovers. When billing is not
// connected (no STRIPE_SECRET_KEY, `isBillingLive` false) nothing is fetched
// and the answer is "unavailable": the page shows "Not connected", never a
// zero and never a number computed from a price list.

import type Stripe from "stripe";
import { isBillingLive, stripe } from "@/services/billing";
import {
  chargedSeries,
  revenueLines,
  type PaidInvoiceLite,
  type RangeWindow,
  type RevenueLine,
  type StripeSubscriptionLite,
} from "@/lib/admin/numbers";

const HOUR_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Past this many a list stops and the page says the figure is partial. */
export const STRIPE_LIST_CAP = 10_000;

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

function toLite(s: Stripe.Subscription): StripeSubscriptionLite {
  return {
    id: s.id,
    items: s.items.data.map((it) => ({
      currency: it.price.currency,
      unitAmount: it.price.unit_amount,
      quantity: it.quantity ?? null,
      interval: it.price.recurring?.interval ?? null,
      intervalCount: it.price.recurring?.interval_count ?? null,
      metered: it.price.recurring?.usage_type === "metered",
    })),
  };
}

interface ActiveSubs {
  subs: StripeSubscriptionLite[];
  truncated: boolean;
}

async function loadActiveSubscriptions(client: Stripe): Promise<ActiveSubs> {
  const rows = await client.subscriptions
    .list({ status: "active", limit: 100 }, { timeout: REQUEST_TIMEOUT_MS })
    .autoPagingToArray({ limit: STRIPE_LIST_CAP });
  return { subs: rows.map(toLite), truncated: rows.length >= STRIPE_LIST_CAP };
}

async function loadPaidInvoices(client: Stripe, since: Date): Promise<{ invoices: PaidInvoiceLite[]; truncated: boolean }> {
  const rows = await client.invoices
    .list({ status: "paid", created: { gte: Math.floor(since.getTime() / 1000) }, limit: 100 }, { timeout: REQUEST_TIMEOUT_MS })
    .autoPagingToArray({ limit: STRIPE_LIST_CAP });
  const invoices = rows.map((inv) => ({
    currency: inv.currency,
    amountPaid: inv.amount_paid,
    paidAt: new Date(((inv.status_transitions?.paid_at ?? inv.created) as number) * 1000),
  }));
  return { invoices, truncated: rows.length >= STRIPE_LIST_CAP };
}

export type StripeRevenue =
  | { source: "unavailable" }
  | { source: "error" }
  | {
      source: "stripe";
      lines: RevenueLine[];
      /** Active subscriptions left out because a price has no single amount (tiered, metered). */
      uncounted: number;
      /** The list stopped at STRIPE_LIST_CAP, so the figure is a floor. */
      truncated: boolean;
      /** When Stripe was last asked (the figures are up to an hour old). */
      asOf: string;
    };

/** Monthly revenue per currency from Stripe's active subscriptions. */
export async function readMonthlyRevenue(): Promise<StripeRevenue> {
  if (!isBillingLive || !stripe) return { source: "unavailable" };
  const client = stripe;
  const e = await cached("subscriptions:active", () => loadActiveSubscriptions(client));
  if (!e.ok) return { source: "error" };
  const { lines, uncounted } = revenueLines(e.value.subs);
  return { source: "stripe", lines, uncounted, truncated: e.value.truncated, asOf: new Date(e.at).toISOString() };
}

export type StripeCharged =
  | { source: "unavailable" }
  | { source: "error" }
  | { source: "stripe"; series: Map<string, number[]>; truncated: boolean; asOf: string };

/** What paid invoices took in each bucket of the window, per currency. */
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
