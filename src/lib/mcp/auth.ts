// The bearer check of every /api/mcp request (docs/plans/mcp-server.md 3.8,
// Decision 7), in this order, re-read from the database each time:
//
//   1. the header is "Bearer wkmcp_at_..." only; a cookie or a query token
//      is never looked at;
//   2. the token: an access token by its SHA-256, unrevoked, unexpired, bound
//      to MCP_RESOURCE;
//   3. the grant: unrevoked (revokedAt read on EVERY request), before its
//      endsBy, and the token of the grant's current family;
//   4 to 10. whether the grant still stands (src/lib/oauth/eligibility.ts
//      enforceStanding): the client not disabled, the switch and the allowed
//      apps, the workspace open, the account's tokenVersion, the person a
//      teammate could act for, no password change or Sign everyone out
//      since the consent. Each failure revokes the grant with its reason;
//      AI off and the holds only BLOCK tools/call;
//   11. the result: the grant, the client, the person, the scopes the token
//      and the grant both hold, with lastUsedAt written at most once a
//      minute.
//
// THE CHALLENGE (RFC 6750, RFC 9728): a 401 whose WWW-Authenticate names
// the protected resource metadata and both scopes, adding
// error="invalid_token" when a token was sent and failed.
//
// Logs carry codes only, never a token.
//
// Server-only.

import type { ActingPerson } from "@/lib/agents/acting";
import { STANDING_GRANT_SELECT, enforceStanding } from "@/lib/oauth/eligibility";
import { SCOPES, type McpScope } from "@/lib/oauth/metadata";
import { NO_STORE } from "@/lib/oauth/oauth-errors";
import { hashSecret, isWellFormed } from "@/lib/oauth/tokens";
import { prisma } from "@/lib/prisma";
import { MCP_ORIGIN, MCP_RESOURCE, normalResource } from "./config";
import { MCP_OAUTH_COPY, MCP_RPC_COPY, MCP_TOOL_COPY } from "./mcp-copy";

/** lastUsedAt is written at most this often. */
export const LAST_USED_EVERY_MS = 60_000;

/** The grant as a call sees it. */
export interface McpGrant {
  id: string;
  clientId: string;
  organizationId: string;
  userId: string;
  appName: string;
  redirectHost: string;
  familyId: string;
  tokenVersion: number;
  authorizedAt: Date;
  endsBy: Date;
  revokedAt: Date | null;
  scopes: string[];
  lastUsedAt: Date | null;
}

export interface McpContext {
  grant: McpGrant;
  client: { id: string; name: string; disabledAt: Date | null };
  /** Null only while AI features are off for the person there (blocked "ai_off"). */
  person: ActingPerson | null;
  /** What blocks tools/call without ending the connection (3.8 steps 8 and 10). */
  blocked: "ai_off" | "mfa" | "password" | null;
  /** The token's scopes that the grant still holds. */
  scopes: McpScope[];
}

/** `unknown`: a well-formed token that names no token (the transport counts it per address, limits.ts). */
export type McpAuth = { ok: true; ctx: McpContext } | { ok: false; sent: boolean; unknown?: true };

/** What the Authorization header carries (3.8 step 1). */
export function bearerOf(header: string | null | undefined): { kind: "none" } | { kind: "malformed" } | { kind: "token"; token: string } {
  if (!header) return { kind: "none" };
  const m = /^\s*([A-Za-z]+)\s+(\S+)\s*$/.exec(header);
  if (!m || m[1].toLowerCase() !== "bearer") return /^\s*bearer\b/i.test(header) ? { kind: "malformed" } : { kind: "none" };
  return isWellFormed("access", m[2]) ? { kind: "token", token: m[2] } : { kind: "malformed" };
}

/** Does this request carry a well-formed credential (2.1 step 6)? */
export function hasWellFormedCredential(header: string | null | undefined): boolean {
  return bearerOf(header).kind === "token";
}

function fail(sent: boolean, code: string): McpAuth {
  console.warn(`[mcp] auth ${code}`);
  return { ok: false, sent };
}

