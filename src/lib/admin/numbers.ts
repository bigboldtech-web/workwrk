// The Staff console's numbers (spec-admin-backoffice 2.1 Overview, 2.5
// Analytics, section 4 step 6). Pure and client-safe: the range windows and
// their buckets, Stripe money (minor units, per-month normalisation, one line
// per currency, never converted), the funnel, the retention cohorts and the
// ranked lists. GET /api/admin/overview, GET /api/admin/analytics, their CSV
// and both pages read these one definitions, and vitest proves them.
//
// There is no price list anywhere in this file or in the codebase any more.
// The old console multiplied a hard-coded rupee price by the number of
// companies on each plan and called it monthly recurring revenue; see
// docs/plans/ui-refresh/staff-console-numbers.md for why that was wrong.

/* ───────────────────────── ranges ───────────────────────── */

export const ANALYTICS_RANGES = ["30d", "3m", "12m"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const RANGE_LABEL: Record<AnalyticsRange, string> = {
  "30d": "30 days",
  "3m": "3 months",
  "12m": "12 months",
};

/** An unknown or missing range is 12 months: the question Analytics exists to answer is the year. */
export const DEFAULT_RANGE: AnalyticsRange = "12m";

export function parseRange(raw: string | null | undefined): AnalyticsRange {
  return (ANALYTICS_RANGES as readonly string[]).includes(raw ?? "") ? (raw as AnalyticsRange) : DEFAULT_RANGE;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface TimeBucket {
  start: Date;
  /** Exclusive; the last bucket ends at `now`. */
  end: Date;
}

export interface RangeWindow {
  range: AnalyticsRange;
  start: Date;
  end: Date;
  /** Whole days the window spans, rounded up ("last {n} days"). */
  windowDays: number;
  /** How a bucket is labelled: by its first day, or by its month. */
  granularity: "day" | "month";
  buckets: TimeBucket[];
}

export function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function addMonthsUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/** "2026-09": a month key, in UTC. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Six 5-day buckets across the last 30 days, so every bar is the same length of time. */
const DAY_BUCKETS = 6;
const DAYS_PER_BUCKET = 5;

/**
 * The window a range asks about, and its chart buckets.
 *
 *   30d  the last 30 days, rolling, in six 5-day buckets (a bar per month
 *        would be one and a half bars)
 *   3m   this calendar month and the two before it, a bucket per month
 *   12m  this calendar month and the eleven before it, a bucket per month
 *
 * The current month is always the last bucket and is always partial; the
 * page says "so far" rather than letting it read as a drop. Every chart
 * holds at most 12 buckets. All in UTC, the calendar Stripe bills in.
 */
export function rangeWindow(range: AnalyticsRange, now: Date): RangeWindow {
  const end = new Date(now.getTime());
  if (range === "30d") {
    const start = new Date(end.getTime() - DAY_BUCKETS * DAYS_PER_BUCKET * DAY_MS);
    const buckets: TimeBucket[] = [];
    for (let i = 0; i < DAY_BUCKETS; i++) {
      const s = new Date(start.getTime() + i * DAYS_PER_BUCKET * DAY_MS);
      const e = i === DAY_BUCKETS - 1 ? end : new Date(start.getTime() + (i + 1) * DAYS_PER_BUCKET * DAY_MS);
      buckets.push({ start: s, end: e });
    }
    return { range, start, end, windowDays: DAY_BUCKETS * DAYS_PER_BUCKET, granularity: "day", buckets };
  }
  const months = range === "3m" ? 3 : 12;
  const first = addMonthsUTC(startOfMonthUTC(end), -(months - 1));
  const buckets: TimeBucket[] = [];
  for (let i = 0; i < months; i++) {
    const s = addMonthsUTC(first, i);
    const e = i === months - 1 ? end : addMonthsUTC(first, i + 1);
    buckets.push({ start: s, end: e });
  }
  return {
    range,
    start: first,
    end,
    windowDays: Math.max(1, Math.ceil((end.getTime() - first.getTime()) / DAY_MS)),
    granularity: "month",
    buckets,
  };
}

/** Which bucket a moment falls in, or -1 outside the window. */
export function bucketIndex(at: Date, w: Pick<RangeWindow, "buckets">): number {
  const t = at.getTime();
  for (let i = 0; i < w.buckets.length; i++) {
    const b = w.buckets[i];
    const last = i === w.buckets.length - 1;
    if (t >= b.start.getTime() && (t < b.end.getTime() || (last && t === b.end.getTime()))) return i;
  }
  return -1;
}

/** How many of `dates` fall in each bucket. */
export function countByBucket(dates: readonly Date[], w: Pick<RangeWindow, "buckets">): number[] {
  const out = w.buckets.map(() => 0);
  for (const d of dates) {
    const i = bucketIndex(d, w);
    if (i >= 0) out[i]++;
  }
  return out;
}

/* ───────────────────────── money ───────────────────────── */

// Stripe's own lists (stripe.com/docs/currencies): amounts in these arrive
// in whole units, or in thousandths. Every other currency is in hundredths.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

/** Decimal places Stripe uses for a currency's minor unit. */
export function minorUnitExponent(currency: string): 0 | 2 | 3 {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** A Stripe minor-unit amount as a plain number in the currency's major unit. */
export function fromMinor(amount: number, currency: string): number {
  return amount / 10 ** minorUnitExponent(currency);
}

/**
 * An amount with its currency WRITTEN OUT ("USD 1,240.00"), never a bare
 * symbol that could be dollars of three countries. Never converted: the
 * amount is formatted in the currency Stripe charged it in.
 */
export function formatMoney(minor: number, currency: string, language?: string | null): string {
  const code = currency.toUpperCase();
  const digits = minorUnitExponent(code);
  try {
    return new Intl.NumberFormat(language || undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: "code",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(fromMinor(minor, code));
  } catch {
    // A code Intl does not know still renders, with the code after the number.
    return `${new Intl.NumberFormat(language || undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(fromMinor(minor, code))} ${code}`;
  }
}

export type BillingInterval = "day" | "week" | "month" | "year";

/** Months in one billing interval (a year is 12, a week 12/52 of a month). */
const MONTHS_PER: Record<BillingInterval, number> = { day: 12 / 365, week: 12 / 52, month: 1, year: 12 };

/**
 * What one subscription item costs per month, in minor units: Stripe's own
 * unit amount times the quantity, spread over its interval. Null when the
 * price has no single unit amount (tiered or metered prices), so it is never
 * guessed. Rounded to a whole minor unit.
 */
export function monthlyMinor(input: {
  unitAmount: number | null | undefined;
  quantity: number | null | undefined;
  interval: string | null | undefined;
  intervalCount?: number | null;
  metered?: boolean;
}): number | null {
  const { unitAmount, interval } = input;
  if (input.metered) return null;
  if (typeof unitAmount !== "number" || !Number.isFinite(unitAmount) || unitAmount < 0) return null;
  if (!interval || !(interval in MONTHS_PER)) return null;
  const qty = typeof input.quantity === "number" && input.quantity >= 0 ? input.quantity : 1;
  const count = typeof input.intervalCount === "number" && input.intervalCount > 0 ? input.intervalCount : 1;
  const months = MONTHS_PER[interval as BillingInterval] * count;
  return Math.round((unitAmount * qty) / months);
}

export interface StripeItemLite {
  currency: string;
  unitAmount: number | null;
  quantity: number | null;
  interval: string | null;
  intervalCount: number | null;
  metered: boolean;
  /** The price's product id, for a coupon that applies to some products only. */
  product?: string | null;
  /** Coupon ids of the discounts on this item; null where Stripe gave no coupon. */
  discounts?: (string | null)[];
}

export interface StripeSubscriptionLite {
  id: string;
  /** The Stripe customer: one per company (services/billing.ts ensureStripeCustomer). */
  customer?: string | null;
  items: StripeItemLite[];
  /** Coupon ids of the discounts on the whole subscription; null where Stripe gave no coupon. */
  discounts?: (string | null)[];
}

/** The part of a Stripe coupon a discount's amount depends on. */
export interface CouponLite {
  id: string;
  percentOff: number | null;
  /** Minor units, in `currency`. */
  amountOff: number | null;
  currency: string | null;
  /** amount_off in other currencies (Stripe's currency_options), minor units, keyed by upper-case code. */
  currencyOptions?: Record<string, number>;
  /** Product ids the coupon is limited to; null when it applies to every product. */
  products: string[] | null;
}

export interface RevenueLine {
  /** Upper-case ISO code, as Stripe charged it. */
  currency: string;
  /** Minor units per month. */
  monthly: number;
  /** Subscriptions counted in this line. */
  subscriptions: number;
  /** Distinct Stripe customers (companies) counted in this line. */
  companies?: number;
}

function couponAmountOff(c: CouponLite, currency: string): number | null {
  if (c.amountOff === null) return null;
  const cur = currency.toUpperCase();
  if (c.currency && c.currency.toUpperCase() === cur) return c.amountOff;
  const opt = c.currencyOptions?.[cur];
  return typeof opt === "number" ? opt : null;
}

function couponApplies(c: CouponLite, product: string | null | undefined): boolean {
  return c.products === null || (!!product && c.products.includes(product));
}

/**
 * What one subscription charges per month after its discounts, in minor
 * units and one currency, or null when that cannot be read exactly (a
 * tiered or metered price, items in two currencies or two intervals, or a
 * discount whose coupon is unknown or has no amount in this currency), so
 * the subscription is left out and counted rather than guessed.
 *
 * Stripe's order: item discounts first, then the subscription's. A percent
 * coupon takes its share of every item it applies to; an amount coupon takes
 * its amount off once per billing interval (off the item, or off the items
 * it applies to), never below zero.
 */
export function subscriptionMonthly(
  s: StripeSubscriptionLite,
  coupons?: ReadonlyMap<string, CouponLite>,
): { currency: string; monthly: number } | null {
  if (s.items.length === 0) return null;
  const currency = s.items[0].currency.toUpperCase();
  const interval = s.items[0].interval;
  const count = s.items[0].intervalCount ?? 1;
  if (!interval || !(interval in MONTHS_PER)) return null;
  const lookup = (id: string | null): CouponLite | null => (id && coupons ? coupons.get(id) ?? null : null);

  const amounts: { amount: number; product: string | null | undefined }[] = [];
  for (const it of s.items) {
    if (it.currency.toUpperCase() !== currency || it.interval !== interval || (it.intervalCount ?? 1) !== count) return null;
    // monthlyMinor is the one check for a price with no single amount.
    if (monthlyMinor(it) === null) return null;
    const qty = typeof it.quantity === "number" && it.quantity >= 0 ? it.quantity : 1;
    let amount = (it.unitAmount as number) * qty;
    for (const id of it.discounts ?? []) {
      const c = lookup(id);
      if (!c) return null;
      if (c.percentOff !== null) amount = amount * (1 - c.percentOff / 100);
      else {
        const off = couponAmountOff(c, currency);
        if (off === null) return null;
        amount = Math.max(0, amount - off);
      }
    }
    amounts.push({ amount, product: it.product });
  }
  for (const id of s.discounts ?? []) {
    const c = lookup(id);
    if (!c) return null;
    const eligible = amounts.filter((a) => couponApplies(c, a.product));
    if (c.percentOff !== null) {
      for (const a of eligible) a.amount = a.amount * (1 - c.percentOff / 100);
    } else {
      let off = couponAmountOff(c, currency);
      if (off === null) return null;
      for (const a of eligible) {
        const take = Math.min(a.amount, off);
        a.amount -= take;
        off -= take;
      }
    }
  }
  const perInterval = amounts.reduce((t, a) => t + a.amount, 0);
  const months = MONTHS_PER[interval as BillingInterval] * (count > 0 ? count : 1);
  return { currency, monthly: Math.round(perInterval / months) };
}

/**
 * Monthly revenue, one line per currency, largest first, after each
 * subscription's own discounts. A subscription whose charge cannot be read
 * exactly (see subscriptionMonthly) is left out whole and counted in
 * `uncounted`, so the page can say how many were not counted rather than
 * show a quietly wrong number.
 */
export function revenueLines(
  subs: readonly StripeSubscriptionLite[],
  coupons?: ReadonlyMap<string, CouponLite>,
): { lines: RevenueLine[]; uncounted: number } {
  const by = new Map<string, { monthly: number; subs: Set<string>; customers: Set<string> }>();
  let uncounted = 0;
  for (const s of subs) {
    const m = subscriptionMonthly(s, coupons);
    if (!m) {
      uncounted++;
      continue;
    }
    const row = by.get(m.currency) ?? { monthly: 0, subs: new Set<string>(), customers: new Set<string>() };
    row.monthly += m.monthly;
    row.subs.add(s.id);
    row.customers.add(s.customer ?? s.id);
    by.set(m.currency, row);
  }
  const lines = [...by.entries()]
    .map(([currency, r]) => ({ currency, monthly: r.monthly, subscriptions: r.subs.size, companies: r.customers.size }))
    .sort((a, b) => b.subscriptions - a.subscriptions || a.currency.localeCompare(b.currency));
  return { lines, uncounted };
}

/** What the console knows is WorkwrK's in a Stripe account that may bill other things too. */
export interface WorkwrkStripeKeys {
  /** The priceCatalog price ids (services/billing.ts). */
  priceIds: ReadonlySet<string>;
  /** Subscription.stripeCustomerId values in our database. */
  customers: ReadonlySet<string>;
  /** Subscription.stripeSubscriptionId values in our database. */
  subscriptions: ReadonlySet<string>;
  /** Organization ids that exist, for Stripe metadata.organizationId (set by checkout). */
  organizationIds: ReadonlySet<string>;
}

/**
 * Whether a Stripe subscription or invoice is WorkwrK's: one of our price
 * ids, a customer or subscription our database holds, or checkout's
 * metadata naming a company that exists. Anything else in the account
 * (another product, a test subscription) is not WorkwrK revenue.
 */
export function isWorkwrkStripe(
  x: { subscriptionId?: string | null; customer?: string | null; priceIds?: readonly (string | null | undefined)[]; organizationId?: string | null },
  k: WorkwrkStripeKeys,
): boolean {
  if (x.subscriptionId && k.subscriptions.has(x.subscriptionId)) return true;
  if (x.customer && k.customers.has(x.customer)) return true;
  if (x.organizationId && k.organizationIds.has(x.organizationId)) return true;
  return (x.priceIds ?? []).some((p) => !!p && k.priceIds.has(p));
}

export interface PaidInvoiceLite {
  currency: string;
  /** Minor units actually paid. */
  amountPaid: number;
  paidAt: Date;
}

/** What Stripe was paid in each bucket, one series per currency. */
export function chargedSeries(invoices: readonly PaidInvoiceLite[], w: Pick<RangeWindow, "buckets">): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const inv of invoices) {
    const i = bucketIndex(inv.paidAt, w);
    if (i < 0 || !(inv.amountPaid > 0)) continue;
    const cur = inv.currency.toUpperCase();
    const row = out.get(cur) ?? w.buckets.map(() => 0);
    row[i] += inv.amountPaid;
    out.set(cur, row);
  }
  return out;
}

/** Monthly revenue, Annual run rate (monthly x 12) and Average per paying company for one currency. */
export function derivedRevenue(line: RevenueLine): { monthly: number; arr: number; arpu: number | null } {
  // A company is a Stripe customer; a line built before customers were read divides by subscriptions.
  const payers = line.companies ?? line.subscriptions;
  return {
    monthly: line.monthly,
    arr: line.monthly * 12,
    arpu: payers > 0 ? Math.round(line.monthly / payers) : null,
  };
}

/* ───────────────────────── workspace use ───────────────────────── */

/**
 * ActivityLog rows that are not somebody using the workspace, so "Still
 * active" and "Busiest workspaces" never count them: the signup row itself,
 * an Owner deleting the workspace or undoing that (lifecycle rows like the
 * signup; without them a company deleted on day one read as retained),
 * signing in and out, switching between workspaces (written to the company a
 * person LEFT as well as the one they entered), a person's own security
 * settings, data migrations, and every row WorkwrK staff cause. The rest of
 * the rule is in lib/admin/workspace-use.ts: the actor must be a person who
 * belongs to that workspace.
 */
export const NOT_USE_TYPES = [
  "organization_created",
  "organization_scheduled_deletion",
  "organization_deletion_cancelled",
  "login",
  "logout",
  "session.idle",
  "password_changed",
  "mfa_enabled",
  "mfa_disabled",
  "signed_out_all_devices",
  "legacy_marketing_imported",
] as const;

/** SQL LIKE patterns for families of the same kind. */
export const NOT_USE_PATTERNS = ["org.switch.%", "staff.%", "admin.%", "%_migrated", "%.migrated"] as const;

/** The same rule in code, for tests and for any caller that already holds the rows. */
export function isWorkspaceUseType(type: string): boolean {
  if ((NOT_USE_TYPES as readonly string[]).includes(type)) return false;
  return !NOT_USE_PATTERNS.some((p) => {
    const body = p.replace(/%/g, "");
    if (p.startsWith("%") && p.endsWith("%")) return type.includes(body);
    if (p.startsWith("%")) return type.endsWith(body);
    if (p.endsWith("%")) return type.startsWith(body);
    return type === p;
  });
}

/* ───────────────────────── funnel, cohorts, lists ───────────────────────── */

/**
 * Whole-percent conversion from the step above; null when the step above is
 * zero. The funnel's steps are nested (each counts only companies that did
 * the step above), so this never passes 100; it is capped anyway, so a
 * miscount can never print "300%".
 */
export function conversionPct(count: number, previous: number | null): number | null {
  if (previous === null || !(previous > 0)) return null;
  return Math.min(100, Math.round((count / previous) * 100));
}

/** A 4px bar's fill relative to the largest value, 0 to 100. */
export function barPct(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export interface CohortCompany {
  id: string;
  createdAt: Date;
}

export interface CohortRow {
  /** "2026-09" */
  month: string;
  size: number;
  stillActive: number;
  paying: number;
  cancelled: number;
  /** Whole percent of the cohort still active; null for an empty cohort. */
  retention: number | null;
}

/**
 * One row per calendar month from the window's first month to now, newest
 * first. Still active = somebody in that workspace did something in the
 * last 30 days (not the billing status, which a staff member sets). Paying =
 * a Stripe subscription that is active or past due today. Cancelled = the workspace was cancelled or
 * its subscription was.
 */
export function buildCohorts(
  companies: readonly CohortCompany[],
  sets: { active: ReadonlySet<string>; paying: ReadonlySet<string>; cancelled: ReadonlySet<string> },
  w: Pick<RangeWindow, "start" | "end">,
): CohortRow[] {
  const rows = new Map<string, CohortRow>();
  for (let m = startOfMonthUTC(w.start); m.getTime() <= w.end.getTime(); m = addMonthsUTC(m, 1)) {
    rows.set(monthKey(m), { month: monthKey(m), size: 0, stillActive: 0, paying: 0, cancelled: 0, retention: null });
  }
  for (const c of companies) {
    const row = rows.get(monthKey(c.createdAt));
    if (!row) continue;
    row.size++;
    if (sets.active.has(c.id)) row.stillActive++;
    if (sets.paying.has(c.id)) row.paying++;
    if (sets.cancelled.has(c.id)) row.cancelled++;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, retention: r.size > 0 ? Math.round((r.stillActive / r.size) * 100) : null }))
    .reverse();
}

export interface RankedCompany {
  id: string;
  name: string;
  value: number;
}

/** The top `n` by value, ties broken by name, zeros left out (a zero is not a rank). */
export function topCompanies(rows: readonly RankedCompany[], n = 5): RankedCompany[] {
  return rows
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, n);
}

/** "12.3": an average to one decimal, "0" with nothing to divide. */
export function averageOf(total: number, count: number): number {
  if (!(count > 0)) return 0;
  return Math.round((total / count) * 10) / 10;
}

/** A bucket's label: "Sep 2026" for a month, "31 Aug" for a 5-day bucket's first day. UTC, like the buckets. */
export function bucketLabel(startIso: string, granularity: "day" | "month", language?: string | null): string {
  const d = new Date(startIso);
  const opts: Intl.DateTimeFormatOptions =
    granularity === "month" ? { month: "short", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(language || undefined, opts).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  }
}

/** "Sep 2026": a cohort month key as words. */
export function monthKeyLabel(key: string, language?: string | null): string {
  const [y, m] = key.split("-").map((s) => Number.parseInt(s, 10));
  if (!y || !m) return key;
  return bucketLabel(new Date(Date.UTC(y, m - 1, 1)).toISOString(), "month", language);
}
