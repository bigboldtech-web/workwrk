// SCIM bearer-token authentication. Hash on the way in, look up
// in constant-ish time via the unique index on tokenHash. Returns
// the org id on success — every SCIM endpoint scopes its query to
// that org so an Okta tenant can't see another tenant's directory.

import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const TOKEN_PREFIX = "wkw_";
const RAW_BYTES = 32;

export type ScimAuthResult =
  | { ok: true; organizationId: string; tokenId: string }
  | { ok: false; response: NextResponse };

export function generateScimTokenRaw(): { raw: string; hash: string; prefix: string } {
  // Random 32 bytes → URL-safe base64 (no padding) prefixed with
  // "wkw_" so it's recognizable in logs / IdP UIs.
  const bytes = crypto.randomBytes(RAW_BYTES);
  const body = bytes.toString("base64url");
  const raw = `${TOKEN_PREFIX}${body}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  // First 8 chars of the *body* (post-prefix) — enough for the
  // admin UI to distinguish without leaking entropy.
  const prefix = `${TOKEN_PREFIX}${body.slice(0, 8)}…`;
  return { raw, hash, prefix };
}

export function hashScimToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function authenticateScim(req: NextRequest): Promise<ScimAuthResult> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      response: scimError(401, "Missing or malformed Authorization header"),
    };
  }
  const raw = auth.slice(7).trim();
  if (!raw) return { ok: false, response: scimError(401, "Empty bearer token") };

  const hash = hashScimToken(raw);
  const token = await prisma.scimToken.findUnique({
    where: { tokenHash: hash },
    select: { id: true, organizationId: true, revokedAt: true, expiresAt: true },
  });
  if (!token) return { ok: false, response: scimError(401, "Invalid token") };
  if (token.revokedAt) return { ok: false, response: scimError(401, "Token revoked") };
  if (token.expiresAt && token.expiresAt < new Date()) {
    return { ok: false, response: scimError(401, "Token expired") };
  }

  // Best-effort lastUsedAt update. Don't await — keeps the hot path
  // quick and the failure mode (UPDATE fails) is harmless.
  prisma.scimToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { ok: true, organizationId: token.organizationId, tokenId: token.id };
}

// SCIM 2.0 errors follow a specific JSON shape (RFC 7644 §3.12).
export function scimError(status: number, detail: string, scimType?: string): NextResponse {
  const body: Record<string, unknown> = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
  };
  if (scimType) body.scimType = scimType;
  return NextResponse.json(body, { status });
}

export function scimResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Content-Type": "application/scim+json" },
  });
}
