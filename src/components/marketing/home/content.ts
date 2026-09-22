// The home page's words, as data (marketing-concept.md section 3 and 8).
//
// Why a data file rather than prose in JSX: the FAQ is rendered twice, once
// as the visible accordion and once as FAQPage structured data, and concept
// 6.3 requires those two to be the same text. The only way that stays true
// through an edit is for there to be one copy of the sentence.
//
// Everything reachable from here is PURE and importable from a Server
// Component, a client island and the JSON-LD builder alike.
//
// Honesty: every sentence below is either a description of a shipped
// mechanism, the visitor's own arithmetic, or the one real customer quote.
// Anything conditional on a feature reads a flag rather than being typed as
// true. Claims that were asserted on the old site and are not backed by
// anything in this repo (certifications, uptime numbers, breach response
// times, a customer count, a funding round) are absent, not softened.

import { flags } from "../flags";
import { pricing, starterSeatCap, tier } from "../data/pricing";
import { tuesday } from "../data/tuesday";

/* ═══════════════════════════════════════════════════════════════════
 * WHAT USED TO BE HERE, AND WHY IT IS GONE.
 *
 * Six exports lived between the imports above and the FAQ below, and all
 * six belonged to the rejected home page:
 *
 *   GAPS_HEADLINE, OLD_TUESDAY, GAPS_STATEMENTS   the fourteen grey tiles
 *     and the day run on a stack. The replacement argument is not made on
 *     the home page at all any more; it is made on /compare and on
 *     /compare/your-stack, where a visitor asking that question already is.
 *   SEAT_CARDS                                    five seats, five
 *     surfaces. The home page shows six surfaces and names no personas.
 *   migrationPhases()                             a quarter of rollout in
 *     three phases. It belongs to a sales conversation, not to the one
 *     idea per screen the page is now built on.
 *   SWITCH_OFF_COLUMNS, SWITCH_OFF_ROWS           the cancellation
 *     schedule as a Table. Same argument, same place: /compare.
 *
 * The FAQ below stays because /faq renders it, and the three Tuesday
 * sentences at the foot of this file stay because /tuesday renders them.
 * ═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
 * 11. FAQ. Rendered once, twice: the accordion and the FAQPage graph.
 * ═══════════════════════════════════════════════════════════════════ */

export interface FaqEntry {
  q: string;
  /** Paragraphs. The structured data joins them with a space. */
  a: string[];
}

/**
 * Seven questions, concept 11, answered against the running product.
 *
 * Question 6 is the one that used to carry six certification badges, an
 * uptime SLA and a four hour breach notification time, none of which this
 * repo can evidence. It now lists the controls that are actually in the
 * code: MFA at login, idle session expiry, lockout after repeated failures,
 * hashed reset tokens, an audit log, roles and scoped visibility. The
 * certification sentence appears only when a flag says the certificate
 * exists.
 */
