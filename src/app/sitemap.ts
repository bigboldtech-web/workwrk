// The sitemap.
//
// One rule, and it is the reason this file changed: what the navigation and
// the footer link, the sitemap declares. The two disagreed on eight routes,
// all of them live, all of them linked from the new chrome, none of them
// submitted: /compare, /demo, /security, /changelog, /contact, /partners,
// /developers, and the children under /features and /industries.
//
// The inverse rule matters just as much. /customers is deliberately absent,
// and so is /dev/foundations: a route that does not render is not a route.
// Both are checked by hand below rather than derived, because deriving a
// sitemap from the filesystem is how a dev page ends up in Google.

import type { MetadataRoute } from "next";

import { blogPosts } from "@/data/blog-posts";
import { flags } from "@/components/marketing/flags";
import { MODULE_ORDER, moduleHref } from "@/components/marketing/product/module-page";
import { COMPARE_SLUGS } from "@/app/(marketing)/compare/data";

const SITE = "https://workwrk.com";

/**
 * The twelve capability pages under /features.
 *
 * They were held out of this list while they were still on the old copy,
 * which sold third party connectors, certifications nobody holds and
 * identity features that do not ship. That was the right call at the time
 * and the wrong end state: it left twelve live, crawlable pages with nothing
 * pointing at them from the page that owns them, still reachable from each
 * other and from the footer, and still saying all of it.
 *
 * They have been rewritten against the product, /features links them again,
 * and so this list is back. The rule is unchanged: what the navigation and
 * the footer link, the sitemap declares.
 */
const FEATURE_SLUGS = [
  "access",
  "ai-engine",
  "analytics",
  "integrations",
  "kpis",
  "kras",
  "kudos",
  "okrs",
  "people",
  "reviews",
  "sops",
  "tasks",
];

/** The vertical pages linked from /industries. */
const INDUSTRY_SLUGS = [
  "healthcare",
  "logistics",
  "manufacturing",
  "real-estate",
  "sales",
  "services",
  "technology",
];

/**
 * The site's last revision, as ONE date.
 *
 * It used to be `new Date()` evaluated per request, so two consecutive
 * fetches of /sitemap.xml returned a different lastmod for all fifty nine
 * URLs and every crawl was told the entire site had changed that second.
 * A lastmod that is always now is a lastmod that says nothing, and a
 * crawler that learns to distrust it stops reading the one signal this
 * file exists to send. Everything else here is derived from a real source;
 * this was the one part derived from nothing.
 *
 * BUMP THIS when the marketing pages change in a way worth recrawling.
 * Blog posts do not use it: they carry their own publication dates.
 */
const SITE_REVISED = new Date("2026-09-22T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  const now = SITE_REVISED;

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE}/features`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    // The module tour, and the index the eight chapters below hang off. It
    // did not exist when this file was written: /product fell through to the
    // marketing 404 while the navigation's Product menu and every
    // /product/[module] row here pointed into the branch.
    //
    // The tour's own panels (/product?m=docs and the rest) are NOT listed.
    // They are one page in eight states, they all carry the same canonical,
    // and a sitemap that submits a query parameter is asking for eight
    // duplicates of one document.
    { url: `${SITE}/product`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/compare`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    // The Stack Receipt landing. It is a real page with its own copy, not a
    // parameterised view of /compare, so it is declared rather than left to
    // be discovered from an ad.
    { url: `${SITE}/compare/your-stack`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    // The explorable map.
    { url: `${SITE}/how-it-connects`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    // The share route. /snap is a permanent redirect to it and is therefore
    // NOT listed: a sitemap declares destinations, not doorways.
    { url: `${SITE}/tuesday`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/industries`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/demo`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/security`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    // The public roadmap. It was removed from the repo in b7c9d055 on the
    // way to an external service that never arrived, which left the URL
    // being quoted while the path fell through to the app's auth gate.
    { url: `${SITE}/roadmap`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE}/help-center`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE}/partners`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE}/developers`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/cookies`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/do-not-sell`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  // Only when there is a real case study on it. The nav link and the page
  // answer to the same two flags, so the sitemap cannot submit a page the
  // navigation is hiding.
  if (flags.customersPage && flags.namedCaseStudies) {
    staticRoutes.push({ url: `${SITE}/customers`, lastModified: now, changeFrequency: "monthly", priority: 0.7 });
  }

  // The eight module chapters. Derived from the same order the nav, the
  // tour and the footer read, so a ninth block cannot appear in one place
  // and be missing from the sitemap.
  const moduleRoutes: MetadataRoute.Sitemap = MODULE_ORDER.map((id) => ({
    url: `${SITE}${moduleHref(id)}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  // The three per competitor pages. /compare/your-stack is NOT in this list:
  // it is not a competitor entry, it has no slug in COMPARE_SLUGS, and it is
  // declared above with its own priority.
  const compareRoutes: MetadataRoute.Sitemap = COMPARE_SLUGS.map((slug) => ({
    url: `${SITE}/compare/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const featureRoutes: MetadataRoute.Sitemap = FEATURE_SLUGS.map((slug) => ({
    url: `${SITE}/features/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const industryRoutes: MetadataRoute.Sitemap = INDUSTRY_SLUGS.map((slug) => ({
    url: `${SITE}/industries/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const blogRoutes: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${SITE}/blog/${post.slug}`,
    lastModified: post.date ? new Date(post.date) : now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...moduleRoutes, ...compareRoutes, ...featureRoutes, ...industryRoutes, ...blogRoutes];
}
