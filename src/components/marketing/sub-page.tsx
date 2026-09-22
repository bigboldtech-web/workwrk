// THE TWO SHELLS THAT DRAW NINETEEN ROUTES: twelve capability pages under
// /features and seven under /industries.
//
// REBUILT ONTO THE ICONIC KIT, because one file stamping the rejected
// template onto a fifth of the site is not a thing that can be fixed page by
// page. What it used to render, and every one of these is a named rule:
//
//   * a SPLIT HERO, `grid lg:grid-cols-[1fr_1.05fr]`, headline column beside
//     a product frame, which is two objects competing in the one region
//     where rule 4 demands one centred object;
//   * TWO BUTTONS in every hero, on a site whose page ends on one;
//   * "Core capabilities.", "One workflow, zero context-switching.",
//     "One platform. Many surfaces.", "Plays well with", "Sound familiar?".
//     Six section headings of deck language, against rule 6;
//   * a CARD GRID under each of them, white boxes with borders and radii,
//     which rule 5 bans outright, plus a row of bordered pills for the
//     measures, which is a badge row, also banned;
//   * `hover:-translate-y-0.5` on the cross links, which rule 7 and the
//     project's own UI conventions both forbid.
//
// Now every route here is the same grammar as /product and /pricing: one
// idea per band, a claim of six words or fewer over one sentence, one
// centred object per section, and one blue at the end of the page.
//
// WHAT THE PAGES THEMSELVES STILL OWN: the words. The capability names, the
// lines under them, the steps and the answers are per page and unchanged,
// because they were written against the product and they are true. What this
// file changed is the shape they are poured into.
//
// WHAT WENT AND IS NOT COMING BACK: the `hue` prop, which every page passed
// and which already resolved to the one accent, so it was a colour control
// that controlled nothing; the per capability lucide icon, because a column
// of icons is the visual grammar of the card grid this replaces; and the
// `testimonial` prop, which no page passed and which was a prop-shaped hole
// waiting for an invented quote.

import { tuesday } from "@/components/marketing/data/tuesday";
import { PART_LINE } from "@/components/marketing/iconic/copy";
import {
  Band,
  Claim,
  Close,
  Eyebrow,
  Headline,
  Line,
  Obj,
  Page,
  Qa,
  type QaItem,
  Stack,
  type StackItem,
  Steps,
  Sub,
  Terms,
} from "@/components/marketing/iconic/iconic";
import { MarketingShell } from "@/components/marketing/shell/marketing-shell";
import { MkSidebar, SURFACES } from "@/components/marketing/shell/surfaces";

export type Capability = StackItem;
export type FAQItem = QaItem;

/** The closing headline, shared by both shells and by /product. Six words. */
const CLOSE = "Open it on your own work.";

/** The questions band, identical on all nineteen routes here. */
function Questions({ items, id }: { items: readonly FAQItem[]; id: string }) {
  return (
    <Band labelledBy={id}>
      <Eyebrow>Questions</Eyebrow>
      <Headline id={id}>Straight answers.</Headline>
      <Qa items={items} />
    </Band>
  );
}

