// Marketing copy rules (marketing-concept.md 8, 10 and 12 Phase 0 item 5).
//
// Three rules, one place, two consumers: the standalone checker in
// ./check.mjs, which runs today, and the ESLint plugin exported at the
// bottom, which is one `files` block away from running in the repo's flat
// config. The regexes live here so the two can never disagree about what
// the rule is.
//
// 1. NO EM DASHES AND NO DOUBLE HYPHENS in copy. Commas, colons, periods.
//    CSS custom properties and CLI flags are code, not prose, and are
//    matched around.
// 2. NO RAW HEX in marketing components. Every colour is a token. The three
//    exceptions are named below with the reason each one cannot be a token.
// 3. NO COMPETITOR NAMES outside /compare. Category nouns everywhere else.
//    The one allowance is the real customer quote, which is the customer's
//    own words.

/** Em dash, en dash, horizontal bar: none of them ship in copy. */
export const DASH_RE = /[—–―]/;

/**
 * A double hyphen used as punctuation. `--os-brand` and `--flag` are code:
 * both are a double hyphen followed by a letter, so they are matched
 * around. `word--word` and `word -- word` are not, and are flagged.
 *
 * Note for anyone writing a class name: a BEM modifier, `mk-band--tint`,
 * matches this rule and is an error. That is not a bug to work around, it
 * is the site's convention arriving by another road: the rebuilt CSS states
 * a variant as a DATA ATTRIBUTE, the way the product's own frame does
 * (`.mk-rail-item[data-active]`, `.mk-shell[data-sidebar]`). Write
 * `.mk-band[data-tone="tint"]`, not `.mk-band--tint`.
 */
export const DOUBLE_HYPHEN_RE = /--(?![A-Za-z])|[A-Za-z]--[A-Za-z]/;

/** Any raw colour literal. */
export const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;

/**
 * Competitor names, nominative use only, and only on /compare. "Monday" the
 * weekday and "Tuesday" the story are ours, so the vendor is matched by its
 * domain, never by the bare word.
 */
export const COMPETITORS = [
  "monday\\.com",
  "clickup",
  "bamboohr",
  "asana",
  "trello",
  "smartsheet",
  "wrike",
  "airtable",
  "confluence",
  "jira",
  "lattice\\b",
  "bonusly",
  "15five",
  "culture amp",
  "salesforce",
  "hubspot",
];

/**
 * Vendor names that are also ordinary English words. Matched CASE
 * SENSITIVELY, because the vendor is a proper noun and the word is not:
 * "Workday" is a competitor, "a workday" is a Tuesday; "Notion" is a
 * competitor, "the notion that" is a sentence. Matching these the way the
 * rest of the list is matched turned an engineering comment about the
 * fixture's clock into a competitor-name error, which is exactly how a
 * useful rule gets switched off.
 */
export const COMPETITORS_CASE_SENSITIVE = ["Workday", "Notion", "Basecamp", "Monday\\.com"];
// Deliberately NOT on the list: Zoho. It is this project's cited visual
// reference, named that way throughout design-system.md ("Zoho-clean"), and
// it appears only in engineering prose about where a layout came from. The
// list is for names the SITE says to a visitor, and the site says none of
// these outside /compare.
export const COMPETITOR_RE = new RegExp(`\\b(?:${COMPETITORS.join("|")})`, "i");
export const COMPETITOR_PROPER_RE = new RegExp(`\\b(?:${COMPETITORS_CASE_SENSITIVE.join("|")})\\b`);

/** True when a line names a competitor. The one entry point for the rule. */
export function namesCompetitor(text) {
  return COMPETITOR_RE.test(text) || COMPETITOR_PROPER_RE.test(text);
}

