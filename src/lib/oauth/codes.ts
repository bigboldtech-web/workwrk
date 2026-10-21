// The authorization code grant (docs/plans/mcp-server.md Decision 6, 3.5, M2).
//
// CHECK FIRST, CLAIM LAST. Every check runs before the code is claimed, so a
// thief who holds a code but not its verifier, or sends it to the wrong
// redirect or resource, burns nothing: the code stays unused and the real
// app's exchange then works. Refused, with nothing claimed or revoked:
//   - a missing, expired or malformed code (invalid_grant);
//   - another client's code (invalid_grant);
//   - a redirect_uri other than the one the code was issued for (an absent
//     one counts only when the client registered exactly that one);
//   - a wrong or malformed PKCE verifier (S256);
//   - a code of an older family than the grant's (a re-consent made a new
//     family; its codes and tokens are the only ones that count);
//   - a resource other than MCP_RESOURCE (invalid_target).
// Then the grant must stand (3.8 steps 3 to 10). Then the claim: a guarded
// update on `usedAt IS NULL`. A code already used, or a claim lost to a
// concurrent exchange, is REUSE only now, when the exchange was otherwise
// right: the family and the grant are revoked (code_reuse) with the audit row.
//
// The claim and the mint are one transaction, so a reuse revocation that
// waits on the claim's row always sees, and revokes, what the winner minted.
// The token scopes are the grant's.
//
// LIMITS. The client's own bucket (60 a minute) is counted only once its
// code is found: a public client's id is no secret, so counting junk codes
// against it would let anyone hold its exchanges at 429 (review of step 1).
// A code that is not found, or is another client's, is counted by address.
//
// Server-only.

import { isOurResource } from "@/lib/mcp/config";
import { prisma } from "@/lib/prisma";
import type { ClientRow } from "./clients";
import { enforceStanding } from "./eligibility";
import { reuseDetected } from "./grants";
import { verifyPkce } from "./pkce";
import { mintTokens, tokenAnswer, type LimitAnswer, type TokenOutcome } from "./refresh";
import { hashSecret, isWellFormed } from "./tokens";

const GRANT_SELECT = {
  id: true, clientId: true, organizationId: true, userId: true, appName: true, redirectHost: true, familyId: true, tokenVersion: true,
  authorizedAt: true, endsBy: true, revokedAt: true, scopes: true,
} as const;

/** The code grant (see the file header). The caller authenticated the client. */
export async function exchangeCode(
  client: ClientRow,
  form: URLSearchParams,
  opts: { now?: Date; clientLimit: (clientId: string) => LimitAnswer; anonLimit: () => LimitAnswer },
): Promise<TokenOutcome> {
  const now = opts.now ?? new Date();
  const presented = form.get("code");
  if (!isWellFormed("code", presented)) return { ok: false, error: "invalid_grant" };
  const id = hashSecret(presented);
  const code = await prisma.oAuthAuthorizationCode.findUnique({
    where: { id },
    select: { id: true, grantId: true, clientId: true, redirectUri: true, codeChallenge: true, resource: true, familyId: true, expiresAt: true, usedAt: true },
  });
  if (!code || code.clientId !== client.id) {
    const anon = opts.anonLimit();
    if (!anon.ok) return { ok: false, error: "too_many", retryAfter: anon.retryAfter };
    return { ok: false, error: "invalid_grant" };
  }
  const limit = opts.clientLimit(client.id);
  if (!limit.ok) return { ok: false, error: "too_many", retryAfter: limit.retryAfter };
  if (code.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "invalid_grant" };
  const redirectUri = form.get("redirect_uri");
  if (redirectUri !== null ? redirectUri !== code.redirectUri : !(client.redirectUris.length === 1 && client.redirectUris[0] === code.redirectUri)) {
    return { ok: false, error: "invalid_grant" };
  }
  if (!verifyPkce(form.get("code_verifier"), code.codeChallenge)) return { ok: false, error: "invalid_grant" };
  const resource = form.get("resource");
  if (resource !== null && !isOurResource(resource)) return { ok: false, error: "invalid_target" };
  if (!isOurResource(code.resource)) return { ok: false, error: "invalid_target" };
  const grant = await prisma.oAuthGrant.findUnique({ where: { id: code.grantId }, select: GRANT_SELECT });
  if (!grant || grant.clientId !== client.id || code.familyId !== grant.familyId) return { ok: false, error: "invalid_grant" };

  // Everything else was right: a used code now is a second exchange.
  if (code.usedAt) {
    await reuseDetected(grant, "code");
    return { ok: false, error: "invalid_grant" };
  }

  const standing = await enforceStanding(grant, { id: client.id, disabledAt: client.disabledAt }, now);
  if (!standing.ok) return { ok: false, error: "invalid_grant" };

  const minted = await prisma.$transaction(async (tx) => {
    const claimed = await tx.oAuthAuthorizationCode.updateMany({ where: { id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count !== 1) return "reuse" as const;
    return mintTokens(tx, {
      grantId: grant.id,
      familyId: grant.familyId,
      scopes: grant.scopes,
      endsBy: grant.endsBy,
      withRefresh: client.grantTypes.includes("refresh_token"),
      parentId: null,
      now,
    });
  });
  if (minted === "reuse") {
    await reuseDetected(grant, "code");
    return { ok: false, error: "invalid_grant" };
  }
  return { ok: true, body: tokenAnswer(minted, grant.scopes) };
}