export function faqEntries(): FaqEntry[] {
  const certs = [
    ...(flags.soc2 ? ["SOC 2 Type II"] : []),
    ...(flags.iso27001 ? ["ISO 27001"] : []),
  ];
  const starter = tier("starter");

  return [
    {
      q: `Is this really one system, or ${tuesday.hubs.length} half apps?`,
      a: [
        // "on our own infrastructure" came out. Calls run on LiveKit against
        // an operator-set LIVEKIT_URL, so whether the media server is ours
        // or a vendor's is a property of the deployment, not of the product,
        // and this sentence is mirrored verbatim into the FAQPage graph that
        // a search engine quotes back. What is true everywhere is what the
        // block does.
        `Each block does the job you would otherwise buy a tool for. Tables has a formula engine. ${pricing.premiumModules[0].name} runs channels, calls and threads. Docs publishes SOPs and collects acknowledgements. Goals carries role owned KRAs and KPIs, not just a progress bar.`,
        "The difference is the data model underneath: one task, one role, one goal, referenced by every block rather than copied between them.",
      ],
    },
    {
      q: "Do we have to switch everything at once?",
      a: [
        "No. Start with one team and one workspace. Modules turn on per workspace, so a team can run on Work and Docs for a month before Talk or Tables is switched on.",
      ],
    },
    {
      q: "How long does moving take, and who does it?",
      a: [
        "A quarter, in three phases: one team in week 1, the processes connected by week 6, the old subscriptions cancelled on their renewal dates by week 12.",
        flags.migrationConcierge
          ? "Migration help is included on the top tier."
          : "You do it, and the phases above are the plan. We have no migration service to sell you.",
      ],
    },
    {
      q: "Do managers need training?",
      a: [
        "The product is one rail, one sidebar and one top bar, and every page is the same three rows: a title, its saved views, one toolbar.",
        "The surfaces on this page are the real ones, drawn from the same components, so what you have read here is what you open.",
      ],
    },
    {
      q: "Is this an HR system? Does it run payroll?",
      a: [
        "People and performance, yes: a directory, roles, KRAs, KPIs, reviews, kudos and surveys.",
        // "Those go through partners" was present tense and implied a route
        // you could buy through today. /partners, one click away in the same
        // footer, opens with "There is no programme yet." Payroll is the
        // highest stakes gap for an enterprise buyer, so the two answers may
        // not disagree: this one now says what is true, which is that there
        // is no payroll anywhere, by us or beside us.
        "Payroll and benefits, no. There is no payroll module and no payroll partner to hand you to, and we would rather say so than sell you one that does not exist.",
      ],
    },
    {
      q: "Where is our data, who can see it, and is it secure?",
      a: [
        "Access is by role and by scope: a person sees the spaces, folders and lists they have been given, and admins can narrow that further.",
        "On the account itself: multi factor authentication at login, sessions that expire when idle, lockout after repeated failed attempts, password reset tokens stored hashed, and an audit log of security events.",
        certs.length > 0
          ? `We hold ${certs.join(" and ")}.`
          : "We hold no third party security certification yet. When we do, it will be named here with its report available, and not before.",
      ],
    },
    {
      q: "What happens to our data if we leave?",
      a: [
        "You export it, any time, on every tier including the free one. Deleted items sit in a trash window before they go.",
        `There is no contract to get out of on ${starter.name}: it is free for up to ${starterSeatCap} people, with no card on file.`,
      ],
    },
  ];
}

/* ═══════════════════════════════════════════════════════════════════
 * 12. The close.
 * ═══════════════════════════════════════════════════════════════════ */

export const FINAL_HEADLINE = "Snap it together.";

/* ═══════════════════════════════════════════════════════════════════
 * The Tuesday workspace, gated.
 *
 * `flags.tuesdayTemplateAtSignup` already decides the CTA's href: without
 * it the button degrades from the ?template=tuesday deep link to a bare
 * /signup, which is honest. The SENTENCES beside that button were not
 * reading the flag, so the page went on promising a seeded workspace next
 * to a button that opens an empty one. A flag that only the href reads is
 * half a gate.
 *
 * Nothing here softens the claim into a promise. With the flag off the copy
 * describes what the story IS today, a storyboard of shipped mechanisms,
 * and says so.
 * ═══════════════════════════════════════════════════════════════════ */

export function spineNotice(): string {
  return flags.tuesdayTemplateAtSignup
    ? tuesday.workspace.notice
    : "Every surface below is the real product, drawn from the same components, with a sample workspace in it.";
}

export function tuesdayCtaHeadline(): string {
  return flags.tuesdayTemplateAtSignup ? "Start Tuesday in your workspace." : "Start your own Tuesday.";
}

export function tuesdayCtaLede(): string {
  return flags.tuesdayTemplateAtSignup
    ? "The Tuesday workspace, the SOP, the board, the goal and the roles, is a template on your first screen."
    : "The SOP, the board, the goal and the roles are all things you build on day one. The Tuesday workspace as a one click template is in build, so the button below opens an empty workspace and not a seeded one.";
}


