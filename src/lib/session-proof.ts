import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proof that lets ONE session carry a tokenVersion bump it caused itself.
 *
 * A password change bumps User.tokenVersion so every other session is signed
 * out, and the session that made the change calls session.update() to stay
 * signed in. The jwt "update" branch must not copy the new version into any
 * token that asks: a stolen or stale cookie would come straight back after a
 * Sign out everywhere or a staff suspension. So the route that bumps the
 * version hands its caller a proof bound to the user and to the exact
 * from and to versions, and the update branch syncs only a token that
 * presents it. Anything else with a mismatched version is revoked.
 */

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "";
}

function sign(userId: string, from: number, to: number): string {
  return createHmac("sha256", secret()).update(`token-version-sync:${userId}:${from}:${to}`).digest("base64url");
}

export function issueTokenVersionProof(userId: string, from: number, to: number): string | null {
  if (!secret()) return null;
  return sign(userId, from, to);
}

export function verifyTokenVersionProof(proof: unknown, userId: string, from: number, to: number): boolean {
  if (typeof proof !== "string" || !proof || !secret()) return false;
  const expected = Buffer.from(sign(userId, from, to));
  const given = Buffer.from(proof);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
