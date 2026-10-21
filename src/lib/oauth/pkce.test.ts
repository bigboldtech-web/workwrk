// PKCE, S256 only (docs/plans/mcp-server.md Decision 3, step 1 tests): the
// RFC 7636 appendix B vector, the refusals, and "plain" refused.

import { describe, expect, it } from "vitest";
import { s256, validChallenge, validVerifier, verifyPkce } from "./pkce";

// RFC 7636 Appendix B.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("PKCE (S256 only)", () => {
  it("matches the RFC 7636 vector", () => {
    expect(s256(VERIFIER)).toBe(CHALLENGE);
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
  });

  it("refuses a wrong, short, long or malformed verifier and a malformed challenge", () => {
    expect(verifyPkce(VERIFIER.slice(0, -1) + "Y", CHALLENGE)).toBe(false);
    expect(verifyPkce("a".repeat(42), s256("a".repeat(42)))).toBe(false);
    expect(verifyPkce("a".repeat(129), s256("a".repeat(129)))).toBe(false);
    expect(verifyPkce(`${"a".repeat(42)}!`, CHALLENGE)).toBe(false);
    expect(verifyPkce(VERIFIER, `${CHALLENGE}=`)).toBe(false);
    expect(verifyPkce(undefined, CHALLENGE)).toBe(false);
    expect(validVerifier("a".repeat(43))).toBe(true);
    expect(validVerifier("a".repeat(128))).toBe(true);
  });

  it("accepts only an S256 challenge of 43 characters: plain and no method are refused", () => {
    expect(validChallenge(CHALLENGE, "S256")).toBe(true);
    expect(validChallenge(CHALLENGE, "plain")).toBe(false);
    expect(validChallenge(VERIFIER, "plain")).toBe(false);
    expect(validChallenge(CHALLENGE, undefined)).toBe(false);
    expect(validChallenge(CHALLENGE, "s256")).toBe(false);
    expect(validChallenge(CHALLENGE.slice(1), "S256")).toBe(false);
    // A plain "challenge" equal to its verifier can never pass as S256.
    expect(verifyPkce(VERIFIER, VERIFIER)).toBe(false);
  });
});
