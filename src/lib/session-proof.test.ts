import { describe, it, expect, beforeAll } from "vitest";
import { issueTokenVersionProof, verifyTokenVersionProof } from "./session-proof";

describe("tokenVersion sync proof", () => {
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-for-session-proof";
  });

  it("verifies only for the same user and the exact bump", () => {
    const proof = issueTokenVersionProof("u1", 3, 4);
    expect(proof).toBeTruthy();
    expect(verifyTokenVersionProof(proof, "u1", 3, 4)).toBe(true);
    expect(verifyTokenVersionProof(proof, "u2", 3, 4)).toBe(false);
    expect(verifyTokenVersionProof(proof, "u1", 4, 5)).toBe(false);
    expect(verifyTokenVersionProof(proof, "u1", 2, 4)).toBe(false);
  });

  it("refuses a missing or malformed proof", () => {
    expect(verifyTokenVersionProof(undefined, "u1", 0, 1)).toBe(false);
    expect(verifyTokenVersionProof("", "u1", 0, 1)).toBe(false);
    expect(verifyTokenVersionProof({}, "u1", 0, 1)).toBe(false);
    expect(verifyTokenVersionProof("not-a-proof", "u1", 0, 1)).toBe(false);
  });
});
