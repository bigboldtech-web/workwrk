// THE EIGHT RULES, COUNTED RATHER THAN JUDGED.
//
// The founder's brief names eight things a reviewer can fail a page on, and
// six of them are decidable by a machine: word counts, sentence counts,
// the absence of an em dash, the absence of a word the voice does not use,
// and the one blue. This file decides those six for the eight pages that are
// not the home page. The two that are not decidable here, "whitespace is the
// design" and "one object per section", are decided by the stylesheet and by
// looking at the page.
//
// Everything asserted is over PURE modules: the copy tree in copy.ts, the
// pricing source, the fixture and the module order. There is no React
// renderer, because a page whose copy is a constant and whose markup is six
// components over that constant has nothing else left to get wrong.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ALL_COPY,
  BLOG_COPY,
  COMPARE_COPY,
  DEMO_COPY,
  LEGAL_COPY,
  PART_LINE,
  PRICING_COPY,
  PRODUCT_COPY,
} from "./copy";
import { BANNED_WORDS_RE } from "../lint/marketing-copy-rules.mjs";
import { pricing, starterSeatCap, tier } from "../data/pricing";
import { MODULE_ORDER } from "../product/module-page";
import { tuesday } from "../data/tuesday";

const DASH = /[—–―]/;
const DOUBLE_HYPHEN = /--(?![A-Za-z])|[A-Za-z]--[A-Za-z]/;

/** Words in a line of copy. */
function words(line: string): number {
  return line.trim().split(/\s+/).filter(Boolean).length;
}

/** Sentences in a line. "Six words or fewer" may still be two sentences;
    "one sentence, never two" is a separate rule and this counts it. */
function sentences(line: string): number {
  return (line.match(/[.!?](?=\s|$)/g) ?? []).length;
}

/**
 * Every string a copy tree holds, keys excluded, with the functions in it
 * called so their output is checked too. An object key like `h1` is not
 * something a visitor reads.
 */
function copyValues(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "function") return copyValues((node as (n: number) => unknown)(6));
  if (Array.isArray(node)) return node.flatMap(copyValues);
  if (node && typeof node === "object") return Object.values(node).flatMap(copyValues);
  return [];
}

/**
 * The static strings a visitor reads, with the dates and the computed
 * sentences left out.
 *
 * `updated` is a date, not a claim, and the cookie lede's count is a number
 * the page computes from the table it renders. Both have assertions of their
 * own; sweeping them for numerals would only find the year and the count.
 */
function staticClaims(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "function") return [];
  if (Array.isArray(node)) return node.flatMap(staticClaims);
  if (node && typeof node === "object") {
    return Object.entries(node)
      .filter(([key]) => key !== "updated")
      .flatMap(([, value]) => staticClaims(value));
  }
  return [];
}

/** Every headline on the eight pages: the h1s and the h2s, with a label. */
function headlines(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [page, tree] of Object.entries(ALL_COPY)) {
    for (const [section, block] of Object.entries(tree as Record<string, unknown>)) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (typeof b.h1 === "string") out.push([`${page}.${section}.h1`, b.h1]);
      if (typeof b.h2 === "string") out.push([`${page}.${section}.h2`, b.h2]);
    }
  }
  return out;
}

