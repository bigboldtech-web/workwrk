// Marketing config: the flags that keep copy tied to shipped state
// (marketing-concept.md section 12 Phase 0 item 5, and the truth gates in
// 4.4, 7.6 and the risk table).
//
// The rule this file exists to enforce: a claim on the public site is a
// FLAG, not a sentence someone typed. A feature that is not live renders
// nothing, never a disabled promise. Flipping a flag is a code review with
// one obvious question attached: has this shipped?
//
// Every flag below is false until the evidence named beside it exists.

import { pricing, type TierId } from "./data/pricing";
import { tuesday } from "./data/tuesday";
import { flags } from "./flags";

export type CtaMode = "trial" | "demo";

/**
 * The single config flag from concept 7.1. If self-serve signup is not live,
 * "Start free" and "Book a demo" swap roles everywhere with no layout change:
 * every CTA on the site reads `primaryCta()` and `secondaryCta()`, never a
 * hardcoded label or href.
 *
 * Set NEXT_PUBLIC_MARKETING_CTA=demo to flip the whole site the same day.
 */
export const ctaPrimary: CtaMode =
  process.env.NEXT_PUBLIC_MARKETING_CTA === "demo" ? "demo" : "trial";

/**
 * Destinations. /signup and /join are the auth unit's routes
 * (spec-account-auth section 0). The marketing site points at them and does
 * not own them; a CTA here is correct the moment that unit lands, and the
 * proxy prefix lists have to carry `signup` and `join` before either works
 * on the marketing host under HARD_HOST_SPLIT.
 */
export const routes = {
  signup: "/signup",
  join: "/join",
  login: "/login",
  demo: "/demo",
  pricing: "/pricing",
  tuesday: "/tuesday",
  compare: "/compare",
  /** The trial deep link that applies the Tuesday template at signup. */
  signupWithTemplate: tuesday.workspace.templateDeepLink,
} as const;

/**
 * The mailboxes the public site hands out, in one place.
 *
 * The Organization node was giving crawlers hello@ as contactType "sales"
 * while the demo form's always-works fallback, the site's own secondary CTA,
 * went to sales@. Two sales addresses on one site is one of them going
 * unread.
 *
 * The legal pages were handing out four MORE addresses inline in their JSX
 * while this object declared two, which is how dpo@ got onto the site: a
 * Data Protection Officer address is a legal representation under Article
 * 37 and it existed nowhere in this repo except in one paragraph of
 * /privacy. The rule is now the same as every other claim on this site: an
 * address the public site hands out is declared here, once, and somebody
 * has agreed to read it.
 *
 * privacy@ and security@ stay because they are the documented route for a
 * data subject request and a vulnerability report respectively, and both
 * pages need a destination that is not the sales mailbox. legal@ and dpo@
 * are gone: /terms now points at general and /privacy at privacy.
 */
export const mailboxes = {
  sales: "sales@workwrk.com",
  general: "hello@workwrk.com",
  privacy: "privacy@workwrk.com",
  security: "security@workwrk.com",
} as const;

export interface CtaSpec {
  label: string;
  href: string;
  /** The measurement id. One per placement, never reused. */
  dataCta: string;
}

const START_FREE = "Start free";
const BOOK_A_DEMO = "Book a demo";

/**
 * The placement, carried on the destination.
 *
 * Concept 7.3 asks for one destination carrying the placement id, and it is
 * not a duplicate of the `data-cta`: that one is only readable through the
 * consent-gated dataLayer, so a visitor who never answers the cookie banner,
 * or answers "Reject all", used to convert completely invisibly, and that is
 * the DEFAULT state. `utm_content` travels with the click itself, so a
 * signup can be attributed to the section that produced it without measuring
 * anyone who said no.
 *
 * It is appended rather than typed into `routes`, so the template deep link
 * keeps its own query and nothing is written twice.
 */
export function withPlacement(href: string, placementId: string): string {
  if (!placementId) return href;
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("utm_content", placementId);
  return `${path}?${params.toString()}`;
}

/**
 * The one filled button. Its label and destination follow ctaPrimary, so
 * "Never two filled buttons in one viewport" stays true in both modes.
 */
export function primaryCta(placement: string, options?: { template?: boolean; label?: string }): CtaSpec {
  if (ctaPrimary === "demo") {
    const dataCta = `${placement}-primary-demo`;
    return { label: options?.label ?? BOOK_A_DEMO, href: withPlacement(routes.demo, dataCta), dataCta };
  }
  // `template` is a REQUEST for the deep link, not a grant of it. Signup does
  // not apply the Tuesday template yet, so asking for it would send a visitor
  // to a query string the trial ignores: the button would promise a seeded
  // workspace and open an empty one. The flag is the grant.
  const wantsTemplate = options?.template === true && flags.tuesdayTemplateAtSignup;
  const href = wantsTemplate ? routes.signupWithTemplate : routes.signup;
  const dataCta = `${placement}-primary-trial`;
  return { label: options?.label ?? START_FREE, href: withPlacement(href, dataCta), dataCta };
}

