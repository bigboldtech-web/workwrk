/**
 * Cross-site request forgery guard for every app API write (pen test
 * 2026-11-28, V-22). The staff console has had one since 2026-10
 * (src/lib/admin/staff-write-origin.ts); the rest of /api had none.
 *
 * The session cookie is shared across workwrk.com subdomains in production
 * (COOKIE_DOMAIN=.workwrk.com) with SameSite=Lax, and Lax treats every
 * *.workwrk.com page as the same site as the app: a text/plain form post or
 * a no-cors fetch from the marketing site, a hosted docs site or a taken-over
 * subdomain arrived with the person's cookie, and the handlers read its body
 * as JSON whatever its type. A cookie-carrying write is now accepted only
 * when:
 *   - the browser does not call it cross-origin (Sec-Fetch-Site, when sent,
 *     is "same-origin"; "same-site" is exactly the case above);
 *   - an Origin header, when sent, names this very host.
 * Not refused:
 *   - a read (GET, HEAD, OPTIONS);
 *   - a request without the session cookie: nothing of anyone's rides on it
 *     (a cross-SITE post never carries a Lax cookie, so an identity
 *     provider's POST back, an embedded form or a webhook sender passes);
 *   - a request with neither header: not a browser page (an API client, an
 *     MCP or SCIM client, cron, curl), which cannot carry a victim's cookie;
 *   - the WorkwrK browser extension (an Origin of chrome-extension:// or
 *     moz-extension://, which no web page can send), which records SOPs with
 *     the person's cookie;
 *   - the staff console, which has its own stricter guard in the proxy.
 * NO OTHER PATH IS EXEMPT (the step 4 review, high): v1, MCP, SCIM, OAuth
 * and the auth routes all also take the session cookie where it is sent
 * (v1 gives an Owner or Admin every scope on it; /api/auth/mfa/enroll sets a
 * person's second factor), so an exemption was a forgery door, and nothing
 * legitimate needs one: our own pages are same-origin, and everything else
 * is either not a browser or carries no Lax cookie.
 * A request with neither header is not from a browser page (curl, a script)
 * and goes on to the route's own gate.
 *
 * Pure: takes the method, the path, the headers and whether the session
 * cookie came, so it runs in the proxy and in tests.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The staff console: its own, stricter guard in the proxy. */
const isStaffConsole = (path: string) => path === "/api/admin" || path.startsWith("/api/admin/");

export const APP_WRITE_ORIGIN_REFUSAL = "This request did not come from WorkwrK. Reload the page and try again.";

function isExtensionOrigin(origin: string): boolean {
  return origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");
}

export function appWriteOriginRefused(args: { method: string; path: string; headers: Headers; hasSessionCookie: boolean }): boolean {
  if (SAFE_METHODS.has(args.method.toUpperCase())) return false;
  if (!args.path.startsWith("/api/")) return false;
  if (!args.hasSessionCookie) return false;
  if (isStaffConsole(args.path)) return false;

  const origin = args.headers.get("origin");
  if (origin && isExtensionOrigin(origin)) return false;

  const fetchSite = args.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return true;

  if (origin) {
    if (origin === "null") return true;
    const host = (args.headers.get("host") || "").trim().toLowerCase();
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return true;
    }
    if (!host || originHost !== host) return true;
  }
  return false;
}
