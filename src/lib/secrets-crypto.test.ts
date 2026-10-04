import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, decryptSecretWith, encryptSecret, encryptSecretWith } from "./secrets-crypto";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);
const saved = process.env.SECRETS_ENCRYPTION_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = saved;
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
});
