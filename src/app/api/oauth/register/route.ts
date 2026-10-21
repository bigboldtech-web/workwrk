// POST /api/oauth/register: dynamic client registration, RFC 7591
// (docs/plans/mcp-server.md 3.3). A 404 while MCP_OFFERED is unset.
//
// A JSON body (any charset) of at most 16 KB. Its redirect URIs are checked
// (src/lib/oauth/redirect-uri.ts), its name is cleaned and never refused
// (client-meta.ts), and nothing else a stranger sends is kept. The answer is
// 201 with the client id and, for a confidential client, its secret, shown
// this once and stored only as a hash. 60 a minute and 600 an hour per
// address, with no global cap; a client never granted is deleted after 24
// hours (src/lib/oauth/sweep.ts).

import { mcpServes } from "@/lib/mcp/config";
import { MCP_OAUTH_COPY } from "@/lib/mcp/mcp-copy";
import { parseClientMetadata } from "@/lib/oauth/client-meta";
import { registerClient } from "@/lib/oauth/clients";
import { readJson } from "@/lib/oauth/form";
import { registerLimit } from "@/lib/oauth/limits";
import { logOAuth, oauthError, oauthJson, oauthPreflight, oauthTooMany, offNotFound, otherMethods } from "@/lib/oauth/oauth-errors";
import { ipFromRequest } from "@/lib/rate-limit-memory";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  const limit = registerLimit(ipFromRequest(req));
  if (!limit.ok) {
    logOAuth("register", "rate_limited");
    return oauthTooMany(limit.retryAfter, MCP_OAUTH_COPY.tooMany);
  }
  const read = await readJson(req);
  if (!read.ok) return oauthError("invalid_client_metadata", MCP_OAUTH_COPY.badBody, read.status === 413 ? 413 : 400);
  const parsed = parseClientMetadata(read.body);
  if (!parsed.ok) {
    logOAuth("register", parsed.error);
    const describe = parsed.error === "invalid_redirect_uri" ? MCP_OAUTH_COPY.redirect : MCP_OAUTH_COPY.metadata;
    return oauthError(parsed.error, describe(parsed.why));
  }
  try {
    return oauthJson(await registerClient(parsed.meta), 201);
  } catch {
    logOAuth("register", "server_error");
    return oauthError("server_error", MCP_OAUTH_COPY.serverError, 500);
  }
}

export function OPTIONS(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return oauthPreflight();
}

// Every other method: 404 while MCP_OFFERED is unset, else 405 (never Next's own 405).
const other = otherMethods("POST, OPTIONS");
export const GET = other.GET;
export const HEAD = other.HEAD;
export const PUT = other.PUT;
export const PATCH = other.PATCH;
export const DELETE = other.DELETE;
