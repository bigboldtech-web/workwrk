// /security, rewritten against the running product.
//
// This page was the biggest truth hole on the site, and it is one click from
// every page through the footer. What it asserted, none of which this repo
// can evidence: SOC 2 Type II, ISO 27001, GDPR, DPDP, "HIPAA-ready" and
// PCI-DSS as six badges; customer managed keys through AWS KMS; SAML SSO and
// SCIM with five named identity providers; EU, India and US data residency
// pinned at workspace creation; AWS across three regions; a 99.95 percent
// uptime SLA; annual penetration tests by a named firm; a private HackerOne
// programme with a four tier bounty table up to 20,000 dollars; a public PGP
// key at /security.asc, which does not exist and answered with the app shell;
// a trust portal at a subdomain that is not ours to link; a four hour breach
// notification commitment; and a VPC deployment add-on at 50k a year.
//
// Every one of those is a legal or contractual commitment a buyer's
// procurement team quotes back, and the home FAQ, which is also the FAQPage
// structured data Google reads, says in as many words: "We hold no third
// party security certification yet." The site contradicted itself one click
// apart.
//
// What is on the page now is the list of controls that are in the code, each
// of which can be checked by opening the product, plus the one honest
// sentence about certifications. The certification list is generated from the
// flags, so the day a report exists the page says so by flipping a flag.

import type { Metadata } from "next";

import { mailboxes } from "@/components/marketing/config";
import { heldCertifications } from "@/components/marketing/flags";
import { Band, Claim, Close, Eyebrow, Headline, Line, Note, Page, Stack, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Security",
  description:
    "The account controls that ship today: multi factor authentication at login, idle session expiry, lockout after repeated failures, hashed reset tokens, a security activity log, and access by role and scope.",
  alternates: { canonical: "https://workwrk.com/security" },
  // Per page social text. The root layout's og:description is the
  // pre-refresh positioning ("Replaces 15 tools. Built for Indian SMBs"),
  // and the site's own arithmetic says 14 everywhere: the pricing source
  // has fourteen categories, the hero eyebrow reads fourteen and the share
  // card counts fourteen. A page that does not set its own inherits the
  // wrong number and the wrong positioning.
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Security", description: "The account controls that ship today: multi factor authentication at login, idle session expiry, lockout after repeated failures, hashed reset tokens, a security activity log, and access by role and scope." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "The account controls that ship today: multi factor authentication at login, idle session expiry, lockout after repeated failures, hashed reset tokens, a security activity log, and access by role and scope." },
};

/** Each control names something in the product a customer can go and see. */
const CONTROLS: Array<{ title: string; body: string }> = [
  {
    title: "Two step verification at login",
    body: "A second factor is asked for at sign in, and an administrator can require it for everyone in the workspace.",
  },
  {
    title: "Sessions that expire",
    body: "A session ends after a period of inactivity, and signing out everywhere ends every session on every device at once.",
  },
  {
    title: "Lockout after repeated failures",
    body: "Repeated failed sign in attempts lock the account rather than letting a list of passwords be tried against it.",
  },
  {
    title: "Password reset tokens, stored hashed",
    body: "A reset link is single use and time limited, and what the database holds is a hash of it, never the link itself.",
  },
  {
    title: "A security activity log",
    body: "Sign ins, password changes, multi factor changes and session revocations are recorded and readable by the account holder.",
  },
  {
    title: "Access by role and by scope",
    body: "A person sees the spaces, folders and lists they have been given. Administrators can narrow that further, and sharing is per entity rather than all or nothing.",
  },
  {
    title: "Your data leaves with you",
    body: "Export is available on every tier including the free one, any time. Deleted items sit in a trash window before they go.",
  },
];

export default function SecurityPage() {
  const certified = heldCertifications.length > 0;
  return (
    <Page>
      {/* 1. The claim. The page's whole value to a buyer is the second half
          of this sentence, so the second half is the headline. */}
      <Band air="hero" labelledBy="sec-h1" still>
        <Eyebrow>Security</Eyebrow>
        <Claim id="sec-h1">What we do not claim.</Claim>
        <Sub>
          {certified
            ? `We hold ${heldCertifications.join(" and ")}, and the reports are available on request.`
            : "We hold no third party security certification yet, and this page names only what is in the product today."}
        </Sub>
      </Band>

      {/* 2. The controls. Seven names, each one a thing a buyer can go and
          open. It was a three column grid of bordered cards, which put the
          top row inside the first viewport. */}
      <Band ground="quiet" labelledBy="sec-controls">
        <Eyebrow>Account security</Eyebrow>
        <Headline id="sec-controls">The controls that ship today</Headline>
        <Stack items={CONTROLS} />
      </Band>

      {/* 3. Procurement. One address, and what we will and will not say. */}
      <Band labelledBy="sec-review">
        <Eyebrow>Procurement</Eyebrow>
        <Headline id="sec-review">Send us your security questionnaire</Headline>
        <Line>
          Write to{" "}
          <a className="ic-a mk-focus" href={`mailto:${mailboxes.sales}`}>
            {mailboxes.sales}
          </a>{" "}
          and we answer what is true today, including where the answer is no.
        </Line>
        <Note>
          Reporting a vulnerability: the same address, with enough detail to reproduce it. There is no bug bounty
          programme, so we will not promise a payment. We will confirm we received it and tell you what we did.
        </Note>
      </Band>

      <Close headline="Open it and check." placement="security-close" />
    </Page>
  );
}
