// /compare: the one page competitor names are allowed on (decision 13), and
// the rows have to be factual.
//
// THE DISCIPLINE, which is older than this restyle and survives it: nothing
// in a competitor column is a claim about their product beyond the category
// a team buys it for. We do not summarise someone else's feature list, we do
// not tick capabilities on their behalf, and there is no logo anywhere. What
// each entry carries is what it is bought for, what we do instead, and the
// case where it is the better answer. Every row about US is checkable by
// opening ours, and the numbers come from the pricing source.
//
// What came out of the old matrix, and has not come back: "Spend and
// procurement: yes" for a product with no spend or procurement in it; "US
// payroll and benefits: 2027", which is a roadmap date read by a buyer as a
// commitment; "Free under 5 users" against an enforced cap of ten; and five
// "where we win" paragraphs comparing our whole product against a summary of
// someone else's written by us.
//
// THE RESTYLE: the nine facts are nine rows instead of a table that scrolled
// sideways on a phone, and the five entries are five stacked passages
// instead of a two column card grid. No card, no border, no tick.

import type { Metadata } from "next";
import Link from "next/link";

import { PrimaryCta } from "@/components/marketing/cta";
import { COMPARE_COPY } from "@/components/marketing/iconic/copy";
import { Band, Claim, Eyebrow, Headline, Line, Note, Page, Sub } from "@/components/marketing/iconic/iconic";
import { COMPARE_ENTRIES, FACTS } from "./data";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

const COMPARE_DESCRIPTION =
  "What WorkwrK does, what the tools it is usually compared against are bought for, and where each of them is the better answer.";

export const metadata: Metadata = {
  title: "Compare",
  description: COMPARE_DESCRIPTION,
  alternates: { canonical: "https://workwrk.com/compare" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Compare", description: COMPARE_DESCRIPTION },
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: COMPARE_DESCRIPTION },
};

/* The copy lives in iconic/copy.ts with the other seven pages. */
const COPY = COMPARE_COPY;

export default function ComparePage() {
  return (
    <Page>
      {/* 1. The claim. */}
      <Band air="hero" labelledBy="compare-h1" still>
        <Eyebrow>{COPY.hero.eyebrow}</Eyebrow>
        <Claim id="compare-h1">{COPY.hero.h1}</Claim>
        <Sub>{COPY.hero.sub}</Sub>
      </Band>

      {/* 2. The facts about us. One object: a list of rows, each one a thing
          this repo or the price list can evidence. */}
      <Band ground="quiet" labelledBy="compare-facts">
        <Eyebrow>{COPY.facts.eyebrow}</Eyebrow>
        <Headline id="compare-facts">{COPY.facts.h2}</Headline>
        <ul className="ic-rows">
          {FACTS.map(([label, value]) => (
            <li key={label}>
              <span className="ic-rowlabel">{label}</span>
              <span className="ic-rowvalue">{value}</span>
            </li>
          ))}
        </ul>
      </Band>

      {/* 3. The entries. Five passages, stacked, no cards. */}
      <Band labelledBy="compare-entries">
        <Eyebrow>{COPY.entries.eyebrow}</Eyebrow>
        <Headline id="compare-entries">{COPY.entries.h2}</Headline>
        <Line>{COPY.entries.line}</Line>
        <ul className="ic-entries">
          {COMPARE_ENTRIES.map((c) => (
            <li key={c.name}>
              <span className="ic-entryname">{c.name}</span>
              <p className="ic-entrypara">Bought for: {c.boughtFor}</p>
              <p className="ic-entrypara">
                <span className="ic-entrylead">What we do instead. </span>
                {c.ours}
              </p>
              <p className="ic-entrypara">
                <span className="ic-entrylead">When they are the answer. </span>
                {c.theirs}
              </p>
              {c.slug ? (
                <p className="ic-entrypara">
                  <Link className="ic-a mk-focus" href={`/compare/${c.slug}`} data-cta={`compare-index-${c.slug}`}>
                    WorkwrK and {c.name}
                  </Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <Note>
          Comparing on price rather than on category?{" "}
          <Link className="ic-a mk-focus" href="/compare/your-stack" data-cta="compare-index-stack">
            Price your current stack
          </Link>
          .
        </Note>
      </Band>

      {/* 4. One line. One button. The page's only blue. */}
      <Band air="wide" labelledBy="compare-close">
        <Headline id="compare-close">{COPY.close.h2}</Headline>
        <Line>{COPY.close.line}</Line>
        <div className="ic-cta">
          <PrimaryCta placement="compare-close" />
        </div>
      </Band>
    </Page>
  );
}
