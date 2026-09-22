// The pricing source (marketing-concept.md section 12, Phase 0 item 2).
//
// One JSON feeds four consumers that used to disagree with each other: the
// Stack Receipt calculator, the pricing cards, the "Replaces roughly $X per
// seat" line, and the SoftwareApplication JSON-LD. Before this file the site
// stated its prices four different ways and fed Google a fifth.
//
// Two rules that the unit tests enforce:
//
//   1. WorkwrK prices are AUTHORED per currency, never converted. The FX
//      table in src/lib/currency.ts is a stale static snapshot, so a
//      multiplied price is wrong by whatever the market has moved.
//   2. The free Starter seat cap equals the cap the product ENFORCES
//      (PLAN_LIMITS.STARTER.users). "Start free" is only honest if the
//      number on the page is the number the server checks.
//
// The fourteen category prices are dated public list-price midpoints for a
// CATEGORY, not for any vendor. They carry `asOf`, they are footnoted, and
// they are editable in the receipt. No competitor is named here or anywhere
// outside /compare.

import { positioningLine } from "../positioning";
import { flagOn, type FlagName } from "../flags";
import raw from "./pricing.json";

export type MarketingCurrency = "USD" | "INR" | "AED" | "SGD" | "GBP" | "EUR";
export type TierId = "starter" | "growth" | "scale";

export interface CurrencyDef {
  code: MarketingCurrency;
  symbol: string;
  locale: string;
  position: "before" | "after";
  decimals: number;
}

export interface Tier {
  id: TierId;
  name: string;
  plan: string;
  free: boolean;
  seatCap: number;
  forWhom: string;
  perSeat: Record<MarketingCurrency, number | null>;
  priceLabel: string;
  priceSubLabel: string;
  cta: "trial" | "demo";
  recommended: boolean;
  recommendedNote?: string;
  bullets: string[];
  /**
   * Bullets that name something not shipped. Each carries the flag that
   * makes it true, and a card renders it only when the flag is on.
   *
   * This exists because one of them, "Migration help on the way in", sat in
   * the plain bullet list on the top tier while the FAQ two sections below
   * said "We have no migration service to sell you". The page contradicted
   * itself in a way a buyer would notice, and the fix cannot be a copy edit
   * in a component: it has to be the same kind of gate the rest of the site
   * uses, so the sentence comes back by flipping a flag and not by
   * remembering it exists.
   */
  gatedBullets?: Array<{ text: string; flag: FlagName }>;
  modules: Record<string, boolean | "limited">;
}

export interface Category {
  id: string;
  label: string;
  hub: string;
  icon: string;
  usdPerSeat: number;
  /**
   * The lowest tier that actually replaces this category, when the block
   * alone is not the answer. Reviews and surveys live inside Teams, which
   * Starter has, but they are Growth features, so a Starter card that counted
   * them would contradict its own bullet list two lines above the total.
   * Absent means "wherever the block is included".
   */
  fromTier?: TierId;
}

export interface PricingSource {
  version: number;
  asOf: string;
  asOfLabel: string;
  listPriceFootnote: string;
  defaultCurrency: MarketingCurrency;
  defaultSeats: number;
  seatCapSource: string;
  seatCapNote: string;
  currencies: CurrencyDef[];
  tiers: Tier[];
  premiumModules: Array<{ id: string; name: string; fromTier: TierId }>;
  categories: Category[];
  categoryPriceCurrencies: Record<MarketingCurrency, number>;
  categoryPriceCurrenciesNote: string;
}

export const pricing = raw as unknown as PricingSource;

/**
 * The step a converted category tile rounds to. A "what if" calculator that
 * prints 647 for a category midpoint reads as a quote; rounding says
 * estimate. INR is the only currency here whose unit is small enough to
 * need a step above 1.
 */
const ROUND_STEP: Record<MarketingCurrency, number> = {
  USD: 1,
  INR: 10,
  AED: 1,
  SGD: 1,
  GBP: 1,
  EUR: 1,
};

export const CURRENCY_CODES: MarketingCurrency[] = pricing.currencies.map((c) => c.code);

export function isMarketingCurrency(code: string): code is MarketingCurrency {
  return (CURRENCY_CODES as string[]).includes(code);
}

export function currencyDef(code: MarketingCurrency): CurrencyDef {
  const found = pricing.currencies.find((c) => c.code === code);
  if (!found) throw new Error(`Unknown marketing currency: ${code}`);
  return found;
}

/**
 * The six currencies the site offers, keyed by country. Deliberately its own
 * small map rather than the product's 21 currency table: the site shows six,
 * and anything not listed falls to the USD default rather than guessing.
 */
const COUNTRY_CURRENCY: Record<string, MarketingCurrency> = {
  US: "USD",
  IN: "INR",
  AE: "AED",
  SA: "AED",
  SG: "SGD",
  MY: "SGD",
  GB: "GBP",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  NL: "EUR",
  ES: "EUR",
  IT: "EUR",
  BE: "EUR",
  AT: "EUR",
  PT: "EUR",
  FI: "EUR",
};

