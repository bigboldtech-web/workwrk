import { NextRequest, NextResponse } from "next/server";

/**
 * Host routing for WorkwrK's three surfaces:
 *
 * 1. **Admin host split** — `/admin` lives on its own hostname (`ADMIN_HOST`)
 *    so customers on the marketing/app hosts never see it. Off when unset.
 *
 * 2. **Marketing vs app split** — the marketing website lives on the apex
 *    (`MARKETING_HOST`, e.g. workwrk.com) and the actual product lives on the
 *    app host (`APP_HOST`, e.g. app.workwrk.com).
 *      - SOFT split (default): only the app host's root lands in the app; every
 *        other path resolves on either host.
 *      - HARD split (opt-in via `HARD_HOST_SPLIT=true`): a marketing page only
 *        answers on the marketing host and an app page only on the app host; a
 *        page that lands on the wrong host is redirected (308) to the right one,
 *        keeping the path and query. So workwrk.com/spaces/ceo redirects to
 *        app.workwrk.com/spaces/ceo, and app.workwrk.com/pricing back to
 *        workwrk.com/pricing.
 *
 * 3. **Custom domain → org resolution** (Enterprise white-label). Opt-in via
 *    `CUSTOM_DOMAINS_ENABLED`.
 *
 *    Config: APP_HOST, MARKETING_HOST, ADMIN_HOST, HARD_HOST_SPLIT,
 *    CUSTOM_DOMAINS_ENABLED. Runs in the Edge runtime (no Prisma here).
 */

const ADMIN_PATH_PREFIX = "/admin";

// Pages that belong to the MARKETING site (the apex host). First path segment.
const MARKETING_PREFIXES = new Set([
  "about", "blog", "changelog", "compare", "contact", "cookies", "customers",
  "demo", "developers", "do-not-sell", "faq", "features", "help-center",
  "industries", "partners", "pricing", "privacy", "security", "terms",
]);

// Pages that belong to the APP (the product host) — the (dashboard), (auth) and
// onboarding route segments. ONLY these redirect off the marketing host; an
// unknown path is NOT assumed to be an app route, so a typo / deleted page on
// workwrk.com shows the marketing 404 instead of being bounced to app.
const APP_PREFIXES = new Set([
  // (dashboard)
  "account", "activity", "agents", "agreements", "ai", "analytics", "announcements",
  "assets", "assigned-comments", "automation", "autopilot", "boards", "build",
  "calendar", "candor", "canvas", "clock", "dashboard", "docs", "everything",
  "favorites", "files", "folders", "forms", "ideas", "imports", "inbox",
  "integrations", "item", "kra-kpi", "kudos", "library", "marketing", "me",
  "meetings", "notetaker", "okrs", "organization", "people", "planner", "policies",
  "process-runs", "reviews", "settings", "sidekick", "sops", "spaces", "store",
  "surveys", "tables", "talent", "tasks", "team", "templates", "timesheets",
  "tlk", "today", "tools", "trash",
  // (auth) + onboarding
  "login", "register", "forgot-password", "reset-password", "verify-email",
  "welcome", "onboard", "setup",
]);

// Paths that must resolve on EITHER host and are never redirected: the API,
// public token links (share/sign/meet/run), embeds, and framework/SEO files.
const SHARED_PREFIXES = new Set([
  "api", "embed", "meet", "run", "share", "sign", "_next",
  "opengraph-image", "icon", "apple-icon", "twitter-image",
]);

// App pages a signed-OUT visitor must still reach (they ARE app routes, but the
// edge auth gate must never bounce them — that would trap a user on the way to
// signing in). Everything else under APP_PREFIXES needs a session.
const AUTH_PUBLIC_PREFIXES = new Set([
  "login", "register", "forgot-password", "reset-password", "verify-email",
]);
function isAuthPublicPath(path: string): boolean {
  return AUTH_PUBLIC_PREFIXES.has(firstSeg(path));
}

// Does the request carry a NextAuth session cookie? We check PRESENCE only —
// never decode, never touch the secret — so a genuinely signed-in browser
// (which always sends this cookie) can never be locked out by the edge gate.
// Covers both the secure-prefixed prod name and the plain dev name, plus the
// chunked `.0`/`.1` variants NextAuth uses for oversized tokens.
function hasSessionCookie(req: NextRequest): boolean {
  const bases = ["__Secure-next-auth.session-token", "next-auth.session-token"];
  for (const c of req.cookies.getAll()) {
    for (const b of bases) {
      if (c.name === b || c.name.startsWith(b + ".")) return true;
    }
  }
  return false;
}

function firstSeg(path: string): string {
  return path.split("/")[1] ?? "";
}
function isSharedPath(path: string): boolean {
  if (/\.[a-z0-9]+$/i.test(path)) return true; // any file: sitemap.xml, robots.txt, manifest, images
  return SHARED_PREFIXES.has(firstSeg(path));
}
function isMarketingPath(path: string): boolean {
  if (path === "/") return true;
  return MARKETING_PREFIXES.has(firstSeg(path));
}
function isAppPath(path: string): boolean {
  return APP_PREFIXES.has(firstSeg(path));
}

