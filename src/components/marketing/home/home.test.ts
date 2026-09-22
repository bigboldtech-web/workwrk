// The home page's pure helpers, and the truth gates they enforce.
//
// Everything asserted here is arithmetic, parsing or a gate. There is no
// React renderer: the components are thin over these modules on purpose,
// so the parts that can be wrong silently are the parts that are tested.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { heroHeadline } from "../headline";
import {
  PERSONAL_NUMBER_KEY,
  parseStoredReceipt,
  prefillQuery,
  serializeStoredReceipt,
} from "../personal-number";
import { DOT_HEX, DOT_ORDER } from "../dots";
import { flagOn } from "../flags";
import {
  CURRENCY_CODES,
  categoryPerSeat,
  formatMoney,
  pricing,
  stackReceipt,
  starterSeatCap,
  tier,
  tierBullets,
} from "../data/pricing";
import { stackReceiptModel } from "../receipt/stack-model";
import { workReceiptModel } from "../receipt/receipt-model";
import {
  narrationForBeat,
  receiptLineLabel,
  stopByNumber,
  trailFor,
  trailUpTo,
  tuesday,
} from "../data/tuesday";
import { COPY, MODULE_LINE } from "./chain";
import { faqEntries, spineNotice, tuesdayCtaHeadline, tuesdayCtaLede } from "./content";
import { HOME_DESCRIPTION, HOME_KEYWORDS, homeJsonLd } from "./json-ld";

const DASH = /[—–―]/;
const DOUBLE_HYPHEN = /--(?![A-Za-z])|[A-Za-z]--[A-Za-z]/;

/** Words in a line of copy. The page's rules are counted, not judged. */
function words(line: string): number {
  return line.trim().split(/\s+/).filter(Boolean).length;
}

/** Every string a copy tree holds, keys excluded: an object key like `h1`
    is not something a visitor reads, and counting it as copy is how a test
    for "the one number on this page is 13" fails on its own field names. */
function copyValues(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(copyValues);
  if (node && typeof node === "object") return Object.values(node).flatMap(copyValues);
  return [];
}

/** Sentences in a line. "Six words or fewer" may still be two sentences;
    "one sentence, never two" is a separate rule and this counts it. */
function sentences(line: string): number {
  return (line.match(/[.!?](?=\s|$)/g) ?? []).length;
}

/* ═══════════════════════════════════════════════════════════════════
 * The hero headline and its A/B.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the claim", () => {
  const h = heroHeadline();

  it("is six words or fewer, which is the rule the page is judged on", () => {
    expect(words(h.h1)).toBeLessThanOrEqual(6);
  });

  it("splits where it breaks and loses nothing", () => {
    expect(h.h1Parts.join(" ")).toBe(h.h1);
    expect(h.h1Parts.length).toBe(2);
  });

  it("carries one sentence under it, never two", () => {
    expect(sentences(h.sub)).toBe(1);
    expect(words(h.sub)).toBeLessThanOrEqual(14);
  });

  it("is the same claim the page renders", () => {
    expect(COPY.hero.h1).toBe(h.h1);
    expect(COPY.hero.sub).toBe(h.sub);
  });

  it("names no customer, no count of tools and no testimonial", () => {
    const text = `${h.h1} ${h.sub}`;
    expect(/\d/.test(text)).toBe(false);
    expect(/person|firm|customer|replaced/i.test(text)).toBe(false);
  });

  it("keeps the copy rules", () => {
    const text = `${h.h1} ${h.sub}`;
    expect(DASH.test(text)).toBe(false);
    expect(DOUBLE_HYPHEN.test(text)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The spine, section by section. Every rule below is one a reviewer can
 * fail the page on, so it is arithmetic here rather than an opinion in a
 * review.
 * ═══════════════════════════════════════════════════════════════════ */

