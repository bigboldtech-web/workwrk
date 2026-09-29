import { describe, expect, it } from "vitest";
import {
  averageOf,
  barPct,
  bucketIndex,
  bucketLabel,
  buildCohorts,
  chargedSeries,
  conversionPct,
  countByBucket,
  derivedRevenue,
  formatMoney,
  fromMinor,
  isWorkspaceUseType,
  isWorkwrkStripe,
  minorUnitExponent,
  monthKeyLabel,
  monthlyMinor,
  parseRange,
  rangeWindow,
  revenueLines,
  subscriptionMonthly,
  topCompanies,
  type CouponLite,
} from "./numbers";

const NOW = new Date("2026-09-29T15:30:00.000Z");

describe("parseRange", () => {
  it("keeps the three ranges and defaults everything else to 12 months", () => {
    expect(parseRange("30d")).toBe("30d");
    expect(parseRange("3m")).toBe("3m");
    expect(parseRange("12m")).toBe("12m");
    expect(parseRange(null)).toBe("12m");
    expect(parseRange("7d")).toBe("12m");
    expect(parseRange("12M")).toBe("12m");
  });
});

describe("rangeWindow", () => {
  it("30 days is six 5-day buckets ending now", () => {
    const w = rangeWindow("30d", NOW);
    expect(w.buckets).toHaveLength(6);
    expect(w.windowDays).toBe(30);
    expect(w.granularity).toBe("day");
    expect(w.start.toISOString()).toBe("2026-08-30T15:30:00.000Z");
    expect(w.buckets[5].end.getTime()).toBe(NOW.getTime());
    for (let i = 1; i < 6; i++) expect(w.buckets[i].start.getTime()).toBe(w.buckets[i - 1].end.getTime());
  });
  it("3 months is this calendar month and the two before it", () => {
    const w = rangeWindow("3m", NOW);
    expect(w.buckets.map((b) => b.start.toISOString().slice(0, 10))).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(w.granularity).toBe("month");
    expect(w.windowDays).toBe(91);
  });
  it("12 months crosses the year boundary and never holds more than 12 buckets", () => {
    const w = rangeWindow("12m", new Date("2026-02-10T00:00:00.000Z"));
    expect(w.buckets).toHaveLength(12);
    expect(w.start.toISOString().slice(0, 10)).toBe("2025-03-01");
    expect(w.buckets[11].start.toISOString().slice(0, 10)).toBe("2026-02-01");
  });
});

describe("bucketIndex and countByBucket", () => {
  const w = rangeWindow("3m", NOW);
  it("places a moment in its month and returns -1 outside the window", () => {
    expect(bucketIndex(new Date("2026-07-01T00:00:00.000Z"), w)).toBe(0);
    expect(bucketIndex(new Date("2026-08-31T23:59:59.999Z"), w)).toBe(1);
    expect(bucketIndex(NOW, w)).toBe(2);
    expect(bucketIndex(new Date("2026-06-30T23:59:59.999Z"), w)).toBe(-1);
    expect(bucketIndex(new Date("2026-10-01T00:00:00.000Z"), w)).toBe(-1);
  });
  it("counts per bucket", () => {
    const dates = ["2026-07-02", "2026-07-20", "2026-09-01", "2025-01-01"].map((d) => new Date(`${d}T12:00:00.000Z`));
    expect(countByBucket(dates, w)).toEqual([2, 0, 1]);
  });
});

describe("money", () => {
  it("knows Stripe's zero- and three-decimal currencies", () => {
    expect(minorUnitExponent("usd")).toBe(2);
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(minorUnitExponent("kwd")).toBe(3);
    expect(fromMinor(123456, "usd")).toBe(1234.56);
    expect(fromMinor(1500, "jpy")).toBe(1500);
    expect(fromMinor(1500, "kwd")).toBe(1.5);
  });
  it("writes the currency out and never converts", () => {
    const usd = formatMoney(123456, "usd", "en-US");
    expect(usd).toContain("USD");
    expect(usd).toContain("1,234.56");
    const inr = formatMoney(499900, "inr", "en-US");
    expect(inr).toContain("INR");
    expect(inr).toContain("4,999.00");
    expect(formatMoney(1500, "jpy", "en-US")).toMatch(/JPY\s?1,500$/);
  });
  it("still renders a code Intl does not know", () => {
    expect(formatMoney(100, "ZZZ", "en-US")).toContain("ZZZ");
  });
});

