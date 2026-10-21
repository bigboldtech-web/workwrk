// POST /api/oauth/token (docs/plans/mcp-server.md 3.5). A 404 while
// MCP_OFFERED is unset.
//
// A form-encoded body (charset accepted), at most 16 KB. The client
// authenticates with exactly the method it registered (src/lib/oauth/
// clients.ts); a failure is 401 invalid_client, with a Basic challenge when
// Basic was used or registered. Then the code grant (codes.ts: every check
// before the claim) or the refresh grant (refresh.ts: rotation, the
// 10 second grace, reuse revoking the family). Every answer carries
// `no-store` and `Pragma: no-cache`.
//
// LIMITS (3.10): only a request with no well-formed credential (a client id's
// shape and a code's or refresh token's) is counted by address, 120 a
// minute; so is one naming a client that does not exist. A well-formed one
// is counted by its client (the code grant, 60 a minute) or its refresh
// family (30 a minute). No lockout, no global cap.

import { mcpServes } from "@/lib/mcp/config";
import { MCP_OAUTH_COPY } from "@/lib/mcp/mcp-copy";
import { BASIC_CHALLENGE, authenticateClient, presentedAuth } from "@/lib/oauth/clients";
import { exchangeCode } from "@/lib/oauth/codes";
import { FORM_MAX, anyRepeated, readForm } from "@/lib/oauth/form";
import { tokenAnonLimit, tokenClientLimit, tokenFamilyLimit } from "@/lib/oauth/limits";
import { logOAuth, oauthError, oauthJson, oauthPreflight, oauthTooMany, offNotFound } from "@/lib/oauth/oauth-errors";
import { exchangeRefresh, type TokenError, type TokenOutcome } from "@/lib/oauth/refresh";
import { isClientIdShape, isWellFormed } from "@/lib/oauth/tokens";
import { ipFromRequest } from "@/lib/rate-limit-memory";

export const dynamic = "force-dynamic";

const PARAMS = ["grant_type", "code", "redirect_uri", "code_verifier", "refresh_token", "scope", "resource", "client_id", "client_secret"] as const;

const DESCRIBE: Record<TokenError, string> = {
  invalid_request: MCP_OAUTH_COPY.badBody,
  invalid_grant: MCP_OAUTH_COPY.grant,
  unauthorized_client: MCP_OAUTH_COPY.notRefresh,
  invalid_scope: MCP_OAUTH_COPY.scope,
  invalid_target: MCP_OAUTH_COPY.target,
};

/** Does the request carry a well-formed credential for its grant type? */
function wellFormedCredential(form: URLSearchParams, headers: Headers): boolean {
  const p = presentedAuth(form, headers);
  if (p.method === "absent" || p.method === "malformed" || !isClientIdShape(p.clientId)) return false;
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") return isWellFormed("code", form.get("code"));
  if (grantType === "refresh_token") return isWellFormed("refresh", form.get("refresh_token"));
  return false;
}

export async function POST(req: Request): Promise<Response> {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  const ip = ipFromRequest(req);
  const read = await readForm(req, FORM_MAX);
  if (!read.ok) {
    const l = tokenAnonLimit(ip);
    if (!l.ok) return oauthTooMany(l.retryAfter, MCP_OAUTH_COPY.tooMany);
    return oauthError("invalid_request", MCP_OAUTH_COPY.badBody, read.status === 413 ? 413 : 400);
  }
  const form = read.form;
  const wellFormed = wellFormedCredential(form, req.headers);
  if (!wellFormed) {
    const l = tokenAnonLimit(ip);
    if (!l.ok) {
      logOAuth("token", "rate_limited");
      return oauthTooMany(l.retryAfter, MCP_OAUTH_COPY.tooMany);
    }
  }
  if (anyRepeated(form, PARAMS)) return oauthError("invalid_request", MCP_OAUTH_COPY.repeated);
  const grantType = form.get("grant_type");
  if (!grantType) return oauthError("invalid_request", MCP_OAUTH_COPY.missing("grant_type"));
  if (grantType !== "authorization_code" && grantType !== "refresh_token") return oauthError("unsupported_grant_type", MCP_OAUTH_COPY.grantType);

  const auth = await authenticateClient(form, req.headers);
  if (!auth.ok) {
    // A client id that names no client is no valid caller: counted by address.
    if (wellFormed && !auth.known) {
      const l = tokenAnonLimit(ip);
      if (!l.ok) return oauthTooMany(l.retryAfter, MCP_OAUTH_COPY.tooMany);
    }
    logOAuth("token", auth.error);
    return oauthError(auth.error, auth.error === "invalid_client" ? MCP_OAUTH_COPY.clientAuth : MCP_OAUTH_COPY.badBody, auth.status, auth.basic ? BASIC_CHALLENGE : {});
  }

  let outcome: TokenOutcome;
  try {
    outcome =
      grantType === "authorization_code"
        ? await exchangeCode(auth.client, form, { clientLimit: (id) => tokenClientLimit(id) })
        : await exchangeRefresh(auth.client, form, { familyLimit: (id) => tokenFamilyLimit(id) });
  } catch {
    logOAuth("token", "server_error");
    return oauthError("server_error", MCP_OAUTH_COPY.serverError, 500);
  }
  if (outcome.ok) return oauthJson(outcome.body);
  if (outcome.error === "too_many") {
    logOAuth("token", "rate_limited");
    return oauthTooMany(outcome.retryAfter, MCP_OAUTH_COPY.tooMany);
  }
  logOAuth("token", outcome.error);
  return oauthError(outcome.error, DESCRIBE[outcome.error]);
}

export function OPTIONS(req: Request): Response {
  if (!mcpServes(req.headers.get("host"))) return offNotFound();
  return oauthPreflight();
}
