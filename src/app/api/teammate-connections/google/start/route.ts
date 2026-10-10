// GET /api/teammate-connections/google/start?products=gmail,calendar&ws=<organizationId>
//
// Begins connecting the signed-in person's own Google account to their AI
// teammates in this workspace (docs/plans/ai-teammates-phase3.md step 2). A
// real navigation from the Connections card, never a fetch: it answers a
// redirect to Google, or back to the card with ?ai_error=<code>.
//
// In order, each refusal its own code:
//   1. this WorkwrK offers no Google                       not_configured
//   2. another host: the same request on the app host first (the state
//      cookie, the session and the registered redirect address live there)
//   3. the AI app (signed out goes to sign in)              person_cannot
//   4. the workspace the card showed (ws) is the session's  workspace_changed
//   5. someone a teammate can act for here (not a Guest, not an agent
//      account, not gone; resolveActingPerson, Decision 27) person_cannot
//   6. ten starts in ten minutes                            rate_limited
//   7. the products asked, plus what the connection already has (a
//      reconnect keeps it), within what the workspace has on
//                                                           workspace_off, bad_products
// Then a PKCE pair and a state (only its hash stored, the verifier sealed),
// and the redirect to Google with the state in an HttpOnly cookie that only
// these two routes ever see.
//
// THE WORKSPACE THE CARD SHOWED (review round 2 of Phase 3), as the four
// change routes since review round 1: Connect, Reconnect and Add name it
// (ws), and a session switched to another workspace in another tab connects
// nothing there. Without it, Reconnect on a card showing workspace A made a
// connection in B with A's products, B's private teammates with Google tools
// began reading the mail there, and A stayed broken. A link that names no
// workspace (a page loaded before this release) is refused the same way, so
// the card reloads rather than connect whichever workspace the session holds.

import { type NextRequest } from "next/server";
import { resolveActingPerson } from "@/lib/agents/acting";
import { requireApp } from "@/lib/app-gate";
import { canonicalHost, connectFailed, noStoreRedirect, stateCookieOptions, STATE_COOKIE, STATE_COOKIE_MAX_AGE_S, toCanonicalHost, toLogin } from "@/lib/connectors/connect-redirects";
import { connectionFor, workspaceConnectorProducts } from "@/lib/connectors/connections";
import { googleConfig } from "@/lib/connectors/google/config";
import { authUrl, newPkce } from "@/lib/connectors/google/oauth";
import { createState } from "@/lib/connectors/oauth-state";
import { CONNECTOR_PRODUCTS, parseProducts, scopesFor } from "@/lib/connectors/products";
import { rateLimit } from "@/lib/rate-limit-memory";

/** Starts one person may make in the window: enough for a slow Google, too few to hammer it. */
const STARTS = { max: 10, windowMs: 10 * 60 * 1000 } as const;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const cfg = googleConfig();
  if (!cfg) return connectFailed("not_configured");

  // One hop at most: a proxy that rewrites the Host header can never loop it.
  const host = (req.headers.get("host") ?? url.host).toLowerCase();
  if (host && host !== canonicalHost() && url.searchParams.get("hop") !== "1") {
    const q = new URLSearchParams(url.searchParams);
    q.set("hop", "1");
    return toCanonicalHost(`${url.pathname}?${q.toString()}`);
  }

  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error.status === 401 ? toLogin() : connectFailed("person_cannot");
  const viewer = gate.viewer;
  // Before anything is read or stored (see the file header).
  if (url.searchParams.get("ws") !== viewer.organizationId) return connectFailed("workspace_changed");
  const acting = await resolveActingPerson(viewer.organizationId, viewer.userId);
  if (!acting.ok) return connectFailed("person_cannot");
  const person = acting.person;

  if (!rateLimit(`teammate-connect:${person.userId}`, STARTS).ok) return connectFailed("rate_limited");

  const asked = parseProducts(url.searchParams.get("products") ?? "");
  const [connection, on] = await Promise.all([connectionFor(person), workspaceConnectorProducts(person.organizationId)]);
  const wanted = CONNECTOR_PRODUCTS.filter((p) => (asked.includes(p) || (connection?.products ?? []).includes(p)) && on[p]);
  if (wanted.length === 0) return connectFailed(on.gmail || on.calendar ? "bad_products" : "workspace_off");

  const { verifier, challenge } = newPkce();
  const { state } = await createState({ organizationId: person.organizationId, userId: person.userId, products: wanted, verifier });
  const res = noStoreRedirect(authUrl(cfg, { state, challenge, scopes: scopesFor(wanted), loginHint: connection?.accountEmail ?? null }));
  res.cookies.set(STATE_COOKIE, state, stateCookieOptions(STATE_COOKIE_MAX_AGE_S));
  return res;
}
