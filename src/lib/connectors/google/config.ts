// The Google OAuth client AI teammates connect through
// (docs/plans/ai-teammates-phase3.md Decision 2), read from the environment.
//
// ITS OWN CLIENT, in its own Google Cloud project: GOOGLE_AGENT_CLIENT_ID and
// GOOGLE_AGENT_CLIENT_SECRET, never the GOOGLE_CLIENT_ID that sign-in and the
// calendar sync use (src/services/googleCalendar.ts). A Gmail review or a
// policy strike on this one can never take Google sign-in down with it.
//
// GOOGLE_AGENT_PRODUCTS lists the products this client has passed Google's
// review for. Unset means none, so a deployment stays off until the founder
// turns a product on.
//
// GOOGLE_AGENT_BASE_URL points every Google address at a stand-in for local
// proofs (scripts/google-stand-in.mjs). In production a stand-in address that
// is not https, or that is this machine, turns the whole connector off: a
// stray local value can never receive anyone's tokens.
//
// Server-only: reads the environment.

import { absoluteUrl } from "@/lib/app-url";
import { parseProducts, type ConnectorProduct } from "../products";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  gmailBase: string;
  calendarBase: string;
  /** The products this deployment offers (GOOGLE_AGENT_PRODUCTS), in CONNECTOR_PRODUCTS order. */
  products: ConnectorProduct[];
  /** Every address is GOOGLE_AGENT_BASE_URL's: a stand-in, never Google. */
  standIn: boolean;
}

const GOOGLE = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  gmailBase: "https://gmail.googleapis.com/gmail/v1",
  calendarBase: "https://www.googleapis.com/calendar/v3",
} as const;

/**
 * The client, or null when this deployment has none to offer: a missing
 * client id, secret or SECRETS_ENCRYPTION_KEY (tokens are only ever stored
 * sealed), no product listed, or a stand-in address production must refuse.
 */
export function googleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const clientId = (env.GOOGLE_AGENT_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_AGENT_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret || !(env.SECRETS_ENCRYPTION_KEY ?? "").trim()) return null;
  const products = parseProducts(env.GOOGLE_AGENT_PRODUCTS ?? "");
  if (products.length === 0) return null;

  const rawBase = (env.GOOGLE_AGENT_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!rawBase) return { clientId, clientSecret, ...GOOGLE, products, standIn: false };
  // Production never talks to a stand-in, local or not: a staging address
  // copied into its settings would receive every person's codes and tokens,
  // and the client secret (review of step 1).
  if (env.NODE_ENV === "production") return null;
  // A base that is not an address points nowhere a token should go.
  if (!URL.canParse(rawBase)) return null;
  return {
    clientId,
    clientSecret,
    authUrl: `${rawBase}/o/oauth2/v2/auth`,
    tokenUrl: `${rawBase}/token`,
    revokeUrl: `${rawBase}/revoke`,
    gmailBase: `${rawBase}/gmail/v1`,
    calendarBase: `${rawBase}/calendar/v3`,
    products,
    standIn: true,
  };
}

/** The one redirect address registered with the client, on the canonical app host. */
export function googleRedirectUri(): string {
  return absoluteUrl("/api/teammate-connections/google/callback");
}

/** Where a token is sent to be revoked, and nothing else. */
export interface GoogleRevokeConfig {
  revokeUrl: string;
  /** GOOGLE_AGENT_BASE_URL's revoke address: a stand-in, never Google. */
  standIn: boolean;
}

/**
 * Where revokes go, read on its own (review of step 2). It never depends on
 * GOOGLE_AGENT_PRODUCTS or the client credentials: Google's revoke endpoint
 * takes the token alone, so emptying the product list to switch the feature
 * off (a failed review, a policy strike, the rollback) still lets every
 * disconnect, leaver and queued revoke reach Google, and the queue drains.
 * Null only without SECRETS_ENCRYPTION_KEY: no stored token can be opened
 * then, and a queue row that cannot be opened would be dropped, so it waits
 * for the key instead. The stand-in base counts outside production only;
 * production always tells Google itself.
 */
export function googleRevokeConfig(env: NodeJS.ProcessEnv = process.env): GoogleRevokeConfig | null {
  if (!(env.SECRETS_ENCRYPTION_KEY ?? "").trim()) return null;
  const rawBase = (env.GOOGLE_AGENT_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!rawBase || env.NODE_ENV === "production") return { revokeUrl: GOOGLE.revokeUrl, standIn: false };
  // A base that is not an address points nowhere a token should go.
  if (!URL.canParse(rawBase)) return null;
  return { revokeUrl: `${rawBase}/revoke`, standIn: true };
}