/** Geo detection, the honest version: a known country or the USD default. */
export function currencyFromCountry(country: string | null | undefined): MarketingCurrency {
  if (!country) return pricing.defaultCurrency;
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? pricing.defaultCurrency;
}

/** Whole-unit money. Intl does symbol placement per locale so the site never hand-positions one. */
export function formatMoney(amount: number, code: MarketingCurrency): string {
  const def = currencyDef(code);
  try {
    return new Intl.NumberFormat(def.locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: def.decimals,
      minimumFractionDigits: def.decimals,
    }).format(amount);
  } catch {
    // An engine without the locale data still has to print a number.
    const n = Math.round(amount).toLocaleString("en-US");
    return def.position === "after" ? `${n} ${def.symbol.trim()}` : `${def.symbol}${n}`;
  }
}

/** A tier's bullets, plus the gated ones whose flag is on. */
export function tierBullets(id: TierId): string[] {
  const t = tier(id);
  const gated = (t.gatedBullets ?? []).filter((b) => flagOn(b.flag)).map((b) => b.text);
  return [...t.bullets, ...gated];
}

export function tier(id: TierId): Tier {
  const found = pricing.tiers.find((t) => t.id === id);
  if (!found) throw new Error(`Unknown tier: ${id}`);
  return found;
}

export const starterSeatCap: number = tier("starter").seatCap;

/** The sentence "Start free" is allowed to carry, built from the enforced cap. */
export function startFreeSubline(): string {
  return `Free for up to ${starterSeatCap} people. No credit card.`;
}

export function category(id: string): Category | undefined {
  return pricing.categories.find((c) => c.id === id);
}

export function categoryLabel(id: string): string {
  return category(id)?.label ?? id;
}

/** A category's per-seat list price in the visitor's currency, rounded to its step. */
export function categoryPerSeat(id: string, code: MarketingCurrency): number {
  const cat = category(id);
  if (!cat) return 0;
  const multiplier = pricing.categoryPriceCurrencies[code] ?? 1;
  const step = ROUND_STEP[code] ?? 1;
  return Math.round((cat.usdPerSeat * multiplier) / step) * step;
}

/** A tier's per-seat price in the visitor's currency, or null for a quoted tier. */
export function tierPerSeat(id: TierId, code: MarketingCurrency): number | null {
  const value = tier(id).perSeat[code];
  return typeof value === "number" ? value : null;
}

/**
 * The tier a visitor with this many seats actually lands on, so the receipt
 * compares their stack against the price they would really pay. Below the
 * free cap that price is zero, and saying so is the point of a real Free tier.
 */
export function tierForSeats(seats: number): Tier {
  if (seats <= tier("starter").seatCap) return tier("starter");
  if (seats <= tier("growth").seatCap) return tier("growth");
  return tier("scale");
}

/**
 * The seat count above which the receipt can no longer print a WorkwrK
 * number, because the tier a visitor lands on is quoted rather than listed.
 *
 * DERIVED, not authored. It used to be a JSON constant set to 100, which was
 * unreachable: Growth's cap is the enforced 50, so the receipt started
 * quoting at 51 and the 51-to-100 band the constant was written to describe
 * did not exist. A number that can never be true of the data is worse than no
 * number, so the data answers the question instead.
 */
export const quotedAboveSeats: number = pricing.tiers
  .filter((t) => t.perSeat[pricing.defaultCurrency] !== null)
  .reduce((cap, t) => Math.max(cap, t.seatCap), 0);

export interface StackLine {
  id: string;
  label: string;
  perSeat: number;
  monthly: number;
}

export interface StackReceipt {
  seats: number;
  currency: MarketingCurrency;
  lines: StackLine[];
  toolCount: number;
  oldMonthly: number;
  /** null when the visitor's seat count puts them on the quoted tier. */
  workwrkMonthly: number | null;
  workwrkTierName: string;
  workwrkTierId: TierId;
  /** null when WorkwrK's price is quoted rather than listed. */
  keepMonthly: number | null;
  /**
   * True when this receipt has no WorkwrK number to print, so the CTA flips
   * to the sales door. It is the same condition as `workwrkMonthly === null`
   * by construction, which is the point: one rule, always reachable.
   */
  escalate: boolean;
  /** The seat count the quote starts above, so the receipt can say why it went quiet. */
  quotedAboveSeats: number;
  asOfLabel: string;
  footnote: string;
}

/**
 * The Stack Receipt. Pure arithmetic over the selected categories at the
 * visitor's seat count, with per-line overrides so the numbers stay theirs:
 * the concept's rule is that every number on the page is the visitor's
 * input, a live product metric, the customer's own, or a footnoted list price.
 */