/* ── CLAIMS, keyed on the flags. ──────────────────────────────────────
 *
 * The gate reported "0 errors in rebuilt files (gate passes)" while a
 * certification wall, an importer list for eight named products and a
 * connector list were live one click from the home page, because the rule
 * set only knew about em dashes and competitor names. The flags file
 * already enumerates exactly the claims a rule should key on, so the rule
 * reads it: a sentence that asserts one of these is an error until the flag
 * beside it is true, and flipping the flag turns the rule off by itself.
 *
 * `flags.ts` is TypeScript and this is a plain module, so it is read as
 * TEXT. That is not a shortcut: the file is a flat object of boolean
 * literals by construction (it imports nothing, so a client component can
 * read a flag for free), and a regex over it cannot be fooled by anything
 * the file is allowed to contain.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FLAGS_FILE = fileURLToPath(new URL("../flags.ts", import.meta.url));

export function readFlags() {
  const out = {};
  let text = "";
  try {
    text = readFileSync(FLAGS_FILE, "utf8");
  } catch {
    // A missing flags file means every claim rule is ON, which is the safe
    // direction: the gate complains rather than passing silently.
    return out;
  }
  for (const m of text.matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*(true|false)\s*,/gm)) {
    out[m[1]] = m[2] === "true";
  }
  return out;
}

const FLAGS = readFlags();

/**
 * One claim, the flag that would make it true, and the pattern that finds it
 * being made. Every pattern is a thing a visitor reads, not an engineering
 * word: "SOC 2" in a comment explaining why the badge is gone is caught by
 * the same rule, which is why the lint directory is exempt from it.
 */
export const CLAIM_RULES = [
  {
    id: "no-unheld-certification",
    flags: ["soc2", "iso27001", "hipaaBaa", "pciDss"],
    test: (text) => /\b(?:SOC ?2(?: Type ?II)?|ISO ?27001|HIPAA[- ]?(?:ready|BAA)|PCI[- ]?DSS)\b/i.test(text),
    message:
      "A certification is a legal claim. It appears only when its flag in flags.ts is true, and the report exists.",
  },
  {
    id: "no-uptime-promise",
    flags: ["uptimeSla"],
    test: (text) => /\b99\.\d+ ?(?:%|percent)\b|\buptime SLA\b/i.test(text),
    message: "An uptime number is a contractual commitment. It needs flags.uptimeSla and a published status page.",
  },
  {
    id: "no-importer-promise",
    flags: ["competitorImporters"],
    test: (text) => /\bone[- ]click importers?\b|\bimporters? for\b/i.test(text),
    message: "No importer ships. The migration copy says what a team actually does instead.",
  },
  {
    id: "no-connector-promise",
    flags: ["thirdPartyIntegrations"],
    test: (text) =>
      /\b(?:SAML|SCIM)\b/.test(text) ||
      /\b(?:Slack|Zapier|QuickBooks|Okta|OneLogin)\b/.test(text) ||
      /\bwebhook events\b/i.test(text),
    message: "No third party connector ships. A connector named on the site is a commitment a buyer quotes back.",
  },
  {
    id: "no-sandbox-promise",
    flags: ["sandbox"],
    test: (text) => /\bsandbox (?:login|workspace|account)\b/i.test(text),
    message: "There is no driveable sandbox yet (flags.sandbox). Say what a call or a trial really gives them.",
  },
  {
    id: "no-residency-promise",
    flags: ["enterpriseIdentity"],
    test: (text) => /\bdata residency\b/i.test(text),
    message: "Data residency is a deployment commitment nothing in this repo evidences.",
  },
];

/** Concept 8: the words the voice does not use. */
export const BANNED_WORDS_RE = /\b(?:supercharge[sd]?|seamless(?:ly)?|empower(?:s|ed|ing)?|game[- ]?changer|revolutionar|world[- ]?class|cutting[- ]edge|effortless(?:ly)?)\b/i;

/**
 * Files exempt from the raw-hex rule, each for a reason that cannot be
 * solved by a token. Nothing else is exempt.
 */
// There used to be a third entry here, for src/components/marketing/data/
// tuesday.ts, described as "the marketing half of the brand quarantine".
// design-system section 7 has no marketing half: the four brand hexes live
// in src/components/brand and nowhere else. tuesday.ts imports them now, the
// OG route imports them from tuesday.ts, and an exemption that institutes a
// second copy of a palette is the rule arguing itself out of existence.
export const HEX_EXEMPT = [
  {
    // The token mirror itself. Every value here IS a token definition.
    match: /src[/\\]components[/\\]marketing[/\\]shell[/\\]marketing-shell\.css$/,
    reason: "the marketing token scope, mirrored from the product token file",
  },
  {
    // Satori has no CSS custom properties, so an OG card must write the
    // token values out. The OG token test checks them against the scope.
    match: /src[/\\]app[/\\]api[/\\]og[/\\]/,
    reason: "next/og renders through Satori, which cannot read custom properties",
  },
];

