// /industries, rewritten against the product.
//
// The old index sold "sector-specific templates: KPIs, SOPs, review cycles,
// comp bands, so your team is operational the same week you sign up", plus
// four cards promising pre-built KPI templates per sector, a forkable SOP
// library that ships "audit-ready", industry competency models and
// sector-typical compensation bands. The Template Center ships with five
// seeds and none of those things exists. Compensation is not in this
// product at all.
//
// What an industry page is honestly FOR is the second half of that idea,
// and it is the half worth keeping: the same eight blocks, arranged the way
// a particular kind of operation already thinks. So the index says that, and
// each page underneath describes the arrangement rather than a library.

import type { Metadata } from "next";

import { Band, Claim, Close, Eyebrow, Headline, Page, Stack, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Industries",
  description:
    "The same eight blocks, arranged the way a particular operation already thinks. Technology, healthcare, manufacturing, logistics, services, sales and real estate.",
  alternates: { canonical: "https://workwrk.com/industries" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "Industries",
    description: "The same eight blocks, arranged the way your operation already thinks.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "The same eight blocks, arranged the way your operation already thinks." },
};

const INDUSTRIES: readonly { slug: string; name: string; body: string }[] = [
  {
    slug: "technology",
    name: "Technology",
    body: "Roles that own result areas, measures with a named owner, and goals that read the work underneath them.",
  },
  {
    slug: "healthcare",
    name: "Healthcare",
    body: "Versioned procedure with a record of who has read the current one. No certification is held and no agreement is signed.",
  },
  {
    slug: "manufacturing",
    name: "Manufacturing",
    body: "Per shift targets with owners, versioned standard procedure, and tables for the working underneath.",
  },
  {
    slug: "logistics",
    name: "Logistics",
    body: "Daily measures per hub, exception procedures with owners, and roles that survive a handover.",
  },
  {
    slug: "services",
    name: "Services",
    body: "Projects as lists with every view, capacity by role, and the repeatable part of delivery written down once.",
  },
  {
    slug: "sales",
    name: "Sales",
    body: "Keep your pipeline tool. This is the half about what a seat owns and whether the quarter is on track.",
  },
  {
    slug: "real-estate",
    name: "Real estate",
    body: "Inventory as a real spreadsheet, transactions as lists, and the closing checklist out of somebody's head.",
  },
];

/** What is genuinely reusable between two companies in the same trade. */
const REUSABLE: readonly [string, string][] = [
  ["The shape of a role", "What a seat owns, what it escalates, and the result areas under it. That part rhymes between firms."],
  ["The measures kept", "The three or four numbers a trade actually reads weekly, with an owner against each reading."],
  ["The repeated process", "The handful of procedures every firm in the trade writes down eventually, and re-writes badly."],
  ["The cadence", "How often the check-in, the cycle and the review happen, which is a trade habit more than a company one."],
];

export default function IndustriesPage() {
  return (
    <Page>
      <Band air="hero" labelledBy="ind-h1" still>
        <Eyebrow>Industries</Eyebrow>
        <Claim id="ind-h1">One system, arranged your way.</Claim>
        <Sub>
          There is no separate edition per trade and no sector library behind a signup, only eight blocks and one data
          model.
        </Sub>
      </Band>

      {/* The seven. It was a three column grid of bordered cards, each with a
          tinted icon tile and a coloured uppercase tagline, and the top row
          began 691px down a 900px screen. Seven names now. */}
      <Band ground="quiet" labelledBy="ind-list">
        <Eyebrow>The arrangements</Eyebrow>
        <Headline id="ind-list">Seven ways teams arrange it.</Headline>
        <Stack
          items={INDUSTRIES.map((ind) => ({
            title: ind.name,
            body: ind.body,
            href: `/industries/${ind.slug}`,
            cta: `industries-${ind.slug}`,
          }))}
        />
      </Band>

      <Band labelledBy="ind-rhyme">
        <Eyebrow>Why a trade page</Eyebrow>
        <Headline id="ind-rhyme">Four things that rhyme.</Headline>
        <Stack items={REUSABLE.map(([title, body]) => ({ title, body }))} />
      </Band>

      <Close headline="Arrange it for your own team." placement="industries-index" />
    </Page>
  );
}
