// The OAuth endpoints' answers (docs/plans/mcp-server.md 3.3 to 3.6, 3.11).
//
// Every answer carries `Cache-Control: no-store` and `Pragma: no-cache`
// (RFC 6749 5.1) and sets no cookie. The POST endpoints answer CORS with `*`,
// POST and OPTIONS, the headers Content-Type and Authorization, and never
// credentials (3.11). An error is `{ error, error_description }` in our own
// words only (mcp-copy.ts MCP_OAUTH_COPY), never a value the caller sent.
//
// Logs carry codes only: `[oauth] <op> <code>`. Never a token, a code, a
// secret, a name or an address.

import { mcpServes } from "@/lib/mcp/config";

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "invalid_target"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "temporarily_unavailable"
  | "server_error";

export const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export const OAUTH_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "600",
} as const;

/** A JSON answer from a POST endpoint, with no-store and the OAuth CORS headers. */
export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...OAUTH_CORS, ...extra },
  });
}

/** An OAuth error answer. */
export function oauthError(error: OAuthErrorCode, description: string, status = 400, extra: Record<string, string> = {}): Response {
  return oauthJson({ error, error_description: description }, status, extra);
}

/** 429 with Retry-After (3.10: every 429 carries it). */
export function oauthTooMany(retryAfter: number, description: string): Response {
  return oauthError("temporarily_unavailable", description, 429, { "Retry-After": String(Math.max(1, Math.ceil(retryAfter))) });
}

/** The CORS preflight of a POST endpoint. */
export function oauthPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...OAUTH_CORS, ...NO_STORE } });
}

/** What every route answers while MCP_OFFERED is unset or on the wrong host: a bare 404. */
export function offNotFound(): Response {
  return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
}

/** One log line, codes only. */
export function logOAuth(op: string, code: string): void {
  console.warn(`[oauth] ${op} ${code}`);
}

/**
 * A method a route does not take (review of MCP step 2): a 404 while
 * MCP_OFFERED is unset or on the wrong host, as every method of every MCP
 * and OAuth route answers then, else 405 with the methods it does take. A
 * route exports one for every method it does not take, so Next's own 405
 * never answers for it and nothing says the route exists while it is off.
 */
export function unsupportedMethod(req: Request, allow: string, extra: Record<string, string> = {}): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return new Response(null, { status: 405, headers: { Allow: allow, ...NO_STORE, ...extra } });
}

/** The handlers of every HTTP method, each answering unsupportedMethod; a route spreads the ones it does not take. */
export function otherMethods(allow: string): Record<"GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS", (req: Request) => Response> {
  const h = (req: Request) => unsupportedMethod(req, allow);
  return { GET: h, HEAD: h, POST: h, PUT: h, PATCH: h, DELETE: h, OPTIONS: h };
}
