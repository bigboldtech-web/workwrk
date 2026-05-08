import { NextRequest, NextResponse } from "next/server";

/**
 * Two routing concerns rolled into one proxy:
 *
 * 1. **Admin host split** — `/admin` lives on its own hostname
 *    (`admin.workwrk.com`) so customers on workwrk.com never even
 *    see it. Off when `ADMIN_HOST` env var is unset (so dev /
 *    preview environments don't break).
 *
 * 2. **Custom domain → org resolution** (Enterprise white-label
 *    Phase W2). When a request arrives on a hostname that's not
 *    the canonical `workwrk.com` and not the admin host, we look
 *    up the matching `Organization.domain` and stamp the org id
 *    into a request header so downstream auth + branding can use
 *    it without re-querying.
 *
 *    Configuration:
 *      APP_HOST         = "workwrk.com"        (canonical app host)
 *      ADMIN_HOST       = "admin.workwrk.com"  (staff panel)
 *      CUSTOM_DOMAINS_ENABLED = "true"         (off by default)
 *
 *    Implementation note: this proxy runs in the Edge runtime,
 *    where Prisma can't be loaded. We resolve the org via a tiny
 *    `/api/internal/resolve-domain` endpoint that runs in the
 *    Node runtime — proxy just sets the header from a cached
 *    value. For now we pass through the host header and leave
 *    deeper resolution to the auth layer.
 */

const ADMIN_PATH_PREFIX = "/admin";

function hostMatches(reqHost: string, configured: string): boolean {
  // Strip port + protocol; compare case-insensitively.
  const norm = (s: string) => s.replace(/:\d+$/, "").toLowerCase();
  return norm(reqHost) === norm(configured);
}

export function proxy(req: NextRequest) {
  const adminHost = process.env.ADMIN_HOST?.trim();
  const appHost = process.env.APP_HOST?.trim();
  const reqHost = req.headers.get("host") || "";
  const path = req.nextUrl.pathname;
  const customDomainsEnabled = process.env.CUSTOM_DOMAINS_ENABLED === "true";

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

  // 2) Custom domain — stamp the request host into a header that
  //    downstream code can read. Opt-in via CUSTOM_DOMAINS_ENABLED.
  //    Skip for the canonical app host (no resolution needed) and
  //    the admin host (handled above).
  if (
    customDomainsEnabled &&
    reqHost &&
    (!appHost || !hostMatches(reqHost, appHost)) &&
    (!adminHost || !hostMatches(reqHost, adminHost))
  ) {
    const res = NextResponse.next();
    res.headers.set("x-workwrk-host", reqHost.split(":")[0].toLowerCase());
    return res;
  }

  return NextResponse.next();
}

export const config = {
  // Run on every path except Next internal assets. The matcher must
  // exclude /_next and static files for performance.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|woff|woff2)$).*)"],
};
