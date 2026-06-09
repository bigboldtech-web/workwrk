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

// Block SSRF to internal/private addresses. The unfurl is authenticated and
// best-effort, but an attacker could otherwise point it at the cloud metadata
// endpoint (169.254.169.254), loopback, or RFC-1918 hosts.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "::1" || h === "::") return true; // IPv6 loopback / unspecified
  if (/^fe80:/i.test(h) || /^f[cd][0-9a-f]{2}:/i.test(h)) return true; // link-local / unique-local
  const v4 = h.startsWith("::ffff:") ? h.slice(7) : h; // IPv4-mapped IPv6
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true;        // this-host / RFC1918 / loopback
    if (a === 169 && b === 254) return true;                  // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;         // RFC1918
    if (a === 192 && b === 168) return true;                  // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true;        // CGNAT
  }
  return false;
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

  if (isBlockedHost(target.hostname)) {
    return jsonError("URL host is not allowed", 400);
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
    // Follow redirects manually so each hop's host is re-validated — otherwise a
    // public URL could 30x-redirect into the private network (SSRF guard bypass).
    let current = target;
    let res: Response;
    for (let hop = 0; ; hop++) {
      res = await fetch(current.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          // Some sites gate OG tags behind a real UA.
          "user-agent": "Mozilla/5.0 (compatible; WorkwrKBot/1.0; +https://workwrk.app)",
          accept: "text/html,application/xhtml+xml",
        },
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) break;
      if (hop >= 3) { clearTimeout(timeout); return jsonSuccess(fallback); }
      let next: URL;
      try { next = new URL(location, current); } catch { clearTimeout(timeout); return jsonSuccess(fallback); }
      if ((next.protocol !== "http:" && next.protocol !== "https:") || isBlockedHost(next.hostname)) {
        clearTimeout(timeout);
        return jsonSuccess(fallback);
      }
      current = next;
    }
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