describe("monthlyMinor", () => {
  it("spreads a price over its interval", () => {
    expect(monthlyMinor({ unitAmount: 800, quantity: 10, interval: "month" })).toBe(8000);
    expect(monthlyMinor({ unitAmount: 12000, quantity: 1, interval: "year" })).toBe(1000);
    expect(monthlyMinor({ unitAmount: 3000, quantity: 1, interval: "month", intervalCount: 3 })).toBe(1000);
    expect(monthlyMinor({ unitAmount: 1200, quantity: 1, interval: "week" })).toBe(5200);
    expect(monthlyMinor({ unitAmount: 12, quantity: 1, interval: "day" })).toBe(365);
  });
  it("treats a missing quantity as one", () => {
    expect(monthlyMinor({ unitAmount: 500, quantity: null, interval: "month" })).toBe(500);
  });
  it("never guesses a tiered, metered or unknown price", () => {
    expect(monthlyMinor({ unitAmount: null, quantity: 3, interval: "month" })).toBeNull();
    expect(monthlyMinor({ unitAmount: 500, quantity: 3, interval: "month", metered: true })).toBeNull();
    expect(monthlyMinor({ unitAmount: 500, quantity: 3, interval: null })).toBeNull();
    expect(monthlyMinor({ unitAmount: 500, quantity: 3, interval: "fortnight" })).toBeNull();
  });
});

describe("revenueLines", () => {
  const item = (currency: string, unitAmount: number | null, quantity = 1, interval = "month") => ({
    currency,
    unitAmount,
    quantity,
    interval,
    intervalCount: 1,
    metered: false,
  });
  it("gives one line per currency and never adds across currencies", () => {
    const { lines, uncounted } = revenueLines([
      { id: "a", items: [item("usd", 800, 10)] },
      { id: "b", items: [item("usd", 12000, 1, "year")] },
      { id: "c", items: [item("eur", 900, 5)] },
    ]);
    expect(uncounted).toBe(0);
    expect(lines).toEqual([
      { currency: "USD", monthly: 9000, subscriptions: 2, companies: 2 },
      { currency: "EUR", monthly: 4500, subscriptions: 1, companies: 1 },
    ]);
  });
  it("leaves out a subscription whose price has no single amount, and counts it", () => {
    const { lines, uncounted } = revenueLines([
      { id: "a", items: [item("usd", 800, 2), item("usd", null, 4)] },
      { id: "b", items: [] },
      { id: "c", items: [item("usd", 100)] },
    ]);
    expect(uncounted).toBe(2);
    expect(lines).toEqual([{ currency: "USD", monthly: 100, subscriptions: 1, companies: 1 }]);
  });
  it("counts a subscription with two items once", () => {
    const { lines } = revenueLines([{ id: "a", items: [item("usd", 100), item("usd", 200)] }]);
    expect(lines[0]).toEqual({ currency: "USD", monthly: 300, subscriptions: 1, companies: 1 });
  });
  it("counts a company once when its customer has two subscriptions", () => {
    const { lines } = revenueLines([
      { id: "a", customer: "cus_1", items: [item("usd", 100)] },
      { id: "b", customer: "cus_1", items: [item("usd", 200)] },
    ]);
    expect(lines[0]).toEqual({ currency: "USD", monthly: 300, subscriptions: 2, companies: 1 });
    expect(derivedRevenue(lines[0]).arpu).toBe(300);
  });
});

