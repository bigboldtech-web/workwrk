import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "@/lib/plan-limits-data";
import { SUB_LINKED, SUB_MECHANISM, headlineSub, positioningLine } from "../positioning";
import { stopShipped } from "./tuesday";
import {
  CURRENCY_CODES,
  allCategoriesPerSeat,
  categoryPerSeat,
  currencyFromCountry,
  formatMoney,
  isMarketingCurrency,
  pricing,
  quotedAboveSeats,
  replacedCategories,
  replacesPerSeat,
  softwareApplicationJsonLd,
  stackReceipt,
  startFreeSubline,
  starterSeatCap,
  tier,
  tierBullets,
  tierForSeats,
  tierPerSeat,
} from "./pricing";

describe("the pricing source", () => {
  it("offers exactly the six decided currencies, USD first", () => {
    expect(CURRENCY_CODES).toEqual(["USD", "INR", "AED", "SGD", "GBP", "EUR"]);
    expect(pricing.defaultCurrency).toBe("USD");
  });

  it("names the three decided tiers", () => {
    expect(pricing.tiers.map((t) => t.id)).toEqual(["starter", "growth", "scale"]);
    expect(pricing.tiers.map((t) => t.name)).toEqual(["Starter", "Growth", "Scale"]);
  });

  it("gates Talk and Tables from Growth, not from Starter", () => {
    expect(pricing.premiumModules.map((m) => m.id).sort()).toEqual(["tables", "talk"]);
    for (const m of pricing.premiumModules) expect(m.fromTier).toBe("growth");
    expect(tier("starter").modules.talk).toBe(false);
    expect(tier("starter").modules.tables).toBe(false);
    expect(tier("growth").modules.talk).toBe(true);
    expect(tier("growth").modules.tables).toBe(true);
    expect(tier("scale").modules.talk).toBe(true);
  });

  it("carries fourteen category list prices with a dated asOf", () => {
    expect(pricing.categories).toHaveLength(14);
    expect(pricing.asOf).toMatch(/^\d{4}-\d{2}$/);
    expect(pricing.listPriceFootnote).toContain(pricing.asOfLabel);
    for (const c of pricing.categories) {
      expect(c.usdPerSeat).toBeGreaterThan(0);
      expect(c.hub.length).toBeGreaterThan(0);
    }
  });

  it("authors every WorkwrK price per currency rather than converting one", () => {
    // A converted price would be a fixed multiple of the USD price in every
    // currency. These are authored figures, so at least one is not.
    const growth = tier("growth").perSeat;
    const ratios = CURRENCY_CODES.map((c) => (growth[c] ?? 0) / (growth.USD ?? 1));
    const usingRawFx = CURRENCY_CODES.every(
      (c, i) => Math.abs(ratios[i] - (pricing.categoryPriceCurrencies[c] ?? 1)) < 0.001,
    );
    expect(usingRawFx).toBe(false);
    for (const c of CURRENCY_CODES) expect(typeof growth[c]).toBe("number");
  });

  it("makes Starter genuinely free in every currency", () => {
    for (const c of CURRENCY_CODES) expect(tierPerSeat("starter", c)).toBe(0);
    expect(tier("starter").free).toBe(true);
  });

  it("quotes Scale rather than inventing a list price", () => {
    for (const c of CURRENCY_CODES) expect(tierPerSeat("scale", c)).toBeNull();
    expect(tier("scale").cta).toBe("demo");
  });
});

describe("the free seat cap is the cap the product enforces", () => {
  it("matches PLAN_LIMITS.STARTER.users exactly", () => {
    // This is the whole reason "Start free" is honest. If the enforced cap
    // moves, this fails and the copy moves with it.
    expect(starterSeatCap).toBe(PLAN_LIMITS.STARTER.users);
  });

  it("says the number out loud in the microcopy", () => {
    expect(startFreeSubline()).toBe(`Free for up to ${PLAN_LIMITS.STARTER.users} people. No credit card.`);
  });

  it("points at the source it was confirmed against", () => {
    expect(pricing.seatCapSource).toContain("plan-limits-data");
  });

  it("keeps Growth and Scale seat caps in step with the enforced limits", () => {
    expect(tier("growth").seatCap).toBe(PLAN_LIMITS.GROWTH.users);
    expect(tier("scale").seatCap).toBe(PLAN_LIMITS.SCALE.users);
  });
});

