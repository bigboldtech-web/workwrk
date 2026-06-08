import { NextRequest } from "next/server";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";

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

function attr(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

// Build OG/meta matchers tolerant of attribute ordering (content before or
// after the property/name attribute).
function metaPatterns(key: string, kind: "property" | "name"): RegExp[] {
  const k = key.replace(/[:]/g, "\\:");
  return [
    new RegExp(`<meta[^>]+${kind}=["']${k}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${kind}=["']${k}["']`, "i"),
  ];
}

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
    const res = await fetch(target.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Some sites gate OG tags behind a real UA.
        "user-agent": "Mozilla/5.0 (compatible; WorkwrKBot/1.0; +https://workwrk.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return jsonSuccess(fallback);

    // Only read the first ~256KB — meta tags live in <head>.
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      while (received < 262_144) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        html += decoder.decode(value, { stream: true });
        if (html.includes("</head>")) break;
      }
      await reader.cancel().catch(() => {});
    } else {
      html = await res.text();
    }

    const title =
      attr(html, metaPatterns("og:title", "property")) ??
      attr(html, [/<title[^>]*>([^<]*)<\/title>/i]) ??
      fallback.title;
    const description =
      attr(html, metaPatterns("og:description", "property")) ??
      attr(html, metaPatterns("description", "name"));
    let image = attr(html, metaPatterns("og:image", "property")) ?? attr(html, metaPatterns("twitter:image", "name"));
    const siteName = attr(html, metaPatterns("og:site_name", "property")) ?? fallback.siteName;

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
