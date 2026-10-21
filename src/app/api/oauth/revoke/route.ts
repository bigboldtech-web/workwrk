// POST /api/oauth/revoke: token revocation, RFC 7009
// (docs/plans/mcp-server.md 3.6). A 404 while MCP_OFFERED is unset.
//
//   - With credentials (a client id, with its secret when it has one): they
//     are checked (a failure is 401 invalid_client), and only that client's
//     tokens are revoked.
//   - With no client id: a PUBLIC client's token is revoked by holding it
//     (RFC 7009 2.1 lets a public client send its token alone); a
//     confidential client's is not.
//   - A refresh token ends the whole grant (`client_revoked`, with the audit
//     row); an access token ends only itself.
//   - Always 200 for a well-formed request (RFC 7009 2.2), whether or not
//     anything was revoked, so the answer tells a stranger nothing.
// Without a well-formed token, 120 a minute per address.

import { mcpServes } from "@/lib/mcp/config";
import { MCP_OAUTH_COPY } from "@/lib/mcp/mcp-copy";
import { BASIC_CHALLENGE, authenticateClient, findClient, presentedAuth, type ClientRow } from "@/lib/oauth/clients";
import { FORM_MAX, anyRepeated, readForm } from "@/lib/oauth/form";
import { revokeGrant } from "@/lib/oauth/grants";
import { revokeAnonLimit } from "@/lib/oauth/limits";
import { NO_STORE, OAUTH_CORS, logOAuth, oauthError, oauthPreflight, oauthTooMany, offNotFound } from "@/lib/oauth/oauth-errors";
import { hashSecret, isWellFormed } from "@/lib/oauth/tokens";
import { prisma } from "@/lib/prisma";
import { ipFromRequest } from "@/lib/rate-limit-memory";

export const dynamic = "force-dynamic";

function done(): Response {
  return new Response(null, { status: 200, headers: { ...NO_STORE, ...OAUTH_CORS } });
}

export async function POST(req: Request): Promise<Response> {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  const ip = ipFromRequest(req);
  const read = await readForm(req, FORM_MAX);
  if (!read.ok) {
    const l = revokeAnonLimit(ip);
    if (!l.ok) return oauthTooMany(l.retryAfter, MCP_OAUTH_COPY.tooMany);
    return oauthError("invalid_request", MCP_OAUTH_COPY.badBody, read.status === 413 ? 413 : 400);
  }
  const form = read.form;
  const token = form.get("token");
  const kind = isWellFormed("access", token) ? "access" : isWellFormed("refresh", token) ? "refresh" : null;
  if (!kind) {
    const l = revokeAnonLimit(ip);
    if (!l.ok) return oauthTooMany(l.retryAfter, MCP_OAUTH_COPY.tooMany);
  }
  if (anyRepeated(form, ["token", "token_type_hint", "client_id", "client_secret"])) return oauthError("invalid_request", MCP_OAUTH_COPY.repeated);
  if (!token) return oauthError("invalid_request", MCP_OAUTH_COPY.missing("token"));

  const presented = presentedAuth(form, req.headers);
  if (presented.method === "malformed") return oauthError("invalid_request", MCP_OAUTH_COPY.badBody);
  let caller: ClientRow | null = null;
  if (presented.method !== "absent") {
    const auth = await authenticateClient(form, req.headers);
    if (!auth.ok) {
      logOAuth("revoke", auth.error);
      return oauthError(auth.error, auth.error === "invalid_client" ? MCP_OAUTH_COPY.clientAuth : MCP_OAUTH_COPY.badBody, auth.status, auth.basic ? BASIC_CHALLENGE : {});
    }
    caller = auth.client;
  }
  if (!kind) return done();

  try {
    const row = await prisma.oAuthToken.findUnique({ where: { id: hashSecret(token as string) }, select: { id: true, kind: true, grantId: true } });
    if (!row) return done();
    const grant = await prisma.oAuthGrant.findUnique({ where: { id: row.grantId }, select: { id: true, clientId: true } });
    if (!grant) return done();
    if (caller) {
      if (grant.clientId !== caller.id) return done();
    } else {
      // No client id: only a public client's token is revoked by holding it.
      const owner = await findClient(grant.clientId);
      if (!owner || owner.authMethod !== "none") return done();
    }
    if (row.kind === "refresh") await revokeGrant(grant.id, "client_revoked", null);
    else await prisma.oAuthToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
  } catch {
    logOAuth("revoke", "server_error");
    return oauthError("server_error", MCP_OAUTH_COPY.serverError, 500);
  }
  return done();
}

export function OPTIONS(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return oauthPreflight();
}
