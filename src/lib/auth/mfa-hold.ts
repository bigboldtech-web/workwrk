// The server gate for the workspace two step rule (settings.security.mfaRequired,
// read by src/lib/auth/security-policy.ts mfaRequiredFor).
//
// authorize() refuses a password sign-in that lacks the second factor, and the
// Google sign-in is refused outright while the rule covers the person. What is
// left is a session that already existed when the rule was switched on: the
// jwt revalidation stamps token.mfaHold, and src/proxy.ts answers every API
// call and page with the hold except the handful that let the person enrol,
// read their own record and leave. So the rule holds whatever the client does
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

/** Pages a held session may still open: where enrolment happens, and the way out. */
const OPEN_PAGE_PREFIX = ["/account/security", "/login", "/logout"];

/** The page a held session is sent to. */
export const MFA_HOLD_PAGE = "/account/security?enrol=mfa";

function clean(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || path.startsWith(`${prefix}?`);
}

/** May a held session call this API path? */
export function mfaHoldAllowsApi(path: string): boolean {
  const p = clean(path);
  if (OPEN_API_EXACT.has(p)) return true;
  return OPEN_API_PREFIX.some((x) => p.startsWith(x));
}

/** May a held session open this page? */
export function mfaHoldAllowsPage(path: string): boolean {
  const p = clean(path);
  return OPEN_PAGE_PREFIX.some((x) => underPrefix(p, x));
}

/** The page an expired password is sent to (Workspace settings > Security > Password expires after). */
export const PASSWORD_HOLD_PAGE = "/account/security?change=1";

/** May a session whose password expired call this API path? Everything a held MFA session may, plus changing the password. */
export function passwordHoldAllowsApi(path: string): boolean {
  const p = clean(path);
  return mfaHoldAllowsApi(p) || p === "/api/me/change-password";
}
