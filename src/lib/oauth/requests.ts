// Pending authorization requests (docs/plans/mcp-server.md Decision 4, 3.4).
//
// The authorization request is stored for 10 minutes and referred to by a
// short token ("wkmcp_rq_" + 43, stored as its SHA-256 hex), so the login
// callback stays far under its 2,048 character cap and the consent can never
// be replayed with edited parameters: everything it grants is read from the
// row, never from the form.
//
// Each consent view binds the row to the person viewing it and replaces its
// csrf hash, so only the form most recently shown, to that person, can
// decide. The decision takes the row once: a delete guarded on the id, the
// viewer, the csrf hash and the expiry, so of two submits only one finds it.
//
// Server-only.

import { prisma } from "@/lib/prisma";
import type { McpScope } from "./metadata";
import { hashSecret, isWellFormed, newSecret, sameHash } from "./tokens";

export const REQUEST_TTL_MS = 10 * 60 * 1000;

export interface PendingRequest {
  id: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string | null;
  codeChallenge: string;
  resource: string;
  viewerId: string | null;
  csrfHash: string | null;
  expiresAt: Date;
}

const SELECT = {
  id: true, clientId: true, redirectUri: true, scopes: true, state: true, codeChallenge: true, resource: true, viewerId: true, csrfHash: true, expiresAt: true,
} as const;

/** Store a checked authorization request; the answer is the token that names it. */
export async function createRequest(input: {
  clientId: string;
  redirectUri: string;
  scopes: McpScope[];
  state: string | null;
  codeChallenge: string;
  resource: string;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const token = newSecret("request");
  await prisma.oAuthAuthorizationRequest.create({
    data: {
      id: hashSecret(token),
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      scopes: [...input.scopes],
      state: input.state,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
      createdAt: now,
    },
  });
  return token;
}

/** The live request a token names, or null (malformed, unknown or expired). */
export async function readRequest(token: unknown, now: Date = new Date()): Promise<PendingRequest | null> {
  if (!isWellFormed("request", token)) return null;
  const row = await prisma.oAuthAuthorizationRequest.findUnique({ where: { id: hashSecret(token) }, select: SELECT });
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  return row;
}

/**
 * Record the consent form shown to `viewerId`: a new csrf token, its hash on
 * the row. Null when the request ended meanwhile.
 */
export async function bindViewer(request: PendingRequest, viewerId: string, now: Date = new Date()): Promise<string | null> {
  const csrf = newSecret("request");
  const r = await prisma.oAuthAuthorizationRequest.updateMany({
    where: { id: request.id, expiresAt: { gt: now } },
    data: { viewerId, csrfHash: hashSecret(csrf) },
  });
  return r.count === 1 ? csrf : null;
}

/** Does this form belong to this viewer, with the csrf of the form last shown (constant time)? */
export function formMatches(request: PendingRequest, viewerId: string, csrf: unknown): boolean {
  if (request.viewerId !== viewerId) return false;
  if (!isWellFormed("request", csrf)) return false;
  return sameHash(hashSecret(csrf), request.csrfHash);
}

/** Take the request once (3.4 decision step 4). True for exactly one caller. */
export async function takeRequest(request: PendingRequest, viewerId: string, now: Date = new Date()): Promise<boolean> {
  const r = await prisma.oAuthAuthorizationRequest.deleteMany({
    where: { id: request.id, viewerId, csrfHash: request.csrfHash, expiresAt: { gt: now } },
  });
  return r.count === 1;
}
