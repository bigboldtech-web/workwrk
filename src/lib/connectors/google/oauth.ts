// The OAuth half of connecting a person's own Google account to their AI
// teammates (docs/plans/ai-teammates-phase3.md step 2): the PKCE pair and the
// state a connect starts with, the consent address, the code exchange, the
// token refresh, the revoke, and the account read from the id token.
//
// NOTHING SECRET LEAVES THIS FILE IN WORDS. Every fetch has its own timeout,
// a failure answers a kind, never Google's body, and the one log line a
// failure writes names the step and the HTTP status only (Decision 16): no
// token, code, address or body is ever written to the server log.
//
// Server-only: holds the client secret.

import { createHash, randomBytes } from "node:crypto";
import { googleRedirectUri, type GoogleConfig, type GoogleRevokeConfig } from "./config";

/** Every call to Google's OAuth endpoints gives up after this long. */
export const OAUTH_TIMEOUT_MS = 10_000;

export interface GoogleTokens {
  accessToken: string;
  /** Google may send none on a re-consent; saveConnection keeps the stored one then (same account only). */
  refreshToken: string | null;
  expiresIn: number;
  /** Google's space-separated answer: what it actually granted (products.ts productsGranted reads it). */
  scope: string;
  idToken: string | null;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** The PKCE pair (RFC 7636, S256): 32 random bytes, and the base64url of their sha256. */
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

/** The sha256 hex a state is stored under (oauth-state.ts): the state itself is never kept. */
export function stateId(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/** A new OAuth state: 32 random bytes for the browser, and the id its row is stored under. */
export function newState(): { state: string; id: string } {
  const state = base64url(randomBytes(32));
  return { state, id: stateId(state) };
}

/**
 * Google's consent address for one connect. Offline access (a refresh
 * token), always the consent screen, and the products granted before kept
 * (include_granted_scopes, Decision 4), so a reconnect that asks for one more
 * product never drops the other.
 */
export function authUrl(cfg: GoogleConfig, a: { state: string; challenge: string; scopes: string[]; loginHint?: string | null }): string {
  const url = new URL(cfg.authUrl);
  const q = url.searchParams;
  q.set("client_id", cfg.clientId);
  q.set("redirect_uri", googleRedirectUri());
  q.set("response_type", "code");
  q.set("scope", a.scopes.join(" "));
  q.set("access_type", "offline");
  q.set("prompt", "consent");
  q.set("include_granted_scopes", "true");
  q.set("code_challenge", a.challenge);
  q.set("code_challenge_method", "S256");
  q.set("state", a.state);
  if (a.loginHint) q.set("login_hint", a.loginHint);
  return url.toString();
}

/** One failure, in the log's one shape: the step and the status, nothing more. */
function logOauth(step: string, status: number | string): void {
  console.error(`[connectors] google ${step} ${status}`);
}

/** A form POST to one of Google's OAuth endpoints: the answer, or null when nothing came back in time. */
async function postForm(url: string, form: Record<string, string>, timeoutMs = OAUTH_TIMEOUT_MS): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

async function jsonOf(res: Response): Promise<Record<string, unknown> | null> {
  const body = (await res.json().catch(() => null)) as unknown;
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

/** Seconds an access token lives, as Google said, within reason; an hour when it said nothing usable. */
function expiresInOf(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 86_400) : 3600;
}

/** The authorization code exchanged for tokens, with the verifier its connect began with. */
export async function exchangeCode(cfg: GoogleConfig, code: string, verifier: string): Promise<{ ok: true; tokens: GoogleTokens } | { ok: false }> {
  const res = await postForm(cfg.tokenUrl, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: googleRedirectUri(),
  });
  if (!res) {
    logOauth("exchange", "network");
    return { ok: false };
  }
  const body = res.ok ? await jsonOf(res) : null;
  const accessToken = text(body?.access_token, 4096);
  if (!res.ok || !body || !accessToken) {
    logOauth("exchange", res.status);
    return { ok: false };
  }
  return {
    ok: true,
    tokens: {
      accessToken,
      refreshToken: text(body.refresh_token, 4096),
      expiresIn: expiresInOf(body.expires_in),
      scope: typeof body.scope === "string" ? body.scope.slice(0, 4000) : "",
      idToken: text(body.id_token, 16_384),
    },
  };
}

/**
 * A new access token from the refresh token. Only Google's own invalid_grant
 * (the grant revoked, or the refresh token expired) says the person must
 * reconnect; invalid_client is WorkwrK's own credentials, never theirs; a
 * timeout, a 5xx or anything else is Google being unavailable (Decision 18).
 */
export async function refreshAccess(
  cfg: GoogleConfig,
  refreshToken: string,
): Promise<{ ok: true; accessToken: string; expiresIn: number } | { ok: false; kind: "invalid_grant" | "invalid_client" | "unavailable" }> {
  const res = await postForm(cfg.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  if (!res) {
    logOauth("refresh", "network");
    return { ok: false, kind: "unavailable" };
  }
  const body = await jsonOf(res);
  if (res.ok) {
    const accessToken = text(body?.access_token, 4096);
    if (accessToken) return { ok: true, accessToken, expiresIn: expiresInOf(body?.expires_in) };
    logOauth("refresh", res.status);
    return { ok: false, kind: "unavailable" };
  }
  const error = typeof body?.error === "string" ? body.error : "";
  logOauth("refresh", res.status);
  if ((res.status === 400 || res.status === 401) && error === "invalid_grant") return { ok: false, kind: "invalid_grant" };
  if ((res.status === 400 || res.status === 401) && (error === "invalid_client" || error === "unauthorized_client")) return { ok: false, kind: "invalid_client" };
  return { ok: false, kind: "unavailable" };
}

/**
 * Tell Google to revoke a token, and so the whole grant. 200: revoked. 400:
 * Google no longer knows the token (revoked already, or expired), so there is
 * nothing left to revoke. Anything else, or no answer in time: failed, and
 * the queue tries again (connections.ts revokeQueued). Only the revoke
 * address is read (config.ts googleRevokeConfig), so a revoke never waits on
 * the connect settings (review of step 2).
 */
export async function revokeToken(cfg: Pick<GoogleRevokeConfig, "revokeUrl">, token: string, timeoutMs = OAUTH_TIMEOUT_MS): Promise<"revoked" | "already" | "failed"> {
  const res = await postForm(cfg.revokeUrl, { token }, timeoutMs);
  if (!res) {
    logOauth("revoke", "network");
    return "failed";
  }
  // The body is never read: it can only say what the status already says.
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 200) return "revoked";
  if (res.status === 400) return "already";
  logOauth("revoke", res.status);
  return "failed";
}

/**
 * The account an id token names: its OpenID "sub" and its address. The
 * payload is only decoded, not verified: the token came straight from
 * Google's token endpoint over TLS, in answer to this server's own code
 * exchange, so nobody else could have written it.
 */
export function idTokenClaims(idToken: string): { sub: string; email: string } | null {
  if (typeof idToken !== "string" || idToken.length > 16_384) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const sub = text(p.sub, 255);
  const email = text(p.email, 320);
  if (!sub || !email || !email.includes("@")) return null;
  return { sub, email: email.trim().toLowerCase() };
}
