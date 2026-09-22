// /customers: a real route with nothing on it yet.
//
// Hiding the nav link did not un-ship the page: it kept answering 200 with
// eight invented company names, nine invented counters and five invented
// named quotes, robots.txt allowed it, and anyone with the URL, or a search
// engine that had already seen it, got the whole thing. `notFound()` was the
// first fix and it over-corrected: a URL that has been live and indexed
// answering 404 is a worse answer than the same URL saying, in one sentence,
// that there are no case studies yet.
//
// So the route answers 200 with the honest empty state below.
//
// TWO CLAIMS WERE CUT FROM IT, and they are the reason this file is now a
// page rather than a placeholder with furniture:
//
//   1. "Companies are running on workwrk, and none of them has agreed to be
//      written about yet." That asserts, as plain fact, an unspecified
//      plural of customers in production. Nothing in this repository or on
//      this site evidences one. flags.ts sets customerLogos, namedCaseStudies,
//      customersPage and productCounters all false, and the home page's own
//      proof band renders "There is no customer story here yet." The page
//      whose entire job is the honest empty state was the page reintroducing
//      the customer claim.
//   2. "The one thing a customer has said in public is the sentence on the
//      sign-in page, and it is quoted on the home page with the same
//      attribution." The home page carries no quote at all, and its source
//      asserts as an invariant that it never will while this is true. That
//      sentence also certified the sign-in page's testimonial as verified
//      public record: an unevidenced hard number (14 tools), an unevidenced
//      customer size (280 people) and a named competitor. The concept doc
//      treats that story as uncleared. It is not ours to cite until it is.
//
// The invented case-study layout that used to sit behind the flags is gone
// with them. A 404 protects the visitor; deleting the shape protects the
// next author, who would otherwise find four invented people at four
// invented companies sitting in the repository as the obvious thing to copy
// the next time somebody needs a quote in a hurry. When a real story exists
// it gets a layout written for the story, not a mould waiting to be filled.

import type { Metadata } from "next";

import { PrimaryCta } from "@/components/marketing/cta";
import { Band, Claim, Eyebrow, Headline, Line, Page, Sub } from "@/components/marketing/iconic/iconic";

const SITE = "https://workwrk.com";

export const metadata: Metadata = {
  title: "Customers",
  description:
    "No case studies yet. When a customer agrees to be written about, their story goes here with their name on it.",
  // noindex while the page is empty. The route is real and it answers 200,
  // which is what an indexed URL deserves, but a page with one paragraph on
  // it competing for the company's own name helps nobody. The sitemap leaves
  // it out on the same flags, so the two never disagree.
  robots: { index: false, follow: false },
  // A SELF CANONICAL, DESPITE THE NOINDEX, because omitting `alternates`
  // does not produce "no canonical": it INHERITS the root layout's, which
  // points at the site root, so this page was declaring itself a duplicate
  // of the home page. Whatever a crawler does with the noindex, the one
  // thing it must not be told is that this URL is the home page. The
  // openGraph description is set for the same reason: without it the share
  // card for the empty-state page advertised the root's product pitch.
  alternates: { canonical: `${SITE}/customers` },
  openGraph: {
    title: "Customers",
    description: "No case studies yet.",
  },
};

export default function CustomersPage() {
  return (
    <Page>
      <Band air="hero" labelledBy="customers-h1" still>
        <Eyebrow>Customers</Eyebrow>
        <Claim id="customers-h1">No case studies yet.</Claim>
        <Sub>When someone agrees to be written about, their story goes here with their name on it.</Sub>
      </Band>

      <Band ground="quiet" air="wide" labelledBy="customers-why">
        <Headline id="customers-why">Empty beats invented.</Headline>
        <Line>
          There is no logo wall, no counter and no quote on this site, because we have not earned one yet.
        </Line>
      </Band>

      <Band air="wide" labelledBy="customers-close">
        <Headline id="customers-close">Be the first one here.</Headline>
        <div className="ic-cta">
          <PrimaryCta placement="customers-empty" />
        </div>
      </Band>
    </Page>
  );
}
