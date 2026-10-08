// Connector tokens sealed (src/lib/connectors/seal.ts): a token opens again
// with the key it was sealed with, keeps opening while the key is rotated,
// and a sealed blob never holds the token's text.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEALED_COLUMNS, openToken, sealToken } from "./seal";

const OLD_KEY = "a".repeat(64);
const NEW_KEY = "b".repeat(64);
const saved = { key: process.env.SECRETS_ENCRYPTION_KEY, previous: process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS };

function setKeys(key: string | undefined, previous: string | undefined): void {
  if (key === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = key;
  if (previous === undefined) delete process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS;
  else process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS = previous;
}

beforeEach(() => setKeys(OLD_KEY, undefined));
afterEach(() => setKeys(saved.key, saved.previous));

describe("sealToken and openToken", () => {
  it("round-trips, and the blob holds no token text", () => {
    const blob = sealToken("1//refresh-token-text");
    expect(blob).toMatchObject({ v: 1, iv: expect.any(String), ct: expect.any(String), tag: expect.any(String) });
    expect(JSON.stringify(blob)).not.toContain("refresh-token-text");
    expect(openToken(blob)).toBe("1//refresh-token-text");
  });

  it("opens a blob sealed with the previous key while the key is rotated", () => {
    const blob = sealToken("ya29.access");
    setKeys(NEW_KEY, OLD_KEY);
    expect(openToken(blob)).toBe("ya29.access");
    // New tokens are sealed with the new key only.
    const fresh = sealToken("ya29.fresh");
    setKeys(NEW_KEY, undefined);
    expect(openToken(fresh)).toBe("ya29.fresh");
    expect(() => openToken(blob)).toThrow();
  });

  it("refuses an empty token and anything that is not a sealed blob", () => {
    expect(() => sealToken("")).toThrow();
    expect(() => openToken("")).toThrow();
    expect(() => openToken({ v: 2, iv: "", ct: "", tag: "" })).toThrow();
  });
});

describe("SEALED_COLUMNS", () => {
  it("lists every sealed column the key rotation must move", () => {
    expect(SEALED_COLUMNS.map((c) => `${c.model}.${c.column}`).sort()).toEqual([
      "orgSecret.encryptedKey",
      "teammateConnection.accessTokenSealed",
      "teammateConnection.refreshTokenSealed",
      "teammateOAuthState.verifierSealed",
      "teammateTokenRevocation.tokenSealed",
    ]);
    expect(SEALED_COLUMNS.filter((c) => c.nullable).map((c) => c.column)).toEqual(["accessTokenSealed"]);
  });
});
