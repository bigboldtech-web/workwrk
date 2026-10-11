import { afterEach, describe, expect, it } from "vitest";
import { decryptBytes, decryptSecret, decryptSecretWith, encryptBytes, encryptSecret, encryptSecretWith } from "./secrets-crypto";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);
const saved = process.env.SECRETS_ENCRYPTION_KEY;
const savedPrevious = process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS;
afterEach(() => {
  if (saved === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = saved;
  if (savedPrevious === undefined) delete process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS;
  else process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS = savedPrevious;
});

describe("secrets-crypto", () => {
  it("round-trips with the configured key, as before", () => {
    process.env.SECRETS_ENCRYPTION_KEY = OLD;
    const blob = encryptSecret("sk-ant-test-value");
    expect(decryptSecret(blob)).toBe("sk-ant-test-value");
  });
  it("re-encrypts from one key to another, and the old key no longer opens it", () => {
    const blob = encryptSecretWith("sk-ant-test-value", OLD);
    const moved = encryptSecretWith(decryptSecretWith(blob, OLD), NEW);
    expect(decryptSecretWith(moved, NEW)).toBe("sk-ant-test-value");
    expect(() => decryptSecretWith(moved, OLD)).toThrow();
    // The app, once it holds the new key, opens the moved blob.
    process.env.SECRETS_ENCRYPTION_KEY = NEW;
    expect(decryptSecret(moved)).toBe("sk-ant-test-value");
  });
  it("refuses an empty key", () => {
    expect(() => encryptSecretWith("x", "")).toThrow();
    expect(() => decryptSecretWith({}, "")).toThrow();
  });
  it("reads with the previous key while a rotation runs, and writes with the new one", () => {
    const old = encryptSecretWith("sk-ant-test-value", OLD);
    process.env.SECRETS_ENCRYPTION_KEY = NEW;
    delete process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS;
    expect(() => decryptSecret(old)).toThrow();
    process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS = OLD;
    expect(decryptSecret(old)).toBe("sk-ant-test-value");
    const fresh = encryptSecret("sk-ant-new-value");
    expect(decryptSecretWith(fresh, NEW)).toBe("sk-ant-new-value");
    expect(() => decryptSecretWith(fresh, OLD)).toThrow();
  });

  // The computer for AI teammates' pictures (docs/plans/ai-teammates-phase4.md Decision 23).
  it("seals bytes as wks1, iv, tag and ciphertext, and opens them with the previous key during a rotation", () => {
    process.env.SECRETS_ENCRYPTION_KEY = OLD;
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const sealed = encryptBytes(plain);
    expect(sealed.subarray(0, 4).toString("ascii")).toBe("wks1");
    expect(sealed.length).toBe(4 + 12 + 16 + plain.length);
    expect(sealed.includes(Buffer.from([0xff, 0xd8]))).toBe(false);
    expect(decryptBytes(sealed)).toEqual(plain);
    process.env.SECRETS_ENCRYPTION_KEY = NEW;
    delete process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS;
    expect(() => decryptBytes(sealed)).toThrow();
    process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS = OLD;
    expect(decryptBytes(sealed)).toEqual(plain);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptBytes(tampered)).toThrow();
    expect(() => encryptBytes(Buffer.alloc(0))).toThrow();
  });
});
