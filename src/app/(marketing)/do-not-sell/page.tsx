// /do-not-sell.
//
// Two things were wrong here and both were the kind that matter on a page
// about a legal right.
//
//   1. "Verified by [a named security vendor] (annual audit)" under our own
//      statement of practice. No such audit exists and the vendor has never
//      been engaged. A fabricated assurance on a privacy page is the worst
//      possible place for one.
//   2. The opt-out form had no handler beyond local state. Submitting it set
//      a boolean, rendered "Request received" and "we will email you a
//      confirmation within 15 business days", and sent nothing anywhere. A
//      person exercising a statutory right was told it had been recorded
//      when nothing had. That is not a broken form; it is a page telling
//      somebody their request is filed when it is in the bin.
//
// The page is now a statement of practice and one real mailbox, which is
// what a request under this act actually needs. No client state is left,
// so it is a server component again.
//
// A THIRD THING WAS WRONG, found on the rebuild and fixed here. This page
// named four sub-processors outright ("AWS, Stripe, Anthropic, Datadog")
// and sent the reader to /privacy "for the full list". /privacy had already
// deleted its six name list as unevidenced against the running deployment,
// and now says in as many words that it will give the current list by name
// in writing on request. So this page asserted four specific vendors the
// privacy policy declines to name, and pointed at a list that is not there.
// Both halves go: the disclosure is the same one /privacy makes, and the
// link points at the paragraph that makes it.
//
// It also published "Last updated: May 18, 2026" while the three documents
// it sits beside all moved to the date this build was written. A statutory
// disclosure is read at its effective date, so it takes the same one they
// carry, from the same file.

import type { Metadata } from "next";
import Link from "next/link";
import { mailboxes } from "@/components/marketing/config";
import { LEGAL_COPY } from "@/components/marketing/iconic/copy";
import { Band, Claim, Close, Eyebrow, Headline, Note, Page, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

// THIS PAGE HAD NO METADATA AT ALL, and it was the only content page in the
// group without it. Everything therefore fell through to src/app/layout.tsx:
// the pre-refresh title and og:title with an em dash in them, the old
// og:description ("Replaces 15 disconnected tools. Built for Indian SMBs"),
// og:locale en_IN, and, the part that actually costs something,
// `canonical: https://workwrk.com`, which tells a search engine that this
// page is a duplicate of the home page and should not be indexed on its own.
// It is a statutory disclosure, so being de-indexed is a compliance problem
// as well as an SEO one: the whole point is that a Californian resident can
// find it.
const DESCRIPTION =
  "WorkwrK does not sell or share personal information. What that means under the CCPA, and the mailbox to write to if you want to exercise the right anyway.";

export const metadata: Metadata = {
  title: "Do not sell or share my personal information",
  description: DESCRIPTION,
  alternates: { canonical: "https://workwrk.com/do-not-sell" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Do not sell or share my personal information", description: DESCRIPTION },
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: DESCRIPTION },
};

export default function DoNotSellPage() {
  return (
    <Page>
      <Band air="hero" labelledBy="dns-h1" still>
        <Eyebrow>CCPA and CPRA</Eyebrow>
        <Claim id="dns-h1">We do not sell your data.</Claim>
        <Sub>
          California residents have the right to opt out of the sale or sharing of personal information, and there is
          nothing here to opt out of.
        </Sub>
      </Band>

      <Band ground="quiet" width="read" align="start" labelledBy="dns-position">
        <Eyebrow>Our position</Eyebrow>
        <Headline id="dns-position">Nothing is sold or shared.</Headline>
        <div className="ic-docbody">
          <p>
            WorkwrK does not sell personal information. We do not exchange your data for money or other valuable
            consideration with third parties for their independent use.
          </p>
          <p>
            We use a small number of sub-processors to run the service, under agreements that prohibit them from using
            your data for their own purposes. We will give you the current list, by name, in writing, on request:{" "}
            <Link className="ic-a mk-focus" href="/privacy#share">
              the privacy policy
            </Link>{" "}
            says how to ask.
          </p>
          <p>No third party has audited this statement.</p>
        </div>
      </Band>

      <Band width="read" align="start" labelledBy="dns-request">
        <Eyebrow>Exercising it</Eyebrow>
        <Headline id="dns-request">How to file a request.</Headline>
        <div className="ic-docbody">
          <p>
            Email{" "}
            <a
              className="ic-a mk-focus"
              href={`mailto:${mailboxes.general}?subject=Do%20not%20sell%20or%20share`}
            >
              {mailboxes.general}
            </a>{" "}
            with the words &ldquo;Do not sell or share&rdquo; in the subject, from the address on your account or with
            enough detail to identify it. Say whether you are a California resident or are authorised to act for one.
          </p>
          <p>
            We will reply to confirm. We are not publishing a turnaround commitment we have no process to be held to,
            and we would rather tell you that than print a number.
          </p>
        </div>
        <Note>Last updated {LEGAL_COPY.privacy.updated}.</Note>
      </Band>

      <Close headline="Read the whole policy." placement="do-not-sell" />
    </Page>
  );
}
