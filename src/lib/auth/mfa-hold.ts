// The server gate for the workspace two step rule (settings.security.mfaRequired,
// read by src/lib/auth/security-policy.ts mfaRequiredFor).
//
// authorize() refuses a password sign-in that lacks the second factor, and the
// Google sign-in is refused outright while the rule covers the person. What is
// left is a session that already existed when the rule was switched on: the
// jwt revalidation stamps token.mfaHold, and src/proxy.ts answers every API
// call and page with the hold except the handful that let the person enrol,
// read their own record, list or disconnect their AI apps, and leave. So the
// rule holds whatever the client does
// (curl, a removed dialog), not only in the Security hold dialog.
//
// Pure; tested. Dormant until an org sets mfaRequired (nothing writes it
// before Workspace settings > Security exposes the editor).

/** API paths a held session may still call: exact matches. */
const OPEN_API_EXACT = new Set([
  "/api/boot",
  "/api/me",
  "/api/me/security-activity",
  "/api/me/switch-org",
  "/api/preferences",
]);

/** API prefixes a held session may still call (NextAuth itself and the MFA routes live here). */
const OPEN_API_PREFIX = ["/api/auth/"];

/**
 * API paths a held session may call by one method only. The person's own AI
 * apps (docs/plans/mcp-server.md 6.2, review of step 4, L4): listing them
 * (names only the person's own apps, the names their security activity
 * already shows under a hold) and Disconnect (only ever takes access away),
 * so the privacy policy's "disconnect it at any time" holds under a hold
 * too. Never their changes (/api/me/connected-apps/<id>/activity), which
 * name what an app touched. A held session is a person who signed in
 * before the workspace's rule, or whose password has since expired: either
 * way the hold asks for more before work, and while it lasts every app of
 * theirs is blocked as well (3.8 step 10), so nothing here reaches work.
 */
const OPEN_API_BY_METHOD: ReadonlyArray<{ path: RegExp; method: string }> = [
  { path: /^\/api\/me\/connected-apps$/, method: "GET" },
  { path: /^\/api\/me\/connected-apps\/[^/]+$/, method: "DELETE" },
];

/** Pages a held session may still open: where enrolment happens, the way out, and where the person disconnects an AI app (above). */
const OPEN_PAGE_PREFIX = ["/account/security", "/login", "/logout", "/account/connections"];

/** The page a held session is sent to. */
export const MFA_HOLD_PAGE = "/account/security?enrol=mfa";

function clean(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || path.startsWith(`${prefix}?`);
}

/** May a held session call this API path, by this method? Without a method, only the paths open to every method. */
export function mfaHoldAllowsApi(path: string, method?: string): boolean {
  const p = clean(path);
  if (OPEN_API_EXACT.has(p)) return true;
  if (OPEN_API_PREFIX.some((x) => p.startsWith(x))) return true;
  const m = (method ?? "").toUpperCase();
  return OPEN_API_BY_METHOD.some((o) => o.method === m && o.path.test(p));
}

/** May a held session open this page? */
export function mfaHoldAllowsPage(path: string): boolean {
  const p = clean(path);
  return OPEN_PAGE_PREFIX.some((x) => underPrefix(p, x));
}

/** The page an expired password is sent to (Workspace settings > Security > Password expires after). */
export const PASSWORD_HOLD_PAGE = "/account/security?change=1";

/** May a session whose password expired call this API path? Everything a held MFA session may, plus changing the password. */
export function passwordHoldAllowsApi(path: string, method?: string): boolean {
  const p = clean(path);
  return mfaHoldAllowsApi(p, method) || p === "/api/me/change-password";
}
