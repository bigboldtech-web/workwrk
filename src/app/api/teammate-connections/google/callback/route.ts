// GET /api/teammate-connections/google/callback?code&state (or ?error&state)
//
// Where Google sends the person back (docs/plans/ai-teammates-phase3.md step
// 2). It answers only redirects to the Connections card: ?ai=connected (with
// ?ai_partial=<product> for each product Google did not grant, and
// ?ai_allows=cleared when another Google account ended the person's allows),
// or ?ai_error=<code>. The one registered redirect address
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
// Then saveConnection, which refuses, inside its own transaction, a workspace
// suspended or closed meanwhile (workspace_closed) and a product turned off
// meanwhile (workspace_off, review round 1 of Phase 3), and Google is told at
// once about an account this one replaced (the cron drains what fails).
// Every answer once the state matched clears the cookie.
//
// ONCE GOOGLE HAS ISSUED A GRANT, NOTHING IS LEFT BEHIND (review of step 2).
// Everything after the code exchange runs in one try: any way out that
// stores nothing (no access granted, a refusal, a throw such as a database
// timeout) revokes the new grant, unless another live connection holds the
// same account (Decision 19), clears the cookie and answers exchange_failed
// (or its own code) rather than a raw error.

import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { viewerFromSession } from "@/lib/access/viewer";
import { resolveActingPerson } from "@/lib/agents/acting";
import { connectDone, connectFailed, stateCookieOptions, STATE_COOKIE } from "@/lib/connectors/connect-redirects";
import { discardConnectGrant, revokeQueued, saveConnection, workspaceConnectorProducts } from "@/lib/connectors/connections";
import { googleConfig, googleRevokeConfig } from "@/lib/connectors/google/config";
import { exchangeCode, idTokenClaims, type GoogleTokens } from "@/lib/connectors/google/oauth";
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

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

/**
 * The grant this connect made and keeps nothing of, revoked at Google,
 * unless it is the very grant another live connection of the same account
 * still uses (Decision 19). Through the revoke settings alone
 * (googleRevokeConfig). Review round 1 of Phase 3: decided under the
 * account's lock, so a connect of the same account saving elsewhere at that
 * moment is never revoked, and queued with the account's key before it is
 * tried, so a revoke Google does not confirm is drained by the cron
 * (connections.ts discardConnectGrant).
 */
async function discardGrant(tokens: GoogleTokens, sub: string): Promise<void> {
  await discardConnectGrant(tokens.refreshToken ?? tokens.accessToken, sub);
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

  let claims: { sub: string; email: string } | null = null;
  let stored = false;
  try {
    claims = idTokenClaims(tokens.idToken ?? "");
    // Google named no account. Whether another live connection holds this
    // grant cannot be known, so it is not revoked: revoking a grant another
    // workspace's connection still uses would end that one in silence. Google
    // lists WorkwrK in that account until the person removes it there.
    if (!claims) return ended(connectFailed("exchange_failed"));

    // A product counts only when Google granted every one of its scopes
    // (Decision 4), and only one this connect asked for and the workspace allows.
    const granted = productsGranted(tokens.scope).filter((p) => allowed.includes(p));
    if (granted.length === 0) {
      await discardGrant(tokens, claims.sub);
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
      await discardGrant(tokens, claims.sub);
      return ended(connectFailed(saved.code));
    }
    // Stored: from here the new grant is a connection's, and is never revoked.
    stored = true;
    // The account this one replaced is told at once; what fails waits for the cron.
    const revoker = googleRevokeConfig();
    if (saved.queued.length > 0 && revoker) {
      await revokeQueued(saved.queued, revoker, { timeoutMs: 5_000, budgetMs: 5_000 }).catch(() => undefined);
    }
    // Another account ended the person's allows (review round 3 of Phase 3): the card says why its teammates ask again.
    return ended(connectDone(allowed.filter((p) => !granted.includes(p)), { allowsCleared: saved.allowsCleared > 0 }));
  } catch (err) {
    console.error(`[connectors] google callback failed: ${errorLine(err)}`);
    // Nothing stored and the account known: the grant goes, unless shared.
    // A failure to tell (the database still down) leaves it, since whether
    // it is shared cannot be known then.
    if (!stored && claims) {
      const sub = claims.sub;
      await discardGrant(tokens, sub).catch(() => undefined);
    }
    return ended(connectFailed("exchange_failed"));
  }
}
