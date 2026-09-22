// /about, rewritten.
//
// What came out: a competitor named three times as the thing we are not, a
// team size of 35, a "$12M Series A from operator funds", a 99.95 percent
// uptime number against a flag that is false and no status page, a founding
// date and a "first 100 customers" milestone, and a testimonial from a named
// CEO at a company that does not exist. The one real quote this site has
// belongs to the login page and is used on the home page with its own
// attribution; it is not repeated here.
//
// An about page can be honest and still be worth reading. What it has to be
// about is the argument, not the mythology.

import type { Metadata } from "next";


import { pricing, starterSeatCap, tier } from "@/components/marketing/data/pricing";
import { Band, Claim, Close, Eyebrow, Headline, Note, Page, Stack, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why this product is one system rather than a suite, what we deliberately do not build, and how to tell whether a claim on this site is true.",
  alternates: { canonical: "https://workwrk.com/about" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "About",
    description: "The argument, what we do not build, and how to check a claim on this site.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "The argument, what we do not build, and how to check a claim on this site." },
};

const IDEAS: readonly { title: string; body: string }[] = [
  {
    title: "One data model, or it is a suite",
    body: "A suite is several products with a shared login. What makes this one system is that a task, a role, a process, a measure and a goal are the same objects everywhere, referenced rather than copied. Everything good about the product comes from that, and so does everything hard about building it.",
  },
  {
    title: "The scope is people and work",
    body: "This is a people and project management system. Payroll, benefits, leave, attendance, invoicing, a CRM and a helpdesk are not in it and are not coming. Naming the edge is more useful to you than a longer feature list.",
  },
  {
    title: "Say the price",
    body: `${tier("starter").name} is free for up to ${starterSeatCap} people. ${tier("growth").name} is per member per month, authored in ${pricing.currencies.map((c) => c.code).join(", ")} rather than converted from a stale rate. Only the top tier is quoted, and the reason is that it is genuinely negotiated.`,
  },
  {
    title: "A claim is a flag, not a sentence",
    body: "Every claim on this site that depends on a feature reads a flag in the code, so a page cannot say a thing ships because somebody typed it. Where a mechanism is unbuilt the page says what happens today instead, in the same place, in the same size type.",
  },
];

export default function AboutPage() {
  return (
    <Page>
      {/* 1. The claim. It was "One system, and a short list of noes." at
          eight words, left aligned at 64px beside 750px of nothing. */}
      <Band air="hero" labelledBy="about-h1" still>
        <Eyebrow>About</Eyebrow>
        <Claim id="about-h1">One system. Everything else is no.</Claim>
        <Sub>
          A company of thirty or three hundred does not lack tools, it lacks one place where the role, the process,
          the work and the number are the same records.
        </Sub>
      </Band>

      {/* 2. The decisions. Four names, not a two column card grid. */}
      <Band ground="quiet" labelledBy="about-ideas">
        <Eyebrow>Decisions</Eyebrow>
        <Headline id="about-ideas">Four things we decided early.</Headline>
        <Stack items={IDEAS} />
      </Band>

      {/* 3. How to check us. Four pages, each one a link, each one a place
          the site can be caught out. */}
      <Band labelledBy="about-check">
        <Eyebrow>Verify it</Eyebrow>
        <Headline id="about-check">Check anything on this site.</Headline>
        <Stack
          items={[
            {
              title: "Roadmap",
              body: "Four columns, and only the first one means you can use it today.",
              href: "/roadmap",
              cta: "about-roadmap",
            },
            {
              title: "Changelog",
              body: "Written from the repository, not from a release calendar.",
              href: "/changelog",
              cta: "about-changelog",
            },
            {
              title: "Security",
              body: "Names what we hold, which is currently no certification at all.",
              href: "/security",
              cta: "about-security",
            },
            {
              title: "Compare",
              body: "Says what a stack of separate tools does better, because some of it is better.",
              href: "/compare",
              cta: "about-compare",
            },
          ]}
        />
        <Note>
          If you find something on this site that is not true, that is a defect, and we would like to hear about it
          more than we would like to keep the sentence.
        </Note>
      </Band>

      <Close headline="Open it and judge it." placement="about-close" />
    </Page>
  );
}
