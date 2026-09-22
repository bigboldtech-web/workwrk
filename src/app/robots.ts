import type { MetadataRoute } from "next";

const SITE = "https://workwrk.com";

/**
 * Paths no crawler should index. The product surfaces, plus the two
 * marketing routes that exist for engineers: /dev, which returns 404 in
 * production anyway, belt and braces, and /404, which is the soft-404
 * target the proxy rewrites an unknown marketing path to.
 */
const DISALLOW = ["/api/", "/dashboard/", "/admin/", "/setup/", "/dev/", "/404"];

/**
 * The exception inside /api/.
 *
 * /api/og/* is not an endpoint, it is the share card: the Work Receipt and
 * the visitor's own Stack Receipt, rendered as images and pointed at by the
 * og:image of /tuesday and /pricing. Most unfurlers ignore robots for an
 * image, but any crawler that honours it would refuse to fetch the one
 * artefact the money layer is designed to spread. Allow is more specific
 * than the /api/ disallow and wins on both major crawlers.
 */
const ALLOW = ["/", "/api/og/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ALLOW,
        disallow: DISALLOW,
      },
      {
        userAgent: ["GPTBot", "ChatGPT-User", "Claude-Web", "ClaudeBot", "PerplexityBot", "Google-Extended"],
        allow: ALLOW,
        disallow: DISALLOW,
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
