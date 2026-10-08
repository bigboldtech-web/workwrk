// GET /api/teammate-connections/google/callback?code&state (or ?error&state)
//
// Where Google sends the person back (docs/plans/ai-teammates-phase3.md step
// 2). It answers only redirects to the Connections card: ?ai=connected (with
// ?ai_partial=<product> for each product Google did not grant), or
// ?ai_error=<code>. The one registered redirect address
// (google/config.ts googleRedirectUri).
//
// THE STATE IS THE PERSON'S, USED ONCE (Decision 5). In order:
//   1. no state                                          state_invalid
//   2. the cookie is not this state (compared in constant time): a link
//      someone else made, so the state is not used and the cookie stays,
//      and the person's own connect can still finish      state_invalid
//   3. the state taken once (expired, used, never issued) state_invalid
//   4. Google's own refusal: nothing stored or audited   access_denied, exchange_failed
//   5. signed out meanwhile                              signed_out
//   6. signed in as someone else, or in another
//      workspace, since the connect began                wrong_person, workspace_changed
//   7. no longer someone a teammate can act for here    person_cannot
//   8. this WorkwrK, or the workspace, stopped offering
//      what was asked                                    not_configured, workspace_off
//   9. the code exchange, and the account it names       exchange_failed
//  10. Google granted none of it: the new grant revoked
//      unless another live connection holds the account no_access
// Then saveConnection, and Google is told at once about an account this one
// replaced (the cron drains what fails). Every answer once the state matched
// clears the cookie.

import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { viewerFromSession } from "@/lib/access/viewer";
import { resolveActingPerson } from "@/lib/agents/acting";
import { connectDone, connectFailed, stateCookieOptions, STATE_COOKIE } from "@/lib/connectors/connect-redirects";
import { accountHeld, revokeQueued, saveConnection, workspaceConnectorProducts } from "@/lib/connectors/connections";
import { googleConfig } from "@/lib/connectors/google/config";
import { exchangeCode, idTokenClaims, revokeToken } from "@/lib/connectors/google/oauth";
import { consumeState } from "@/lib/connectors/oauth-state";
import { productsGranted } from "@/lib/connectors/products";

/** Two secrets compared in constant time (their hashes, so the lengths always match). */
function sameSecret(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return a.length > 0 && b.length > 0 && timingSafeEqual(x, y);
}

/** The flow is over: the cookie goes with the answer. */
function ended(res: NextResponse): NextResponse {
  res.cookies.set(STATE_COOKIE, "", stateCookieOptions(0));
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  if (!state) return connectFailed("state_invalid");
  const cookie = req.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!sameSecret(cookie, state)) return connectFailed("state_invalid");

  const row = await consumeState(state);
  if (!row) return ended(connectFailed("state_invalid"));

  const googleError = url.searchParams.get("error");
  if (googleError) return ended(connectFailed(googleError === "access_denied" ? "access_denied" : "exchange_failed"));
  const code = url.searchParams.get("code") ?? "";
  if (!code || code.length > 2048) return ended(connectFailed("exchange_failed"));

  // Who is signed in now, against who began this connect, where.
  const viewer = await viewerFromSession();
  if (!viewer) return ended(connectFailed("signed_out"));
  if (viewer.userId !== row.userId) return ended(connectFailed("wrong_person"));
  if (viewer.organizationId !== row.organizationId) return ended(connectFailed("workspace_changed"));
  const acting = await resolveActingPerson(row.organizationId, row.userId);
  if (!acting.ok) return ended(connectFailed("person_cannot"));

  const cfg = googleConfig();
  if (!cfg) return ended(connectFailed("not_configured"));
  const on = await workspaceConnectorProducts(row.organizationId);
  const allowed = row.products.filter((p) => on[p]);
  if (allowed.length === 0) return ended(connectFailed("workspace_off"));

  const exchanged = await exchangeCode(cfg, code, row.verifier);
  if (!exchanged.ok) return ended(connectFailed("exchange_failed"));
  const tokens = exchanged.tokens;
  const claims = idTokenClaims(tokens.idToken ?? "");
  if (!claims) return ended(connectFailed("exchange_failed"));

  // A product counts only when Google granted every one of its scopes
  // (Decision 4), and only one this connect asked for and the workspace allows.
  const granted = productsGranted(tokens.scope).filter((p) => allowed.includes(p));
  if (granted.length === 0) {
    // Nothing to keep, so the grant just made is revoked, unless it is the
    // very grant another live connection still uses (Decision 19).
    if (!(await accountHeld(claims.sub))) await revokeToken(cfg, tokens.refreshToken ?? tokens.accessToken);
    return ended(connectFailed("no_access"));
  }

  const saved = await saveConnection({
    organizationId: row.organizationId,
    userId: row.userId,
    tokens,
    claims,
    products: granted,
    scopes: tokens.scope.split(/\s+/).filter(Boolean).slice(0, 50),
  });
  if (!saved.ok) {
    if (!(await accountHeld(claims.sub))) await revokeToken(cfg, tokens.refreshToken ?? tokens.accessToken);
    return ended(connectFailed(saved.code));
  }
  // The account this one replaced is told at once; what fails waits for the cron.
  if (saved.queued.length > 0) {
    await revokeQueued(saved.queued, cfg, { timeoutMs: 5_000, budgetMs: 5_000 }).catch(() => undefined);
  }
  return ended(connectDone(allowed.filter((p) => !granted.includes(p))));
}
