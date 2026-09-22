// EVERY HEADLINE AND EVERY SUPPORTING LINE ON THE EIGHT PAGES, in one file.
//
// Two reasons it is here rather than inside each route:
//
//   1. The founder can read the whole site's voice in one screen without
//      opening eight files, and can change a line without reading JSX.
//   2. A test can hold it to the rules. iconic.test.ts counts the words in
//      every headline (six or fewer), the sentences in every supporting line
//      (exactly one), and sweeps the whole tree for em dashes, double
//      hyphens and the words the voice does not use. A page that keeps its
//      copy in its markup can only be checked by eye, and the eight rules
//      are the sort of rule that is kept for three weeks and then is not.
//
// The pages import from here and render it. Nothing below is computed from
// anything but the pricing source, which is where a number on this site
// comes from.
//
// THE RULES THIS FILE IS HELD TO, and each one is a failing test:
//
//   h1 and h2: six words or fewer.
//   sub and line: exactly one sentence.
//   No em dash, no en dash, no double hyphen, anywhere.
//   None of the words in the marketing cliche list.
//   No competitor name outside the /compare tree.

import { starterSeatCap } from "../data/pricing";

export const PRODUCT_COPY = {
  hero: {
    eyebrow: "Product",
    h1: "One record. Eight parts read it.",
    sub: "Every part below is one surface of the same workspace, on the same records.",
  },
  tour: {
    eyebrow: "The tour",
  },
  chapters: {
    eyebrow: "Chapters",
    h2: "Each part has a page.",
  },
  close: {
    h2: "Open it on your own work.",
  },
} as const;

/**
 * One plain line per part, under the part's name in the tour.
 *
 * It is a map rather than eight strings in the markup so that a ninth part
 * cannot appear on the page without a line, and an eighth cannot quietly
 * disappear: iconic.test.ts asserts the keys are exactly MODULE_ORDER.
 *
 * WHY NOT `hub.features`, which the fixture already carries. Two reasons.
 * The AI entry there is two sentences ("Ask AI on every page, reading the
 * workspace. Not a chatbot on every button."), and one of these lines sits
 * under a headline, where the rule is one. And the Teams and Docs entries
 * are seven item lists, which is a feature dump rather than a sentence. The
 * fixture's list is still what /features prints, because a capability page
 * is where a list belongs.
 */
export const PART_LINE: Record<string, string> = {
  work: "Tasks, lists, boards, seventeen views.",
  docs: "Docs, wikis, processes and contracts.",
  talk: "Channels, threads and calls.",
  tables: "Sheets and forms.",
  goals: "Goals, results and the measures under them.",
  teams: "The directory, the roles, the reviews.",
  planner: "The calendar and the timesheet.",
  ai: "One Ask, reading the workspace it is in.",
};

export const PRICING_COPY = {
  hero: {
    eyebrow: "Pricing",
    h1: "Pay for people. Nothing else.",
    sub: `Free up to ${starterSeatCap} people, then one price per person per month.`,
  },
  plans: {
    eyebrow: "Plans",
    h2: "Three plans. One number.",
  },
  matrix: {
    eyebrow: "Side by side",
    h2: "What each plan includes.",
    line: "Every row here ships today, and nothing on the table is a feature in build.",
  },
  questions: {
    h2: "Questions about money.",
  },
  close: {
    h2: "Free to start. No card.",
  },
} as const;

export const COMPARE_COPY = {
  hero: {
    eyebrow: "Compare",
    h1: "The only page that names names.",
    sub: "Every row about us is one you can check by opening ours.",
  },
  facts: {
    eyebrow: "About us",
    h2: "The facts, in one place.",
  },
  entries: {
    eyebrow: "The category",
    h2: "Who we get put beside.",
    line: "What each one is bought for, what we do instead, and when they are the better answer.",
  },
  close: {
    h2: "Run one process in ours.",
    line: "See whether the trail it leaves behind is worth the move.",
  },
} as const;

export const DEMO_COPY = {
  hero: {
    eyebrow: "Book a demo",
    h1: "Twenty minutes. No slide deck.",
    sub: "We open the product on the parts you asked about and answer what you bring.",
  },
  call: {
    eyebrow: "The call",
    h2: "What a call actually is.",
  },
  form: {
    eyebrow: "Book it",
    h2: "Tell us what to open.",
    line: "We reply to every request.",
  },
  close: {
    h2: "Or just open it yourself.",
    line: "Start free, with no card and no demo gate, and the call is here when you want one.",
  },
} as const;

export const BLOG_COPY = {
  hero: {
    eyebrow: "Blog",
    // "and the operators using it" once said this index carried customer
    // written posts. Every post here is team written, there is no author
    // field that distinguishes the two, and the rest of the site goes to
    // some trouble not to imply named customers exist.
    h1: "Notes from building it.",
    sub: "How the parts connect, what the category words mean, and what we decided not to build.",
  },
  empty: {
    h2: "Nothing here yet.",
  },
} as const;

/** The three legal documents: the name, and the one line under it. */
export const LEGAL_COPY = {
  privacy: {
    eyebrow: "Privacy",
    h1: "Privacy policy.",
    sub: "What we collect, why, where it lives, and what you can ask us to do with it.",
    // Substantively rewritten in this build: a blanket regional compliance
    // claim, a six name sub-processor list, a DPO appointment, a three region
    // residency promise, a usage-telemetry disclosure and a per-workspace
    // embeddings sentence were all removed as unevidenced. A reader and a
    // regulator both read this field as the date the disclosure in force was
    // written, so it moves whenever the document does.
    updated: "22 September 2026",
  },
  terms: {
    eyebrow: "Terms",
    h1: "Terms of service.",
    sub: "The agreement between your organization and ours, as short as a contract can honestly be.",
    updated: "22 September 2026",
  },
  cookies: {
    eyebrow: "Cookies",
    h1: "Cookie policy.",
    // The count is passed in by the page from the table it renders, so the
    // sentence cannot say six while the table shows seven.
    sub: (count: number) => `${count} cookies, all of them ours. No analytics vendor, no ad network, no pixel.`,
    // The previous six rows (ww_session, ww_csrf, ww_preferences, ww_attrib,
    // ww_consent, _ga) were invented and were replaced wholesale with the six
    // cookies this codebase actually sets. That is a new disclosure, so it
    // carries the date it was written rather than the old one's.
    updated: "22 September 2026",
  },
} as const;

/**
 * Every copy tree on the eight pages, for the sweep in iconic.test.ts.
 *
 * A page added to this file and not to this list is a page nothing checks,
 * so the test also asserts the list has an entry per exported tree.
 */
export const ALL_COPY = {
  product: PRODUCT_COPY,
  pricing: PRICING_COPY,
  compare: COMPARE_COPY,
  demo: DEMO_COPY,
  blog: BLOG_COPY,
  legal: LEGAL_COPY,
} as const;
