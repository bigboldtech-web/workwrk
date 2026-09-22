// THE EIGHT RULES, SWEPT OVER EVERY ROUTE, not over the six that already pass.
//
// WHY THIS FILE EXISTS. iconic.test.ts counts words in `copy.ts`, and
// `copy.ts` is the copy tree of eight pages. Its own sweep asserts the set it
// covers is exactly ["blog","compare","demo","legal","pricing","product"],
// under a name claiming the sweep is "not vacuous". The sweep was not
// vacuous; it was SCOPED. Forty routes kept their copy in their own files,
// every one of them broke rules 1, 2, 4, 5 and 6, and 371 tests stayed green
// throughout, which is worse than no test: it is a gate reporting on the
// pages that never needed one.
//
// So this file does not read a copy tree. It ENUMERATES THE ROUTES on disk
// and reads each page's own source, which means a new page is covered the
// moment it exists rather than the moment somebody remembers to register it.
// Every assertion below is a thing the rebuild fixed and a thing that will
// quietly come back the first time someone is in a hurry.
//
// What it cannot decide is what a screenshot decides: whether a section owns
// its viewport, and whether the air around a sentence is the design. Those
// are looked at. Everything here is counted.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { moduleHeadline, MODULE_ORDER } from "../product/module-page";

const MARKETING = join(process.cwd(), "src/app/(marketing)");

/** Every page the marketing group renders, as a route and its source. */
function pageFiles(dir = MARKETING, route = ""): Array<{ route: string; file: string; src: string }> {
  const out: Array<{ route: string; file: string; src: string }> = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...pageFiles(full, `${route}/${name}`));
    } else if (name === "page.tsx" || name === "not-found.tsx") {
      out.push({ route: route || "/", file: full, src: readFileSync(full, "utf8") });
    }
  }
  return out;
}

const PAGES = pageFiles();

/**
 * Routes this sweep deliberately does not hold to the page rules, each with
 * the reason. A list of three is a list; a list that grows is how the scoped
 * sweep this file replaces came about, so every entry says why.
 */
const EXEMPT: Record<string, string> = {
  // The rewrite target the proxy uses for an unknown path on the marketing
  // host. Its whole body is `notFound()`, so it renders nothing at all.
  "/404": "renders nothing: it calls notFound() so not-found.tsx draws",
  // An internal token reference sheet. It is deliberately out of the sitemap
  // (see the note at the top of src/app/sitemap.ts) and is not a page a
  // visitor is ever sent to.
  "/dev/foundations": "internal design reference, not in the sitemap, not linked",
};

const ROUTES = PAGES.filter((p) => !(p.route in EXEMPT));

/** Words in a headline. */
function words(line: string): number {
  return line.trim().split(/\s+/).filter(Boolean).length;
}

/** Sentences, counted by terminal stops. */
function sentences(line: string): number {
  return (line.match(/[.!?](?=\s|$)/g) ?? []).length;
}

