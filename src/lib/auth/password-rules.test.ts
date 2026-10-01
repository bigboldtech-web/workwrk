import { describe, expect, it } from "vitest";
import { validatePassword } from "@/lib/password-policy";
import { parsePolicyView, passwordChecklist, passwordMeets, policyView } from "./password-rules";

const SAMPLES = ["", "short1A", "alllowercase1", "ALLUPPERCASE", "Abcdefgh", "Abcdefg1", "Abcdefghijk1", "12345678", "Aa1Aa1Aa1Aa1"];
const POLICIES = [
  undefined,
  { minPasswordLength: 12, requireUppercase: true, requireNumbers: true },
  { minPasswordLength: 8, requireUppercase: false, requireNumbers: false },
  { minPasswordLength: 4, requireUppercase: false, requireNumbers: true },
];

describe("password rules", () => {
  it("never shows a rule the server does not enforce, or hides one it does", () => {
    for (const policy of POLICIES) {
      const view = policyView(policy);
      for (const pw of SAMPLES) {
        const allMet = passwordChecklist(pw, view).every((r) => r.met);
        expect(allMet).toBe(validatePassword(pw, policy) === null);
        expect(passwordMeets(pw, view)).toBe(validatePassword(pw, policy) === null);
      }
    }
  });

  it("floors the length at 8 exactly as validatePassword does", () => {
    expect(policyView({ minPasswordLength: 4 }).minLength).toBe(8);
    expect(passwordChecklist("x", policyView({ minPasswordLength: 4 }))[0].label).toBe("At least 8 characters");
  });

  it("lists only the rules the policy turns on", () => {
    const keys = passwordChecklist("", policyView({ requireUppercase: false, requireNumbers: true })).map((r) => r.key);
    expect(keys).toEqual(["length", "number"]);
  });

  it("reads a wire view defensively as the platform default", () => {
    expect(parsePolicyView(null)).toEqual({ minLength: 8, requireUppercase: true, requireNumbers: true, requireSymbol: false });
    expect(parsePolicyView({ minLength: "12", requireUppercase: "no" })).toEqual({ minLength: 8, requireUppercase: true, requireNumbers: true, requireSymbol: false });
    expect(parsePolicyView({ minLength: 14, requireUppercase: false, requireNumbers: false })).toEqual({ minLength: 14, requireUppercase: false, requireNumbers: false, requireSymbol: false });
  });

  it("adds the symbol rule when the workspace requires it, and the server agrees", () => {
    const view = policyView({ requireSymbol: true });
    expect(passwordChecklist("Abcdefg1", view).map((r) => [r.key, r.met])).toContainEqual(["symbol", false]);
    expect(passwordMeets("Abcdefg1", view)).toBe(false);
    expect(passwordMeets("Abcdefg1!", view)).toBe(true);
    expect(validatePassword("Abcdefg1", { requireSymbol: true })).toMatch(/symbol/);
  });
});
