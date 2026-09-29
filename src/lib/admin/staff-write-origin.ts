/**
 * Cross-site request forgery guard for Staff console writes (/api/admin/*).
 *
 * The session cookie is shared across workwrk.com subdomains in production
 * (COOKIE_DOMAIN=.workwrk.com), so SameSite=Lax treats app.workwrk.com and
 * workwrk.com as the same site as the console. A text/plain form post or a
 * no-cors fetch from any of them would otherwise arrive with a staff
 * member's cookie. A write is accepted only when:
 *   - the browser does not call it cross-origin (Sec-Fetch-Site, when sent,
 *     is same-origin; "same-site" is exactly the case above and is refused),
 *   - an Origin header, when sent, names this very host,
 *   - a body, when it has a type, is JSON (the console never sends anything
 *     else, and a browser cannot send JSON cross-origin without a preflight).
 * A request with none of these headers is not from a browser page (curl, a
 * script), which cannot carry a victim's cookie, so it goes on to the staff
 * gate like any other request.
 *
 * Pure: takes the method and headers so it runs in the proxy and in tests.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const STAFF_WRITE_ORIGIN_REFUSAL = "This request did not come from the Staff console.";

function hostOnly(value: string): string {
  return value.trim().toLowerCase();
}

export function staffWriteOriginRefused(method: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return true;

  const origin = headers.get("origin");
  if (origin) {
    if (origin === "null") return true;
    const host = headers.get("host") || "";
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return true;
    }
    if (!host || hostOnly(originHost) !== hostOnly(host)) return true;
  }

  const type = headers.get("content-type");
  if (type && !type.toLowerCase().startsWith("application/json")) return true;

  return false;
}