export function stackReceipt(input: {
  selected: string[];
  seats: number;
  currency?: MarketingCurrency;
  /** Per-seat overrides keyed by category id, from the editable receipt lines. */
  overrides?: Record<string, number>;
}): StackReceipt {
  const currency = input.currency ?? pricing.defaultCurrency;
  const seats = Math.max(1, Math.round(Number.isFinite(input.seats) ? input.seats : pricing.defaultSeats));
  const overrides = input.overrides ?? {};

  const seen = new Set<string>();
  const lines: StackLine[] = [];
  for (const id of input.selected) {
    if (seen.has(id)) continue;
    const cat = category(id);
    if (!cat) continue;
    seen.add(id);
    const override = overrides[id];
    const perSeat = Math.max(0, typeof override === "number" && Number.isFinite(override) ? override : categoryPerSeat(id, currency));
    lines.push({ id, label: cat.label, perSeat, monthly: perSeat * seats });
  }

  const oldMonthly = lines.reduce((sum, l) => sum + l.monthly, 0);
  const landedTier = tierForSeats(seats);
  const perSeat = tierPerSeat(landedTier.id, currency);
  const workwrkMonthly = perSeat === null ? null : perSeat * seats;

  return {
    seats,
    currency,
    lines,
    toolCount: lines.length,
    oldMonthly,
    workwrkMonthly,
    workwrkTierName: landedTier.name,
    workwrkTierId: landedTier.id,
    keepMonthly: workwrkMonthly === null ? null : oldMonthly - workwrkMonthly,
    escalate: workwrkMonthly === null,
    quotedAboveSeats,
    asOfLabel: pricing.asOfLabel,
    footnote: pricing.listPriceFootnote,
  };
}

/** Tier order, lowest first. Used to answer "is this tier at or above that one". */
const TIER_ORDER: TierId[] = ["starter", "growth", "scale"];

function tierAtLeast(tierId: TierId, floor: TierId): boolean {
  return TIER_ORDER.indexOf(tierId) >= TIER_ORDER.indexOf(floor);
}

/**
 * Whether a tier genuinely replaces a category. Two gates, not one: the block
 * has to be included AND the tier has to be at or above the category's own
 * floor where it has one.
 *
 * The one-gate version counted Reviews and Surveys into Starter's total,
 * because both sit in the Teams block and Starter has Teams. The same card
 * then listed "Reviews, kudos and surveys" as a Growth bullet. A card that
 * denies a feature and charges for it in the same breath is the kind of
 * arithmetic a visitor checks.
 */
export function tierReplaces(tierId: TierId, c: Category): boolean {
  if (tier(tierId).modules[c.hub] !== true) return false;
  return c.fromTier ? tierAtLeast(tierId, c.fromTier) : true;
}

/** The "Replaces roughly X per seat of tools" line on a pricing card. */
export function replacesPerSeat(tierId: TierId, code: MarketingCurrency): number {
  const included = pricing.categories.filter((c) => tierReplaces(tierId, c));
  return included.reduce((sum, c) => sum + categoryPerSeat(c.id, code), 0);
}

/** The category labels a tier's "replaces" line is counting, for the card's tooltip or list. */
export function replacedCategories(tierId: TierId): Category[] {
  return pricing.categories.filter((c) => tierReplaces(tierId, c));
}

/** Everything the fourteen tiles cost together, per seat, at list. */
export function allCategoriesPerSeat(code: MarketingCurrency): number {
  return pricing.categories.reduce((sum, c) => sum + categoryPerSeat(c.id, code), 0);
}

/**
 * SoftwareApplication JSON-LD, generated from this file so the structured
 * data and the visible price can never drift. A quoted tier emits no Offer
 * rather than a made up number, and there is no aggregateRating: the site
 * has no ratings, so claiming one to Google would be a fabrication.
 */
export function softwareApplicationJsonLd(code: MarketingCurrency, siteUrl: string) {
  const offers = pricing.tiers
    .map((t) => {
      const perSeat = tierPerSeat(t.id, code);
      if (perSeat === null) return null;
      return {
        "@type": "Offer",
        name: t.name,
        price: String(perSeat),
        priceCurrency: code,
        description: t.free ? `Free for up to ${t.seatCap} people` : "Per user, per month, billed annually",
        url: `${siteUrl}/pricing`,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: String(perSeat),
          priceCurrency: code,
          unitText: "user per month",
        },
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    // A stable identifier, so the node the home page carries and the node
    // /pricing carries are read as ONE thing rather than as two products
    // with the same name. Without it the two graphs are unrelated.
    "@id": `${siteUrl}#software`,
    name: "WorkwrK",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    // The page the offers are on, not the site root. A SoftwareApplication
    // whose offers all point at /pricing and whose own url points at the
    // homepage sends a crawler to the one page that does not list a price.
    url: `${siteUrl}/pricing`,
    // The same gate the H1 subhead answers to. This node is the version of
    // the sentence a search engine quotes back to a buyer, which makes it
    // the worst place on the site for an ungated mechanism claim.
    description: positioningLine(),
    offers: offers.length === 1 ? offers[0] : offers,
  };
}
