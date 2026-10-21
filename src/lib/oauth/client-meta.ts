// Dynamic client registration's metadata (RFC 7591; docs/plans/mcp-server.md 3.3).
//
// A NAME IS NEVER A REASON TO REFUSE (Decision 3, review H3). Control and
// invisible characters are removed, runs of white space become one space, and
// the rest is trimmed and cut to 60 characters ("" when nothing is left).
// Whether the name is SHOWN is app-label.ts's decision, at consent. Refusing
// a name containing "workwrk" stopped Claude Code ("Claude Code (workwrk)")
// from connecting; showing it would let "WorkwrK Security Check" ask for
// access. So it is kept, and the redirect label is shown instead.
//
// Logos, URIs, contacts, software fields and keys are dropped: nothing a
// stranger registers is fetched, stored or shown. `scope` is ignored.
//
// Pure.

import { checkRedirectUri, REDIRECT_URIS_MAX } from "./redirect-uri";

export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";
export const AUTH_METHODS: readonly AuthMethod[] = ["none", "client_secret_post", "client_secret_basic"];
export type GrantType = "authorization_code" | "refresh_token";

export const CLIENT_NAME_MAX = 60;

export interface ClientMetadata {
  name: string;
  redirectUris: string[];
  grantTypes: GrantType[];
  authMethod: AuthMethod;
}

export type MetadataResult =
  | { ok: true; meta: ClientMetadata }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; why: string };

// Cc control, Cf format (zero width, bidi overrides), Zl and Zp separators,
// Co private use, Cs lone surrogates, Cn unassigned.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}\p{Cn}]/gu;

/** The name as stored: cleaned, never refused. */
export function cleanClientName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Line breaks and tabs are white space first, so "Code\nApp" stays two words.
  const cleaned = raw.normalize("NFC").replace(/[\t\n\v\f\r]/g, " ").replace(INVISIBLE, "").replace(/\s+/gu, " ").trim();
  const chars = [...cleaned];
  return (chars.length > CLIENT_NAME_MAX ? chars.slice(0, CLIENT_NAME_MAX).join("") : cleaned).trim();
}

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** The registration body, checked: what WorkwrK keeps of it, or why it is refused. */
export function parseClientMetadata(body: unknown): MetadataResult {
  const b = asObject(body);
  if (!b) return { ok: false, error: "invalid_client_metadata", why: "the body is not a JSON object" };

  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) return { ok: false, error: "invalid_redirect_uri", why: "redirect_uris must list 1 to 5 URIs" };
  const unique = [...new Set(uris)];
  if (unique.length > REDIRECT_URIS_MAX) return { ok: false, error: "invalid_redirect_uri", why: "redirect_uris must list 1 to 5 URIs" };
  const redirectUris: string[] = [];
  for (const u of unique) {
    const c = checkRedirectUri(u);
    if (!c.ok) return { ok: false, error: "invalid_redirect_uri", why: c.why };
    redirectUris.push(c.uri);
  }

  let authMethod: AuthMethod = "client_secret_basic";
  if (b.token_endpoint_auth_method !== undefined) {
    if (typeof b.token_endpoint_auth_method !== "string" || !(AUTH_METHODS as readonly string[]).includes(b.token_endpoint_auth_method)) {
      return { ok: false, error: "invalid_client_metadata", why: "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic" };
    }
    authMethod = b.token_endpoint_auth_method as AuthMethod;
  }

  // Absent: both (the table's default), so a client that leaves it out still
  // gets a refresh token rather than a consent screen every hour.
  let grantTypes: GrantType[] = ["authorization_code", "refresh_token"];
  if (b.grant_types !== undefined) {
    if (!Array.isArray(b.grant_types) || b.grant_types.length === 0) return { ok: false, error: "invalid_client_metadata", why: "grant_types must be a list" };
    const set = [...new Set(b.grant_types)];
    if (!set.every((g) => g === "authorization_code" || g === "refresh_token") || !set.includes("authorization_code")) {
      return { ok: false, error: "invalid_client_metadata", why: "grant_types may hold only authorization_code and refresh_token, and must hold authorization_code" };
    }
    grantTypes = (["authorization_code", "refresh_token"] as const).filter((g) => set.includes(g));
  }

  if (b.response_types !== undefined) {
    const rt = b.response_types;
    if (!Array.isArray(rt) || rt.length !== 1 || rt[0] !== "code") return { ok: false, error: "invalid_client_metadata", why: "response_types may only be code" };
  }

  return { ok: true, meta: { name: cleanClientName(b.client_name), redirectUris, grantTypes, authMethod } };
}
