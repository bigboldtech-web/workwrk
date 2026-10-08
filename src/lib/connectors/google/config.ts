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

/** This machine, by any of the names a stand-in runs on. */
function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "[::1]" || h === "0.0.0.0" || /^127\./.test(h);
}

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
  let base: URL;
  try {
    base = new URL(rawBase);
  } catch {
    // A base that is not an address points nowhere a token should go.
    return null;
  }
  if (env.NODE_ENV === "production" && (base.protocol !== "https:" || isLocalHost(base.hostname))) return null;
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