/** Every supporting line: the sentence under a claim or a headline. */
function supportingLines(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [page, tree] of Object.entries(ALL_COPY)) {
    for (const [section, block] of Object.entries(tree as Record<string, unknown>)) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (typeof b.sub === "string") out.push([`${page}.${section}.sub`, b.sub]);
      if (typeof b.line === "string") out.push([`${page}.${section}.line`, b.line]);
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════
 * Rule 2. Few words, enormous type.
 * ═══════════════════════════════════════════════════════════════════ */

describe("rule 2: few words", () => {
  it("holds every headline to six words or fewer", () => {
    for (const [where, line] of headlines()) {
      expect(`${where}: ${line} (${words(line)} words)`).toBe(`${where}: ${line} (${Math.min(words(line), 6)} words)`);
    }
  });

  it("finds a headline on every page, so the sweep is not vacuous", () => {
    const pages = new Set(headlines().map(([where]) => where.split(".")[0]));
    expect([...pages].sort()).toEqual(["blog", "compare", "demo", "legal", "pricing", "product"]);
  });

  it("gives every page exactly one h1", () => {
    for (const page of Object.keys(ALL_COPY)) {
      const h1s = headlines().filter(([where]) => where.startsWith(`${page}.`) && where.endsWith(".h1"));
      // Legal is three documents in one tree, so it carries three.
      expect(h1s.length).toBe(page === "legal" ? 3 : 1);
    }
  });

  it("holds every supporting line to one sentence and a readable length", () => {
    for (const [where, line] of supportingLines()) {
      expect(`${where}: ${sentences(line)} sentence(s)`).toBe(`${where}: 1 sentence(s)`);
      expect(words(line)).toBeLessThanOrEqual(18);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * Rule 6. Power words, plain words.
 * ═══════════════════════════════════════════════════════════════════ */

describe("rule 6: plain words", () => {
  const all = copyValues(ALL_COPY);

  it("has copy to check", () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it("uses no em dash, en dash or double hyphen anywhere", () => {
    for (const line of all) {
      expect(`${line} :: dash`).toBe(`${line} :: ${DASH.test(line) ? "DASH" : "dash"}`);
      expect(DOUBLE_HYPHEN.test(line)).toBe(false);
    }
  });

  it("uses none of the words the voice does not use", () => {
    for (const line of all) {
      expect(`${line} :: ${BANNED_WORDS_RE.test(line)}`).toBe(`${line} :: false`);
    }
  });

  it("names no competitor outside the compare tree", () => {
    // The compare copy is the argument's frame, not the vendor names: the
    // names themselves live in (marketing)/compare/data.ts, which is the one
    // path the copy checker allows them on. Nothing in this file may carry
    // one, including the /compare page's own headings.
    const names = /\b(?:Monday\.com|ClickUp|Asana|Notion|Workday|BambooHR|Lattice|Jira|Trello|Slack)\b/i;
    for (const line of all) {
      expect(`${line} :: ${names.test(line)}`).toBe(`${line} :: false`);
    }
  });

  it("uses no exclamation mark and no question mark in a headline", () => {
    for (const [, line] of headlines()) {
      expect(/[!?]/.test(line)).toBe(false);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * Rule 8. Colour is almost absent, and the page's one blue is its closing
 * button. This is the part of that rule a unit test can reach: the pages
 * that HAVE a close, and the one page that deliberately does not.
 * ═══════════════════════════════════════════════════════════════════ */

describe("rule 8: one button", () => {
  it("gives product, pricing, compare and demo a closing line", () => {
    expect(PRODUCT_COPY.close.h2).toBeTruthy();
    expect(PRICING_COPY.close.h2).toBeTruthy();
    expect(COMPARE_COPY.close.h2).toBeTruthy();
    expect(DEMO_COPY.close.h2).toBeTruthy();
  });

  it("gives the blog and the three legal documents none", () => {
    // A document is not a funnel. An index of essays and a privacy policy
    // end where they end; the navigation carries both doors on every page.
    expect("close" in BLOG_COPY).toBe(false);
    expect("close" in LEGAL_COPY.privacy).toBe(false);
    expect("close" in LEGAL_COPY.terms).toBe(false);
    expect("close" in LEGAL_COPY.cookies).toBe(false);
  });

  it("renders the one filled blue on the page's LAST band, not in the middle", () => {
    // Read from the routes rather than asserted in prose: a `variant="ghost"`
    // on a PrimaryCta is the difference between one blue and two in a single
    // viewport, and /demo needs it because the form's own submit is filled.
    const demo = readFileSync("src/app/(marketing)/demo/page.tsx", "utf8");
    expect(demo).toContain('<PrimaryCta placement="demo-close" variant="ghost" />');

    // And the money page's three plan buttons are ghost, so the only filled
    // blue on it is the close.
    const price = readFileSync("src/app/(marketing)/pricing/page.tsx", "utf8");
    expect(price).toContain('variant="ghost"');
    expect(price).not.toContain("<TierCta");
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The numbers on these pages come from the source, never from a keyboard.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the numbers are read, not typed", () => {
  it("takes the free seat cap from the constant the server enforces", () => {
    expect(PRICING_COPY.hero.sub).toContain(String(starterSeatCap));
  });

  it("names three plans because the price list has three", () => {
    expect(pricing.tiers.length).toBe(3);
    expect(PRICING_COPY.plans.h2.toLowerCase()).toContain("three plans");
  });

  it("says eight parts because the fixture has eight hubs", () => {
    expect(tuesday.hubs.length).toBe(8);
    expect(MODULE_ORDER.length).toBe(8);
    expect(PRODUCT_COPY.hero.h1.toLowerCase()).toContain("eight parts");
  });

  it("keeps the tour's order and the chapters' order identical", () => {
    // The tab strip and the chapter list both map MODULE_ORDER, so a part
    // cannot be in one and missing from the other.
    const page = readFileSync("src/app/(marketing)/product/page.tsx", "utf8");
    expect(page.match(/MODULE_ORDER\.map/g)?.length).toBe(2);
  });

  it("gives every part a line, and no part the page does not show", () => {
    expect(Object.keys(PART_LINE).sort()).toEqual([...MODULE_ORDER].sort());
  });

  it("holds every part's line to one sentence, because it sits under a headline", () => {
    for (const [id, line] of Object.entries(PART_LINE)) {
      expect(`${id}: ${sentences(line)} sentence(s)`).toBe(`${id}: 1 sentence(s)`);
      expect(words(line)).toBeLessThanOrEqual(10);
    }
  });

  it("gives every part in the order a surface and crumbs in the tour", () => {
    const page = readFileSync("src/app/(marketing)/product/page.tsx", "utf8");
    for (const id of MODULE_ORDER) {
      expect(page).toContain(`  ${id}: {`);
    }
  });

  it("quotes no figure about customers, adoption or savings", () => {
    // THE ONLY NUMERAL ON THESE EIGHT PAGES IS THE FREE SEAT CAP, and it is
    // read from the constant the server enforces. Every other quantity the
    // copy names is spelled as a word: "Eight parts", "Three plans",
    // "Twenty minutes". Nothing here is a statistic about customers,
    // adoption, savings or time saved, because there is not one we can
    // evidence.
    //
    // Two things are deliberately outside this sweep. `updated` is a date,
    // and the cookie lede's count is computed by the page from the table it
    // renders, so both are checked by the assertions that own them rather
    // than by a regex over prose.
    const allowed = new Set([String(starterSeatCap)]);
    for (const line of staticClaims(ALL_COPY)) {
      for (const n of line.match(/\d[\d,.]*/g) ?? []) {
        expect(`${line} :: ${n}`).toBe(`${line} :: ${allowed.has(n) ? n : "an unsourced number"}`);
      }
    }
    // And the one that is allowed is actually there, so this is not vacuous.
    expect(staticClaims(ALL_COPY).some((l) => l.includes(String(starterSeatCap)))).toBe(true);
    expect(tier("growth").seatCap).toBeGreaterThan(starterSeatCap);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The truth gates, which are the part of this build that is not style.
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * A route file with everything that is not shown to a visitor removed.
 *
 * Three kinds of line are taken out, and each for a reason:
 *
 *   Comments, including MULTI LINE ones. These files deliberately name the
 *   claims that were removed, so the next person can see what was taken out
 *   and why; a line-at-a-time filter misses the second line of a block
 *   comment, which is how a note explaining that we do not claim GDPR
 *   compliance reads to a regex as a GDPR claim.
 *
 *   A line carrying `copy-gate: <flag>`. That is the marketing copy
 *   checker's own escape, and it means the sentence is inside a branch the
 *   named flag holds shut. The sandbox line on /demo is the one instance:
 *   it is written, it is unreachable while flags.sandbox is false, and it
 *   prints on the day there is a sandbox.
 */
function renderedOnly(source: string): string {
  return source
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !/copy-gate:/.test(l))
    .join("\n");
}

describe("the truth gates", () => {
  const files = {
    privacy: readFileSync("src/app/(marketing)/privacy/page.tsx", "utf8"),
    terms: readFileSync("src/app/(marketing)/terms/page.tsx", "utf8"),
    cookies: readFileSync("src/app/(marketing)/cookies/page.tsx", "utf8"),
    pricing: readFileSync("src/app/(marketing)/pricing/page.tsx", "utf8"),
    demo: readFileSync("src/app/(marketing)/demo/page.tsx", "utf8"),
  };

  /** A claim, and the file it must not appear as a rendered string in. */
  const FORBIDDEN: Array<[keyof typeof files, RegExp, string]> = [
    // The fabricated compliance sentence the previous build shipped.
    ["privacy", /honou?rs? every regional regulation/i, "a blanket regional compliance claim"],
    ["privacy", /\bGDPR\b(?![^\n]*ask us)/i, "a named regime we have not been assessed against"],
    ["privacy", /Settings\s*[>»]\s*Privacy/i, "an in-product privacy page that does not exist"],
    ["privacy", /Data Protection Officer/i, "an Article 37 appointment nobody holds"],
    ["privacy", /zero[- ]retention/i, "a third party's contract quoted as ours"],
    // The six invented cookie rows.
    ["cookies", /ww_session|ww_csrf|ww_preferences|ww_attrib|_ga\b/i, "a cookie this deployment does not set"],
    ["cookies", /Google Analytics/i, "an analytics vendor the site does not load"],
    // The billing commitments with nothing behind them.
    ["terms", /pro[- ]rated/i, "a proration behaviour nothing in this repo sets"],
    ["terms", /auto[- ]renew/i, "a renewal commitment nothing in this repo honours"],
    ["terms", /\b99\.\d+ ?%/, "an uptime number with no status page behind it"],
    // The support ladder and the connector rows.
    ["pricing", /Priority support|Named contact/i, "a support tier that does not exist"],
    ["pricing", /\bSOC ?2\b|\bISO ?27001\b/i, "a certification nobody holds"],
    // The sandbox.
    ["demo", /sandbox (?:login|workspace|account)/i, "a driveable sandbox that does not exist"],
  ];

  for (const [file, pattern, what] of FORBIDDEN) {
    it(`keeps ${what} off /${file}`, () => {
      expect(`/${file}: ${pattern.test(renderedOnly(files[file]))}`).toBe(`/${file}: false`);
    });
  }

  it("still states the two absences the proof rests on", () => {
    expect(files.privacy).toContain("We hold no third party privacy certification or audit yet");
    expect(files.cookies).toContain("None. Every cookie in the table above is set by workwrk itself");
  });

  it("gates the sandbox line on the flag rather than deleting the branch", () => {
    expect(files.demo).toContain("flags.sandbox");
    expect(files.demo).toContain("copy-gate: sandbox");
  });
});
