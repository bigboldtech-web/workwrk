import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

/**
 * AES-256-GCM helper for OrgSecret. Plaintext credentials never
 * touch the database — we encrypt with a master key from env.
 *
 * Storage format (Json blob):
 *   { v: 1, iv: <hex>, ct: <hex>, tag: <hex> }
 *
 * Master key:
 *   SECRETS_ENCRYPTION_KEY = a 32-byte secret. We accept hex (64
 *   chars), base64 (44 chars with padding), or any other string —
 *   in the last case we SHA-256 it down to 32 bytes so it's always
 *   the right length. Use a real, randomly-generated 32-byte secret
 *   in prod; the SHA-256 fallback exists so dev environments don't
 *   need extra setup.
 *
 * Generating one:
 *   openssl rand -hex 32
 */

interface CipherBlob {
  v: 1;
  iv: string;
  ct: string;
  tag: string;
}

function masterKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) throw new Error("SECRETS_ENCRYPTION_KEY is not set");
  // Hex (64 chars) or base64 (44 chars with =) — try those first.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length === 44) {
    return Buffer.from(raw, "base64");
  }
  // Fallback: hash the input down to a 32-byte key.
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): CipherBlob {
  if (!plaintext) throw new Error("Cannot encrypt an empty string");
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("hex"),
    ct: ct.toString("hex"),
    tag: tag.toString("hex"),
  };
}

export function decryptSecret(blob: unknown): string {
  if (!blob || typeof blob !== "object") throw new Error("Invalid cipher blob");
  const b = blob as CipherBlob;
  if (b.v !== 1) throw new Error(`Unsupported cipher version: ${b.v}`);
  const key = masterKey();
  const iv = Buffer.from(b.iv, "hex");
  const ct = Buffer.from(b.ct, "hex");
  const tag = Buffer.from(b.tag, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Last 4 chars of a key, used as a non-secret hint in the UI. */
export function keyHint(plaintext: string): string {
  if (plaintext.length <= 4) return "…" + plaintext;
  return "…" + plaintext.slice(-4);
}
