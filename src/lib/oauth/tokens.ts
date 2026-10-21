// The OAuth server's secrets (docs/plans/mcp-server.md 3.7).
//
// Every secret is `randomBytes(32).toString("base64url")`, 43 characters,
// behind a prefix that names what it is, and is stored ONLY as its SHA-256
// hex (the row's id for codes, requests and tokens; OAuthClient.secretHash
// for a client secret). A database leak yields no working secret. A client
// id is not a secret: "wkc_" + 32 characters, stored as itself.
//
// "Well formed" is the shape alone (the prefix and 43 base64url characters):
// the rate limits count traffic by address only when no well-formed
// credential is sent (Decision 15), so a valid caller behind a shared address
// is never blocked by strangers there.
//
// Pure (node:crypto only).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PREFIX = {
  clientSecret: "wkmcp_cs_",
  request: "wkmcp_rq_",
  code: "wkmcp_ac_",
  access: "wkmcp_at_",
  refresh: "wkmcp_rt_",
} as const;

export type SecretKind = keyof typeof PREFIX;

const BODY = /^[A-Za-z0-9_-]{43}$/;
const CLIENT_ID = /^wkc_[A-Za-z0-9_-]{32}$/;

/** A new secret of this kind: the prefix and 43 base64url characters. */
export function newSecret(kind: SecretKind): string {
  return `${PREFIX[kind]}${randomBytes(32).toString("base64url")}`;
}

/** A new client id: "wkc_" and 32 base64url characters. */
export function newClientId(): string {
  return `wkc_${randomBytes(24).toString("base64url")}`;
}

/** A new token family id (not a secret; it names a chain of tokens). */
export function newFamilyId(): string {
  return `fam_${randomBytes(18).toString("base64url")}`;
}

/** The stored form of a secret: SHA-256 hex. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** True when `value` has this kind's shape. */
export function isWellFormed(kind: SecretKind, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const p = PREFIX[kind];
  return value.length === p.length + 43 && value.startsWith(p) && BODY.test(value.slice(p.length));
}

/** True when `value` has a client id's shape. */
export function isClientIdShape(value: unknown): value is string {
  return typeof value === "string" && CLIENT_ID.test(value);
}

/** Two hex digests compared in constant time (false when either is not 64 hex characters). */
export function sameHash(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** A presented secret against a stored hash, in constant time. */
export function secretMatches(presented: string, storedHash: string | null | undefined): boolean {
  return sameHash(hashSecret(presented), storedHash ?? null);
}
