import { NextRequest } from "next/server";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { fetchPublic, readCapped } from "@/lib/net/public-fetch";
import { parseHeadMeta } from "@/lib/net/html-head";

/*
 * GET /api/link-preview?url=<encoded>
 *
 * Server-side "unfurl" for the Web bookmark block. Fetches the target page
 * and scrapes Open Graph / standard meta tags into a small preview payload:
 *   { url, title, description, image, favicon, siteName }
 *
 * Server-side because (a) CORS blocks client fetches of arbitrary origins
 * and (b) it keeps the scrape off the user's network. Best-effort: a fetch
 * failure still returns a usable payload (the URL + hostname as title) so
 * the block always renders something.
 */

// Pen test 2026-11-28: the fetch is the shared public one (V-20: the old
// host-name block let ::ffff:7f00:1, a trailing dot and any name resolving to
// a private address through), and the page is read by a one-pass scanner
// (V-10: twelve backtracking regexes over 256 KB froze the server).

export async function GET(req: NextRequest) {
  const { error } = await getSessionOrFail();
  if (error) return error;

  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return jsonError("Missing url", 400);

  let target: URL;
  try {
    target = new URL(raw);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return jsonError("Only http(s) URLs are supported", 400);
    }
  } catch {
    return jsonError("Invalid url", 400);
  }


  const hostname = target.hostname.replace(/^www\./, "");
  const fallback = {
    url: target.toString(),
    title: hostname,
    description: null as string | null,
    image: null as string | null,
    favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
    siteName: hostname,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let html = "";
    try {
      const res = await fetchPublic(target.toString(), {
        signal: controller.signal,
        maxRedirects: 3,
        headers: {
          // Some sites gate OG tags behind a real UA.
          "user-agent": "Mozilla/5.0 (compatible; WorkwrKBot/1.0; +https://workwrk.app)",
          accept: "text/html,application/xhtml+xml",
        },
      });
      // Refused (not a public address) or failed: the plain fallback, never
      // the reason, so the preview is no probe of anyone's network.
      if (!res.ok || res.status < 200 || res.status >= 300) return jsonSuccess(fallback);
      // Only the first 256 KB, and only up to </head>: meta tags live there.
      const { bytes } = await readCapped(res.body, 262_144, (soFar) => soFar.includes("</head>"));
      html = new TextDecoder().decode(bytes);
    } finally {
      clearTimeout(timeout);
    }

    const head = parseHeadMeta(html);
    const title = head.meta.get("og:title") ?? head.title ?? fallback.title;
    const description = head.meta.get("og:description") ?? head.meta.get("description") ?? null;
    let image = head.meta.get("og:image") ?? head.meta.get("twitter:image") ?? null;
    const siteName = head.meta.get("og:site_name") ?? fallback.siteName;

    // Resolve protocol-relative / relative image URLs against the target.
    if (image) {
      try { image = new URL(image, target).toString(); } catch { image = null; }
    }

    return jsonSuccess({
      url: target.toString(),
      title: title || fallback.title,
      description: description || null,
      image: image || null,
      favicon: fallback.favicon,
      siteName,
    });
  } catch {
    return jsonSuccess(fallback);
  }
}
