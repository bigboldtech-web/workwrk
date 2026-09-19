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

const SITE = "https://workwrk.com";

/** The module pages linked from /features. */
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

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE}/features`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/compare`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    // The share route. /snap is a permanent redirect to it and is therefore
    // NOT listed: a sitemap declares destinations, not doorways.
    { url: `${SITE}/tuesday`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/industries`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/demo`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/security`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
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

  return [...staticRoutes, ...featureRoutes, ...industryRoutes, ...blogRoutes];
}
