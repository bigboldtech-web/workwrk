// Access and refresh tokens: minting, and the refresh grant
// (docs/plans/mcp-server.md Decision 6, 3.5, 3.7).
//
// Access tokens live 1 hour; refresh tokens rotate, live 30 days unused and
// never past the grant's endsBy. Every token is bound to MCP_RESOURCE
// (RFC 8707).
//
// A USED REFRESH TOKEN IS KEPT, as a tombstone, until its own expiresAt (the
// sweep deletes it a day after). Rotation once deleted every refresh row of
// the family but the newest and its parent, so a thief who rotated twice
// erased the evidence: the real app's old token then answered a silent
// invalid_grant, with no reuse detected, nothing revoked, no audit row and no
// notice, and the thief kept the connection (review of step 1, M1). The
// tombstone is the row as it was, with usedAt set: the reuse check stays the
// one lookup by hash it always was, it needs no table or SQL of its own, and
// it lives exactly as long as the token it stands for could have been
// presented. A family therefore holds at most ONE unused refresh row, plus
// one tombstone per rotation in the last 30 days.
//
// THE REFRESH GRANT, checks first and the claim last (the code grant's rule,
// M2, applied here too, so a refused scope or resource never burns the
// token and a retry never reads as theft):
//   1. the client registered refresh_token, else unauthorized_client;
//   2. the token: a refresh token of this client and the grant's current
//      family, unrevoked and unexpired, else invalid_grant;
//   3. already used: within 10 seconds, invalid_grant only (a retry of a
//      lost answer); later, reuse revokes the family and the grant
//      (reuse_detected), with a critical audit row and an Inbox notice;
//   4. a wider scope is invalid_scope, a wrong resource invalid_target; a
//      narrower scope narrows the new access token only, and the new
//      refresh token keeps the scope of the one presented (RFC 6749 6);
//   5. endsBy recomputed with the workspace's connection life now (its
//      stored session lifetime, else 30 days: grantLifetimeDaysOf); past it
//      the grant is revoked `expired`; then 3.8 steps 3 to 10;
//   6. under the grant's row lock: claim it (it becomes the tombstone), mint
//      the new pair (parentId the old one) and drop the family's expired
//      access tokens, in one transaction.
// A refresh token that is not found, or is another client's, is counted by
// address (the caller's anonLimit): only a holder of one of the family's
// tokens can spend the family's own bucket.
//
// Server-only.

import type { Prisma } from "@/generated/prisma";
import { MCP_RESOURCE, isOurResource } from "@/lib/mcp/config";
import { prisma } from "@/lib/prisma";
import type { ClientRow } from "./clients";
import { STANDING_GRANT_SELECT, enforceStanding } from "./eligibility";
import { reuseDetected, revokeAsJudged } from "./grants";
import type { McpScope } from "./metadata";
import { hashSecret, isWellFormed, newSecret } from "./tokens";

export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 86_400_000;
export const REUSE_GRACE_MS = 10_000;
const DAY_MS = 86_400_000;

export type TokenAnswer = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

export type TokenError = "invalid_request" | "invalid_grant" | "unauthorized_client" | "invalid_scope" | "invalid_target";

export type TokenOutcome =
  | { ok: true; body: TokenAnswer }
  | { ok: false; error: TokenError }
  | { ok: false; error: "too_many"; retryAfter: number };

type Tx = Prisma.TransactionClient;

/** A rate limit's answer (src/lib/oauth/limits.ts). */
export type LimitAnswer = { ok: boolean; retryAfter: number };

/**
 * Mint an access token and, when asked, a refresh token, for one grant's
 * family. The refresh token carries `refreshScopes` when given (a narrowed
 * refresh keeps the presented token's scope, RFC 6749 6), else `scopes`.
 */
export async function mintTokens(
  tx: Tx,
  a: { grantId: string; familyId: string; scopes: readonly string[]; refreshScopes?: readonly string[]; endsBy: Date; withRefresh: boolean; parentId: string | null; now: Date },
): Promise<{ access: string; refresh: string | null; refreshId: string | null; expiresIn: number }> {
  const resource = MCP_RESOURCE();
  const access = newSecret("access");
  const accessUntil = Math.min(a.now.getTime() + ACCESS_TTL_MS, a.endsBy.getTime());
  await tx.oAuthToken.create({
    data: { id: hashSecret(access), grantId: a.grantId, kind: "access", familyId: a.familyId, parentId: null, scopes: [...a.scopes], resource, expiresAt: new Date(accessUntil), createdAt: a.now },
  });
  let refresh: string | null = null;
  let refreshId: string | null = null;
  if (a.withRefresh) {
    refresh = newSecret("refresh");
    refreshId = hashSecret(refresh);
    const refreshUntil = Math.min(a.now.getTime() + REFRESH_TTL_MS, a.endsBy.getTime());
    await tx.oAuthToken.create({
      data: { id: refreshId, grantId: a.grantId, kind: "refresh", familyId: a.familyId, parentId: a.parentId, scopes: [...(a.refreshScopes ?? a.scopes)], resource, expiresAt: new Date(refreshUntil), createdAt: a.now },
    });
  }
  return { access, refresh, refreshId, expiresIn: Math.max(1, Math.floor((accessUntil - a.now.getTime()) / 1000)) };
}