describe("the AI allowance is on the page and is the enforced one", () => {
  // The page's headline is "the arithmetic is on the page", and the AI cap
  // was the one enforced limit missing from it: the comparison matrix
  // derived AI from moduleNames and printed an unqualified Yes on all
  // three tiers while src/lib/plan-limits.ts refuses the next Ask at
  // `current >= limit` from a LIFETIME count of org._count.aiQueries.
  const forTier = (id: "starter" | "growth" | "scale") =>
    tier(id).bullets.find((b) => b.startsWith("AI:"));

  it("names an allowance on every tier", () => {
    expect(forTier("starter")).toBeTruthy();
    expect(forTier("growth")).toBeTruthy();
    expect(forTier("scale")).toBeTruthy();
  });

  it("quotes the number the server checks", () => {
    expect(forTier("starter")).toContain(String(PLAN_LIMITS.STARTER.ai));
    expect(forTier("growth")).toContain(String(PLAN_LIMITS.GROWTH.ai));
    // 2000 is printed grouped, so compare against the grouped form.
    expect(forTier("scale")).toContain(PLAN_LIMITS.SCALE.ai.toLocaleString("en-US"));
  });

  it("says the allowance is a total rather than a monthly refill", () => {
    // The count has no period filter. Calling it monthly would be the same
    // fabrication as an invented SLA, only quieter.
    expect(forTier("starter")).toContain("in total");
    expect(forTier("growth")).toContain("in total");
    expect(forTier("scale")).toContain("in total");
  });
});

describe("currency", () => {
  it("detects the six from a country and falls back to USD, never to a guess", () => {
    expect(currencyFromCountry("IN")).toBe("INR");
    expect(currencyFromCountry("in")).toBe("INR");
    expect(currencyFromCountry("AE")).toBe("AED");
    expect(currencyFromCountry("SG")).toBe("SGD");
    expect(currencyFromCountry("GB")).toBe("GBP");
    expect(currencyFromCountry("DE")).toBe("EUR");
    expect(currencyFromCountry("US")).toBe("USD");
    expect(currencyFromCountry("BR")).toBe("USD");
    expect(currencyFromCountry(null)).toBe("USD");
    expect(currencyFromCountry("")).toBe("USD");
  });

  it("recognises its own codes and rejects the product's other fifteen", () => {
    expect(isMarketingCurrency("INR")).toBe(true);
    expect(isMarketingCurrency("JPY")).toBe(false);
  });

  it("formats whole units with the right symbol in the right place", () => {
    expect(formatMoney(650, "INR")).toContain("650");
    expect(formatMoney(650, "INR")).toContain("₹");
    expect(formatMoney(8, "USD")).toBe("$8");
    expect(formatMoney(7, "GBP")).toBe("£7");
    expect(formatMoney(2200, "USD")).toBe("$2,200");
    // The euro sits after the number in its default locale.
    expect(formatMoney(8, "EUR")).toMatch(/8/);
  });

  it("rounds a converted category tile to a readable step", () => {
    expect(categoryPerSeat("task-tracker", "USD")).toBe(12);
    // 12 * 80 = 960, already on the 10 step.
    expect(categoryPerSeat("task-tracker", "INR")).toBe(960);
    // 5 * 0.8 = 4, whole units.
    expect(categoryPerSeat("forms", "GBP")).toBe(4);
    expect(categoryPerSeat("not-a-category", "USD")).toBe(0);
  });

  it("prices all fourteen categories together", () => {
    expect(allCategoriesPerSeat("USD")).toBe(124);
  });
});

