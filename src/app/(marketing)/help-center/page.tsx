// /help-center, rewritten so nothing on it is a prop.
//
// What was here: a 14px search field with no handler and no results page
// behind it (a control that does nothing is the clearest possible lie a page
// can tell), "200+ guides, organized by hub. Searchable. Updated weekly", a
// "Top guides this month" grid of six articles all linking to "#", a hub
// grid claiming "~25 guides" behind each of seven hubs, two of those guides
// being a migration from three named competitor products and a setup guide
// for single sign-on and directory provisioning that do not exist, and a
// support commitment of "Real humans on chat 09:00 to 20:00" with no chat
// widget on the page.
//
// There is no guide library. Pretending otherwise wastes the time of the
// person who most needs a straight answer. So this page is what a help
// centre is when you do not have one yet: the eight or nine pages that DO
// answer things, named, with what each one answers, and one mailbox.

import type { Metadata } from "next";

import { mailboxes, moduleNames } from "@/components/marketing/config";
import { starterSeatCap } from "@/components/marketing/data/pricing";
import { Band, Claim, Eyebrow, Headline, Line, Page, Stack, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Help",
  description:
    "Where the answers actually are: the questions page, the security page, the roadmap, the changelog and the developer reference, with one mailbox for everything else.",
  alternates: { canonical: "https://workwrk.com/help-center" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "Help",
    description: "Where the answers actually are, and one mailbox for everything else.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Where the answers actually are, and one mailbox for everything else." },
};

const ANSWERS: readonly { href: string; label: string; body: string }[] = [
  {
    href: "/faq",
    label: "Questions and answers",
    body: "What you are buying, what it costs, what moving really involves, and the things we say no to.",
  },
  {
    href: "/pricing",
    label: "Pricing",
    body: `What each tier holds, in your own currency, and what free actually means: up to ${starterSeatCap} people, no card.`,
  },
  {
    href: "/security",
    label: "Security",
    body: "What we do to protect an account, and, in the same number of words, what we hold no certification for.",
  },
  {
    href: "/roadmap",
    label: "Roadmap",
    body: "What is live today and what is ahead. If a thing you need is not in the first column, it is not built.",
  },
  {
    href: "/changelog",
    label: "Changelog",
    body: "What shipped, with dates, taken from the repository rather than a release calendar.",
  },
  {
    href: "/developers",
    label: "Developer reference",
    body: "The v1 API surface, the OpenAPI document, the key scopes and the real rate limits.",
  },
  {
    href: "/features",
    label: "What each block does",
    body: `The ${moduleNames.length} blocks, and one page per capability underneath, each written against the product.`,
  },
  {
    href: "/compare",
    label: "How it compares",
    body: "What a stack of separate tools does better, and what one system does better. Both halves.",
  },
];

export default function HelpCenterPage() {
  return (
    <Page>
      <Band air="hero" labelledBy="help-h1" still>
        <Eyebrow>Help</Eyebrow>
        <Claim id="help-h1">There is no guide library yet.</Claim>
        <Sub>
          So rather than a search box with nothing behind it, here are the pages that answer real questions and one
          mailbox a person reads.
        </Sub>
      </Band>

      {/* The answers. Names and lines, not an eight card grid whose top row
          used to sit inside the first viewport. */}
      <Band ground="quiet" labelledBy="help-answers">
        <Eyebrow>Answers</Eyebrow>
        <Headline id="help-answers">Where to look instead.</Headline>
        <Stack
          items={ANSWERS.map((a) => ({
            title: a.label,
            body: a.body,
            href: a.href,
            cta: `help-${a.href.replace(/^\//, "")}`,
          }))}
        />
      </Band>

      <Band air="wide" labelledBy="help-write">
        <Headline id="help-write">Or just write to us.</Headline>
        <Line>
          <a className="ic-a mk-focus" href={`mailto:${mailboxes.general}`}>
            {mailboxes.general}
          </a>{" "}
          reaches a person, and we will not publish a response time we have no status page to be held to.
        </Line>
      </Band>
    </Page>
  );
}
