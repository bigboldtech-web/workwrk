import type { MetadataRoute } from "next";

const SITE = "https://workwrk.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard/", "/admin/", "/setup/"],
      },
      {
        userAgent: ["GPTBot", "ChatGPT-User", "Claude-Web", "ClaudeBot", "PerplexityBot", "Google-Extended"],
        allow: "/",
        disallow: ["/api/", "/dashboard/", "/admin/", "/setup/"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
