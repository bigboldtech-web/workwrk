import { describe, expect, it } from "vitest";
import { mfaHoldAllowsApi, mfaHoldAllowsPage } from "./mfa-hold";

describe("mfa hold gate", () => {
  it("lets a held session enrol, read itself and sign out", () => {
    for (const p of ["/api/auth/mfa/enroll", "/api/auth/session", "/api/auth/signout", "/api/boot", "/api/me", "/api/me/", "/api/me/security-activity", "/api/preferences"]) {
      expect(mfaHoldAllowsApi(p)).toBe(true);
    }
  });
  it("refuses everything else, including the rest of /api/me", () => {
    for (const p of ["/api/me/delete", "/api/me/change-password", "/api/items/1", "/api/users", "/api/meeting", "/api/bootstrap", "/api/authx"]) {
      expect(mfaHoldAllowsApi(p)).toBe(false);
    }
  });
  it("opens only the security page and the ways out", () => {
    expect(mfaHoldAllowsPage("/account/security")).toBe(true);
    expect(mfaHoldAllowsPage("/account/security/")).toBe(true);
    expect(mfaHoldAllowsPage("/login")).toBe(true);
    expect(mfaHoldAllowsPage("/account/securityx")).toBe(false);
    expect(mfaHoldAllowsPage("/account/profile")).toBe(false);
    expect(mfaHoldAllowsPage("/today")).toBe(false);
  });
});
