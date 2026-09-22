// The Stack Receipt's shape, and the types both receipts share.
//
// Split out of receipt-model.ts for a bundle reason, not a design one, and
// it is the same reason dots.ts exists: receipt-model.ts imports the 850
// line Tuesday fixture for the WORK receipt, and the calculator island
// needs only the STACK half. Importing the one used to ship the other.
//
// Everything here is pure and reads nothing but the pricing source.
// The React component and the next/og route both render exactly what comes
// out of these functions, which is what stops a shared image from drifting
// from the page that produced it.

import type { DotColor } from "../dots";
import {
  formatMoney,
  pricing,
  stackReceipt,
  type MarketingCurrency,
  type StackReceipt,
} from "../data/pricing";

export interface ReceiptRow {
  id: string;
  /** Left column: a clock time on the work receipt, a category label on the stack receipt. */
  lead: string;
  /** Middle column: what happened, or nothing when the lead already says it. */
  label: string;
  /** The quiet right-of-label note: the modules that made the connection, or the per-seat price. */
  meta?: string;
  /** Far right, tabular: money on the stack receipt, absent on the work receipt. */
  amount?: string;
  dot?: DotColor;
  /** A cancelled subscription is shown by strike-through and grey, never by red. */
  struck?: boolean;
}

export interface ReceiptTotal {
  id: string;
  label: string;
  value: string;
  /** The one line the eye should land on. At most one per receipt. */
  emphasis?: boolean;
  note?: string;
}

export interface ReceiptModel {
  kind: "work" | "stack";
  title: string;
  meta: string;
  rows: ReceiptRow[];
  totals: ReceiptTotal[];
  footer: string;
  /** The 14 to 1 mark, on the stack receipt only. */
  mark?: string;
  /** Rendered under the rows when the numbers are dated list prices. */
  footnote?: string;
}

/** The stack receipt: the visitor's own subscriptions, at their own seat count. */
export function stackReceiptModel(input: {
  selected: string[];
  seats: number;
  currency?: MarketingCurrency;
  overrides?: Record<string, number>;
}): ReceiptModel {
  return stackReceiptModelFrom(stackReceipt(input));
}

export function stackReceiptModelFrom(receipt: StackReceipt): ReceiptModel {
  const money = (n: number) => formatMoney(n, receipt.currency);
  const perSeat = (n: number) => `${money(n)}/seat`;

  const rows: ReceiptRow[] = receipt.lines.map((line) => ({
    id: line.id,
    lead: line.label,
    label: "",
    meta: perSeat(line.perSeat),
    amount: money(line.monthly),
    struck: true,
  }));

  // The comparison needs something to compare, and NONE of it renders until
  // there is.
  //
  // With nothing selected the old stack is zero, so the arithmetic is true
  // and the reading is absurd: under a heading that says "Less than the
  // tools it replaces", the receipt opened by telling every visitor, before
  // they had touched anything, that WorkwrK costs 400 dollars a month more
  // than the nothing they are currently paying. The previous guard wrapped
  // only the "You keep" line and left the two totals that make the claim,
  // which fixed the conclusion and kept the premise.
  //
  // An empty receipt is one sentence saying what to do, which is what its
  // empty state is for.
  const toolWord = receipt.toolCount === 1 ? "tool" : "tools";
  const totals: ReceiptTotal[] = [];

  if (receipt.lines.length > 0) {
    totals.push(
      {
        id: "old",
        label: "Old stack",
        value: `${money(receipt.oldMonthly)}/mo`,
        note: `${receipt.toolCount} ${toolWord}`,
      },
      {
        id: "workwrk",
        label: `WorkwrK ${receipt.workwrkTierName}`,
        value: receipt.workwrkMonthly === null ? "Talk to sales" : `${money(receipt.workwrkMonthly)}/mo`,
        note: "1 tool",
      },
    );

    if (receipt.keepMonthly !== null) {
      const keep = receipt.keepMonthly;
      totals.push({
        id: "keep",
        label: keep >= 0 ? "You keep" : "You'd pay more",
        value: `${money(Math.abs(keep))}/mo`,
        emphasis: true,
      });
    }
  }

  return {
    kind: "stack",
    title: "STACK RECEIPT",
    meta: `${receipt.seats} ${receipt.seats === 1 ? "seat" : "seats"}`,
    rows,
    totals,
    // An empty receipt is not billed anything, so it does not say how it
    // would be billed. The footer states a term once there is a term.
    // "Billed annually, cancel anytime" used to print here. The first half
    // is in the pricing source (the offers say "Per user, per month, billed
    // annually"); the second half is a commercial term nothing in this repo
    // evidences, and /pricing deleted pro-rating, free guests and volume
    // discounts for exactly that reason. It is gone rather than softened.
    footer:
      receipt.lines.length === 0
        ? "Category list prices, editable"
        : receipt.workwrkTierName === "Starter"
          ? "Free plan, no card"
          : "Billed annually",
    // The visitor's own arithmetic, not the fixture's. A hardcoded 14 printed
    // "14 → 1" in the footer of a card whose rows listed three tools, which
    // is the one number on a shareable receipt that was not the sharer's.
    // The mark is a consolidation, so it needs at least two things to
    // consolidate: "1 → 1" is not a claim, it is a shrug.
    mark: receipt.toolCount > 1 ? `${receipt.toolCount} → 1` : undefined,
    footnote: receipt.footnote,
  };
}

