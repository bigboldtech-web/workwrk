import { describe, expect, it } from "vitest";
import { mfaHoldAllowsApi, mfaHoldAllowsPage, passwordHoldAllowsApi } from "./mfa-hold";

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
  it("opens only the security page, where AI apps are disconnected, and the ways out", () => {
    expect(mfaHoldAllowsPage("/account/security")).toBe(true);
    expect(mfaHoldAllowsPage("/account/security/")).toBe(true);
    expect(mfaHoldAllowsPage("/login")).toBe(true);
    expect(mfaHoldAllowsPage("/account/connections")).toBe(true);
    expect(mfaHoldAllowsPage("/account/securityx")).toBe(false);
    expect(mfaHoldAllowsPage("/account/connectionsx")).toBe(false);
    expect(mfaHoldAllowsPage("/account/profile")).toBe(false);
    expect(mfaHoldAllowsPage("/today")).toBe(false);
  });

  // Review of step 4 of docs/plans/mcp-server.md, L4: the privacy policy says an AI app can be disconnected at any
  // time, and a held session could neither list its apps nor disconnect one. Both holds now may, by those methods
  // only; never an app's changes. Fails on eb8a880b: every connected-apps path was held.
  it("lets either hold list the person's AI apps and disconnect one, by those methods only, never their changes", () => {
    for (const allows of [mfaHoldAllowsApi, passwordHoldAllowsApi]) {
      expect(allows("/api/me/connected-apps", "GET")).toBe(true);
      expect(allows("/api/me/connected-apps/", "get")).toBe(true);
      expect(allows("/api/me/connected-apps/gr_abc", "DELETE")).toBe(true);
      for (const [p, m] of [
        ["/api/me/connected-apps", "POST"],
        ["/api/me/connected-apps", "DELETE"],
        ["/api/me/connected-apps", undefined],
        ["/api/me/connected-apps/gr_abc", "GET"],
        ["/api/me/connected-apps/gr_abc", "PUT"],
        ["/api/me/connected-apps/gr_abc", undefined],
        ["/api/me/connected-apps/gr_abc/activity", "GET"],
        ["/api/me/connected-apps/gr_abc/activity", "DELETE"],
        ["/api/me/connected-appsx", "GET"],
      ] as const) {
        expect(allows(p, m), `${p} ${m}`).toBe(false);
      }
    }
  });
});