describe("subscriptionMonthly (what Stripe charges, after discounts)", () => {
  const coupon = (id: string, over: Partial<CouponLite>): CouponLite => ({ id, percentOff: null, amountOff: null, currency: null, products: null, ...over });
  const coupons = new Map<string, CouponLite>([
    ["half", coupon("half", { percentOff: 50 })],
    ["comp", coupon("comp", { percentOff: 100 })],
    ["ten", coupon("ten", { amountOff: 1000, currency: "usd" })],
    ["ten_multi", coupon("ten_multi", { amountOff: 1000, currency: "usd", currencyOptions: { EUR: 900 } })],
    ["prod_a_only", coupon("prod_a_only", { percentOff: 50, products: ["prod_a"] })],
  ]);
  const it1 = (unitAmount: number, qty = 1, extra: Record<string, unknown> = {}) => ({
    currency: "usd",
    unitAmount,
    quantity: qty,
    interval: "month",
    intervalCount: 1,
    metered: false,
    ...extra,
  });
  it("takes a percent coupon off the subscription", () => {
    expect(subscriptionMonthly({ id: "s", items: [it1(800, 10)], discounts: ["half"] }, coupons)).toEqual({ currency: "USD", monthly: 4000 });
  });
  it("a 100% coupon charges nothing, so a comped pilot adds nothing", () => {
    expect(subscriptionMonthly({ id: "s", items: [it1(5000)], discounts: ["comp"] }, coupons)?.monthly).toBe(0);
  });
  it("takes an amount coupon once per interval and never below zero", () => {
    expect(subscriptionMonthly({ id: "s", items: [it1(3000)], discounts: ["ten"] }, coupons)?.monthly).toBe(2000);
    expect(subscriptionMonthly({ id: "s", items: [it1(500)], discounts: ["ten"] }, coupons)?.monthly).toBe(0);
    // A yearly price: 1,000 off a 12,000 year is 11,000 a year, 917 a month.
    expect(subscriptionMonthly({ id: "s", items: [it1(12000, 1, { interval: "year" })], discounts: ["ten"] }, coupons)?.monthly).toBe(917);
  });
  it("uses the coupon's amount in the subscription's currency, or leaves it out", () => {
    const eur = { ...it1(3000), currency: "eur" };
    expect(subscriptionMonthly({ id: "s", items: [eur], discounts: ["ten_multi"] }, coupons)).toEqual({ currency: "EUR", monthly: 2100 });
    expect(subscriptionMonthly({ id: "s", items: [eur], discounts: ["ten"] }, coupons)).toBeNull();
  });
  it("applies item discounts, and a coupon limited to some products only to those", () => {
    expect(subscriptionMonthly({ id: "s", items: [it1(1000, 1, { discounts: ["half"] }), it1(1000)] }, coupons)?.monthly).toBe(1500);
    expect(
      subscriptionMonthly({ id: "s", items: [it1(1000, 1, { product: "prod_a" }), it1(1000, 1, { product: "prod_b" })], discounts: ["prod_a_only"] }, coupons)?.monthly,
    ).toBe(1500);
  });
  it("leaves out a discount it cannot read rather than guess", () => {
    expect(subscriptionMonthly({ id: "s", items: [it1(1000)], discounts: [null] }, coupons)).toBeNull();
    expect(subscriptionMonthly({ id: "s", items: [it1(1000)], discounts: ["gone"] }, coupons)).toBeNull();
    expect(subscriptionMonthly({ id: "s", items: [it1(1000)], discounts: ["half"] })).toBeNull();
    const { lines, uncounted } = revenueLines([{ id: "s", items: [it1(1000)], discounts: ["gone"] }], coupons);
    expect(lines).toEqual([]);
    expect(uncounted).toBe(1);
  });
  it("leaves out items in two currencies or two intervals", () => {
    expect(subscriptionMonthly({ id: "s", items: [it1(1000), { ...it1(1000), currency: "eur" }] }, coupons)).toBeNull();
    expect(subscriptionMonthly({ id: "s", items: [it1(1000), it1(1000, 1, { interval: "year" })] }, coupons)).toBeNull();
  });
});

describe("isWorkwrkStripe", () => {
  const keys = {
    priceIds: new Set(["price_growth"]),
    customers: new Set(["cus_ours"]),
    subscriptions: new Set(["sub_ours"]),
    organizationIds: new Set(["org_1"]),
  };
  it("counts only what WorkwrK can name as its own", () => {
    expect(isWorkwrkStripe({ subscriptionId: "sub_ours" }, keys)).toBe(true);
    expect(isWorkwrkStripe({ customer: "cus_ours" }, keys)).toBe(true);
    expect(isWorkwrkStripe({ organizationId: "org_1" }, keys)).toBe(true);
    expect(isWorkwrkStripe({ priceIds: ["price_other", "price_growth"] }, keys)).toBe(true);
    // Another product in the same Stripe account, or checkout metadata naming no company that exists.
    expect(isWorkwrkStripe({ subscriptionId: "sub_x", customer: "cus_x", organizationId: "org_gone", priceIds: ["price_other"] }, keys)).toBe(false);
    expect(isWorkwrkStripe({}, keys)).toBe(false);
  });
});

describe("isWorkspaceUseType", () => {
  it("never counts signup, signing in or out, switching, security, migrations or staff rows as use", () => {
    for (const t of [
      "organization_created",
      "organization_scheduled_deletion",
      "organization_deletion_cancelled",
      "login",
      "logout",
      "session.idle",
      "org.switch.in",
      "org.switch.out",
      "password_changed",
      "mfa_enabled",
      "staff.status.changed",
      "staff.plan.changed",
      "admin.org.plan_changed",
      "work.tasks_migrated",
      "access.settings.migrated",
      "legacy_marketing_imported",
    ]) {
      expect(isWorkspaceUseType(t)).toBe(false);
    }
  });
  it("never counts an Owner deleting the workspace, or restoring it, as use", () => {
    // The Owner belongs to the workspace, so only the type keeps a company
    // deleted on day one out of "Still active" and "Busiest workspaces".
    expect(isWorkspaceUseType("organization_scheduled_deletion")).toBe(false);
    expect(isWorkspaceUseType("organization_deletion_cancelled")).toBe(false);
  });
  it("counts what people do in the workspace", () => {
    for (const t of ["task_created", "sop_created", "table.create", "okr_check_in", "kudos_given", "user.invited", "access.granted"]) {
      expect(isWorkspaceUseType(t)).toBe(true);
    }
  });
});

