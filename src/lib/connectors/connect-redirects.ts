// Where the two OAuth navigation routes send the browser
// (docs/plans/ai-teammates-phase3.md step 2): they cannot answer JSON, so
// every outcome is a redirect to the person's own card, carrying a code the
// page turns into a sentence (connection-views.ts teammateConnectSentence).
//
// ALWAYS THE CANONICAL APP HOST (src/lib/app-url.ts absoluteUrl). Under
// HARD_HOST_SPLIT the API answers on either host (src/proxy.ts
// SHARED_PREFIXES), but the session cookie, the state cookie and the one
// redirect address registered with Google live on the app host, so the start
// route moves a request that came in elsewhere there first, and every answer
// lands there.
//
// Server-only: reads the environment.

import { NextResponse } from "next/server";
import { absoluteUrl } from "@/lib/app-url";

/** The cookie that carries the state through Google and back. */
export const STATE_COOKIE = "wk_tc_state";

/** Its path: only the start and the callback routes ever see it. */
export const STATE_COOKIE_PATH = "/api/teammate-connections/google";

export const STATE_COOKIE_MAX_AGE_S = 600;

export function stateCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: STATE_COOKIE_PATH,
    maxAge,
  };
}

/** A redirect nobody may cache: each one is one person's answer, once. */
function redirect(url: string, status: 302 | 307 = 302): NextResponse {
  const res = NextResponse.redirect(url, status);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Back to the card with a reason: /account/connections?ai_error=<code>#ai-google. */
export function connectFailed(code: string): NextResponse {
  return redirect(absoluteUrl(`/account/connections?ai_error=${encodeURIComponent(code)}#ai-google`));
}

/** Back to the card, connected, naming each product Google did not grant. */
export function connectDone(partial: readonly string[]): NextResponse {
  const q = new URLSearchParams({ ai: "connected" });
  for (const p of partial) q.append("ai_partial", p);
  return redirect(absoluteUrl(`/account/connections?${q.toString()}#ai-google`));
}

/** Signed out at the start: sign in, then land on the card. */
export function toLogin(): NextResponse {
  return redirect(absoluteUrl("/login?callbackUrl=/account/connections"));
}

/** The canonical app host, as a Host header carries it ("app.workwrk.com", "localhost:3016"). */
export function canonicalHost(): string {
  return new URL(absoluteUrl("/")).host.toLowerCase();
}

/** The same request on the canonical host (307: the method and query kept). */
export function toCanonicalHost(pathAndQuery: string): NextResponse {
  return redirect(absoluteUrl(pathAndQuery), 307);
}

export { redirect as noStoreRedirect };