export interface FeatureSubPageProps {
  /**
   * This page's own url segment, and the id its closing CTA is measured by.
   *
   * It is NOT `hubSlug`: four capability pages share the Goals hub, so a
   * hub-derived placement would have reported four pages as one number. And
   * it is not derived from the eyebrow either, because a placement id that
   * moves when someone edits display copy is an analytics series that
   * silently breaks on a copy change.
   */
  slug: string;
  hubSlug: string;
  eyebrow: string;
  /** The page's h1. Six words or fewer, and a test counts them. */
  title: string;
  /** One sentence under the claim. One, and a test counts the stops. */
  lede: string;
  capabilities: readonly Capability[];
  /** The headline over the ordered list, when a page has one. Six words. */
  workflowTitle?: string;
  workflowSteps?: readonly string[];
  faq?: readonly FAQItem[];
  relatedSlugs?: readonly string[];
  /**
   * THE PRODUCT, IN ITS OWN BAND.
   *
   * One key into the marketing-lite SURFACES registry. It used to render
   * beside the headline, which put two objects in the hero; it now owns the
   * band under it, centred and at full column width, which is both the rule
   * and the size at which the product's real 14px is legible.
   *
   * It is a KEY and not a component so a page cannot draw a UI of its own.
   * Every surface here is one the home page and the Tuesday story already
   * render, from the same fixture, through the same truth gates, so a
   * feature page can never show a screen the product does not have.
   */
  surfaceKey?: string;
  /** The breadcrumb's last crumb. Defaults to the eyebrow. */
  surfaceCrumb?: string;
  /** What the frame shows, for a screen reader. Required with surfaceKey. */
  surfaceLabel?: string;
}

const ALL_FEATURE_LINKS: Record<string, { title: string; body: string }> = {
  kpis:         { title: "KPIs",         body: "Track, weight and score, tied to performance." },
  kras:         { title: "KRAs",         body: "Key result areas linked to roles." },
  tasks:        { title: "Tasks",        body: "Lists, boards and every view." },
  sops:         { title: "SOPs",         body: "Process docs with acknowledgement." },
  okrs:         { title: "OKRs",         body: "Cascade with auto-rollup." },
  reviews:      { title: "Reviews",      body: "Cycles with weighted scoring." },
  people:       { title: "People",       body: "Org chart, roles and history." },
  access:       { title: "Access",       body: "Roles, audit log, scoped sharing." },
  kudos:        { title: "Kudos",        body: "Recognition tied to values." },
  "ai-engine":  { title: "AI Engine",    body: "Ask, inbox triage, signals." },
  analytics:    { title: "Analytics",    body: "Role-aware dashboards." },
  integrations: { title: "Integrations", body: "What connects today, and what does not." },
};

