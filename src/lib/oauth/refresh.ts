// Access and refresh tokens: minting, and the refresh grant
// (docs/plans/mcp-server.md Decision 6, 3.5, 3.7).
//
// Access tokens live 1 hour; refresh tokens rotate, live 30 days unused and
// never past the grant's endsBy, and a family keeps at most two refresh rows
// (the newest and its parent: the parent is what a retry inside the grace
// presents). Every token is bound to MCP_RESOURCE (RFC 8707).
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
//   4. a wider scope is invalid_scope (a narrower one is kept), a wrong
//      resource invalid_target;
//   5. endsBy recomputed with the workspace's sessionMaxDays now; past it the
//      grant is revoked `expired`; then 3.8 steps 3 to 10;
//   6. under the grant's row lock: claim it, mint the new pair (parentId the
//      old one), prune the family to two refresh rows and drop its expired
//      access tokens, in one transaction.
//
// Server-only.

import type { Prisma } from "@/generated/prisma";
import { MCP_RESOURCE, isOurResource } from "@/lib/mcp/config";
import { prisma } from "@/lib/prisma";
import type { ClientRow } from "./clients";
import { enforceStanding } from "./eligibility";
import { reuseDetected, revokeGrant } from "./grants";
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

/** Mint an access token and, when asked, a refresh token, for one grant's family. */
export async function mintTokens(
  tx: Tx,
  a: { grantId: string; familyId: string; scopes: readonly string[]; endsBy: Date; withRefresh: boolean; parentId: string | null; now: Date },
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
      data: { id: refreshId, grantId: a.grantId, kind: "refresh", familyId: a.familyId, parentId: a.parentId, scopes: [...a.scopes], resource, expiresAt: new Date(refreshUntil), createdAt: a.now },
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

const GRANT_SELECT = {
  id: true, clientId: true, organizationId: true, userId: true, appName: true, redirectHost: true, familyId: true, tokenVersion: true,
  authorizedAt: true, endsBy: true, revokedAt: true, scopes: true,
} as const;

/** The refresh grant (see the file header). The caller authenticated the client and counted the request. */
export async function exchangeRefresh(
  client: ClientRow,
  form: URLSearchParams,
  opts: { now?: Date; familyLimit: (familyId: string) => { ok: boolean; retryAfter: number } },
): Promise<TokenOutcome> {
  const now = opts.now ?? new Date();
  if (!client.grantTypes.includes("refresh_token")) return { ok: false, error: "unauthorized_client" };
  const presented = form.get("refresh_token");
  if (!isWellFormed("refresh", presented)) return { ok: false, error: "invalid_grant" };
  const id = hashSecret(presented);
  const token = await prisma.oAuthToken.findUnique({ where: { id }, select: { id: true, grantId: true, kind: true, familyId: true, scopes: true, expiresAt: true, usedAt: true, revokedAt: true } });
  if (!token || token.kind !== "refresh") return { ok: false, error: "invalid_grant" };
  const limit = opts.familyLimit(token.familyId);
  if (!limit.ok) return { ok: false, error: "too_many", retryAfter: limit.retryAfter };
  const grant = await prisma.oAuthGrant.findUnique({ where: { id: token.grantId }, select: GRANT_SELECT });
  if (!grant || grant.clientId !== client.id) return { ok: false, error: "invalid_grant" };
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
  // The connection's cap with the workspace's rule as it is now.
  const endsBy = new Date(grant.authorizedAt.getTime() + Math.max(1, standing.sessionMaxDays) * DAY_MS);
  if (now.getTime() >= endsBy.getTime()) {
    await revokeGrant(grant.id, "expired", null);
    return { ok: false, error: "invalid_grant" };
  }
  const keep = scopes ?? (token.scopes as McpScope[]);

  const minted = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "OAuthGrant" WHERE "id" = ${grant.id} FOR UPDATE`;
    const fresh = await tx.oAuthGrant.findUnique({ where: { id: grant.id }, select: { revokedAt: true, familyId: true } });
    if (!fresh || fresh.revokedAt || fresh.familyId !== token.familyId) return null;
    const claimed = await tx.oAuthToken.updateMany({ where: { id, usedAt: null, revokedAt: null }, data: { usedAt: now } });
    // Lost to a concurrent rotation of the same token, a moment ago: inside the grace by definition.
    if (claimed.count !== 1) return null;
    const m = await mintTokens(tx, { grantId: grant.id, familyId: token.familyId, scopes: keep, endsBy, withRefresh: true, parentId: id, now });
    await tx.oAuthGrant.update({ where: { id: grant.id }, data: { endsBy, lastUsedAt: now } });
    // At most two refresh rows a family: the new one and its parent.
    await tx.oAuthToken.deleteMany({ where: { familyId: token.familyId, kind: "refresh", id: { notIn: [id, m.refreshId as string] } } });
    await tx.oAuthToken.deleteMany({ where: { familyId: token.familyId, kind: "access", expiresAt: { lte: now } } });
    return m;
  });
  if (!minted) return { ok: false, error: "invalid_grant" };
  return { ok: true, body: tokenAnswer(minted, keep) };
}
