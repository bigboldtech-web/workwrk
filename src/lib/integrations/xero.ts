/**
 * Xero OAuth 2.0 + API client shell. Mirrors quickbooks.ts shape so
 * the two integrations can be swapped behind a unified Financials >
 * Integrations surface.
 *
 * Wiring:
 *   1. Register an OAuth 2.0 app at developer.xero.com.
 *   2. Env: XERO_CLIENT_ID / XERO_CLIENT_SECRET.
 *   3. Whitelist the redirectUri() value in the app config.
 *
 * Xero scope picks:
 *   accounting.transactions  — read+write journal entries
 *   accounting.contacts       — customers / suppliers
 *   accounting.settings       — chart of accounts
 *   offline_access            — receive a refresh token
 *
 * Important: Xero rotates `refresh_token` on every refresh call.
 * The persistence layer MUST overwrite the stored refresh token
 * after every refresh or future calls will 401.
 */

export const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
  "offline_access",
].join(" ");

export interface XeroTokens {
  accessToken: string;
  refreshToken: string;
  tenantId: string; // Xero "tenant" — chosen on consent
  expiresAt: string;
}

export function isConfigured(): boolean {
  return !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
}

export function redirectUri(): string {
  const base = process.env.NEXTAUTH_URL || "https://workwrk.com";
  return `${base}/api/integrations/xero/callback`;
}

export function buildAuthUrl(state: string): string {
  const baseAuth = "https://login.xero.com/identity/connect/authorize";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.XERO_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    scope: XERO_SCOPES,
    state,
  });
  return `${baseAuth}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<Omit<XeroTokens, "tenantId">> {
  const tokenUrl = "https://identity.xero.com/connect/token";
  const basic = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
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
    throw new Error(`Xero token exchange failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

export async function resolveTenantId(accessToken: string): Promise<string> {
  const res = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Xero connections lookup failed: ${res.status}`);
  }
  const list = (await res.json()) as Array<{ tenantId: string; tenantType: string }>;
  // First org-tenant is the default. Multi-tenant pickers come later.
  const first = list.find((t) => t.tenantType === "ORGANISATION") ?? list[0];
  if (!first?.tenantId) throw new Error("No Xero tenant in response");
  return first.tenantId;
}

export async function refreshTokens(refreshToken: string): Promise<Omit<XeroTokens, "tenantId">> {
  const tokenUrl = "https://identity.xero.com/connect/token";
  const basic = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero refresh failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}