/** 3.8 for one request. */
export async function mcpContext(authorization: string | null | undefined, now: Date = new Date()): Promise<McpAuth> {
  // 1. The header.
  const b = bearerOf(authorization);
  if (b.kind === "none") return { ok: false, sent: false };
  if (b.kind === "malformed") return fail(true, "malformed");

  // 2. The token.
  const token = await prisma.oAuthToken.findUnique({
    where: { id: hashSecret(b.token) },
    select: { id: true, grantId: true, kind: true, familyId: true, scopes: true, resource: true, expiresAt: true, revokedAt: true },
  });
  if (!token) {
    console.warn("[mcp] auth unknown_token");
    return { ok: false, sent: true, unknown: true };
  }
  if (token.kind !== "access") return fail(true, "not_access");
  if (token.revokedAt) return fail(true, "token_revoked");
  if (token.expiresAt.getTime() <= now.getTime()) return fail(true, "token_expired");
  if (normalResource(token.resource) !== MCP_RESOURCE()) return fail(true, "wrong_resource");

  // 3. The grant, read fresh: revoked, past endsBy, or an older family.
  const read: McpGrant | null = await prisma.oAuthGrant.findUnique({ where: { id: token.grantId }, select: STANDING_GRANT_SELECT });
  if (!read) return fail(true, "no_grant");
  if (read.revokedAt) return fail(true, "grant_revoked");
  if (read.familyId !== token.familyId) return fail(true, "old_family");

  // 4 to 10. Whether it still stands; each failure revokes with its reason,
  // and only the row as it was judged (review of step 4, M2): a log out in
  // another browser or a reconnect a moment after the read above is judged
  // again, never revoked as an ended connection.
  const client = await prisma.oAuthClient.findUnique({ where: { id: read.clientId }, select: { id: true, name: true, disabledAt: true } });
  if (!client) return fail(true, "no_client");
  const standing = await enforceStanding(read, client, now);
  if (!standing.ok) return fail(true, standing.revoke ? `revoked_${standing.revoke}` : "grant_revoked");
  // The grant as it was judged. A reconnect since the read above gave it a new family, which this token is not of.
  const grant: McpGrant = standing.grant;
  if (grant.familyId !== token.familyId) return fail(true, "old_family");

  // 11. The scopes both hold, and lastUsedAt at most once a minute.
  const held = new Set(grant.scopes);
  const scopes = SCOPES.filter((s) => token.scopes.includes(s) && held.has(s));
  if (!scopes.includes("mcp:read")) return fail(true, "no_scope");
  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() >= LAST_USED_EVERY_MS) {
    await prisma.oAuthGrant
      .updateMany({
        where: { id: grant.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_EVERY_MS) } }] },
        data: { lastUsedAt: now },
      })
      .catch(() => console.warn("[mcp] auth last_used_not_written"));
  }
  return { ok: true, ctx: { grant, client, person: standing.person, blocked: standing.blocked, scopes } };
}

/** The resource metadata URL the challenge names (RFC 9728 3). */
export function resourceMetadataUrl(): string {
  return `${MCP_ORIGIN()}/.well-known/oauth-protected-resource/api/mcp`;
}

/** The WWW-Authenticate header (3.8). */
export function challengeHeader(sent: boolean): string {
  const base = `Bearer resource_metadata="${resourceMetadataUrl()}", scope="${SCOPES.join(" ")}"`;
  return sent ? `${base}, error="invalid_token", error_description="${MCP_OAUTH_COPY.invalidToken}"` : base;
}

/**
 * The challenge a write tool's refusal on a read connection carries
 * (Decision 12 keeps that refusal an isError result, never a 403): the
 * OpenAI Apps SDK's additive `_meta["mcp/www_authenticate"]`, so a client
 * that reads it (ChatGPT) can ask the person to connect again with Read and
 * change (final review of the MCP server, contract L1). The scope named is
 * what the write tools need.
 */
export function insufficientScopeChallenge(): string {
  return `Bearer error="insufficient_scope", scope="${SCOPES.join(" ")}", resource_metadata="${resourceMetadataUrl()}", error_description="${MCP_TOOL_COPY.errors.readOnly}"`;
}

/** The 401 answer (3.8). */
export function challenge(sent: boolean, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: MCP_RPC_COPY.unauthorized } }), {
    status: 401,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, "WWW-Authenticate": challengeHeader(sent), ...extra },
  });
}
