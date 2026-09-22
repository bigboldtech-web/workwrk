// The personal number (marketing-concept.md 7.4 and 3 row "sticky").
//
// Once a visitor has built a Stack Receipt, the sticky bar carries a grey
// chip reading "You'd keep X/mo", the final CTA repeats it, and /pricing
// opens prefilled. That means one small piece of state outlives the section
// that produced it, and it is the visitor's own arithmetic, so it never
// leaves their browser: localStorage, this shape, and nothing sent anywhere.
//
// Everything here is PURE except the two accessors at the bottom, which is
// deliberate: the parsing and the staleness rule are the parts worth testing,
// and a test should not need a DOM to reach them.
//
// Three rules the parser enforces, each learned from a way this breaks:
//
//   1. A stored record is UNTRUSTED input. It is written by an earlier
//      version of this site, hand edited in devtools, or corrupted. Anything
//      that does not parse is treated as absent.
//   2. It EXPIRES. Category list prices carry an `asOf` date and are
//      reviewed quarterly, so a chip quoting a number from an older price
//      table is quoting a price the site no longer shows. A record whose
//      `asOf` is not the current one is discarded rather than displayed.
//   3. It never renders a zero or a negative. "You'd keep $0/mo" is not a
//      reason to sign up, and "You'd keep -$40/mo" is an own goal.

import { pricing, isMarketingCurrency, type MarketingCurrency } from "./data/pricing";

export const PERSONAL_NUMBER_KEY = "workwrk:mk:receipt";

export interface StoredReceipt {
  /** The category ids the visitor tapped. */
  selected: string[];
  seats: number;
  currency: MarketingCurrency;
  /**
   * The prices the visitor CORRECTED, per category id.
   *
   * Without them the sticky chip and the closing line recomputed the saving
   * from list prices and quoted a different number from the receipt two
   * sections above, on a page whose whole argument is "this is your number".
   */
  overrides?: Record<string, number>;
  /** Monthly saving, in the stored currency. Always above zero. */
  keep: number;
  /** The price table this number came from, so a stale one can be dropped. */
  asOf: string;
}

/**
 * Parse a stored record. Returns null for anything this version cannot
 * stand behind, which is the same answer as "no receipt yet": the chip
 * simply does not render.
 */
export function parseStoredReceipt(raw: string | null | undefined): StoredReceipt | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  if (record.asOf !== pricing.asOf) return null;

  const keep = Number(record.keep);
  if (!Number.isFinite(keep) || keep <= 0) return null;

  const seats = Number(record.seats);
  if (!Number.isFinite(seats) || seats < 1) return null;

  const currency = typeof record.currency === "string" ? record.currency.toUpperCase() : "";
  if (!isMarketingCurrency(currency)) return null;

  const known = new Set(pricing.categories.map((c) => c.id));
  const selected = Array.isArray(record.selected)
    ? record.selected.filter((id): id is string => typeof id === "string" && known.has(id))
    : [];
  if (selected.length === 0) return null;

  const overrides: Record<string, number> = {};
  const rawOverrides = record.overrides;
  if (typeof rawOverrides === "object" && rawOverrides !== null) {
    for (const [id, value] of Object.entries(rawOverrides as Record<string, unknown>)) {
      const n = Number(value);
      if (known.has(id) && selected.includes(id) && Number.isFinite(n) && n >= 0) overrides[id] = n;
    }
  }

  return { selected, seats: Math.round(seats), currency, overrides, keep, asOf: pricing.asOf };
}

export function serializeStoredReceipt(input: Omit<StoredReceipt, "asOf">): string {
  return JSON.stringify({ ...input, asOf: pricing.asOf });
}

/**
 * The query string /pricing is opened with, so the receipt at the top of
 * that page starts where the visitor left it on the home page.
 */
export function prefillQuery(record: StoredReceipt): string {
  const params = new URLSearchParams();
  params.set("seats", String(record.seats));
  params.set("currency", record.currency);
  params.set("tools", record.selected.join(","));
  const prices = Object.entries(record.overrides ?? {}).map(([id, value]) => `${id}:${value}`);
  if (prices.length > 0) params.set("prices", prices.join(","));
  return params.toString();
}

/* ── The two impure accessors. Every storage call is wrapped: a private
      window, blocked site data and a quota error must never break a page
      whose only use for this is a grey chip. ─────────────────────────── */

export function readStoredReceipt(): StoredReceipt | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredReceipt(window.localStorage.getItem(PERSONAL_NUMBER_KEY));
  } catch {
    return null;
  }
}

export function writeStoredReceipt(input: Omit<StoredReceipt, "asOf"> | null): void {
  if (typeof window === "undefined") return;
  try {
    if (input === null || !Number.isFinite(input.keep) || input.keep <= 0 || input.selected.length === 0) {
      window.localStorage.removeItem(PERSONAL_NUMBER_KEY);
    } else {
      window.localStorage.setItem(PERSONAL_NUMBER_KEY, serializeStoredReceipt(input));
    }
  } catch {
    // Storage is a convenience here, never a dependency.
  }
  try {
    // The sticky bar and the final CTA live in different trees from the
    // calculator, so a plain state update cannot reach them. One event on
    // the document does, and it is the same pattern the instrumentation
    // module already uses.
    document.dispatchEvent(new CustomEvent(PERSONAL_NUMBER_EVENT));
  } catch {
    // Older engines still get the value on the next page load.
  }
}

export const PERSONAL_NUMBER_EVENT = "workwrk:mk:receipt-changed";
