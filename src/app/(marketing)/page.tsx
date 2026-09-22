// The home route.
//
// The page is built in the project-management category's own register, the
// one ClickUp, Asana and monday.com share, because that is the register the
// founder asked for after rejecting a quieter one twice. The bands, and the
// survey rule each one answers, are documented in
// src/components/marketing/home/stack.tsx; the visual half is stack.css.
//
//   0 nav        the layout owns it
//   1 hero       claim, product frame, one filled button
//   2 proof      the honest rung, where a logo wall would go
//   3 breadth    a tab strip over seven real product surfaces
//   4 modules    the eight hubs as a card grid
//   5 use cases  three alternating rows, words and product
//   6 security   a boring table of what actually ships
//   7 pricing    free floor, highlighted middle, quoted top
//   8 close      one line, one button
//   9 footer     the layout owns it
//
// It is a Server Component and stays one. There is exactly one client
// island on the page, the tab strip, and it owns which chip is on and
// nothing else: every product frame inside it is server markup. So the
// whole page is complete and legible at first paint, with JavaScript off,
// in a link preview and on paper.
//
// What is NOT on this page, and will not come back without the evidence
// named beside it: a customer logo, a counter, a case study, a
// certification badge, an analyst placement, a testimonial, and a play
// control with no video behind it. The category puts a proof ladder right
// under the hero and this site cannot climb it yet, so band 2 says what is
// true instead of implying what is not.

import type { Metadata } from "next";

import { HomeStack } from "@/components/marketing/home/stack";
import { HOME_DESCRIPTION, HOME_KEYWORDS, homeJsonLd } from "@/components/marketing/home/json-ld";
import { detectCurrency } from "@/components/marketing/geo";
import { SITE_TITLE_DEFAULT } from "@/components/marketing/positioning";

const SITE = "https://workwrk.com";
const OG_ALT = "WorkwrK: the work platform your whole company runs on.";

export const metadata: Metadata = {
  title: SITE_TITLE_DEFAULT,
  description: HOME_DESCRIPTION,
  keywords: HOME_KEYWORDS,
  authors: [{ name: "WorkwrK" }],
  creator: "WorkwrK",
  publisher: "WorkwrK",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // The card, named explicitly.
  //
  // A `metadata` export that declares openGraph or twitter WITHOUT an images
  // key replaces the file convention's inferred one rather than merging with
  // it, so the home page, and only the home page, unfurled with no picture
  // at all while every other route carried the root card. That is the one
  // route whose link gets shared most.
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "WorkwrK",
    title: SITE_TITLE_DEFAULT,
    description: HOME_DESCRIPTION,
    url: SITE,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: OG_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: "WorkwrK",
    description: "Tasks, plans, docs, spreadsheets, chat, people and goals in one workspace.",
    images: [{ url: "/opengraph-image", alt: OG_ALT }],
  },
  alternates: { canonical: SITE },
  category: "Business Software",
};

export default async function Home() {
  const currency = await detectCurrency();
  const jsonLd = homeJsonLd({ site: SITE, currency });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeStack currency={currency} />
    </>
  );
}