export function FeatureSubPage({
  slug,
  hubSlug,
  eyebrow,
  title,
  lede,
  capabilities,
  workflowTitle,
  workflowSteps,
  faq,
  relatedSlugs,
  surfaceKey,
  surfaceCrumb,
  surfaceLabel,
}: FeatureSubPageProps) {
  // The rail hub the frame highlights. /features/access is filed under the
  // settings hub, which is not one of the story's eight blocks, so it falls
  // back to Teams, which is where roles and access actually live.
  const frameHub = tuesday.hubs.some((h) => h.id === hubSlug) ? hubSlug : "teams";
  const hub = tuesday.hubs.find((h) => h.id === frameHub);
  const surface = surfaceKey ? SURFACES[surfaceKey] : undefined;

  // THE CRUMB, DEDUPLICATED. It was built as [hub name, crumb] and keyed by
  // the crumb's own text, so /features/okrs and /features/kpis, whose two
  // crumbs both resolve to "Goals", emitted a duplicate React key and
  // rendered a product chrome reading "Goals > Goals". A repeated label is
  // dropped and the key is the position.
  const tail = surfaceCrumb ?? eyebrow;
  const head = hub?.label ?? "Work";
  const breadcrumb = tail === head ? [head] : [head, tail];

  return (
    <Page>
      {/* 1. The claim. Type only. The frame below owns the page's first
          object, and two objects in the first two screens is one too many. */}
      <Band air="hero" labelledBy={`${slug}-h1`} still>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Claim id={`${slug}-h1`}>{title}</Claim>
        <Sub>{lede}</Sub>
      </Band>

      {/* 2. The surface. The part's name is the headline, exactly as it is on
          the /product tour, so the same object is introduced the same way
          wherever a visitor meets it. */}
      {surface && surfaceLabel && hub ? (
        <Band ground="quiet" labelledBy={`${slug}-surface`}>
          <Eyebrow>The screen</Eyebrow>
          <Headline id={`${slug}-surface`}>{hub.label}</Headline>
          <Line>{PART_LINE[hub.id] ?? lede}</Line>
          <Obj>
            <MarketingShell
              hub={frameHub}
              breadcrumb={breadcrumb}
              sidebar={<MkSidebar hub={frameHub} />}
              label={surfaceLabel}
            >
              {surface()}
            </MarketingShell>
          </Obj>
        </Band>
      ) : null}

      {/* 3. What you get. Names, not cards. */}
      <Band labelledBy={`${slug}-caps`}>
        <Eyebrow>What you get</Eyebrow>
        <Headline id={`${slug}-caps`}>Everything below ships today.</Headline>
        <Stack items={capabilities} />
      </Band>

      {/* 4. The order, when the order is the idea. */}
      {workflowSteps && workflowSteps.length > 0 ? (
        <Band ground="quiet" labelledBy={`${slug}-flow`}>
          <Headline id={`${slug}-flow`}>{workflowTitle ?? "What it carries."}</Headline>
          <Steps items={workflowSteps} />
        </Band>
      ) : null}

      {/* 5. The rest of the system. Names with a line, no chevrons, no
          hover transform, no boxes. */}
      {relatedSlugs && relatedSlugs.length > 0 ? (
        <Band labelledBy={`${slug}-rest`}>
          <Headline id={`${slug}-rest`}>It reads the rest.</Headline>
          <Stack
            items={relatedSlugs.flatMap((related) => {
              const r = ALL_FEATURE_LINKS[related];
              return r
                ? [{ ...r, href: `/features/${related}`, cta: `feature-${slug}-related-${related}` }]
                : [];
            })}
          />
        </Band>
      ) : null}

      {faq && faq.length > 0 ? <Questions items={faq} id={`${slug}-qa`} /> : null}

      <Close headline={CLOSE} placement={`feature-${slug}`} />
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════
// The industry shell. Same grammar, three bands of its own.
// ════════════════════════════════════════════════════════════════════

export interface IndustrySubPageProps {
  /** This page's own url segment, and its closing CTA's measurement id. */
  slug: string;
  eyebrow: string;
  title: string;
  lede: string;
  /** The headline over the problems. Six words or fewer. */
  painsTitle?: string;
  pains: readonly string[];
  capabilities: readonly Capability[];
  kpisLabel?: string;
  kpis?: readonly string[];
  faq?: readonly FAQItem[];
}

export function IndustrySubPage({
  slug,
  eyebrow,
  title,
  lede,
  painsTitle,
  pains,
  capabilities,
  kpisLabel = "What teams here measure.",
  kpis,
  faq,
}: IndustrySubPageProps) {
  return (
    <Page>
      <Band air="hero" labelledBy={`${slug}-h1`} still>
        <Eyebrow>Industries</Eyebrow>
        <Claim id={`${slug}-h1`}>{title}</Claim>
        <Sub>{lede}</Sub>
      </Band>

      <Band ground="quiet" labelledBy={`${slug}-pains`}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Headline id={`${slug}-pains`}>{painsTitle ?? "Where the trail breaks."}</Headline>
        <Steps items={pains} />
      </Band>

      <Band labelledBy={`${slug}-caps`}>
        <Eyebrow>What you get</Eyebrow>
        <Headline id={`${slug}-caps`}>What you would use.</Headline>
        <Stack items={capabilities} />
      </Band>

      {kpis && kpis.length > 0 ? (
        <Band ground="quiet" labelledBy={`${slug}-kpis`}>
          <Headline id={`${slug}-kpis`}>{kpisLabel}</Headline>
          <Terms items={kpis} />
        </Band>
      ) : null}

      {faq && faq.length > 0 ? <Questions items={faq} id={`${slug}-qa`} /> : null}

      <Close headline={CLOSE} placement={`industry-${slug}`} />
    </Page>
  );
}