describe("the stack receipt maths", () => {
  it("prints nothing and keeps nothing when nothing is selected", () => {
    const r = stackReceipt({ selected: [], seats: 50 });
    expect(r.lines).toHaveLength(0);
    expect(r.oldMonthly).toBe(0);
    expect(r.toolCount).toBe(0);
  });

  it("multiplies per-seat by seats, per line and in total", () => {
    const r = stackReceipt({ selected: ["task-tracker", "wiki", "team-chat"], seats: 50, currency: "USD" });
    expect(r.lines.map((l) => l.monthly)).toEqual([600, 400, 400]);
    expect(r.oldMonthly).toBe(1400);
    expect(r.toolCount).toBe(3);
  });

  it("ignores a repeated or unknown category rather than double counting it", () => {
    const r = stackReceipt({ selected: ["wiki", "wiki", "nope"], seats: 10 });
    expect(r.toolCount).toBe(1);
    expect(r.oldMonthly).toBe(80);
  });

  it("uses the visitor's own edited price when a line is overridden", () => {
    const r = stackReceipt({ selected: ["task-tracker"], seats: 20, overrides: { "task-tracker": 19 } });
    expect(r.lines[0].perSeat).toBe(19);
    expect(r.oldMonthly).toBe(380);
  });

  it("never charges for a negative or nonsense override", () => {
    const r = stackReceipt({ selected: ["wiki"], seats: 5, overrides: { wiki: -100 } });
    expect(r.lines[0].perSeat).toBe(0);
    expect(r.oldMonthly).toBe(0);
  });

  it("lands a small team on the free tier and keeps the whole old stack", () => {
    const r = stackReceipt({ selected: ["task-tracker", "wiki"], seats: 8, currency: "USD" });
    expect(r.workwrkTierName).toBe("Starter");
    expect(r.workwrkMonthly).toBe(0);
    expect(r.keepMonthly).toBe(r.oldMonthly);
    expect(r.escalate).toBe(false);
  });

  it("crosses to Growth one seat above the free cap", () => {
    expect(tierForSeats(starterSeatCap).id).toBe("starter");
    expect(tierForSeats(starterSeatCap + 1).id).toBe("growth");
    const r = stackReceipt({ selected: ["task-tracker"], seats: starterSeatCap + 1, currency: "USD" });
    expect(r.workwrkMonthly).toBe(8 * (starterSeatCap + 1));
  });

  it("quotes rather than computes above the Growth cap, and keeps no number it cannot stand behind", () => {
    const r = stackReceipt({ selected: ["task-tracker"], seats: 500 });
    expect(r.workwrkTierName).toBe("Scale");
    expect(r.workwrkMonthly).toBeNull();
    expect(r.keepMonthly).toBeNull();
  });

  it("escalates exactly when it has no number to print, and never on a line it can never reach", () => {
    // The rule is one thing: can this receipt state a WorkwrK price? The
    // previous escalation line (100) sat above the Growth cap (50), so the
    // receipt was already quoting by the time it could have fired.
    expect(quotedAboveSeats).toBe(tier("growth").seatCap);
    const listed = stackReceipt({ selected: [], seats: quotedAboveSeats });
    expect(listed.escalate).toBe(false);
    expect(listed.workwrkMonthly).not.toBeNull();

    const quoted = stackReceipt({ selected: [], seats: quotedAboveSeats + 1 });
    expect(quoted.escalate).toBe(true);
    expect(quoted.workwrkMonthly).toBeNull();
    expect(quoted.quotedAboveSeats).toBe(quotedAboveSeats);

    // Whatever the seat count, escalate and "no number" are the same answer.
    for (const seats of [1, 10, 11, 50, 51, 99, 100, 101, 280, 5000]) {
      const r = stackReceipt({ selected: ["wiki"], seats });
      expect(r.escalate, `seats=${seats}`).toBe(r.workwrkMonthly === null);
    }
  });

  it("still shows the 280-person firm its own stack total when the WorkwrK side is a quote", () => {
    // The one real customer the site may quote runs 280 people. The receipt
    // cannot invent a price for them, but it must not go blank either.
    const r = stackReceipt({ selected: ["task-tracker", "wiki", "team-chat"], seats: 280, currency: "USD" });
    expect(r.oldMonthly).toBe(280 * (12 + 8 + 8));
    expect(r.toolCount).toBe(3);
    expect(r.workwrkMonthly).toBeNull();
    expect(r.escalate).toBe(true);
  });

  it("works out the arithmetic of the concept's own worked example", () => {
    // marketing-concept.md 3 section 9 prints five tools at 50 seats.
    const r = stackReceipt({
      selected: ["task-tracker", "wiki", "team-chat", "okr-tool", "review-tool"],
      seats: 50,
      currency: "USD",
    });
    expect(r.oldMonthly).toBe(2200);
    expect(r.workwrkMonthly).toBe(400);
    expect(r.keepMonthly).toBe(1800);
  });

  it("clamps a nonsense seat count instead of printing NaN", () => {
    expect(stackReceipt({ selected: ["wiki"], seats: 0 }).seats).toBe(1);
    expect(stackReceipt({ selected: ["wiki"], seats: -4 }).seats).toBe(1);
    expect(stackReceipt({ selected: ["wiki"], seats: Number.NaN }).seats).toBe(pricing.defaultSeats);
    expect(stackReceipt({ selected: ["wiki"], seats: 12.6 }).seats).toBe(13);
  });

  it("says a bigger stack keeps more, monotonically", () => {
    const small = stackReceipt({ selected: ["wiki"], seats: 50 });
    const big = stackReceipt({ selected: ["wiki", "team-chat", "okr-tool"], seats: 50 });
    expect(big.keepMonthly!).toBeGreaterThan(small.keepMonthly!);
  });
});

