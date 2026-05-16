/**
 * QuickBooks Online OAuth + API client shell.
 *
 * Wiring strategy:
 *   1. Register an OAuth app at developer.intuit.com.
 *   2. Drop client_id / client_secret into env as
 *      QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET.
 *   3. Whitelist the redirect URI from `redirectUri()` on the
 *      OAuth app config.
 *   4. The /api/integrations/quickbooks/connect route builds an
 *      auth URL via `buildAuthUrl()`; the /callback route exchanges
 *      the code via `exchangeCodeForTokens()` and stores the result
 *      in `Integration.config`.
 *
 * Tokens stored in `Integration.config` schema:
 *   { accessToken, refreshToken, realmId, expiresAt }
 *
 * `realmId` is QuickBooks' tenant identifier — surfaced as the
 * `realmId` query param on the OAuth callback. Every API call to
 * QB needs it in the URL path.
 */

export const QUICKBOOKS_SCOPES = [
  "com.intuit.quickbooks.accounting",
  "openid",
  "profile",
  "email",
].join(" ");

export interface QuickBooksTokens {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: string; // ISO timestamp
}

export function isConfigured(): boolean {
  return !!(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
}

export function redirectUri(): string {
  const base = process.env.NEXTAUTH_URL || "https://workwrk.com";
  return `${base}/api/integrations/quickbooks/callback`;
}

export function buildAuthUrl(state: string): string {
  const baseAuth = "https://appcenter.intuit.com/connect/oauth2";
  const params = new URLSearchParams({
    client_id: process.env.QUICKBOOKS_CLIENT_ID || "",
    response_type: "code",
    scope: QUICKBOOKS_SCOPES,
    redirect_uri: redirectUri(),
    state,
  });
  return `${baseAuth}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  realmId: string
): Promise<QuickBooksTokens> {
  const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
  const basic = Buffer.from(
    `${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QuickBooks token exchange failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    realmId,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

export async function refreshTokens(refreshToken: string): Promise<QuickBooksTokens> {
  const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
  const basic = Buffer.from(
    `${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QuickBooks refresh failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    realmId: "", // caller carries this from prior token
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}
