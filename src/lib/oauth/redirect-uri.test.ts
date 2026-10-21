// Redirect URIs (docs/plans/mcp-server.md Decision 3, 3.3, 3.4, step 1
// tests): our own hosts, a host under workwrk.com, the Google url?q= shape,
// %2F%2F, javascript:, data:, user information and a fragment refused; the
// cursor scheme and loopback on any port accepted; matching exact.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRedirectUri, matchRedirect, redirectHostOf, redirectLabelOf, withParams } from "./redirect-uri";

const saved = { ...process.env };
beforeEach(() => {
  process.env.NEXTAUTH_URL = "https://app.workwrk.com";
  process.env.APP_HOST = "app.workwrk.com";
  process.env.MARKETING_HOST = "workwrk.com";
  process.env.ADMIN_HOST = "admin.workwrk.com";
  process.env.COOKIE_DOMAIN = ".workwrk.com";
});
afterEach(() => {
  process.env = { ...saved };
});

const refused = (u: string) => expect(checkRedirectUri(u).ok, u).toBe(false);
const accepted = (u: string) => expect(checkRedirectUri(u).ok, u).toBe(true);

describe("which redirect URIs may be registered", () => {
  it("refuses our own hosts, and any host at or under workwrk.com or COOKIE_DOMAIN", () => {
    refused("https://app.workwrk.com/oauth/consent");
    refused("https://workwrk.com/callback");
    refused("https://admin.workwrk.com/callback");
    refused("https://x.workwrk.com/callback");
    refused("https://APP.WORKWRK.COM./callback");
    process.env.COOKIE_DOMAIN = ".example-tenant.test";
    process.env.APP_HOST = "app.example-tenant.test";
    refused("https://files.example-tenant.test/cb");
    refused("https://app.example-tenant.test/cb");
    // workwrk.com stays ours whatever COOKIE_DOMAIN says.
    refused("https://y.workwrk.com/cb");
  });

  it("refuses an address that carries another address (the Google url?q= shape, %2F%2F, //)", () => {
    refused("https://www.google.com/url?q=https://evil.example/steal");
    refused("https://www.google.com/url?q=https%3A%2F%2Fevil.example");
    refused("https://good.example/next/%2F%2Fevil.example");
    refused("https://good.example//evil.example/x");
    refused("https://good.example/r?to=http:evil.example");
    refused("cursor://anysphere.cursor-retrieval/oauth?next=https://evil.example");
  });

  it("refuses javascript:, data:, other browser schemes, plain http off this computer, user information, fragments and spaces", () => {
    refused("javascript:alert(1)");
    refused("data:text/html,<script>alert(1)</script>");
    refused("file:///etc/passwd");
    refused("chrome-extension://abc/cb");
    refused("http://evil.example/callback");
    refused("https://claude.ai@evil.example/callback");
    refused("https://user:pass@evil.example/callback");
    refused("https://claude.ai/callback#x");
    refused("https://claude.ai/call back");
    refused("x:/cb");
    refused(`https://claude.ai/${"a".repeat(2000)}`);
    refused("");
  });

  it("accepts https elsewhere, the cursor scheme and loopback http on any port", () => {
    accepted("https://claude.ai/api/mcp/auth_callback");
    accepted("https://chatgpt.com/connector_platform_oauth_redirect");
    accepted("cursor://anysphere.cursor-retrieval/oauth/user-workwrk/callback");
    accepted("com.example.app:/oauth2redirect");
    accepted("http://127.0.0.1:18799/callback");
    accepted("http://localhost:33418/callback");
    accepted("http://[::1]/callback");
  });

  // Review of step 1: the private-scheme rule stays, minus the launch schemes that open something other than an MCP client.
  it("refuses well-known launch schemes that are not MCP clients, and keeps the editors' and AI apps'", () => {
    for (const u of [
      "ms-settings:privacy", "ms-word:ofe|u|https://x", "ms-excel://cb", "microsoft-edge:https://x", "edge://settings", "mailto:a@b.example",
      "tel:+15550100", "sms:+15550100", "file:///cb", "javascript://cb", "data://cb", "about://blank", "blob://cb", "chrome://settings",
      "callto://x", "facetime://x", "skype:x", "webcal://x/cb", "itms-apps://x", "market://details", "search-ms:query=x", "shell:startup", "steam://x",
    ]) refused(u);
    for (const u of ["cursor://anysphere.cursor-retrieval/cb", "vscode://anthropic.claude-code/cb", "vscode-insiders://x/cb", "windsurf://x/cb", "claude://cb", "com.example.app:/cb"]) accepted(u);
  });

  it("refuses our own server's loopback address in local development", () => {
    process.env.NEXTAUTH_URL = "http://localhost:3016";
    refused("http://localhost:3016/oauth/consent");
    refused("http://127.0.0.1:3016/cb");
    accepted("http://127.0.0.1:18799/callback");
  });
});

describe("matching a request's redirect", () => {
  it("is exact, except that loopback matches on any port", () => {
    const reg = ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1/callback", "http://localhost:33418/callback"];
    expect(matchRedirect(reg, "https://claude.ai/api/mcp/auth_callback")).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(matchRedirect(reg, "https://claude.ai/api/mcp/auth_callback/")).toBeNull();
    expect(matchRedirect(reg, "https://claude.ai/api/mcp/auth_callback?x=1")).toBeNull();
    expect(matchRedirect(reg, "http://127.0.0.1:18799/callback")).toBe("http://127.0.0.1:18799/callback");
    expect(matchRedirect(reg, "http://localhost:51000/callback")).toBe("http://localhost:51000/callback");
    // The loopback host itself must match.
    expect(matchRedirect(["http://127.0.0.1/callback"], "http://localhost:18799/callback")).toBeNull();
    expect(matchRedirect(reg, "http://127.0.0.1:18799/other")).toBeNull();
  });

  it("uses the only registered one when none is given, and none when several are", () => {
    expect(matchRedirect(["https://claude.ai/cb"], null)).toBe("https://claude.ai/cb");
    expect(matchRedirect(["https://claude.ai/cb", "https://claude.ai/cb2"], null)).toBeNull();
  });
});

describe("what a redirect is called", () => {
  it("names the host, this computer, or the app scheme", () => {
    expect(redirectHostOf("https://Claude.AI/cb")).toBe("claude.ai");
    expect(redirectHostOf("http://127.0.0.1:18799/callback")).toBe("localhost");
    expect(redirectHostOf("cursor://anysphere.cursor-retrieval/x")).toBe("cursor:");
    expect(redirectLabelOf("https://claude.ai/cb")).toBe("claude.ai");
    expect(redirectLabelOf("http://127.0.0.1:18799/callback")).toBe("an app on this computer");
    expect(redirectLabelOf("cursor://anysphere.cursor-retrieval/x")).toBe("the cursor app");
    expect(redirectLabelOf(`https://${"a".repeat(70)}.example/cb`).length).toBeLessThanOrEqual(60);
  });

  it("keeps the redirect's own query when it adds the answer", () => {
    expect(withParams("https://claude.ai/cb?x=1", { code: "c", state: null })).toBe("https://claude.ai/cb?x=1&code=c");
    expect(withParams("cursor://a.b/cb", { code: "c" })).toBe("cursor://a.b/cb?code=c");
  });
});
