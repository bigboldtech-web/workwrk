// The proxy and the MCP server's OAuth paths (docs/plans/mcp-server.md 3.1,
// step 1 tests): /oauth is an app path, so the apex sends it to the app host
// (308) and the app host answers it no-store (both failed before step 1);
// the discovery documents pass untouched on the app host and are the
// marketing 404 on the apex (a guard: true before too); the OAuth and MCP
// endpoints ignore cookies, so a held session's cookie never holds them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const st = vi.hoisted(() => ({ token: null as null | Record<string, unknown> }));
vi.mock("next-auth/jwt", () => ({ getToken: async () => st.token }));

import { proxy } from "./proxy";

const APP = "app.workwrk.test";
const MKT = "workwrk.test";

function req(url: string, host: string, cookie?: string, method = "GET") {
  const headers = new Headers({ host });
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(url, `https://${host}`), { headers, method });
}

const saved = { ...process.env };
beforeEach(() => {
  process.env.AUTH_EDGE_GATE = "true";
  process.env.HARD_HOST_SPLIT = "true";
  process.env.APP_HOST = APP;
  process.env.MARKETING_HOST = MKT;
  delete process.env.ADMIN_HOST;
  st.token = null;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("the OAuth pages under the host split", () => {
  it("sends /oauth on the apex to the app host with its query (308)", async () => {
    const res = await proxy(req("/oauth/authorize?client_id=wkc_x&state=s", MKT));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`https://${APP}/oauth/authorize?client_id=wkc_x&state=s`);
  });

  it("answers /oauth on the app host no-store, and never bounces a signed-out visitor at the edge", async () => {
    for (const p of ["/oauth/authorize?client_id=wkc_x", "/oauth/consent?request=wkmcp_rq_x"]) {
      const res = await proxy(req(p, APP));
      expect(res.headers.get("location"), p).toBeNull();
      expect(res.headers.get("cache-control"), p).toBe("no-store, max-age=0, must-revalidate");
    }
  });
});

describe("the discovery documents (a guard)", () => {
  it("pass untouched on the app host and are the marketing 404 on the apex", async () => {
    for (const p of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
      const app = await proxy(req(p, APP));
      expect(app.headers.get("location"), p).toBeNull();
      expect(app.headers.get("x-middleware-rewrite"), p).toBeNull();
      const apex = await proxy(req(p, MKT));
      expect(apex.headers.get("x-middleware-rewrite") ?? "", p).toContain("/404");
    }
  });
});

describe("the endpoints that ignore cookies", () => {
  it("never hold the OAuth or MCP endpoints for a held session's cookie, and still hold the rest of the API", async () => {
    st.token = { mfaHold: true };
    for (const p of ["/api/oauth/token", "/api/oauth/register", "/api/oauth/revoke", "/api/mcp"]) {
      const res = await proxy(req(p, APP, "next-auth.session-token=x", "POST"));
      expect(res.status, p).toBe(200);
    }
    const held = await proxy(req("/api/boards", APP, "next-auth.session-token=x"));
    expect(held.status).toBe(403);
  });
});

// Review of the longer-sessions fix (the getToken callers): a session that
// ended, by a plain log out or any other policy end, is held by nothing, so
// its next call answers as signed out and the person is asked to log in
// again, not sent to set up two step verification or change a password.
describe("an ended session's cookie", () => {
  it("is never held, for either hold, on the API or a page", async () => {
    for (const reason of ["logged_out", "unchecked", "idle", "signed_out"]) {
      for (const hold of [{ mfaHold: true }, { passwordHold: true }]) {
        st.token = { ...hold, policyEnded: true, policyEndedReason: reason };
        const api = await proxy(req("/api/boards", APP, "next-auth.session-token=x"));
        expect(api.status, `${reason} ${Object.keys(hold)[0]} api`).toBe(200);
        const page = await proxy(req("/account/profile", APP, "next-auth.session-token=x"));
        expect(page.headers.get("location"), `${reason} ${Object.keys(hold)[0]} page`).toBeNull();
      }
    }
    // A live one still is.
    st.token = { mfaHold: true };
    expect((await proxy(req("/api/boards", APP, "next-auth.session-token=x"))).status).toBe(403);
  });
});

// Review of step 4 of docs/plans/mcp-server.md, L4: under either hold, the person's own AI apps can be listed and
// disconnected (the privacy policy's "at any time"), from the page where that is done, and nothing more of them:
// not their changes, not another method. Fails on eb8a880b: every one of them was held.
describe("a held session and its AI apps", () => {
  it("passes listing and Disconnect, and the page they are on, for both holds; holds the changes and other methods", async () => {
    for (const hold of [{ mfaHold: true }, { passwordHold: true }]) {
      st.token = hold;
      const name = Object.keys(hold)[0];
      for (const [p, m] of [["/api/me/connected-apps", "GET"], ["/api/me/connected-apps/gr_abc", "DELETE"]] as const) {
        const res = await proxy(req(p, APP, "next-auth.session-token=x", m));
        expect(res.status, `${name} ${m} ${p}`).toBe(200);
      }
      const page = await proxy(req("/account/connections", APP, "next-auth.session-token=x"));
      expect(page.headers.get("location"), `${name} page`).toBeNull();
      for (const [p, m] of [["/api/me/connected-apps/gr_abc/activity", "GET"], ["/api/me/connected-apps", "POST"], ["/api/me/connected-apps/gr_abc", "GET"]] as const) {
        const res = await proxy(req(p, APP, "next-auth.session-token=x", m));
        expect(res.status, `${name} ${m} ${p}`).toBe(403);
      }
      const other = await proxy(req("/account/profile", APP, "next-auth.session-token=x"));
      expect(other.headers.get("location"), `${name} other page`).toContain("/account/security");
    }
  });
});