function hostMatches(reqHost: string, configured: string): boolean {
  // Strip port + protocol; compare case-insensitively.
  const norm = (s: string) => s.replace(/:\d+$/, "").toLowerCase();
  return norm(reqHost) === norm(configured);
}

// Cross-host redirect keeping the path + query, forced to https.
function redirectToHost(req: NextRequest, host: string) {
  const url = req.nextUrl.clone();
  url.protocol = "https:";
  url.host = host; // sets hostname and clears any inherited port
  url.port = "";
  return NextResponse.redirect(url, 308);
}

export function proxy(req: NextRequest) {
  const adminHost = process.env.ADMIN_HOST?.trim();
  const appHost = process.env.APP_HOST?.trim();
  const marketingHost = process.env.MARKETING_HOST?.trim();
  const reqHost = req.headers.get("host") || "";
  const path = req.nextUrl.pathname;
  const customDomainsEnabled = process.env.CUSTOM_DOMAINS_ENABLED === "true";
  const hardSplit = process.env.HARD_HOST_SPLIT === "true";

  // 1) Admin host split — opt-in via env.
  if (adminHost) {
    const onAdminHost = hostMatches(reqHost, adminHost);

    if (onAdminHost) {
      const allowed =
        path.startsWith(ADMIN_PATH_PREFIX) ||
        path.startsWith("/api/admin") ||
        path.startsWith("/api/auth") ||
        path === "/login" ||
        path.startsWith("/_next") ||
        path === "/favicon.ico";

      if (!allowed) {
        const url = req.nextUrl.clone();
        url.pathname = ADMIN_PATH_PREFIX;
        return NextResponse.redirect(url);
      }
      return NextResponse.next();
    }

    if (path.startsWith(ADMIN_PATH_PREFIX) || path.startsWith("/api/admin")) {
      const url = req.nextUrl.clone();
      url.pathname = "/404";
      return NextResponse.rewrite(url);
    }
  }

  // 2) HARD marketing/app split — opt-in via HARD_HOST_SPLIT. Never touches
  //    shared paths (API, public token links, embeds, files).
  if (hardSplit && appHost && marketingHost && !isSharedPath(path)) {
    const onMarketing = hostMatches(reqHost, marketingHost);
    const onApp = hostMatches(reqHost, appHost);

    // A KNOWN app route that landed on the marketing host → send it to the app
    // host. Unknown paths are left to the marketing host (its own 404), so a
    // typo or removed page never bounces the visitor into the app.
    if (onMarketing && isAppPath(path)) {
      return redirectToHost(req, appHost);
    }
    // A marketing route that landed on the app host → send it to marketing.
    // (Root "/" is left to the app-root redirect below.)
    if (onApp && path !== "/" && isMarketingPath(path)) {
      return redirectToHost(req, marketingHost);
    }
  }

  // 3) App host root lands in the app, not the marketing landing. Opt-in via APP_HOST.
  if (appHost && hostMatches(reqHost, appHost) && path === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/today";
    return NextResponse.redirect(url);
  }

  // 3.5) Edge auth gate — opt-in via AUTH_EDGE_GATE. Send an unauthenticated
  //      request for a protected app page straight to /login at the edge, BEFORE
  //      the app bundle ships and flashes a loader (the dashboard layout gates
  //      client-side today, so the whole shell loads first). Presence-only cookie
  //      check: a valid session always carries the cookie, so this can't lock a
  //      real user out; a stale/forged cookie slips past here but is still
  //      rejected by the session callback downstream (defense in depth).
  if (
    process.env.AUTH_EDGE_GATE === "true" &&
    isAppPath(path) &&
    !isAuthPublicPath(path) &&
    !hasSessionCookie(req)
  ) {
    const callbackUrl = path + (req.nextUrl.search || "");
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();

  // Authenticated app pages must never be cached: after logout, the browser's
  // Back button (bfcache/history) must not be able to re-show a dashboard the
  // person is no longer entitled to see. Marketing pages are unaffected.
  if (isAppPath(path)) {
    res.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  }

  // 4) Custom domain — stamp the request host into a header downstream code can
  //    read. Opt-in via CUSTOM_DOMAINS_ENABLED. Skip all of our OWN hosts.
  if (
    customDomainsEnabled &&
    reqHost &&
    (!appHost || !hostMatches(reqHost, appHost)) &&
    (!adminHost || !hostMatches(reqHost, adminHost)) &&
    (!marketingHost || !hostMatches(reqHost, marketingHost))
  ) {
    res.headers.set("x-workwrk-host", reqHost.split(":")[0].toLowerCase());
  }

  return res;
}

export const config = {
  // Run on every path except Next internal assets. The matcher must
  // exclude /_next and static files for performance.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|woff|woff2)$).*)"],
};
