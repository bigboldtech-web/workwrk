import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

/**
 * AES-256-GCM helper for IntegrationConnection tokens. Plaintext
 * OAuth/API credentials never touch the database — we encrypt with a
 * master key from env before writing `accessTokenEncrypted` /
 * `refreshTokenEncrypted`.
 *
 * Storage format (string column): compact JSON
 *   {"v":1,"iv":"<hex>","ct":"<hex>","tag":"<hex>"}
 *
 * Master key:
 *   AUTOMATION_ENC_KEY = a 32-byte secret. Accepts hex (64 chars),
 *   base64 (44 chars with padding), or any other string — in the last
 *   case we SHA-256 it down to 32 bytes so it's always the right
 *   length. Use a real, randomly-generated 32-byte secret in prod
 *   (`openssl rand -hex 32`); the SHA-256 fallback keeps dev setups
 *   friction-free.
 *
 * NOTE: connections are catalog stubs for now (no OAuth flows), but
 * every future token write MUST route through these helpers.
 */

interface CipherBlob {
  v: 1;
  iv: string;
  ct: string;
  tag: string;
}

/** True when AUTOMATION_ENC_KEY is configured — callers can gate UI hints. */
export function isAutomationCryptoConfigured(): boolean {
  return Boolean(process.env.AUTOMATION_ENC_KEY);
}

function masterKey(): Buffer {
  const raw = process.env.AUTOMATION_ENC_KEY;
  if (!raw) throw new Error("AUTOMATION_ENC_KEY is not set");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length === 44) {
    return Buffer.from(raw, "base64");
  }
  // Fallback: hash the input down to a 32-byte key.
  return createHash("sha256").update(raw).digest();
}

/** Encrypt a token for storage in an *Encrypted column. */
export function encryptToken(plaintext: string): string {
  if (!plaintext) throw new Error("Cannot encrypt an empty string");
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob: CipherBlob = {
    v: 1,
    iv: iv.toString("hex"),
    ct: ct.toString("hex"),
    tag: tag.toString("hex"),
  };
  return JSON.stringify(blob);
}

/** Decrypt a token previously produced by `encryptToken`. */
export function decryptToken(stored: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new Error("Invalid cipher blob");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid cipher blob");
  const b = parsed as CipherBlob;
  if (b.v !== 1) throw new Error(`Unsupported cipher version: ${b.v}`);
  const key = masterKey();
  const iv = Buffer.from(b.iv, "hex");
  const ct = Buffer.from(b.ct, "hex");
  const tag = Buffer.from(b.tag, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