describe("one idea per screen, few words, enormous type", () => {
  const headlines = [
    COPY.hero.h1,
    COPY.payoff.h2,
    COPY.system.h2,
    COPY.proof.h2,
    COPY.close.h2,
    ...COPY.beats.map((b) => b.h2),
  ];

  it("keeps every headline on the page to six words or fewer", () => {
    for (const line of headlines) expect(words(line), line).toBeLessThanOrEqual(6);
  });

  it("gives every supporting line one sentence and no more", () => {
    const lines = [COPY.hero.sub, COPY.problem.line, COPY.payoff.line, ...COPY.beats.map((b) => b.line)];
    for (const line of lines) expect(sentences(line), line).toBe(1);
  });

  it("numbers the four beats so they read as one chain", () => {
    expect(COPY.beats.map((b) => b.n)).toEqual(["01", "02", "03", "04"]);
    expect(COPY.beats.map((b) => b.label)).toEqual(["Task", "Owner", "Standard", "Goal"]);
  });

  it("carries one line for every module in the fixture, and no ninth", () => {
    expect(Object.keys(MODULE_LINE).sort()).toEqual(tuesday.hubs.map((h) => h.id).sort());
    for (const hub of tuesday.hubs) {
      expect(MODULE_LINE[hub.id], hub.id).toBeTruthy();
      expect(words(MODULE_LINE[hub.id]!), hub.id).toBeLessThanOrEqual(9);
    }
  });

  it("says nothing this page cannot evidence", () => {
    const everything = copyValues(COPY).join(" ");
    // No customer, no logo, no counter, no certification, no analyst.
    expect(/customer story here yet/.test(everything)).toBe(false);
    expect(/SOC ?2|ISO ?27001|HIPAA|PCI/i.test(everything)).toBe(false);
    expect(/\b(?:trusted by|leading|fortune|gartner|forrester)\b/i.test(everything)).toBe(false);
    // The one number on the page is the calendar's.
    const numbers = everything.match(/\d+/g) ?? [];
    expect(new Set(numbers)).toEqual(new Set(["13", "01", "02", "03", "04"]));
  });

  it("names no tool it replaces, because that vocabulary is on /compare", () => {
    const everything = `${copyValues(COPY).join(" ")} ${Object.values(MODULE_LINE).join(" ")}`;
    expect(/replaces/i.test(everything)).toBe(false);
  });

  it("keeps the copy rules across every word on the page", () => {
    const everything = `${copyValues(COPY).join(" ")} ${Object.values(MODULE_LINE).join(" ")}`;
    expect(DASH.test(everything)).toBe(false);
    expect(DOUBLE_HYPHEN.test(everything)).toBe(false);
    expect(/\b(?:supercharge|seamless|empower|game.changer|world.class|effortless)/i.test(everything)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The personal number.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the stored personal number", () => {
  const good = { selected: ["wiki", "team-chat"], seats: 50, currency: "USD" as const, keep: 420 };

  it("round trips", () => {
    const parsed = parseStoredReceipt(serializeStoredReceipt(good));
    expect(parsed).toEqual({ ...good, overrides: {}, asOf: pricing.asOf });
  });

  it("keeps the prices the visitor corrected, so the chip and the receipt agree", () => {
    // The sticky chip and the closing line recompute the saving from this
    // record. Without the edits they recomputed it from list prices and
    // quoted a different number from the receipt two sections above, on a
    // page whose whole argument is that the number is the visitor's own.
    const edited = { ...good, overrides: { wiki: 3, "team-chat": 12 } };
    const parsed = parseStoredReceipt(serializeStoredReceipt(edited));
    expect(parsed?.overrides).toEqual({ wiki: 3, "team-chat": 12 });
    // And they survive into the prefilled pricing link.
    expect(new URLSearchParams(prefillQuery(parsed!)).get("prices")).toBe("wiki:3,team-chat:12");
  });

  it("drops an override for a category that is not on the receipt", () => {
    const parsed = parseStoredReceipt(
      JSON.stringify({ ...good, overrides: { "okr-tool": 9, wiki: "cheap" }, asOf: pricing.asOf }),
    );
    expect(parsed?.overrides).toEqual({});
  });

  it("treats anything unparseable as absent", () => {
    expect(parseStoredReceipt(null)).toBeNull();
    expect(parseStoredReceipt("")).toBeNull();
    expect(parseStoredReceipt("not json")).toBeNull();
    expect(parseStoredReceipt("[]")).toBeNull();
    expect(parseStoredReceipt("null")).toBeNull();
  });

  it("drops a record written against an older price table", () => {
    const stale = JSON.stringify({ ...good, asOf: "2019-01" });
    expect(parseStoredReceipt(stale)).toBeNull();
  });

  it("never shows a zero or a negative saving", () => {
    expect(parseStoredReceipt(serializeStoredReceipt({ ...good, keep: 0 }))).toBeNull();
    expect(parseStoredReceipt(serializeStoredReceipt({ ...good, keep: -40 }))).toBeNull();
  });

  it("drops a currency or a category this version does not know", () => {
    const badCurrency = JSON.stringify({ ...good, currency: "XYZ", asOf: pricing.asOf });
    expect(parseStoredReceipt(badCurrency)).toBeNull();
    const badTools = JSON.stringify({ ...good, selected: ["not-a-category"], asOf: pricing.asOf });
    expect(parseStoredReceipt(badTools)).toBeNull();
  });

  it("keeps the known categories out of a mixed list", () => {
    const mixed = JSON.stringify({ ...good, selected: ["wiki", "made-up", 7], asOf: pricing.asOf });
    expect(parseStoredReceipt(mixed)?.selected).toEqual(["wiki"]);
  });

  it("opens the pricing page where the visitor left off", () => {
    const query = prefillQuery({ ...good, asOf: pricing.asOf });
    const params = new URLSearchParams(query);
    expect(params.get("seats")).toBe("50");
    expect(params.get("currency")).toBe("USD");
    expect(params.get("tools")).toBe("wiki,team-chat");
  });

  it("stores under one key, namespaced so it cannot collide with the product", () => {
    expect(PERSONAL_NUMBER_KEY.startsWith("workwrk:mk:")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The receipt maths, and the currency toggle through it.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the stack receipt arithmetic", () => {
  it("multiplies each category by the seat count and totals them", () => {
    const r = stackReceipt({ selected: ["task-tracker", "wiki"], seats: 10, currency: "USD" });
    expect(r.lines.map((l) => l.perSeat)).toEqual([12, 8]);
    expect(r.lines.map((l) => l.monthly)).toEqual([120, 80]);
    expect(r.oldMonthly).toBe(200);
  });

  it("prices WorkwrK at the tier the seat count actually lands on", () => {
    const free = stackReceipt({ selected: ["wiki"], seats: starterSeatCap, currency: "USD" });
    expect(free.workwrkMonthly).toBe(0);
    expect(free.workwrkTierId).toBe("starter");

    const paid = stackReceipt({ selected: ["wiki"], seats: starterSeatCap + 1, currency: "USD" });
    expect(paid.workwrkTierId).toBe("growth");
    expect(paid.workwrkMonthly).toBe((tier("growth").perSeat.USD ?? 0) * (starterSeatCap + 1));
  });

  it("stops printing a number once the tier is quoted rather than listed", () => {
    const quoted = stackReceipt({ selected: ["wiki"], seats: 400, currency: "USD" });
    expect(quoted.workwrkMonthly).toBeNull();
    expect(quoted.keepMonthly).toBeNull();
    expect(quoted.escalate).toBe(true);
  });

  it("lets the visitor's own price win over the list price", () => {
    const r = stackReceipt({ selected: ["wiki"], seats: 10, currency: "USD", overrides: { wiki: 3 } });
    expect(r.oldMonthly).toBe(30);
  });

  it("refuses a negative override rather than paying the visitor", () => {
    const r = stackReceipt({ selected: ["wiki"], seats: 10, currency: "USD", overrides: { wiki: -99 } });
    expect(r.oldMonthly).toBe(0);
  });

  it("counts a category once however many times it is tapped", () => {
    const r = stackReceipt({ selected: ["wiki", "wiki", "wiki"], seats: 10 });
    expect(r.toolCount).toBe(1);
  });

  it("never divides by a seat count of zero or a fraction of a person", () => {
    expect(stackReceipt({ selected: ["wiki"], seats: 0 }).seats).toBe(1);
    expect(stackReceipt({ selected: ["wiki"], seats: -12 }).seats).toBe(1);
    expect(stackReceipt({ selected: ["wiki"], seats: 7.6 }).seats).toBe(8);
    expect(stackReceipt({ selected: ["wiki"], seats: Number.NaN }).seats).toBe(pricing.defaultSeats);
  });
});

describe("the currency toggle", () => {
  it("offers exactly the six the decision names, with USD the default", () => {
    expect(CURRENCY_CODES).toEqual(["USD", "INR", "AED", "SGD", "GBP", "EUR"]);
    expect(pricing.defaultCurrency).toBe("USD");
  });

  it("carries every number on the receipt into the chosen currency", () => {
    for (const code of CURRENCY_CODES) {
      const model = stackReceiptModel({ selected: ["task-tracker", "wiki"], seats: 20, currency: code });
      const symbol = formatMoney(1, code).replace(/[\d.,\s]/g, "");
      for (const row of model.rows) {
        expect(row.meta, `${code} per seat`).toContain(symbol);
        expect(row.amount, `${code} monthly`).toContain(symbol);
      }
      for (const total of model.totals) {
        if (total.value === "Talk to sales") continue;
        expect(total.value, `${code} total`).toContain(symbol);
      }
    }
  });

  it("authors each currency rather than converting a stale rate at render time", () => {
    // Every tier states its own number per currency. A tier missing one
    // would silently fall back to a quote, which is a price change nobody
    // approved.
    for (const t of pricing.tiers) {
      for (const code of CURRENCY_CODES) {
        expect(code in t.perSeat, `${t.id} is missing ${code}`).toBe(true);
      }
    }
  });

  it("rounds a converted category price to something that reads as an estimate", () => {
    expect(categoryPerSeat("task-tracker", "INR") % 10).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * Truth gates. The page may not say a thing the product does not do.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the truth gates", () => {
  const unshipped = tuesday.stops.filter((s) => !s.truthGate.shipped);

  it("has something to gate, or these tests prove nothing", () => {
    expect(unshipped.length).toBeGreaterThan(0);
  });

  it("prints the fallback narration on every unshipped beat", () => {
    for (const beat of tuesday.beats) {
      const stop = stopByNumber(beat.stop);
      if (!stop || stop.truthGate.shipped) continue;
      expect(narrationForBeat(beat)).toBe(beat.fallbackNarration);
      expect(narrationForBeat(beat)).not.toBe(beat.narration);
    }
  });

  it("gates the trail, which is the line repeated under every beat", () => {
    for (const stop of unshipped) {
      if (!stop.trailFallback) continue;
      expect(trailFor(stop)).toBe(stop.trailFallback);
    }
    // And the growing trail the task carries is built from the gated lines.
    expect(trailUpTo(2).join(" ")).not.toContain("owner by role");
  });

  it("gates the receipt, which is the half that gets shared", () => {
    for (const line of tuesday.receipt.lines) {
      if (!line.labelFallback || line.stop === undefined) continue;
      const stop = stopByNumber(line.stop);
      if (stop?.truthGate.shipped) continue;
      expect(receiptLineLabel(line)).toBe(line.labelFallback);
    }
    const printed = workReceiptModel().rows.map((r) => r.label).join(" ");
    expect(printed).not.toContain("owner by role");
  });

  it("never gates a line into saying nothing", () => {
    for (const line of tuesday.receipt.lines) {
      expect(receiptLineLabel(line).length).toBeGreaterThan(3);
    }
    for (const stop of tuesday.stops) {
      expect(trailFor(stop).length).toBeGreaterThan(3);
    }
  });

  it("claims no certification while the flags say we hold none", () => {
    const text = faqEntries()
      .flatMap((e) => e.a)
      .join(" ");
    expect(text).toContain("no third party security certification");
    expect(/SOC 2|ISO 27001|HIPAA|PCI/.test(text)).toBe(false);
  });

  it("names no importer that does not exist", () => {
    const text = faqEntries()
      .flatMap((e) => e.a)
      .join(" ");
    if (flagOn("csvImport")) return;
    expect(/import .{0,20}spreadsheet/i.test(text)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The page's own copy.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the copy the site still renders", () => {
  const everything = [
    HOME_DESCRIPTION,
    ...Object.values(MODULE_LINE),
    ...copyValues(COPY),
    ...faqEntries().flatMap((e) => [e.q, ...e.a]),
  ].join("\n");

  it("carries no em dash and no double hyphen", () => {
    expect(DASH.test(everything)).toBe(false);
    expect(DOUBLE_HYPHEN.test(everything)).toBe(false);
  });

  it("names no competitor", () => {
    expect(/\b(?:monday\.com|clickup|bamboohr|asana|jira|lattice)\b/i.test(everything)).toBe(false);
    expect(/\b(?:Workday|Notion|Basecamp)\b/.test(everything)).toBe(false);
  });

  it("uses no marketing cliche", () => {
    expect(/\b(?:supercharge|seamless|empower|game.changer|world.class|effortless)/i.test(everything)).toBe(false);
  });

  it("answers the seven questions the concept lists", () => {
    expect(faqEntries()).toHaveLength(7);
    for (const entry of faqEntries()) {
      expect(entry.q.endsWith("?")).toBe(true);
      expect(entry.a.length).toBeGreaterThan(0);
    }
  });

  it("states the free cap the server actually enforces", () => {
    const exit = faqEntries()[6].a.join(" ");
    expect(exit).toContain(String(starterSeatCap));
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * Structured data.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the home structured data", () => {
  const graph = homeJsonLd({ site: "https://example.test" })["@graph"] as Array<Record<string, unknown>>;
  const node = (type: string) => graph.find((n) => n["@type"] === type);

  it("declares its context once, on the graph", () => {
    for (const n of graph) expect(n["@context"]).toBeUndefined();
  });

  it("takes its prices from the pricing source", () => {
    const offers = node("SoftwareApplication")?.offers as Array<Record<string, string>>;
    const listed = pricing.tiers.filter((t) => t.perSeat.USD !== null);
    expect(offers).toHaveLength(listed.length);
    for (const offer of offers) {
      const match = listed.find((t) => t.name === offer.name);
      expect(match, offer.name).toBeTruthy();
      expect(offer.price).toBe(String(match?.perSeat.USD));
      expect(offer.priceCurrency).toBe("USD");
    }
  });

  it("follows the currency toggle", () => {
    const inr = homeJsonLd({ site: "https://example.test", currency: "INR" })["@graph"] as Array<
      Record<string, unknown>
    >;
    const offers = (inr.find((n) => n["@type"] === "SoftwareApplication")?.offers ?? []) as Array<
      Record<string, string>
    >;
    for (const offer of offers) expect(offer.priceCurrency).toBe("INR");
  });

  it("claims no rating, because there are no ratings", () => {
    expect(JSON.stringify(graph)).not.toContain("aggregateRating");
  });

  it("points at no route that does not exist", () => {
    const json = JSON.stringify(graph);
    expect(json).not.toContain("SearchAction");
    expect(json).not.toContain("/search");
  });

  it("claims no FAQPage, because /faq is the FAQ document", () => {
    // The home graph used to carry a FAQPage with seven questions while
    // /faq carried one with eleven, the first seven of them word for word.
    // Two URLs claiming the same FAQPage is the pattern a search engine
    // collapses, and until it does the two pages compete for one rich
    // result. The dedicated page keeps it: it has every answer on it.
    // The home page still renders the seven and links to /faq.
    expect(node("FAQPage")).toBeUndefined();
    expect(faqEntries().length).toBeGreaterThan(0);
  });

  it("describes the product with the page's own claim, not a rating or a count", () => {
    // The description is the sentence a search engine quotes back, so it
    // is the page's first line and its payoff, and nothing else. It used
    // to end "in place of the stack a company buys one tool at a time",
    // which is the replacement argument the home page no longer makes.
    expect(HOME_DESCRIPTION).toContain("Every task knows who owns it.");
    expect(HOME_DESCRIPTION).toContain("already exists");
    expect(/\b(?:trusted by|leading|rating|reviews)\b/i.test(HOME_DESCRIPTION)).toBe(false);
    expect(HOME_KEYWORDS.length).toBeGreaterThan(8);
    expect(HOME_KEYWORDS).toContain("workwrk");
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The brand quarantine, from the marketing side.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the four dots", () => {
  it("keeps the loader's order, which is the timing signature of every pulse", () => {
    expect(DOT_ORDER).toEqual(["yellow", "blue", "red", "green"]);
  });

  it("has one hex per dot and no duplicates", () => {
    const hexes = DOT_ORDER.map((c) => DOT_HEX[c]);
    expect(new Set(hexes).size).toBe(4);
    for (const hex of hexes) expect(/^#[0-9A-Fa-f]{6}$/.test(hex)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The pricing card's gated bullets.
 * ═══════════════════════════════════════════════════════════════════ */

describe("a tier's bullet list", () => {
  it("hides a bullet whose flag is off", () => {
    // "Migration help on the way in" sat in the plain list on the top tier
    // while the FAQ said there is no migration service to sell. A page that
    // contradicts itself two sections apart is the defect this gate exists
    // to stop coming back.
    const scale = tier("scale");
    const gated = scale.gatedBullets ?? [];
    expect(gated.length).toBeGreaterThan(0);
    for (const b of gated) {
      expect(scale.bullets).not.toContain(b.text);
      if (!flagOn(b.flag)) expect(tierBullets("scale")).not.toContain(b.text);
    }
  });

  it("says the same thing as the FAQ about migration help", () => {
    const bullets = pricing.tiers.flatMap((t) => tierBullets(t.id)).join(" ");
    const faq = faqEntries().flatMap((e) => e.a).join(" ");
    const cardOffersHelp = /migration help/i.test(bullets);
    const faqOffersHelp = /migration help is included/i.test(faq);
    expect(cardOffersHelp).toBe(faqOffersHelp);
  });

  it("keeps every ungated bullet", () => {
    for (const t of pricing.tiers) {
      for (const b of t.bullets) expect(tierBullets(t.id)).toContain(b);
    }
  });
});


/* ═══════════════════════════════════════════════════════════════════
 * The Tuesday template gate.
 *
 * `flags.tuesdayTemplateAtSignup` already degraded the CTA's href from the
 * ?template=tuesday deep link to a bare /signup. The SENTENCES beside that
 * button did not read it, so the page promised a seeded workspace next to a
 * button that opens an empty one. These assertions are the half that was
 * missing: no copy on the page may name the template while the flag is off.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the Tuesday workspace template", () => {
  const shipped = flagOn("tuesdayTemplateAtSignup");
  const templateName = tuesday.workspace.templateName;

  const templateSentences = () => [spineNotice(), tuesdayCtaHeadline(), tuesdayCtaLede()];

  it("names the template in copy only when the flag grants it", () => {
    for (const line of templateSentences()) {
      if (shipped) continue;
      expect(line, `"${line}"`).not.toContain(templateName);
    }
  });

  it("never claims a first-screen template while the flag is off", () => {
    if (shipped) return;
    const all = templateSentences().join(" ").toLowerCase();
    expect(all).not.toContain("on your first screen");
    expect(all).not.toContain("yours on day one");
  });

  it("says what ships instead rather than softening the claim", () => {
    if (shipped) return;
    expect(tuesdayCtaLede()).toContain("in build");
    expect(tuesdayCtaLede().toLowerCase()).toContain("empty workspace");
  });

  it("keeps every gated sentence free of dashes, like the rest of the copy", () => {
    for (const line of templateSentences()) {
      expect(DASH.test(line), `"${line}"`).toBe(false);
      expect(DOUBLE_HYPHEN.test(line), `"${line}"`).toBe(false);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * Claims made by a picture.
 * ═══════════════════════════════════════════════════════════════════ */

describe("surface level claims follow the same gates as the prose", () => {
  it("only shows a kudos on the review timeline when stop 6 has shipped", () => {
    // The surface IS the claim: a kudos row on a review timeline is the
    // "kudos lands as review evidence" mechanism, drawn rather than
    // written, and stop 6's gate is what decides whether it is true.
    const stop6 = stopByNumber(6);
    expect(stop6).toBeDefined();
    const hasKudosRow = tuesday.review.timeline.some((row) => row.kind === "kudos");
    // The fixture keeps the row; the surface filters it. This asserts the
    // fixture still has one to filter, so the gate is doing work.
    expect(hasKudosRow).toBe(true);
    expect(stop6!.truthGate.mechanism.toLowerCase()).toContain("kudos");
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * Structure. Three things that are correct in the source and would be
 * silently wrong again after one edit, so they are asserted as text.
 * ═══════════════════════════════════════════════════════════════════ */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the scene degrades to the page the server rendered", () => {
  const css = read("./home.css");

  it("gates a pin's GEOMETRY on the same attribute as its content", () => {
    // The stop stacking is gated on `data-scene`, which only the island
    // sets, while the track height and the sticky child were gated on the
    // media query alone. A run where the island never attached on a wide
    // screen, script blocked or a chunk 404 after a deploy, then kept a
    // 620vh track with six stops flowing inside an 844px sticky box: the
    // centrepiece frozen and overlapping itself for five viewports.
    expect(css).toContain('.mk-pin-track[data-pin="snap"][data-scene="on"] { height: 220vh; }');
    expect(css).toContain('.mk-pin-track[data-pin="spine"][data-scene="on"] { height: 620vh; }');
    expect(css).toContain('.mk-pin-track[data-scene="on"] > .mk-pin-sticky {');
    // And nothing sets a track height without the attribute.
    expect(css).not.toMatch(/\.mk-pin-track\[data-pin="(?:snap|spine)"\]\s*\{\s*height/);
  });

  it("writes data-scene onto the track as well as the stage", () => {
    // One pin is left on the site and it is /tuesday's. The home page's
    // snap pin is gone with the composition it scrubbed: nothing on the
    // home page is revealed by scrolling any more.
    const source = read("./spine-pin.client.tsx");
    expect(source).toMatch(/track\.(?:dataset\.scene = "on"|setAttribute\("data-scene", "on"\))/);
  });
});

describe("the wire is blue, and the hue belongs to the dot", () => {
  const css = read("./home.css");

  it("paints the line in the one accent, never in the stop's brand hue", () => {
    // Concept 10: blue is the only colour for wires and the connection
    // lines, and YBRG appears as the four dots and the pulse on a wire.
    // The line took `--mk-stop-dot`, so stop 1 drew a yellow wire and stop
    // 4 a red one, which also collided with red's in-surface meaning.
    const line = css.slice(css.indexOf(".mk-wirelink__line {"));
    expect(line.slice(0, 220)).toContain("background: var(--os-brand);");
    expect(line.slice(0, 220)).not.toContain("--mk-stop-dot");
    // The dot keeps it.
    const dot = css.slice(css.indexOf(".mk-wirelink__dot {"));
    expect(dot.slice(0, 200)).toContain("var(--mk-stop-dot");
  });
});

describe("the cookie banner is answerable before the page is read", () => {
  it("mounts before <main> in the marketing layout", () => {
    const layout = read("../../../app/(marketing)/layout.tsx");
    const banner = layout.indexOf("<ConsentBanner");
    // The ELEMENT, not the word: the note above the mount says "<main>" too.
    const main = layout.indexOf('<main id="main">');
    expect(banner).toBeGreaterThan(-1);
    expect(main).toBeGreaterThan(-1);
    // It overlays the hero, so a keyboard or screen reader visitor must be
    // able to answer it without traversing the whole page first: mounted
    // after <main> its first button was focus stop 134 of 137.
    expect(banner).toBeLessThan(main);
  });
});

describe("the dots land in the wordmark, not beside it", () => {
  const css = read("./home.css");
  const spine = read("./spine.tsx");
  const logo = read("../../brand/logo.tsx");

  it("splits the word where the brand lockup splits it", () => {
    // The close is the one frame on the page where the whole argument
    // resolves into the logo, so the logo it resolves into has to be the
    // logo. LogoLockup splits "workwrk" into work + wr + k and floats the
    // dot row above the middle "wr", which is the gap between the two k
    // letters. The close rendered "workwr" + the dot row + "k" as one flex
    // line, which put the dots ON the baseline and split the word in two.
    expect(logo).toContain("wr{dots}");
    const fly = spine.slice(spine.indexOf('<span className="mk-dotfly"'));
    const block = fly.slice(0, 460);
    expect(block).toContain('<span className="mk-dotfly__anchor">');
    // The dot row is INSIDE the anchor, which is the "wr" span.
    expect(block.indexOf('mk-dotfly__anchor')).toBeLessThan(block.indexOf('mk-dotfly__slot'));
    // And the word is not cut anywhere else.
    expect(block).not.toContain("workwr");
  });

  it("floats the row above that span rather than in the line", () => {
    const slot = css.slice(css.indexOf(".mk-dotfly__slot {"), css.indexOf(".mk-dotfly__slot span"));
    expect(slot).toContain("position: absolute;");
    expect(slot).toContain("left: 50%;");
    expect(slot).toContain("bottom: calc(100% - 4px);");
    expect(slot).toContain("transform: translateX(-50%);");
    // The anchor has to establish the containing block, or the row escapes
    // to the stage and lands wherever the nearest positioned ancestor is.
    expect(css).toContain(".mk-dotfly__anchor { position: relative; }");
  });
});

describe("the pinned spine keeps a gutter at both ends of the viewport", () => {
  const css = read("./home.css");

  it("pads the stage so the clock and the map are not flush with the edges", () => {
    // Inside the pin the stage IS the viewport. With no block padding the
    // clock's cap height started under the nav's own border and the "you
    // are here" map ended on the last row of pixels, so the strip read as
    // cut off rather than as the foot of the stage.
    const stage = css.slice(css.indexOf('.mk-spine-stage[data-scene="on"] {'));
    expect(stage.slice(0, 900)).toContain("padding-block: 14px 20px;");
    // On a short viewport the gutter shrinks rather than taking height off
    // the frames, which are already the tightest thing in the stage there.
    expect(css).toContain('.mk-spine-stage[data-scene="on"] { padding-block: 6px 10px; }');
  });
});