/** Files allowed to carry a competitor name outside /compare. */
export const COMPETITOR_EXEMPT = [
  {
    match: /src[/\\]components[/\\]marketing[/\\]config\.ts$/,
    reason: "the one real customer quote, verbatim, which is the customer's own word",
  },
  {
    match: /[/\\]compare[/\\]/,
    reason: "competitor names are allowed on /compare, factual and without logos",
  },
  {
    match: /src[/\\]components[/\\]marketing[/\\]lint[/\\]/,
    reason: "the rule has to name what it bans",
  },
];

/**
 * Is this line commentary or a gate rather than copy?
 *
 * Used by the claim rules only. A `//` or `*` line is a note to the next
 * engineer, and a line naming a flag is the claim being held back by one.
 */
export function isCommentaryOrGate(line) {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return true;
  return /\bflags?\.[A-Za-z]|flagOn\(|heldCertifications/.test(line);
}

/**
 * The one escape, and it has to name the flag it is escaping.
 *
 * A claim can sit inside a block the flag gates a few lines above it, which
 * a line-at-a-time checker cannot see: the three connector rows in the
 * /pricing matrix live inside `flags.thirdPartyIntegrations ? [...] : []`.
 * Writing `copy-gate: thirdPartyIntegrations` on the line says which flag
 * holds it back, and the rule only accepts a flag it is itself keyed on, so
 * the escape cannot be used to wave a different claim through.
 */
export function gateMarkerFlag(line) {
  const m = /copy-gate:\s*([A-Za-z0-9_]+)/.exec(line);
  return m ? m[1] : null;
}

export function exemptFor(list, filePath) {
  return list.find((e) => e.match.test(filePath)) ?? null;
}

/**
 * Files written before the rebuild. They are still scanned and still
 * counted, loudly, but they do not fail the gate: a rule that is red on the
 * day it lands gets switched off within a week, and then the rule is gone
 * and the debt is not. It never grows: a new file is held to the rule from
 * its first line.
 *
 * THIS LIST NO LONGER SAYS "a later stage". Every marketing file that was
 * on it has been rewritten, and the marketing phase is the last stage, so
 * the one entry left is not waiting on a stage: it is waiting on the unit
 * that owns src/components/layout. The reason for the entry, and the exact
 * seven findings, are written against it below so whoever picks it up does
 * not have to rediscover them.
 */
export const LEGACY_PREFIXES = [
  // The list is down to one entry, and that entry is not ours.
  //
  // The forty one pages of the pre-rebuild site were all on this list.
  // They have been rewritten against the product: the twelve capability
  // pages under /features, the seven trade pages and their index, and
  // about, blog, changelog, contact, cookies, customers, developers,
  // do-not-sell, help-center, partners, privacy, roadmap and terms. The
  // two shared shells they render through, primitives.tsx and
  // sub-page.tsx, came off with them. Two files on the list,
  // motion.tsx and shared.tsx, had zero importers and zero routes and
  // were deleted rather than cleaned.
  //
  // Every one of those files is now held to every rule, which is what
  // this list existing was for.
  //
  // The consent banner is what is left, and it is the one surface on the
  // marketing site that never came onto the rebuilt system. The marketing
  // layout mounts it on every page, so it is the FIRST thing a first time
  // visitor sees, over the hero, on every route.
  //
  // Seven findings, all in that one file, all still open:
  //
  //   3 x no-em-dash, at lines 23, 61 and 120. Line 61 is user visible and
  //     is the heading: "We use cookies, your choice" is written there with
  //     an em dash in place of the comma. A sed-strip and grep over all
  //     fifty nine crawled routes finds no other em dash anywhere on the
  //     site, so this is the only one on screen, and a static scan of the
  //     rendered HTML misses it because the banner is client rendered.
  //
  //   4 x no-raw-hex, at lines 29, 30, 55 and 190, each hard coding #0073EA
  //     or #0060B9 instead of the accent token. So the banner is also the
  //     one element on the site whose blue cannot follow the token layer.
  //
  // There is a third thing this checker cannot see: "Accept all" is a
  // second FILLED blue button in the same viewport as the hero's Start
  // free, against the site's one-primary-per-viewport rule.
  //
  // It is a SHARED component in src/components/layout, outside the
  // marketing phase's territory, so it is reported here rather than edited.
  // It is not deferred to a later marketing stage, because there is not one.
  "src/components/layout/consent-banner.tsx",
];

export function isLegacy(relativePath) {
  const p = relativePath.split("\\").join("/");
  return LEGACY_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * The rules, as data. Each returns a message or null for one line of text.
 * `kind` separates a hard error from a voice note the writer can argue with.
 */
export const RULES = [
  {
    id: "no-em-dash",
    kind: "error",
    test: (text) => DASH_RE.test(text),
    message: "No em dashes or en dashes in marketing copy. Use a comma, a colon or a period.",
  },
  {
    id: "no-double-hyphen",
    kind: "error",
    test: (text) => DOUBLE_HYPHEN_RE.test(text),
    message: "No double hyphens in marketing copy. A CSS custom property or a CLI flag is code and is allowed.",
  },
  {
    id: "no-raw-hex",
    kind: "error",
    exempt: HEX_EXEMPT,
    test: (text) => HEX_RE.test(text),
    message: "No raw hex in marketing code. Read a token from the marketing scope.",
  },
  {
    id: "no-competitor-names",
    kind: "error",
    exempt: COMPETITOR_EXEMPT,
    test: (text) => namesCompetitor(text),
    message: "Competitor names belong on /compare only. Use the category noun.",
  },
  {
    id: "no-marketing-cliche",
    kind: "warn",
    test: (text) => BANNED_WORDS_RE.test(text),
    message: "The voice is physical and plain. Say what it does instead.",
  },
  // A claim rule is live only while every flag that would make the claim
  // true is false. The lint directory is exempt from all of them for the
  // reason it is exempt from the competitor rule: the rule has to name what
  // it bans.
  ...CLAIM_RULES.filter((rule) => rule.flags.every((f) => FLAGS[f] === false)).map((rule) => ({
    id: rule.id,
    kind: "error",
    // A claim rule reads COPY, never commentary and never a line that is
    // gating the claim: `flags.soc2 ? ["SOC 2 Type II"] : []` is the rule
    // being obeyed, and a comment explaining why a badge wall was deleted
    // is the reason it was. Both used to be reported as the claim itself.
    copyOnly: true,
    flags: rule.flags,
    exempt: [
      {
        match: /src[/\\]components[/\\]marketing[/\\]lint[/\\]/,
        reason: "the rule has to name what it bans",
      },
      {
        match: /src[/\\]components[/\\]marketing[/\\]flags\.ts$/,
        reason: "the flags file has to name every claim it gates",
      },
    ],
    test: rule.test,
    message: rule.message,
  })),
];

/**
 * The ESLint plugin. Wiring is one block in eslint.config.mjs:
 *
 *   import { marketingPlugin } from "./src/components/marketing/lint/marketing-copy-rules.mjs";
 *   {
 *     files: ["src/app/(marketing)/**\/*.tsx", "src/components/marketing/**\/*.tsx",
 *             "src/app/(marketing)/**\/*.ts",  "src/components/marketing/**\/*.ts"],
 *     plugins: { "workwrk-mk": marketingPlugin },
 *     rules: {
 *       "workwrk-mk/no-em-dash": "error",
 *       "workwrk-mk/no-double-hyphen": "error",
 *       "workwrk-mk/no-raw-hex": "error",
 *       "workwrk-mk/no-competitor-names": "error",
 *       "workwrk-mk/no-marketing-cliche": "warn",
 *     },
 *   },
 */
function makeRule(rule) {
  return {
    meta: { type: "problem", docs: { description: rule.message }, schema: [] },
    create(context) {
      const filename = context.filename ?? context.getFilename();
      if (rule.exempt && exemptFor(rule.exempt, filename)) return {};
      const visit = (node, text) => {
        if (typeof text === "string" && rule.test(text)) {
          context.report({ node, message: rule.message });
        }
      };
      return {
        Literal(node) {
          if (typeof node.value === "string") visit(node, node.value);
        },
        TemplateElement(node) {
          visit(node, node.value.raw);
        },
        JSXText(node) {
          visit(node, node.value);
        },
      };
    },
  };
}

export const marketingPlugin = {
  rules: Object.fromEntries(RULES.map((r) => [r.id, makeRule(r)])),
};
