// OAuth clients: registration and authentication at the token and revocation
// endpoints (docs/plans/mcp-server.md 3.3, 3.5, 3.6).
//
// A confidential client's secret is shown once, at registration, and stored
// only as its SHA-256 hex. At the token endpoint a client authenticates with
// EXACTLY the method it registered (none, client_secret_post or
// client_secret_basic), compared in constant time; any other answers 401
// invalid_client, with a Basic challenge when Basic was used or registered.
// A failed authentication never locks a client out (a stranger could lock
// out a real app); it counts toward a surge line (limits.ts).
//
// Server-only.

import { prisma } from "@/lib/prisma";
import type { AuthMethod, ClientMetadata } from "./client-meta";
import { clientAuthFailed } from "./limits";
import { hashSecret, isClientIdShape, newClientId, newSecret, secretMatches } from "./tokens";

export interface ClientRow {
  id: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  authMethod: string;
  secretHash: string | null;
  disabledAt: Date | null;
}

const CLIENT_SELECT = { id: true, name: true, redirectUris: true, grantTypes: true, authMethod: true, secretHash: true, disabledAt: true } as const;

/** The registration's answer body (RFC 7591 3.2.1). */
export interface Registered {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: ["code"];
  token_endpoint_auth_method: AuthMethod;
  client_secret?: string;
  client_secret_expires_at?: 0;
}

/** Store a checked registration and answer it; the secret, if any, appears here only. */
export async function registerClient(meta: ClientMetadata, now: Date = new Date()): Promise<Registered> {
  const id = newClientId();
  const secret = meta.authMethod === "none" ? null : newSecret("clientSecret");
  await prisma.oAuthClient.create({
    data: {
      id,
      name: meta.name,
      redirectUris: meta.redirectUris,
      grantTypes: meta.grantTypes,
      authMethod: meta.authMethod,
      secretHash: secret ? hashSecret(secret) : null,
      createdAt: now,
    },
  });
  return {
    client_id: id,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: meta.name,
    redirect_uris: meta.redirectUris,
    grant_types: meta.grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: meta.authMethod,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 as const } : {}),
  };
}

/** A client by id, or null when the id is malformed or unknown. */
export async function findClient(clientId: unknown): Promise<ClientRow | null> {
  if (!isClientIdShape(clientId)) return null;
  return prisma.oAuthClient.findUnique({ where: { id: clientId }, select: CLIENT_SELECT });
}

export type PresentedAuth =
  | { method: "client_secret_basic"; clientId: string; secret: string }
  | { method: "client_secret_post"; clientId: string; secret: string }
  | { method: "none"; clientId: string }
  | { method: "absent" }
  | { method: "malformed" };

/** How the request presents its client (RFC 6749 2.3.1): the Basic header, the body, or the client id alone. */
export function presentedAuth(form: URLSearchParams, headers: Headers): PresentedAuth {
  const header = headers.get("authorization");
  const bodyId = form.get("client_id");
  const bodySecret = form.get("client_secret");
  if (form.getAll("client_id").length > 1 || form.getAll("client_secret").length > 1) return { method: "malformed" };
  if (header && /^basic\s+/i.test(header)) {
    if (bodySecret !== null) return { method: "malformed" };
    let decoded: string;
    try {
      decoded = Buffer.from(header.replace(/^basic\s+/i, "").trim(), "base64").toString("utf8");
    } catch {
      return { method: "malformed" };
    }
    const at = decoded.indexOf(":");
    if (at < 1) return { method: "malformed" };
    let clientId: string;
    let secret: string;
    try {
      clientId = decodeURIComponent(decoded.slice(0, at).replace(/\+/g, " "));
      secret = decodeURIComponent(decoded.slice(at + 1).replace(/\+/g, " "));
    } catch {
      return { method: "malformed" };
    }
    if (bodyId !== null && bodyId !== clientId) return { method: "malformed" };
    return { method: "client_secret_basic", clientId, secret };
  }
  if (header) return { method: "malformed" };
  if (bodyId === null || bodyId === "") return bodySecret !== null ? { method: "malformed" } : { method: "absent" };
  if (bodySecret !== null) return { method: "client_secret_post", clientId: bodyId, secret: bodySecret };
  return { method: "none", clientId: bodyId };
}

export type ClientAuth =
  | { ok: true; client: ClientRow; method: AuthMethod }
  | { ok: false; status: 400 | 401; error: "invalid_request" | "invalid_client"; basic: boolean; known: boolean };

/**
 * Authenticate the client of a token or revocation request with exactly the
 * method it registered. `known` says whether a client by that id exists (the
 * token endpoint counts an unknown one by address).
 */
export async function authenticateClient(form: URLSearchParams, headers: Headers): Promise<ClientAuth> {
  const p = presentedAuth(form, headers);
  if (p.method === "malformed") return { ok: false, status: 400, error: "invalid_request", basic: false, known: false };
  if (p.method === "absent") return { ok: false, status: 401, error: "invalid_client", basic: false, known: false };
  const basic = p.method === "client_secret_basic";
  const client = await findClient(p.clientId);
  if (!client || client.disabledAt) {
    // The same work as a known client, so an unknown id is not told apart by timing.
    if (p.method !== "none") secretMatches(p.secret, "0".repeat(64));
    clientAuthFailed(null);
    return { ok: false, status: 401, error: "invalid_client", basic, known: !!client };
  }
  const registeredBasic = client.authMethod === "client_secret_basic";
  if (client.authMethod !== p.method) {
    clientAuthFailed(client.id);
    return { ok: false, status: 401, error: "invalid_client", basic: basic || registeredBasic, known: true };
  }
  if (p.method !== "none" && !secretMatches(p.secret, client.secretHash)) {
    clientAuthFailed(client.id);
    return { ok: false, status: 401, error: "invalid_client", basic: basic || registeredBasic, known: true };
  }
  return { ok: true, client, method: p.method };
}

/** The WWW-Authenticate header of a 401 invalid_client answer when Basic was used or registered. */
export const BASIC_CHALLENGE = { "WWW-Authenticate": 'Basic realm="workwrk", charset="UTF-8"' } as const;
