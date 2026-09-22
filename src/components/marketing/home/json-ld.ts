// The home page's structured data (concept 6.3, decision 7).
//
// Four rules, each one of them a defect that was live on this page:
//
//   1. The OFFERS come from the pricing source. They used to be three hand
//      typed rupee prices at seat caps of 25, 100 and 500, none of which
//      matched the pricing page, the receipt, or the caps the server
//      enforces. Structured data is the version of a price a search engine
//      quotes back to a buyer, so it is the worst possible place for a
//      fourth opinion.
//   2. There is NO FAQPage node. There was one, carrying seven of the
//      eleven answers /faq emits from the same file, word for word, on a
//      second URL. Two URLs claiming the same FAQPage is the pattern a
//      search engine collapses, and until it does the home page competes
//      with the page whose whole job is the FAQ. The page still renders
//      the seven answers and links to /faq; it just does not also claim to
//      be the FAQ document.
//   3. No aggregateRating. The site has no ratings. A 4.8 from 284 raters
//      in a graph is a fabrication with a Google policy attached to it.
//   4. No SearchAction. It pointed at /search, which is not a route.
//
// The positioning is PPMS: one system for people, processes, work and
// goals, in USD by default with the currency a data decision.

import { positioningLine } from "../positioning";
import { mailboxes, moduleNames } from "../config";
import { pricing, softwareApplicationJsonLd, type MarketingCurrency } from "../data/pricing";
import { tuesday } from "../data/tuesday";

export interface JsonLdOptions {
  site: string;
  currency?: MarketingCurrency;
}

export function homeJsonLd({ site, currency = pricing.defaultCurrency }: JsonLdOptions) {
  // `@context` is dropped from the node: the graph above already declares
  // it, and a node repeating it is noise in the one document a crawler
  // reads literally.
  const software = { ...softwareApplicationJsonLd(currency, site) } as Record<string, unknown>;
  delete software["@context"];

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        // The nodes carry @ids and reference each other. Without them a
        // crawler reads three unrelated things that happen to share a name.
        "@id": `${site}#website`,
        name: "WorkwrK",
        url: site,
        publisher: { "@id": `${site}#organization` },
        // Same gate as the H1 subhead, and for the same reason: structured
        // data is the version of a sentence a search engine quotes back.
        description: positioningLine(),
      },
      software,
      {
        "@type": "Organization",
        "@id": `${site}#organization`,
        name: "WorkwrK",
        url: site,
        // No sameAs: the two profiles that used to be listed pointed at
        // accounts nothing in this repo proves exist, which is the same
        // reason the footer dropped its social row. They come back together.
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "sales",
          email: mailboxes.sales,
        },
      },
      // NO FAQPage NODE HERE.
      //
      // /faq emits one, from the same file, with eleven entries. This node
      // carried seven of those eleven, word for word, on a second URL. Two
      // URLs claiming the same FAQPage is the pattern a search engine
      // collapses, and while it lasts the home page and the page whose
      // whole job is the FAQ compete for one rich result. The dedicated
      // page is the one that should win it: it has every answer on it.
      //
      // The home page still RENDERS the seven answers; it just does not
      // also claim to be the FAQ document. Its section links to /faq.
    ],
  };
}

/**
 * The description both the metadata and the WebSite node use.
 *
 * It is the page's own argument, in the page's own words: the claim, then
 * the mechanism, then the payoff. It names no customer, no count and no
 * certification, because a meta description is quoted back verbatim by a
 * search engine and is the worst place on a site for a claim that has to
 * be walked back.
 */
export const HOME_DESCRIPTION =
  "Every task knows who owns it. The owner, the standard and the goal travel with the work, so when the quarter ends the record of who delivered what already exists. " +
  `${moduleNames.length} parts, one system.`;

/** The eight block names, for the metadata keywords. */
export const HOME_KEYWORDS: string[] = [
  "people and project management system",
  "work operating system",
  "SOP management software",
  "KPI tracking software",
  "OKR and goal tracking",
  "performance review software",
  "employee recognition software",
  "task and project management",
  "team directory and org chart",
  "spreadsheets and forms for teams",
  "team chat and calls",
  ...tuesday.hubs.map((h) => `workwrk ${h.label.toLowerCase()}`),
  "workwrk",
];