describe("the sweep itself", () => {
  it("finds every route, so it cannot go vacuous the way the last one did", () => {
    // A floor, not an exact set. Pinning the exact list is precisely the
    // mistake this file exists to undo: it made the sweep green while forty
    // uncovered pages broke every rule.
    expect(PAGES.length).toBeGreaterThanOrEqual(45);
    expect(ROUTES.length).toBeGreaterThanOrEqual(43);
  });

  it("exempts only routes that render nothing a visitor reads", () => {
    for (const route of Object.keys(EXEMPT)) {
      expect(PAGES.map((p) => p.route)).toContain(route);
    }
    expect(Object.keys(EXEMPT).length).toBeLessThanOrEqual(3);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * ONE GRAMMAR. The finding this file answers was not that pages were ugly,
 * it was that the site read as two products' websites glued at the nav: an
 * exact binary split, 72px centred on nine routes and 64px left aligned on
 * forty, with nothing in between.
 * ═══════════════════════════════════════════════════════════════════ */

describe("one grammar", () => {
  // The home page is the one route with its own sheet, and deliberately so:
  // it is the site's loudest page and it carries sections nothing else has.
  //
  // IT NO LONGER OBEYS THE EIGHT RULES, and that is a deliberate change
  // rather than drift. The rules encode the quiet register the founder
  // rejected twice; the register he asked for instead is the one ClickUp,
  // Asana and monday.com share, and it is denser, more colourful and more
  // product forward by design. `home/stack` (was `home/chain`) is that page.
  //
  // BE CLEAR ABOUT WHAT THIS SWEEP DOES AND DOES NOT COVER. Every assertion
  // in this file reads a ROUTE FILE, and the home route file is now four
  // lines that render one component, so the rule tests below have never seen
  // the new home page's headlines or its card grid and would not have caught
  // them either way. They are not evidence that the home page obeys rule 2
  // or rule 5. It does not: its headline is nine words and it ships a
  // deliberate eight card module grid.
  //
  // The other forty-three routes still draw through the kit and are still
  // held to all eight rules, because they have not been moved to the new
  // register yet. When they are, these rules are what changes.
  const KIT = /iconic\/iconic|iconic\/legal-doc|marketing\/sub-page|home\/stack/;

  it("draws every route through the iconic kit", () => {
    for (const page of ROUTES) {
      expect(`${page.route}: ${KIT.test(page.src) ? "kit" : "own layout"}`).toBe(`${page.route}: kit`);
    }
  });

  it("leaves no page on the rejected type ramp", () => {
    // `mk-display-md` and `mk-title-lg` are the 64px left aligned heading and
    // its h2, which is the whole of the grammar the founder rejected.
    for (const page of ROUTES) {
      for (const banned of ["mk-display-md", "mk-display-lg", "mk-title-lg"]) {
        expect(`${page.route}: ${page.src.includes(banned) ? banned : "clean"}`).toBe(`${page.route}: clean`);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * Rule 5. No card grid, no badge row, no logo wall.
 * ═══════════════════════════════════════════════════════════════════ */

describe("rule 5: no card grid", () => {
  it("ships no bordered card grid on any route", () => {
    for (const page of ROUTES) {
      // `mk-cards` is the legacy grid container and `mk-card` its tile;
      // `FeatureCard` is the primitives-era three column card.
      for (const banned of ["mk-cards", "mk-card__title", "FeatureCard"]) {
        expect(`${page.route}: ${page.src.includes(banned) ? banned : "clean"}`).toBe(`${page.route}: clean`);
      }
    }
  });

  it("keeps the legacy primitives kit out of the routes entirely", () => {
    // The primitives sheet is where GradientText, Quote, CTABand and the hue
    // table live. One import of it brings the whole rejected visual language
    // back with it.
    for (const page of ROUTES) {
      const legacy = /from "@\/components\/marketing\/primitives"/.test(page.src);
      expect(`${page.route}: ${legacy ? "imports primitives" : "clean"}`).toBe(`${page.route}: clean`);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * Rule 7. Motion is one move.
 * ═══════════════════════════════════════════════════════════════════ */

describe("rule 7: one move", () => {
  it("has no hover transform anywhere in the marketing tree", () => {
    for (const page of ROUTES) {
      expect(`${page.route}: ${/hover:-?translate-/.test(page.src) ? "hover transform" : "clean"}`).toBe(
        `${page.route}: clean`,
      );
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * Rule 2. Few words, enormous type.
 *
 * Read off the SOURCE, so a headline written in a page rather than in the
 * copy tree is counted the same as one written in it.
 * ═══════════════════════════════════════════════════════════════════ */

/** Every literal claim and headline a page file writes out. */
function literalHeadlines(src: string): string[] {
  const out: string[] = [];
  // <Claim id="x">Literal words.</Claim> and the same for Headline.
  for (const m of src.matchAll(/<(?:Claim|Headline)\b[^>]*>([^<{}]+)<\/(?:Claim|Headline)>/g)) {
    out.push(m[1]);
  }
  // <Close headline="..." /> and the two sub-page shells' `title=`.
  for (const m of src.matchAll(/\b(?:headline|title|workflowTitle|painsTitle|kpisLabel)="([^"]+)"/g)) {
    out.push(m[1]);
  }
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// TEN WORDS, NOT SIX. See the matching note in iconic.test.ts: six was the
// rejected register's rule, where a headline was a clipped two-part
// fragment. The register the founder asked for writes plainer, longer
// lines, and the rebuilt home page's own claim is nine words. The cap
// stays, because "a headline that became a paragraph" is a real failure
// and is not a matter of register.
const HEADLINE_MAX = 10;

describe("rule 2: few words", () => {
  it("holds every literal headline on every route to ten words or fewer", () => {
    for (const page of ROUTES) {
      for (const line of literalHeadlines(page.src)) {
        // A `title=` in a `metadata` block is a browser tab name, not a
        // headline, and those legitimately run long.
        if (/title="[^"]*"/.test(line)) continue;
        expect(`${page.route}: "${line}" is ${words(line)} words`).toBe(
          `${page.route}: "${line}" is ${Math.min(words(line), HEADLINE_MAX)} words`,
        );
      }
    }
  });

  it("finds headlines on most routes, so the count is real", () => {
    const withHeadlines = ROUTES.filter((p) => literalHeadlines(p.src).length > 0);
    expect(withHeadlines.length).toBeGreaterThanOrEqual(30);
  });

  it("holds the eight module chapter claims to ten words", () => {
    for (const id of MODULE_ORDER) {
      const headline = moduleHeadline(id);
      expect(`${id}: "${headline}" is ${words(headline)} words`).toBe(
        `${id}: "${headline}" is ${Math.min(words(headline), HEADLINE_MAX)} words`,
      );
    }
  });

  it("holds every sub-page lede to one sentence", () => {
    for (const page of ROUTES) {
      for (const m of page.src.matchAll(/\blede="([^"]+)"/g)) {
        const line = m[1].replace(/\s+/g, " ").trim();
        expect(`${page.route}: "${line}" has ${sentences(line)} sentence(s)`).toBe(
          `${page.route}: "${line}" has 1 sentence(s)`,
        );
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The decided spine, item 5: "no replaces lines".
 *
 * The vocabulary belongs on /compare, which is the page that names names on
 * purpose. It was on the navigation of all 49 routes, on the eight rows of
 * the product rail inside every frame, on the eight module chapters and on
 * the /features index, which is the competitor-displacement framing the
 * whole direction was chosen to get away from.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the replaces vocabulary", () => {
  it("appears on no route outside the compare tree", () => {
    for (const page of ROUTES) {
      if (page.route.startsWith("/compare")) continue;
      const rendered = page.src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      expect(`${page.route}: ${/Replaces:|Replaced:/.test(rendered) ? "replaces line" : "clean"}`).toBe(
        `${page.route}: clean`,
      );
    }
  });

  it("appears in no shared marketing component", () => {
    const shared = ["nav.tsx", "footer.tsx", "shell/marketing-shell.tsx", "sub-page.tsx"];
    for (const name of shared) {
      const src = readFileSync(join(process.cwd(), "src/components/marketing", name), "utf8");
      const rendered = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      expect(`${name}: ${/Replaces:|Replaced:/.test(rendered) ? "replaces line" : "clean"}`).toBe(`${name}: clean`);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * Rule 8. Colour is almost absent.
 * ═══════════════════════════════════════════════════════════════════ */

describe("rule 8: colour is almost absent", () => {
  it("paints no page's own text with the brand accent", () => {
    // `--os-brand-deep` was the legacy link colour, and it was on links in
    // the middle of bands on eleven routes, which is a blue per paragraph on
    // a site whose rule is one blue per screen. Inside a product frame the
    // product's own chrome is fixed and may use whatever it uses.
    for (const page of ROUTES) {
      expect(`${page.route}: ${page.src.includes("--os-brand-deep") ? "brand text" : "clean"}`).toBe(
        `${page.route}: clean`,
      );
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The truth gates, held at the tree level rather than per page.
 * ═══════════════════════════════════════════════════════════════════ */

describe("truth gates", () => {
  it("has deleted the dead landing tree that still held invented quotes", () => {
    // src/components/landing was unimported dead code containing fabricated
    // customer testimonials, count-up metric cards and about a hundred em
    // dashes, and it was excluded from the copy checker's scan roots by
    // design. One import away from putting invented customers back on the
    // site, with the gate that would catch it looking elsewhere.
    let exists = true;
    try {
      statSync(join(process.cwd(), "src/components/landing"));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it("ships no em dash or double hyphen in any marketing page's own source", () => {
    for (const page of ROUTES) {
      const rendered = page.src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      expect(`${page.route}: ${/[—–―]/.test(rendered) ? "em dash" : "clean"}`).toBe(`${page.route}: clean`);
    }
  });
});
