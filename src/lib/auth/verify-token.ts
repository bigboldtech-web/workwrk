// Email verification tokens, hashed at rest like password reset tokens
// (src/app/api/auth/forgot-password): the raw token lives only in the
// emailed link and User.verifyToken holds its SHA-256, so a database leak
// yields no working link. Server-only (node crypto).

import crypto from "crypto";

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function hashVerifyToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function newVerifyToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashVerifyToken(raw), expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS) };
}
