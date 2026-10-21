// PKCE, S256 only (RFC 7636; docs/plans/mcp-server.md Decision 3, 3.4, 3.5).
//
// The challenge is base64url(SHA-256(verifier)) without padding: exactly 43
// characters (the SQL CHECK holds it to that). "plain" is refused at the
// authorization request, so a verifier can never be its own challenge.
// The verifier is 43 to 128 unreserved characters. Compared in constant time.
//
// Pure (node:crypto only).

import { createHash, timingSafeEqual } from "node:crypto";

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** Is this a challenge and method WorkwrK accepts? Only S256, only a 43 character challenge. */
export function validChallenge(challenge: unknown, method: unknown): boolean {
  return method === "S256" && typeof challenge === "string" && CHALLENGE.test(challenge);
}

/** Is this a well-formed verifier? */
export function validVerifier(verifier: unknown): verifier is string {
  return typeof verifier === "string" && VERIFIER.test(verifier);
}

/** The S256 challenge of a verifier. */
export function s256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Does the verifier answer the challenge? False for any malformed input. */
export function verifyPkce(verifier: unknown, challenge: unknown): boolean {
  if (!validVerifier(verifier) || typeof challenge !== "string" || !CHALLENGE.test(challenge)) return false;
  const want = Buffer.from(challenge, "ascii");
  const got = Buffer.from(s256(verifier), "ascii");
  return want.length === got.length && timingSafeEqual(want, got);
}
