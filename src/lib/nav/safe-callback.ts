// The one rule for where /login may send a person after they log in
// (spec-account-auth `/login` and the Session expired block, risk 6).
//
// `callbackUrl` arrives in the query string, so it is attacker controlled.
// It is honoured only when it is a same-origin path into the product:
//   - a single leading slash (never "//host" or "/\host", which browsers
//     read as another origin), no scheme, no control characters, no
//     backslashes anywhere;
//   - a first segment the app host serves (APP_SEGMENTS, which a vitest test
//     holds equal to src/proxy.ts APP_PREFIXES), the staff console (/admin)
//     or a shared token page (/share, /sign, /meet, /run);
//   - never a sign-in page itself (a loop through /login is worse than the
//     default), never /api, never a marketing page.
// Anything else falls back to WORK_HOME_HREF. Pure, so the login form, the
// tests and any server caller share it.

import { WORK_HOME_HREF } from "./route-hub";

/** The first path segments the app host serves. Kept equal to src/proxy.ts APP_PREFIXES by safe-callback.test.ts. */
export const APP_SEGMENTS: ReadonlySet<string> = new Set([
  "account", "activity", "agents", "agreements", "ai", "analytics", "announcements",
  "assets", "assigned-comments", "automation", "autopilot", "boards", "build",
  "calendar", "candor", "canvas", "clock", "dashboard", "dashboards", "docs", "everything",
  "favorites", "files", "folders", "forms", "home", "ideas", "imports", "inbox",
  "integrations", "item", "kra-kpi", "kudos", "library", "marketing", "me",
  "meetings", "my-work", "notetaker", "okrs", "organization", "people", "planner", "policies",
  "process-runs", "reviews", "settings", "sidekick", "sops", "spaces", "store",
  "surveys", "tables", "talent", "tasks", "team", "templates", "timesheets",
  "tlk", "today", "tools", "trash",
  "work",
  "login", "register", "signup", "join", "forgot-password", "reset-password", "verify-email",
  "welcome", "onboard", "setup",
]);

/** Sign-in pages that must never be a destination after logging in. /join is NOT here: it is where an invitee returns. */
const LOOP_SEGMENTS = new Set(["login", "register", "signup", "forgot-password", "reset-password", "verify-email", "welcome", "setup"]);

/** Allowed beyond the app host's own segments: the staff console and the shared token pages. */
const EXTRA_SEGMENTS = new Set(["admin", "share", "sign", "meet", "run"]);

export function safeCallbackUrl(raw: string | null | undefined, fallback: string = WORK_HOME_HREF): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // Backslashes and control characters are how "/\evil.com" and "/%09/evil"
  // tricks turn a path into another host in some browsers.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, "https://app.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "https://app.invalid") return fallback;
  const segment = url.pathname.split("/")[1] ?? "";
  if (!segment) return fallback;
  if (LOOP_SEGMENTS.has(segment)) return fallback;
  if (!APP_SEGMENTS.has(segment) && !EXTRA_SEGMENTS.has(segment)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