/** The token answer (3.5). */
export function tokenAnswer(m: { access: string; refresh: string | null; expiresIn: number }, scopes: readonly string[]): TokenAnswer {
  return {
    access_token: m.access,
    token_type: "Bearer",
    expires_in: m.expiresIn,
    ...(m.refresh ? { refresh_token: m.refresh } : {}),
    scope: [...scopes].join(" "),
  };
}

/** A `scope` parameter on a refresh: null when absent; "wider" when it asks for more than the token holds; else the narrower set. */
export function narrowedScopes(raw: string | null, held: readonly string[]): McpScope[] | null | "wider" {
  if (raw === null) return null;
  const asked = [...new Set(raw.split(/\s+/).filter(Boolean))];
  if (asked.length === 0) return null;
  if (!asked.every((s) => held.includes(s))) return "wider";
  const set = new Set(asked);
  if (set.has("mcp:write")) set.add("mcp:read");
  if (!set.has("mcp:read")) return "wider";
  return (["mcp:read", "mcp:write"] as const).filter((s) => set.has(s));
}


/** The refresh grant (see the file header). The caller authenticated the client and counted the request. */
export async function exchangeRefresh(
  client: ClientRow,
  form: URLSearchParams,
  opts: { now?: Date; familyLimit: (familyId: string) => LimitAnswer; anonLimit: () => LimitAnswer },
): Promise<TokenOutcome> {
  const now = opts.now ?? new Date();
  if (!client.grantTypes.includes("refresh_token")) return { ok: false, error: "unauthorized_client" };
  const presented = form.get("refresh_token");
  if (!isWellFormed("refresh", presented)) return { ok: false, error: "invalid_grant" };
  const id = hashSecret(presented);
  const token = await prisma.oAuthToken.findUnique({ where: { id }, select: { id: true, grantId: true, kind: true, familyId: true, scopes: true, expiresAt: true, usedAt: true, revokedAt: true } });
  const grant = token && token.kind === "refresh" ? await prisma.oAuthGrant.findUnique({ where: { id: token.grantId }, select: STANDING_GRANT_SELECT }) : null;
  if (!token || !grant || grant.clientId !== client.id) {
    // Nobody's token of this client: counted by address, never by a family.
    const anon = opts.anonLimit();
    if (!anon.ok) return { ok: false, error: "too_many", retryAfter: anon.retryAfter };
    return { ok: false, error: "invalid_grant" };
  }
  const limit = opts.familyLimit(token.familyId);
  if (!limit.ok) return { ok: false, error: "too_many", retryAfter: limit.retryAfter };
  if (grant.revokedAt || token.revokedAt || token.expiresAt.getTime() <= now.getTime() || token.familyId !== grant.familyId) return { ok: false, error: "invalid_grant" };

  if (token.usedAt) {
    if (now.getTime() - token.usedAt.getTime() > REUSE_GRACE_MS) await reuseDetected(grant, "refresh");
    return { ok: false, error: "invalid_grant" };
  }

  const scopes = narrowedScopes(form.get("scope"), token.scopes);
  if (scopes === "wider") return { ok: false, error: "invalid_scope" };
  const resource = form.get("resource");
  if (resource !== null && !isOurResource(resource)) return { ok: false, error: "invalid_target" };

  const standing = await enforceStanding(grant, { id: client.id, disabledAt: client.disabledAt }, now);
  if (!standing.ok) return { ok: false, error: "invalid_grant" };
  // The connection's cap with the workspace's rule as it is now, from the
  // grant as it was judged; ended only as judged (review of step 4, M2), so
  // a reconnect a moment ago, with its own consent time, is never ended by it.
  const judged = standing.grant;
  const endsBy = new Date(judged.authorizedAt.getTime() + Math.max(1, standing.grantMaxDays) * DAY_MS);
  if (now.getTime() >= endsBy.getTime()) {
    await revokeAsJudged(judged, "expired", now);
    return { ok: false, error: "invalid_grant" };
  }
  // The new access token's scope: narrowed when asked. The new refresh token's: the presented one's (RFC 6749 6).
  const keep = scopes ?? (token.scopes as McpScope[]);

  const minted = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "OAuthGrant" WHERE "id" = ${grant.id} FOR UPDATE`;
    const fresh = await tx.oAuthGrant.findUnique({ where: { id: grant.id }, select: { revokedAt: true, familyId: true } });
    if (!fresh || fresh.revokedAt || fresh.familyId !== token.familyId) return null;
    const claimed = await tx.oAuthToken.updateMany({ where: { id, usedAt: null, revokedAt: null }, data: { usedAt: now } });
    // Lost to a concurrent rotation of the same token, a moment ago: inside the grace by definition.
    if (claimed.count !== 1) return null;
    const m = await mintTokens(tx, { grantId: grant.id, familyId: token.familyId, scopes: keep, refreshScopes: token.scopes, endsBy, withRefresh: true, parentId: id, now });
    await tx.oAuthGrant.update({ where: { id: grant.id }, data: { endsBy, lastUsedAt: now } });
    // The claimed token stays, as the tombstone that detects its reuse; only expired access tokens go.
    await tx.oAuthToken.deleteMany({ where: { familyId: token.familyId, kind: "access", expiresAt: { lte: now } } });
    return m;
  });
  if (!minted) return { ok: false, error: "invalid_grant" };
  return { ok: true, body: tokenAnswer(minted, keep) };
}
