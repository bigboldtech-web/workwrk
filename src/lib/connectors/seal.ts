// How a connector token is kept (docs/plans/ai-teammates-phase3.md Decision
// 16): sealed with AES-256-GCM by src/lib/secrets-crypto.ts, as the same JSON
// blob OrgSecret.encryptedKey holds. A dump of the database holds no token,
// and a key rotation moves these columns with the rest: SEALED_COLUMNS is the
// list scripts/rotate-secrets-key.ts walks.
//
// Server-only: reads the key from the environment.

import { decryptSecret, encryptSecret } from "@/lib/secrets-crypto";

export type Sealed = { v: 1; iv: string; ct: string; tag: string };

/** A token sealed with the current key. An empty one throws: there is nothing to keep. */
export function sealToken(plain: string): Sealed {
  return encryptSecret(plain);
}

/**
 * A sealed token opened: with the current key, or, while a key is being
 * rotated, the previous one (SECRETS_ENCRYPTION_KEY_PREVIOUS). Throws when
 * no key opens it.
 */
export function openToken(blob: unknown): string {
  return decryptSecret(blob);
}

/** Every column that holds a sealed blob, by Prisma model and field. A nullable one may hold none. */
export const SEALED_COLUMNS: ReadonlyArray<{ model: string; column: string; nullable: boolean }> = [
  { model: "orgSecret", column: "encryptedKey", nullable: false },
  { model: "teammateConnection", column: "refreshTokenSealed", nullable: false },
  { model: "teammateConnection", column: "accessTokenSealed", nullable: true },
  { model: "teammateOAuthState", column: "verifierSealed", nullable: false },
  { model: "teammateTokenRevocation", column: "tokenSealed", nullable: false },
];