describe("chargedSeries", () => {
  it("sums paid invoices per bucket and per currency, ignoring the outside and the zero", () => {
    const w = rangeWindow("3m", NOW);
    const s = chargedSeries(
      [
        { currency: "usd", amountPaid: 1000, paidAt: new Date("2026-07-05T00:00:00Z") },
        { currency: "usd", amountPaid: 500, paidAt: new Date("2026-07-25T00:00:00Z") },
        { currency: "usd", amountPaid: 0, paidAt: new Date("2026-08-05T00:00:00Z") },
        { currency: "eur", amountPaid: 700, paidAt: new Date("2026-09-02T00:00:00Z") },
        { currency: "usd", amountPaid: 9999, paidAt: new Date("2026-01-02T00:00:00Z") },
      ],
      w,
    );
    expect(s.get("USD")).toEqual([1500, 0, 0]);
    expect(s.get("EUR")).toEqual([0, 0, 700]);
  });
});

describe("derivedRevenue", () => {
  it("run rate is monthly times twelve and the average divides by subscriptions", () => {
    expect(derivedRevenue({ currency: "USD", monthly: 9000, subscriptions: 2 })).toEqual({ monthly: 9000, arr: 108000, arpu: 4500 });
    expect(derivedRevenue({ currency: "USD", monthly: 0, subscriptions: 0 }).arpu).toBeNull();
  });
});

describe("funnel and bars", () => {
  it("converts from the step above and never divides by zero", () => {
    expect(conversionPct(5, 10)).toBe(50);
    expect(conversionPct(1, 3)).toBe(33);
    expect(conversionPct(0, 0)).toBeNull();
    expect(conversionPct(4, null)).toBeNull();
  });
  it("never prints more than 100%", () => {
    expect(conversionPct(5, 1)).toBe(100);
  });
  it("bars are relative to the largest and clamp", () => {
    expect(barPct(5, 10)).toBe(50);
    expect(barPct(0, 10)).toBe(0);
    expect(barPct(3, 0)).toBe(0);
    expect(barPct(20, 10)).toBe(100);
  });
  it("averages to one decimal", () => {
    expect(averageOf(10, 3)).toBe(3.3);
    expect(averageOf(5, 0)).toBe(0);
  });
});

describe("buildCohorts", () => {
  it("one row per month, newest first, from activity rather than billing status", () => {
    const w = rangeWindow("3m", NOW);
    const companies = [
      { id: "a", createdAt: new Date("2026-07-03T00:00:00Z") },
      { id: "b", createdAt: new Date("2026-07-20T00:00:00Z") },
      { id: "c", createdAt: new Date("2026-09-10T00:00:00Z") },
      { id: "z", createdAt: new Date("2025-01-01T00:00:00Z") },
    ];
    const rows = buildCohorts(companies, { active: new Set(["a", "c"]), paying: new Set(["a"]), cancelled: new Set(["b"]) }, w);
    expect(rows.map((r) => r.month)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(rows[2]).toEqual({ month: "2026-07", size: 2, stillActive: 1, paying: 1, cancelled: 1, retention: 50 });
    expect(rows[1]).toEqual({ month: "2026-08", size: 0, stillActive: 0, paying: 0, cancelled: 0, retention: null });
    expect(rows[0].retention).toBe(100);
  });
  it("a 30-day window starting mid-month includes that month", () => {
    const rows = buildCohorts([], { active: new Set(), paying: new Set(), cancelled: new Set() }, rangeWindow("30d", NOW));
    expect(rows.map((r) => r.month)).toEqual(["2026-09", "2026-08"]);
  });
});

describe("topCompanies", () => {
  it("top five by value, ties by name, zeros left out", () => {
    const rows = [
      { id: "1", name: "Beta", value: 5 },
      { id: "2", name: "Alpha", value: 5 },
      { id: "3", name: "Zero", value: 0 },
      { id: "4", name: "Gamma", value: 9 },
      { id: "5", name: "D", value: 1 },
      { id: "6", name: "E", value: 2 },
      { id: "7", name: "F", value: 3 },
    ];
    expect(topCompanies(rows).map((r) => r.name)).toEqual(["Gamma", "Alpha", "Beta", "F", "E"]);
  });
});

describe("labels", () => {
  it("labels buckets and cohort months in UTC", () => {
    expect(bucketLabel("2026-09-01T00:00:00.000Z", "month", "en-US")).toBe("Sep 2026");
    expect(bucketLabel("2026-08-30T23:30:00.000Z", "day", "en-GB")).toBe("30 Aug");
    expect(monthKeyLabel("2026-01", "en-US")).toBe("Jan 2026");
    expect(monthKeyLabel("nope", "en-US")).toBe("nope");
  });
});