/** The chip in the sticky bar and the final CTA, once a receipt exists. */
export function personalNumberLabel(receipt: StackReceipt): string | null {
  if (receipt.keepMonthly === null || receipt.keepMonthly <= 0) return null;
  return `You'd keep ${formatMoney(receipt.keepMonthly, receipt.currency)}/mo`;
}

/**
 * The share link behind "Copy my receipt", whose OG image is the receipt
 * itself.
 *
 * The EDITED prices travel with it. Every line on the receipt is editable and
 * the page invites the edit ("Change any of them to what you actually pay"),
 * so a link that dropped the edits sent someone else's number: the receipt on
 * screen, the chip under the nav, the line above the last button and the card
 * that unfurled from the link could all disagree, and three of the four were
 * list prices the sharer had just corrected.
 */
export function receiptShareQuery(input: {
  selected: string[];
  seats: number;
  currency: MarketingCurrency;
  overrides?: Record<string, number>;
}): string {
  const params = new URLSearchParams();
  params.set("kind", "stack");
  params.set("seats", String(Math.max(1, Math.round(input.seats))));
  params.set("currency", input.currency);
  if (input.selected.length > 0) params.set("tools", input.selected.join(","));
  const prices = Object.entries(input.overrides ?? {})
    // Only the lines that are actually on the receipt, and only real
    // numbers: a URL is untrusted the moment it leaves the page.
    .filter(([id, value]) => input.selected.includes(id) && Number.isFinite(value) && value >= 0)
    .map(([id, value]) => `${id}:${Math.round(value * 100) / 100}`);
  if (prices.length > 0) params.set("prices", prices.join(","));
  return params.toString();
}

/** The inverse of receiptShareQuery, tolerant of anything a URL can carry. */
export function parseReceiptQuery(params: URLSearchParams): {
  kind: "work" | "stack";
  selected: string[];
  seats: number;
  currency: MarketingCurrency;
  overrides: Record<string, number>;
} {
  const kind = params.get("kind") === "stack" ? "stack" : "work";
  const rawSeats = Number(params.get("seats"));
  const seats = Number.isFinite(rawSeats) && rawSeats > 0 ? Math.min(100000, Math.round(rawSeats)) : pricing.defaultSeats;
  const rawCurrency = (params.get("currency") ?? "").toUpperCase();
  const currency = (pricing.currencies.find((c) => c.code === rawCurrency)?.code ??
    pricing.defaultCurrency) as MarketingCurrency;
  const known = new Set(pricing.categories.map((c) => c.id));
  const selected = (params.get("tools") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => known.has(s));
  const overrides: Record<string, number> = {};
  for (const pair of (params.get("prices") ?? "").split(",")) {
    const [id, raw] = pair.split(":");
    const value = Number(raw);
    if (!known.has(id) || !selected.includes(id)) continue;
    if (!Number.isFinite(value) || value < 0 || value > 9999) continue;
    overrides[id] = value;
  }
  return { kind, selected, seats, currency, overrides };
}