/** The ghost button beside it. Always the other door. */
export function secondaryCta(placement: string, options?: { label?: string }): CtaSpec {
  if (ctaPrimary === "demo") {
    const trial = `${placement}-secondary-trial`;
    return { label: options?.label ?? START_FREE, href: withPlacement(routes.signup, trial), dataCta: trial };
  }
  const demo = `${placement}-secondary-demo`;
  return { label: options?.label ?? BOOK_A_DEMO, href: withPlacement(routes.demo, demo), dataCta: demo };
}

/** The per-tier button on a pricing card: listed tiers open the trial, the quoted tier opens sales. */
export function tierCta(tierId: TierId, placement: string): CtaSpec {
  const t = pricing.tiers.find((x) => x.id === tierId);
  if (t?.cta === "demo") {
    const dataCta = `${placement}-${tierId}-sales`;
    return { label: "Talk to sales", href: withPlacement(routes.demo, dataCta), dataCta };
  }
  return primaryCta(`${placement}-${tierId}`);
}

/**
 * Which tier card carries the one filled button.
 *
 * Comparing the resolved href to "/demo" is what a card must NOT do: in
 * demo-first mode every card resolves to /demo, so every card goes ghost and
 * the pricing page ships with no primary at all. The recommended tier is the
 * filled one in both modes, which is what keeps "exactly one filled button in
 * a viewport" true rather than "at most one".
 */
export function tierCtaIsPrimary(tierId: TierId): boolean {
  const recommended = pricing.tiers.find((t) => t.recommended);
  return (recommended?.id ?? "growth") === tierId;
}

/**
 * Claim flags. Each one gates a sentence or a slot. They live in flags.ts,
 * which imports nothing, so a client component can read one without dragging
 * the Tuesday fixture and the pricing table into the browser with it. They
 * are re-exported here because this is where every caller already looks.
 */
export { flags, flagOn, heldCertifications, type FlagName } from "./flags";

/**
 * Tier names live in the pricing JSON so renaming a tier is a data change,
 * never a copy sweep (decision 8).
 */
export const tierNames: Record<TierId, string> = {
  starter: pricing.tiers.find((t) => t.id === "starter")?.name ?? "Starter",
  growth: pricing.tiers.find((t) => t.id === "growth")?.name ?? "Growth",
  scale: pricing.tiers.find((t) => t.id === "scale")?.name ?? "Scale",
};

/** Module names, from the naming canon. The site never invents a ninth. */
export const moduleNames: string[] = tuesday.hubs.map((h) => h.label);

/**
 * The one real customer voice, with the login page's attribution verbatim
 * (decision 11). It is used at three sizes and never edited. A second quote
 * does not exist, so the site does not pretend one does.
 *
 * One character differs from the login page: the login markup joins the last
 * two sentences with an em dash, and the concept document quotes the same
 * sentence with a period. The site uses the period, because no em dash ships
 * in marketing copy. Nothing else in the sentence, and nothing at all in the
 * attribution, is changed.
 *
 * "Workday" appears inside the quote. That is the customer's own word, not
 * the site naming a competitor, and it is why config.ts is the one file the
 * copy lint allows a competitor name in outside /compare.
 */
export const realQuote = {
  // ONE SENTENCE, as the customer said it.
  //
  // The source on the login page joins the two clauses with a long dash,
  // which the site's copy rule forbids. The first pass answered that by
  // replacing it with a full stop, which split a real person's sentence in
  // two and changed where the emphasis falls: the second clause is a
  // consequence of the first, not a separate remark. A semicolon keeps the
  // one sentence, adds no word that was not said, and carries no dash.
  // Nothing else here may be reworded: this is the one real quote on the
  // site and the attribution below is verbatim.
  body:
    "We replaced 14 SaaS tools with WorkwrK in one quarter. Our managers actually open the app now; that didn't happen with Workday.",
  /** The number the hero eyebrow borrows. It is the customer's, not ours. */
  toolCount: 14,
  /** Verbatim from the login page: name on one line, role and size on the next. */
  name: "Mohsin S.",
  title: "COO · 280-person services firm",
  initials: "MS",
  source: "src/app/(auth)/layout.tsx",
} as const;

/**
 * One sentence of the real quote, marked as an extract.
 *
 * The adoption block shows a single line of it at display size under the
 * full attribution and the avatar. That is a legitimate pull quote, but the
 * sentence was AUTHORED SEPARATELY as a string literal: the same named
 * customer appeared twice on one page saying two different things at two
 * lengths, with nothing marking the short one as an extract, and nothing
 * stopping the two from drifting apart in a later edit.
 *
 * So the extract is sliced out of `realQuote.body` and carries an ellipsis
 * on whichever side has been cut. It cannot say something the quote does
 * not, because it is made of the quote.
 */
export function realQuoteSentence(index: number): string {
  const sentences = realQuote.body.match(/[^.]+\./g)?.map((part) => part.trim()) ?? [];
  const one = sentences[index];
  if (!one) return realQuote.body;
  const head = index > 0 ? "… " : "";
  const tail = index < sentences.length - 1 ? " …" : "";
  return `${head}${one}${tail}`;
}

/**
 * Competitor names are allowed on /compare and nowhere else (decision 13).
 * The copy lint reads this list, so adding a name here is the deliberate act.
 */
export const competitorNamesAllowedOn = ["/compare"] as const;
