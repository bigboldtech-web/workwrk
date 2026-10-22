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
import { tierCtaIsPrimary } from "../config";
import { flags } from "../flags";
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
  // TEN WORDS, NOT SIX. The six came from the quiet register the founder
  // rejected twice, where a headline was a clipped two-part fragment: "Pay
  // for people. Nothing else.", "Three plans. One number." The register he
  // asked for instead (ClickUp, Asana, monday.com) writes plainer, longer,
  // benefit-led lines that read as sentences, and the rebuilt home page's
  // own claim is nine words.
  //
  // The cap is kept rather than removed, because the failure it guards
  // against is real and unrelated to register: a headline that turns into a
  // paragraph. Ten is the home page's longest line plus one.
  const HEADLINE_MAX = 10;

  it("holds every headline to ten words or fewer", () => {
    for (const [where, line] of headlines()) {
      expect(`${where}: ${line} (${words(line)} words)`).toBe(
        `${where}: ${line} (${Math.min(words(line), HEADLINE_MAX)} words)`,
      );
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

    // The money page fills EXACTLY ONE plan button, the recommended one.
    //
    // This used to assert all three were ghost, on the reasoning that the
    // page's only blue belonged to its close. That was written while the
    // plans were three unbordered rows, where a filled button had nothing
    // to anchor to. The plans are bordered cards again, and marking the
    // recommended card with a filled button is the category's own pattern
    // and what the rebuilt home page's price strip does.
    //
    // The rule this test protects is one filled button per VIEWPORT, and
    // that still holds: the plans band and the closing band are far apart
    // on this page and are never on screen together.
    const price = readFileSync("src/app/(marketing)/pricing/page.tsx", "utf8");
    expect(price).toContain('tierCtaIsPrimary(t.id) ? "primary" : "ghost"');
  });

  it("marks exactly one tier as the filled one, so the page cannot grow a second blue", () => {
    // The skin above is chosen by `tierCtaIsPrimary`, which reads the
    // `recommended` flag in the pricing source. If two tiers ever carried
    // that flag, the plans band would ship two filled buttons in one
    // viewport and the assertion above would still pass, because it only
    // checks the expression.
    const filled = pricing.tiers.filter((t) => tierCtaIsPrimary(t.id));
    expect(filled.map((t) => t.id)).toHaveLength(1);
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
    changelog: readFileSync("src/app/(marketing)/changelog/page.tsx", "utf8"),
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
    // Google's verification and its security assessment are founder actions
    // still to come (docs/plans/ai-teammates-phase3.md, review of step 5).
    ["privacy", /verified by Google|Google[- ]verified|\bCASA\b|security assessment/i, "a Google verification or assessment nobody has passed"],
    // The computer for AI teammates keeps no sign-in between browsers
    // (docs/plans/ai-teammates-phase4.md Decision 8, step 5).
    ["privacy", /stored (?:sign[- ]in )?profiles?/i, "a stored sign-in profile nothing keeps"],
    // Its browsers run on WorkwrK's own server (docs/plans/browser-host.md
    // Decision 14, section 9.5): no browser provider is used or framed.
    ["privacy", /browser provider/i, "a browser provider this deployment does not use"],
    ["cookies", /browser provider/i, "a third party frame this deployment does not load"],
    // An AI app connected through the MCP server is the person's choice, and
    // WorkwrK checks none (docs/plans/mcp-server.md 6.1 notChecked, 6.4).
    ["privacy", /verified by WorkwrK|WorkwrK[- ](?:verified|approved|certified)|approved by WorkwrK/i, "an AI app check WorkwrK does not make"],
  ];

  for (const [file, pattern, what] of FORBIDDEN) {
    it(`keeps ${what} off /${file}`, () => {
      expect(`/${file}: ${pattern.test(renderedOnly(files[file]))}`).toBe(`/${file}: false`);
    });
  }

  it("still states the two absences the proof rests on", () => {
    expect(files.privacy).toContain("We hold no third party privacy certification or audit yet");
    // docs/plans/browser-host.md 9.5: no exception any more, since the frame is WorkwrK's own (before: one the person started).
    expect(visibleText(files.cookies)).toContain("None set by anyone else. When you watch or take over");
    expect(visibleText(files.cookies)).not.toContain("with one exception");
    expect(visibleText(files.cookies)).toContain("Every cookie in the table above is set by workwrk itself.");
  });

  it("gates the sandbox line on the flag rather than deleting the branch", () => {
    expect(files.demo).toContain("flags.sandbox");
    expect(files.demo).toContain("copy-gate: sandbox");
  });

  // Review of step 5. Google's verification looks for the Limited Use
  // disclosure word for word, and nothing held it or the Google section's
  // promises, so a restyle could drop one and fail no test.
  it("keeps Google's Limited Use disclosure on /privacy word for word, linked to the policy itself", () => {
    expect(visibleText(files.privacy)).toContain(
      "WorkwrK's use and transfer of information received from Google APIs to any other app will adhere to the Google API Services User Data Policy, including the Limited Use requirements. We do not use data from Google Workspace APIs to develop, improve or train generalized AI or machine learning models.",
    );
    expect(renderedOnly(files.privacy)).toContain('<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>');
  });

  it("keeps where the person's Google is never used, the attachments sentence and the shared-account exception on /privacy", () => {
    const text = visibleText(files.privacy);
    expect(text).toContain("never when a teammate answers in Talk, for an automation or for another teammate");
    expect(text).toContain("It never opens attachments.");
    expect(text).toContain("unless the same Google account is still connected elsewhere in WorkwrK, ask Google to remove WorkwrK's access");
  });

  it("says on /privacy what else a teammate reads and keeps of the person's Google", () => {
    const text = visibleText(files.privacy);
    // Reads at an approval, and colleagues' busy times for a meeting.
    expect(text).toContain("and again when you approve what it asked, to check that the email conversation is still there or that the event has not changed since it asked.");
    expect(text).toContain("To find a time to meet, it can also read, through your account, when up to five colleagues in your workspace are busy, never what they are doing.");
    // The answer in the run history too, and the tokens in the backups.
    expect(text).toContain("which stays in your chat with it and in your run history, as every teammate answer does.");
    expect(text).toContain("Our encrypted backups hold the encrypted tokens too, for at most 90 days, as above.");
    // Review round 3 of Phase 3: deleting the account erases them (src/app/api/me/delete).
    // Review round 5 of Phase 3: a very long history is finished by the erasure sweep, within a day.
    // Review round 6 of Phase 3: a day was not true for the worst case (a history of about a million rows, or many erasures at once).
    expect(text).toContain("and its requests stay as every teammate request does, until you delete your account, which erases their words at once for most histories, or within a few days for a very long one.");
    expect(text).not.toContain("within a day");
  });

  // Step 5 of docs/plans/ai-teammates-phase4.md: the computer for AI
  // teammates on /privacy. The key clauses are pinned, each as the code
  // makes it true; the spec's "never sees what you type", "told only that you
  // finished" and "nothing you sign in to is kept" were made exact (the page's
  // comment says why), and the answers keep what they quoted.
  it("says on /privacy what the computer for AI teammates does, sends and keeps", () => {
    const text = visibleText(files.privacy);
    expect(text).toContain("If an Owner or Admin turns it on for your workspace, which needs the Growth plan or above, an AI teammate can use a web browser for you, in your own chats with it.");
    // docs/plans/browser-host.md 9.5: on a server WorkwrK runs, apart from the workspace's.
    expect(text).toContain(
      "The browser runs on a server WorkwrK runs for these browsers alone, apart from the servers that hold your workspace, for that one chat and is never shared: nobody else, an Owner or Admin included, can watch it, use it or reach what you sign in to in it",
    );
    expect(text).toContain("A teammate opens only the sites your workspace and that teammate allow, and never private or internal addresses.");
    expect(text).toContain("every click, every word it types and every choice waits for your approval on a card that shows the page.");
    // Decision 16: the model never sees a picture of a page.
    expect(text).toContain("The words a page shows are sent to our model provider to answer you, never a picture of the page; we do not send them for training, and we do not use them to train any model.");
    // Decision 18: the refusal is by the field's kind.
    expect(text).toContain("A teammate never types into a field it recognises as one for a password, a one-time code or a card number");
    // Field values never leave the browser; after Done it may read the page.
    expect(text).toContain("never sees what you type in a page's fields: to sign in or pay, you take over the browser yourself while the teammate sees nothing, and it is told only whether you finished, then may read the page as you left it.");
    expect(text).toContain("It cannot download or upload files, and no sign-in you make in it is kept after the browser closes.");
    // The second paragraph: what is kept, for whom, and for how long.
    expect(text).toContain("For you alone, we keep a list of the steps a teammate took in the browser, the kind of step, the site, how it went and when, for 30 days.");
    expect(text).toContain("Pictures of pages shown on its cards and in your chat are kept encrypted for 24 hours, for you alone, and are not in our backups.");
    expect(text).toContain("We never keep the text of the pages it read; what it wrote back to you, and which sites it used, stay in your chat with it and in your run history, as every teammate answer does.");
    expect(text).toContain("A request it asks you to approve keeps what it would do, such as the words it would type, as every teammate request does.");
    expect(text).toContain("Owners and Admins see in the audit log which sites a teammate opened for you and what kind of steps it took, never what it read or typed.");
    // docs/plans/browser-host.md 9.5: what that server keeps, exactly (review of its step 4, L9, and its
    // final review, privacy M2 and the lows): no copy of a page, picture or input once the browser closes,
    // and Chrome's own storage on a memory-only disk while it runs; counts; each browser's codes and times
    // for an hour after it closes (6.1); a system log of events with no code, address or content, at most
    // 14 days; and the addresses of the people who watch or use a browser, in memory, for its rate limits
    // (3.1), since the server's SSH log keeps the addresses that reach its own port 22.
    expect(text).toContain(
      "Once the browser closes, that server keeps no copy of the pages it opened, the picture of it you watched or what you typed when you took it over. While the browser runs, its own cache, cookies and site storage sit on a disk kept only in memory, for that browser alone, and are gone when it closes.",
    );
    expect(text).toContain(
      "About the browsers and the people who use them, the server keeps only these: counts, such as how many browsers are running; the codes that name each browser and when it ran, until an hour after it closes; a system log of events, such as a browser starting or closing or a view of one opening, which holds none of those codes, no network address and nothing from a page, for at most 15 days; and, in its memory alone, the network addresses of the people who watch or use a browser, to limit how often each may try.",
    );
    expect(text).not.toContain("it keeps only counts, such as how many browsers are running.");
    // Before: "never stores", which Chrome's own cache and storage during a session made untrue, and every
    // address "that reach it", which the SSH log made untrue; the system log was not named.
    expect(text).not.toContain("That server never stores");
    expect(text).not.toContain("the network addresses that reach it");
    // Sections 4, 6 and 7 (browser-host.md 9.5 for 4 and 7).
    expect(text).toContain(
      "We use a small number of sub-processors to run the service: hosting providers for our servers, among them the one where AI teammates' browsers run when a workspace turns them on, a payment processor, a transactional email provider and a model provider for the AI features.",
    );
    expect(text).not.toContain("a provider that runs those browsers");
    // Browser host final review, privacy M4: what the browsers reach by themselves, named beside the hosting company.
    expect(text).toContain(
      "When a workspace turns them on, AI teammates' browsers also reach three other companies, from WorkwrK's browser server and never from your device. To find each site it opens, a browser asks Cloudflare (1.1.1.1) and Quad9 (9.9.9.9), which see the names of those sites. Chrome, the browser they run, checks the pages it opens with Google Safe Browsing and fetches its own updates and settings from Google. We turn off Chrome's password leak checks, autofill, sync, usage reports and sign-in.",
    );
    // In section 4, beside the hosting company: between its sub-processors and the list's request.
    const share = text.slice(text.indexOf("We use a small number of sub-processors"), text.indexOf("and ask for the sub-processor list"));
    expect(share.length).toBeGreaterThan(0);
    for (const name of ["Cloudflare (1.1.1.1)", "Quad9 (9.9.9.9)", "Google Safe Browsing", "updates and settings from Google"]) expect(share, name).toContain(name);
    expect(text).toContain("A teammate's browser steps are deleted 30 days after they were taken, and pictures of pages 24 hours after they were taken. Our encrypted backups hold the steps, as they hold every other record, for at most 90 days, and never the pictures.");
    expect(text).toContain(
      "An AI teammate's browser runs on WorkwrK's own server, in one region for this deployment, which Owners and Admins see in Settings, Apps & modules. The names of the sites it looks up, and Chrome's checks and updates with Google, go to the companies section 4 names, which may answer from outside that region.",
    );
    // The spec's wordings that are not true of the code, kept off.
    expect(text).not.toContain("nothing you sign in to is kept");
    expect(text).not.toContain("told only that you finished");
    expect(text).not.toContain("What a page shows is sent");
    // And the date moved with them (and again with Phase 5's step 5 and its review, below, the browser host's step 4 and its final review).
    expect(LEGAL_COPY.privacy.updated).toBe("21 October 2026");
  });

  // Step 5 of docs/plans/ai-teammates-phase5.md: teaching AI teammates by
  // showing on /privacy. The spec's key clauses are pinned, each as the code
  // makes it true (the page's comment says which were made truer and why),
  // and the spec's wordings that are not true of the code are kept off.
  it("says on /privacy what teaching AI teammates by showing keeps, sends, shows Owners and Admins, and deletes", () => {
    const text = visibleText(files.privacy);
    // Off until an Owner or Admin turns it on, as the computer's paragraph opens.
    expect(text).toContain("If an Owner or Admin also turns on teaching by showing, you can show an AI teammate how to do a job by doing it once in its browser.");
    // What a recording keeps, and never keeps.
    expect(text).toContain("While you do it, we keep which pages you visit, by their site and the start of their address, the words on the buttons, links and other controls you click, and which fields and lists you use.");
    expect(text).toContain("The steps never keep what you type in a field or which option you choose");
    // The pictures can show it, and the page says so (review of Phase 5 step 5, M1).
    expect(text).toContain("which can show what is on it, what you typed or chose included, is kept for you alone for 24 hours.");
    expect(text).not.toContain("We never keep what you type");
    expect(text).toContain("a field we recognise as a password, code or card field");
    expect(text).toContain("nothing inside a box from another site");
    expect(text).toContain("those become steps you do yourself each time.");
    expect(text).toContain("can name a person or a record");
    expect(text).toContain("you see every one when you review the steps, and can remove it.");
    expect(text).toContain("kept for you alone for 24 hours");
    expect(text).toContain("sees nothing while you record");
    // Only a saved skill runs, and it still asks.
    expect(text).toContain("only once you save them can it use the skill.");
    expect(text).toContain("and still asks before every click, every word it types and every choice;");
    expect(text).toContain("some sites save or send what is in a field as soon as it is filled in, and a request that fills in fields for a skill says so.");
    // What reaches the model provider (Decision 16), never for training.
    expect(text).toContain("The names of your skills and what each is for, and a skill's steps while it follows one, are sent to our model provider to answer you, as pages are, and never for training.");
    // The person's alone, and never started by itself.
    expect(text).toContain("yours alone");
    expect(text).toContain("nobody else, an Owner or Admin included, can see it, use it or copy it");
    expect(text).toContain("a teammate uses it only when you ask in your own chat with it, never by itself");
    expect(text).toContain("only reminds you");
    // What Owners and Admins see, and what they may do unseen.
    expect(text).toContain("Owners and Admins see in the audit log when you recorded, saved, changed or deleted a skill or made a routine from one, with its number of steps and its sites, never its name or its steps, and how many skills the workspace keeps and by how many people;");
    expect(text).toContain("never its name or its steps");
    expect(text).toContain("delete every skill in the workspace without seeing any");
    // Section 6.
    expect(text).toContain("A skill is kept until you delete it, an Owner or Admin deletes every skill in the workspace, or your account or the workspace is erased.");
    expect(text).toContain("If you leave the workspace or are deactivated, or its teammate is removed, the skill is deleted 30 days later, unless you or the teammate come back before then;");
    expect(text).toContain("deleted 30 days later");
    expect(text).toContain("for at most 90 days after it is deleted");
    expect(text).toContain("Pictures taken while you record are deleted after 24 hours, as other pictures of pages, and are never in our backups.");
    // Before: none of it was on the page.
    // Kept off: what the code never does, and the spec's wordings made truer.
    for (const off of ["replays", "shared skill", "never record what you type or choose", "never uses it when you are not there", "we keep the pages you visit", "the request says so", "only then can it use the skill"]) {
      expect(text, off).not.toContain(off);
    }
    expect(LEGAL_COPY.privacy.updated).toBe("21 October 2026");
    // The comment names the spec and every Decision the paragraph rests on.
    expect(files.privacy).toContain("docs/plans/ai-teammates-phase5.md,\n                  Decisions 6, 7, 9, 10, 14, 15, 18, 19, 22, 24 and 25, step\n                  5)");
  });

  it("never says a browser is recorded on /privacy, nor keeps a sign-in profile", () => {
    const text = visibleText(files.privacy);
    const from = text.indexOf("If an Owner or Admin turns it on for your workspace, which needs the Growth plan");
    const to = text.indexOf("never what it read or typed.");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const browser = [
      text.slice(from, to),
      ...text.split(/(?<=\.) /).filter((sentence) => /browser/i.test(sentence)),
    ].join(" ");
    // Recording is off per session (Decision 7): "recorded" reads as a video of the person's browsing.
    expect(browser).not.toMatch(/\brecord(?:ed|ing|s)?\b/i);
    expect(text).not.toMatch(/stored (?:sign[- ]in )?profiles?/i);
  });

  // docs/plans/browser-host.md 9.5: the live view's frame is WorkwrK's own
  // browser server, which sets no cookie and keeps no site storage in the
  // person's browser, so /cookies names no third party and no provider's rows
  // wait. Its final review (the privacy lows): "keeps nothing" was more than
  // the code holds, so the plain claim replaced it.
  it("says on /cookies the live view's frame is WorkwrK's own, setting no cookie and keeping no site storage in your browser", () => {
    const text = visibleText(files.cookies);
    expect(text).toContain(
      "None set by anyone else. When you watch or take over an AI teammate's browser, the picture of that browser comes from WorkwrK's own browser server, which sets no cookie and keeps no site storage in your browser. Every cookie in the table above is set by workwrk itself. We load no analytics vendor, no ad tech, no retargeting pixel and no social network tracker on this site or in the product.",
    );
    expect(text).toContain("sets no cookie and keeps no site storage in your browser");
    expect(text).not.toContain("keeps nothing in your browser");
    // Before: the provider's frame was the one exception, its rows waiting for Founder action 6.
    expect(text).not.toContain("frame from our browser provider");
    expect(LEGAL_COPY.cookies.updated).toBe("21 October 2026");
  });

  // docs/plans/browser-host.md Decision 14: the pages name the one provider
  // production may run, so changing it is a change of the pages too.
  it("names WorkwrK's own browser server only while production may run only our own host", async () => {
    const { DISCLOSED_PRODUCTION_PROVIDER } = await import("../../../lib/browser/disclosed");
    expect(DISCLOSED_PRODUCTION_PROVIDER).toBe("workwrk");
    expect(visibleText(files.privacy)).toContain("runs on WorkwrK's own server");
    expect(visibleText(files.cookies)).toContain("WorkwrK's own browser server");
  });

  it("keeps every dash and double hyphen off the browser's text on /privacy, /cookies and the waiting changelog entry", () => {
    for (const [name, text] of [
      ["privacy", visibleText(files.privacy)],
      ["cookies", visibleText(files.cookies)],
      ["changelog", files.changelog.slice(files.changelog.indexOf("WRITTEN, NOT LISTED"), files.changelog.indexOf("const ENTRIES"))],
    ] as const) {
      expect(`${name}: ${DASH.test(text)}`).toBe(`${name}: false`);
      expect(`${name}: ${DOUBLE_HYPHEN.test(text)}`).toBe(`${name}: false`);
    }
  });

  it("writes teaching by showing's changelog entry in a constant the page never renders, waiting for the founder (Phase 5 step 5)", async () => {
    const waiting = readFileSync("src/app/(marketing)/changelog/waiting-entries.ts", "utf8");
    const { TEAMMATE_SKILLS_ENTRY } = await import("../../../app/(marketing)/changelog/waiting-entries");
    // Before: no entry written anywhere.
    expect(TEAMMATE_SKILLS_ENTRY.title).toBe("Teach AI teammates by showing");
    expect(TEAMMATE_SKILLS_ENTRY.items.map((i) => i.type)).toEqual(["feature", "security"]);
    expect(TEAMMATE_SKILLS_ENTRY.items[0].text).toBe(
      "On Growth and above, where an Owner or Admin turns it on, show a teammate a job once in its browser, review the steps, and run it again from your chat or from a reminder.",
    );
    expect(TEAMMATE_SKILLS_ENTRY.items[1].text).toBe(
      "A recording's steps keep which pages you visit, the words on the buttons and links you click and which fields you use, never what you type or choose; its pictures, kept for you alone for 24 hours, can show it. Every click still asks first, and a form's fields are filled in on one card that shows every word first.",
    );
    // It waits for Founder actions 1 to 4 and production (5), in the commit that sets the flag.
    expect(waiting).toContain("Founder actions 1 to 4");
    expect(waiting).toContain("flags.teammateSkills");
    // Not on the page: the page never imports it, and nothing a visitor reads names it.
    expect(files.changelog).not.toMatch(/import[^;]*waiting-entries/);
    expect(renderedOnly(files.changelog)).not.toContain("Teach AI teammates by showing");
    expect(renderedOnly(files.changelog)).not.toContain("show a teammate a job once");
    for (const t of [TEAMMATE_SKILLS_ENTRY.title, ...TEAMMATE_SKILLS_ENTRY.items.map((i) => i.text)]) {
      expect(`${DASH.test(t)} ${DOUBLE_HYPHEN.test(t)}`, t).toBe("false false");
    }
    expect(flags.teammateSkills).toBe(false);
  });

  // docs/plans/mcp-server.md 6.4 (step 4): connecting an AI app through the
  // WorkwrK MCP server on /privacy. Both paragraphs are pinned word for word,
  // each where the spec puts it, and the spec's wordings the code does not
  // bear out (the page's comment says which were made truer and why) are kept
  // off. Fails on the code before step 4: neither paragraph was there.
  it("says on /privacy what connecting an AI app does, where what it reads goes, how it ends and what is kept (MCP step 4)", () => {
    const text = visibleText(files.privacy);
    const mcp =
      "You can connect an AI app that you use, such as Claude, ChatGPT, Cursor or VS Code, to WorkwrK when an Owner or Admin of your workspace allows it. You choose the workspace, and whether the app may only read or may also make changes. It works as you: it sees and changes only what you can, it can never delete anything, and every change it makes is recorded with its name. What it reads, and what you send through it, goes to the company that makes that app, under that company's own terms; we do not control what it keeps. We send nothing until you choose Allow, and you can disconnect it at any time in My settings, Calendar & connections, which ends its access at once. Logging out everywhere, or changing your password, disconnects it too; logging out of one browser does not. We keep the app's name and the addresses it returns to, and when you connected it and last used it, until 90 days after the connection ends, and how many requests and changes it made each day for 90 days. Owners and Admins see how many apps are connected in the workspace and how many requests and changes they made today, and each change in the audit log, with the app's name and the network address it came from, kept for as long as the rest of the log.";
    expect(text).toContain(mcp);
    // In section 3, after teaching by showing and before the providers' question.
    expect(text.indexOf(mcp)).toBeGreaterThan(text.indexOf("they can delete every skill in the workspace without seeing any."));
    expect(text.indexOf(mcp)).toBeLessThan(text.indexOf("Which providers we use, and what their own retention terms say"));
    const sub = "An AI app you connect yourself is not one of our sub-processors: you choose it, and its company receives what you let it read under its own terms.";
    expect(text).toContain(sub);
    // In section 4, after the sub-processors and before what the browsers reach.
    expect(text.indexOf(sub)).toBeGreaterThan(text.indexOf("before you sign up or at any point after."));
    expect(text.indexOf(sub)).toBeLessThan(text.indexOf("When a workspace turns them on, AI teammates' browsers also reach"));
    // The spec's wordings that are not true of the code, kept off.
    expect(text).not.toContain("Signing out everywhere");
    expect(text).not.toContain("each day, for 90 days after the connection ends");
    expect(text).not.toContain("Owners and Admins see those counts");
    // The date (a guard: it already was this day) and its history line.
    expect(LEGAL_COPY.privacy.updated).toBe("21 October 2026");
    expect(readFileSync("src/components/marketing/iconic/copy.ts", "utf8")).toContain("21 October 2026 (the MCP server,");
    for (const t of [mcp, sub]) expect(`${DASH.test(t)} ${DOUBLE_HYPHEN.test(t)}`, t).toBe("false false");
  });

  it("writes the MCP server's changelog entry in a constant the page never renders, waiting for MCP_OFFERED (MCP step 4)", async () => {
    const waiting = readFileSync("src/app/(marketing)/changelog/waiting-entries.ts", "utf8");
    const { MCP_ENTRY } = await import("../../../app/(marketing)/changelog/waiting-entries");
    // Before step 4: no entry written anywhere.
    expect(MCP_ENTRY.items.map((i) => i.type)).toEqual(["feature", "security"]);
    expect(MCP_ENTRY.items[0].text).toBe(
      "Connect Claude, ChatGPT, Cursor or VS Code to WorkwrK and ask it to find, create and change your work, as you, where an Owner or Admin turns it on.",
    );
    expect(MCP_ENTRY.items[1].text).toBe(
      "An app sees only what you can, never deletes anything, and every change it makes is marked with its name. Disconnect it any time in My settings.",
    );
    expect(MCP_ENTRY.date).toBe("<the day production is turned on>");
    expect(waiting).toContain("Founder actions 1 and 2");
    // Not on the page: the page never imports it, and nothing a visitor reads names it.
    expect(files.changelog).not.toMatch(/import[^;]*waiting-entries/);
    expect(renderedOnly(files.changelog)).not.toContain(MCP_ENTRY.title);
    expect(renderedOnly(files.changelog)).not.toContain("Connect Claude, ChatGPT, Cursor or VS Code");
    for (const t of [MCP_ENTRY.title, ...MCP_ENTRY.items.map((i) => i.text)]) {
      expect(`${DASH.test(t)} ${DOUBLE_HYPHEN.test(t)}`, t).toBe("false false");
    }
  });

  it("writes the skills row of the pricing matrix behind flags.teammateSkills, Growth and above (Phase 5 step 5)", () => {
    // Before: no row, and no flag.
    expect(files.pricing).toContain('...(flags.teammateSkills ? ([["Teach AI teammates by showing", false, true, true]] as Array<[string, CompareValue, CompareValue, CompareValue]>) : []),');
    expect(files.pricing.match(/Teach AI teammates by showing/g)?.length).toBe(1);
  });

  it("writes the computer's changelog entry but lists it only once it is on in production", () => {
    // Written now, in a comment above ENTRIES (Decision 32).
    expect(files.changelog).toContain('title: "AI teammates can use a web browser for you"');
    expect(files.changelog).toContain("Founder actions 1 to 7");
    // Not on the page: nothing a visitor reads names it.
    expect(renderedOnly(files.changelog)).not.toContain("AI teammates can use a web browser for you");
    expect(renderedOnly(files.changelog)).not.toContain("take it over to sign in or pay yourself");
  });

  it("writes the browser row of the pricing matrix from the enforced caps, behind flags.teammateComputer", () => {
    expect(files.pricing).toContain("const BROWSER_CAP = { growth: BROWSER_LIMITS.GROWTH, scale: BROWSER_LIMITS.SCALE } as const;");
    expect(files.pricing).toContain('import { BROWSER_LIMITS, PLAN_LIMITS, TEAMMATE_LIMITS } from "@/lib/plan-limits-data";');
    // The row sits inside the flag's branch, Starter has none, and its numbers are read, never typed.
    expect(files.pricing).toMatch(
      /\.\.\.\(flags\.teammateComputer\s*\?\s*\(\[\s*\[\s*"AI teammates' web browser \(minutes a month, at once\)",\s*false,\s*`\$\{cap\(BROWSER_CAP\.growth!\.minutesPerMonth\)\} minutes, \$\{BROWSER_CAP\.growth!\.atOnce\} at once`,\s*`\$\{cap\(BROWSER_CAP\.scale!\.minutesPerMonth\)\} minutes, \$\{BROWSER_CAP\.scale!\.atOnce\} at once`,\s*\],\s*\]/,
    );
    expect(files.pricing.match(/AI teammates' web browser/g)?.length).toBe(1);
  });

  it("lists on /cookies the cookie connecting Google to AI teammates sets, as long as it lasts", () => {
    const redirects = readFileSync("src/lib/connectors/connect-redirects.ts", "utf8");
    const name = /STATE_COOKIE = "([^"]+)"/.exec(redirects)?.[1];
    expect(name).toBe("wk_tc_state");
    // Ten minutes, set by the start route.
    expect(redirects).toContain("STATE_COOKIE_MAX_AGE_S = 600;");
    expect(readFileSync("src/app/api/teammate-connections/google/start/route.ts", "utf8")).toContain("res.cookies.set(STATE_COOKIE, state,");
    // Before: six rows, and this cookie in none of them.
    expect(renderedOnly(files.cookies)).toMatch(/name: "wk_tc_state",\s+purpose:[\s\S]*?duration: "10 minutes",\s+type: "Essential"/);
  });
});

/**
 * What a visitor reads of a route file's prose: renderedOnly, then the JSX
 * space literals, the tags and the two entities these pages write taken
 * out, and every run of white space read as one space, so a sentence the
 * source wraps across lines is matched whole.
 */
function visibleText(source: string): string {
  return renderedOnly(source)
    .replace(/\{" "\}/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
