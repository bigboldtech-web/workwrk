// /partners, rewritten.
//
// What was here: three partner tracks with published economics ("20% rev
// share for the first year", "30% margin on first-year ACV", "Pays within
// 30 days of customer pay"), a partner portal with real time pipeline and
// commission tracking, co-marketing including joint webinars and conference
// sponsorship, and an "Active partners" strip naming eight consulting firms.
// None of it exists: there is no programme, no portal, no commission
// schedule and no partner. The eight names are the same class of invention
// as a customer logo wall, and the on-brand rule bans both outright.
//
// A partner page with nothing behind it is still worth keeping, because the
// people who land on it are exactly the people worth talking to. It just has
// to say what is true, which is: not yet, and here is what we would want.

import type { Metadata } from "next";
import Link from "next/link";

import { mailboxes } from "@/components/marketing/config";
import { Band, Claim, Eyebrow, Headline, Note, Page, Stack, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Partners",
  description:
    "There is no partner programme yet: no portal, no published economics, no signed partners. What we would want from one, and how to start the conversation.",
  alternates: { canonical: "https://workwrk.com/partners" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "Partners",
    description: "No programme yet. What we would want from one, and how to start.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "No programme yet. What we would want from one, and how to start." },
};

const WANTED: readonly { title: string; body: string }[] = [
  {
    title: "People who implement",
    body: "Consultants and operators who set a company up properly: the roles, the result areas, the measures and the first three processes. That first fortnight is the whole difference between a workspace that sticks and one that does not.",
  },
  {
    title: "People who know one trade deeply",
    body: "The industry pages on this site describe arrangements, not templates. Someone who has run operations in a trade knows the arrangement better than we do, and that is worth building a programme around.",
  },
  {
    title: "People who build on the API",
    body: "There is a v1 REST API and an OpenAPI document, and no connector to any third party product. If you would build one, we would rather it be a partnership than a support ticket.",
  },
];

export default function PartnersPage() {
  return (
    <Page>
      <Band air="hero" labelledBy="partners-h1" still>
        <Eyebrow>Partners</Eyebrow>
        <Claim id="partners-h1">There is no programme yet.</Claim>
        <Sub>No portal, no certification, no published revenue share, and no partners to name.</Sub>
      </Band>

      <Band ground="quiet" labelledBy="partners-want">
        <Eyebrow>Later</Eyebrow>
        <Headline id="partners-want">Who we would build it with.</Headline>
        <Stack items={WANTED} />
        <Note>
          If one of those is you, write to{" "}
          <a className="ic-a mk-focus" href={`mailto:${mailboxes.sales}`}>
            {mailboxes.sales}
          </a>{" "}
          and we will answer with what we can commit to today. The developer reference is at{" "}
          <Link className="ic-a mk-focus" href="/developers">
            /developers
          </Link>
          , and what is built and what is not is on the{" "}
          <Link className="ic-a mk-focus" href="/roadmap">
            roadmap
          </Link>
          .
        </Note>
      </Band>
    </Page>
  );
}