describe("the replaces line on a pricing card", () => {
  it("counts only the categories a tier's modules actually cover", () => {
    const starter = replacesPerSeat("starter", "USD");
    const growth = replacesPerSeat("growth", "USD");
    expect(growth).toBe(allCategoriesPerSeat("USD"));
    expect(starter).toBeLessThan(growth);
    // Starter has no Talk and no Tables, so those four categories are out,
    // and Reviews and Surveys are Growth features inside a block Starter has.
    expect(growth - starter).toBe(8 + 13 + 12 + 5 + 6 + 7);
  });

  it("never counts a category into a tier whose own bullets exclude it", () => {
    // The card says "Reviews, kudos and surveys" is what Growth adds. The
    // total two lines below it has to agree.
    const starterIds = replacedCategories("starter").map((c) => c.id);
    expect(starterIds).not.toContain("review-tool");
    expect(starterIds).not.toContain("survey-tool");
    expect(starterIds).toContain("hris-directory");
    expect(replacedCategories("growth").map((c) => c.id)).toContain("review-tool");

    const starterBullets = tier("starter").bullets.join(" ").toLowerCase();
    const growthBullets = tier("growth").bullets.join(" ").toLowerCase();
    expect(starterBullets).not.toContain("review");
    expect(growthBullets).toContain("review");
  });
});

describe("the JSON-LD", () => {
  const ld = softwareApplicationJsonLd("USD", "https://workwrk.com");

  it("emits offers from this file, so the graph cannot contradict the page", () => {
    const offers = Array.isArray(ld.offers) ? ld.offers : [ld.offers];
    expect(offers).toHaveLength(2);
    expect(offers[0].name).toBe("Starter");
    expect(offers[0].price).toBe("0");
    expect(offers[1].name).toBe("Growth");
    expect(offers[1].price).toBe(String(tierPerSeat("growth", "USD")));
    expect(offers[1].priceCurrency).toBe("USD");
  });

  it("claims no rating, because the site has none", () => {
    expect(JSON.stringify(ld)).not.toContain("aggregateRating");
    expect(JSON.stringify(ld)).not.toContain("ratingValue");
  });

  it("follows the currency toggle", () => {
    const inr = softwareApplicationJsonLd("INR", "https://workwrk.com");
    const offers = Array.isArray(inr.offers) ? inr.offers : [inr.offers];
    expect(offers[1].priceCurrency).toBe("INR");
    expect(offers[1].price).toBe(String(tierPerSeat("growth", "INR")));
  });
});

describe("the SOP allowance is the one the server enforces", () => {
  it("counts every SOP, drafts included, because the server does", () => {
    // src/lib/plan-limits.ts counts org._count.sops, which is every SOP row
    // in any status (`enum SOPStatus` is DRAFT, IN_REVIEW, APPROVED,
    // PUBLISHED, ARCHIVED), and /api/sops refuses the next creation. The
    // bullets used to read "3 published SOPs", so a Starter customer who
    // drafted three and published none was stopped at the fourth having
    // been promised three published ones.
    for (const t of pricing.tiers) {
      const bullet = tierBullets(t.id).find((b) => /SOPs/.test(b));
      expect(bullet, t.id).toBeTruthy();
      expect(bullet, t.id).not.toMatch(/published/i);
      expect(bullet, t.id).toMatch(/drafts included/);
      const count = Number(bullet!.match(/\d+/)?.[0]);
      expect(count, t.id).toBe(PLAN_LIMITS[t.plan].sops);
    }
  });
});

describe("the positioning sentence answers to the truth gates", () => {
  it("does not assert an unbuilt mechanism in the structured data", () => {
    const graph = softwareApplicationJsonLd("USD", "https://workwrk.com") as Record<string, unknown>;
    const description = String(graph.description);
    expect(description).toBe(positioningLine());
    expect(description).not.toMatch(/SOPs become tasks/);
    expect(description).toMatch(/linked records/);
  });

  it("swaps to the mechanism sentence only when all three stops ship", () => {
    expect(stopShipped(1) && stopShipped(2) && stopShipped(5)).toBe(false);
    expect(headlineSub()).toBe(SUB_LINKED);
    expect(SUB_MECHANISM).toMatch(/SOPs become tasks/);
  });
});
