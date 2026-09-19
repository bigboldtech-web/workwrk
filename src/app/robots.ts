import type { MetadataRoute } from "next";

const SITE = "https://workwrk.com";

/**
 * Paths no crawler should index. The product surfaces, plus the two
 * marketing routes that exist for engineers: /dev, which returns 404 in
 * production anyway, belt and braces, and /404, which is the soft-404
 * target the proxy rewrites an unknown marketing path to.
 */
const DISALLOW = ["/api/", "/dashboard/", "/admin/", "/setup/", "/dev/", "/404"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
      {
        userAgent: ["GPTBot", "ChatGPT-User", "Claude-Web", "ClaudeBot", "PerplexityBot", "Google-Extended"],
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
