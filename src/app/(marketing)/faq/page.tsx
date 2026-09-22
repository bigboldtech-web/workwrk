// /faq, rewritten so it agrees with the home page's FAQ.
//
// The home FAQ is rendered twice, once as the accordion and once as the
// FAQPage structured data a search engine quotes back, and this page used to
// answer the same questions differently: one click importers for eight named
// competitor products (`flags.competitorImporters` is false), SAML SSO and
// SCIM on Scale with Google Workspace SSO on every paid plan
// (`flags.enterpriseIdentity` is false), US, EU and India data residency,
// a named model version, offices in three cities, four language betas, a
// four business hour reply commitment, and "$29,999/year" for Scale against a
// price list that quotes that tier rather than listing it.
//
// So this page is now the home page's seven answers, read from the same
// module they are written in, plus four questions that are specific to this
// page and checkable. One source, one set of sentences, and the structured
// data on the home page cannot drift from the page a visitor reads here.

import type { Metadata } from "next";

import { mailboxes, moduleNames } from "@/components/marketing/config";
import { faqEntries } from "@/components/marketing/home/content";
import { pricing, starterSeatCap, tier } from "@/components/marketing/data/pricing";
import { Band, Claim, Close, Eyebrow, Headline, Note, Page, Qa, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Straight answers about WorkwrK: what the eight blocks are, what moving costs, what we do not do, and what we hold no certification for yet.",
  alternates: { canonical: "https://workwrk.com/faq" },
  // Per page social text. The root layout's og:description is the
  // pre-refresh positioning ("Replaces 15 tools. Built for Indian SMBs"),
  // and the site's own arithmetic says 14 everywhere: the pricing source
  // has fourteen categories, the hero eyebrow reads fourteen and the share
  // card counts fourteen. A page that does not set its own inherits the
  // wrong number and the wrong positioning.
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "FAQ", description: "Straight answers about WorkwrK: what the eight blocks are, what moving costs, what we do not do, and what we hold no certification for yet." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Straight answers about WorkwrK: what the eight blocks are, what moving costs, what we do not do, and what we hold no certification for yet." },
};

const GROWTH = tier("growth");

/** The questions this page adds to the home page's seven. All checkable. */
function extraEntries(): Array<{ q: string; a: string[] }> {
  return [
    {
      q: "What exactly am I buying?",
      a: [
        `One product with ${moduleNames.length} blocks: ${moduleNames.join(", ")}. Same data model, same navigation, one bill.`,
        "It is a people and project management system. It is not an HRMS: payroll, benefits, leave and attendance are not ours, and we would rather say so than sell you a module that does not exist.",
      ],
    },
    {
      q: "What does it cost, and is the free tier real?",
      a: [
        `${tier("starter").name} is free for up to ${starterSeatCap} people with no card and no time limit. ${GROWTH.name} is priced per member per month, billed annually, and ${tier("scale").name} is quoted.`,
        `Prices are authored per currency in ${pricing.currencies.map((c) => c.code).join(", ")}, so the number you see is the number you pay.`,
      ],
    },
    {
      q: "Can you import from the tools we use now?",
      a: [
        "Partly, and the honest answer has two halves. There is no tool that reads another product's data for you, and we will not pretend otherwise. What does exist is CSV: a table reads a spreadsheet and so does a people list, which is how most teams move the data they actually care about. For the rest, do the thing every team ends up doing anyway: bring one team, build the lists and the SOPs from the templates, and cancel each old subscription on its own renewal date.",
      ],
    },
    {
      q: "Who do we talk to, and how fast do you answer?",
      a: [
        `Write to ${mailboxes.general}. We read every message. We are not going to publish a response time commitment we have no status page to be held to.`,
      ],
    },
  ];
}

export default function FaqPage() {
  const entries = [...faqEntries(), ...extraEntries()];
  // The dedicated FAQ page shipped no structured data at all, so the
  // eleven answers a visitor reads here were machine readable only on the
  // home page, and only the seven of them the home page renders. Same
  // entries, same file, one graph.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.q,
      acceptedAnswer: { "@type": "Answer", text: entry.a.join(" ") },
    })),
  };
  return (
    <Page>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* 1. The claim, alone. The questions used to open in the same band,
          so the first viewport carried a headline, a lede, a mailto and the
          first four questions at once. */}
      <Band air="hero" labelledBy="faq-h1" still>
        <Eyebrow>FAQ</Eyebrow>
        <Claim id="faq-h1">Straight answers, including the noes.</Claim>
        <Sub>These are the same answers the home page gives, from the same file, so the two cannot drift apart.</Sub>
      </Band>

      {/* 2. The questions. */}
      <Band ground="quiet" labelledBy="faq-list">
        <Eyebrow>Questions</Eyebrow>
        <Headline id="faq-list">Every one we get asked.</Headline>
        <Qa
          items={entries.map((entry) => ({
            q: entry.q,
            a: (
              <>
                {entry.a.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </>
            ),
          }))}
        />
        <Note>
          If yours is not here, write to{" "}
          <a className="ic-a mk-focus" href={`mailto:${mailboxes.general}`}>
            {mailboxes.general}
          </a>
          .
        </Note>
      </Band>

      <Close headline="The rest is in the product." placement="faq-close" />
    </Page>
  );
}
