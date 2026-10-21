// The discovery documents (docs/plans/mcp-server.md 3.2, step 1 tests
// "metadata: exact, plus OPTIONS"), served by the three .well-known routes.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as asRoute from "@/app/.well-known/oauth-authorization-server/route";
import * as prRoute from "@/app/.well-known/oauth-protected-resource/route";
import * as prSuffixRoute from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import { requestedScopes } from "./metadata";

const saved = { ...process.env };
beforeEach(() => {
  process.env.MCP_OFFERED = "1";
  process.env.NEXTAUTH_URL = "https://app.workwrk.com";
  process.env.APP_HOST = "app.workwrk.com";
  process.env.MCP_DOCS_URL = "https://docs.workwrk.com/connect-an-ai-app";
});
afterEach(() => {
  process.env = { ...saved };
});

const get = (url: string, method = "GET") => new Request(url, { method, headers: { host: "app.workwrk.com" } });

describe("the protected resource metadata (RFC 9728)", () => {
  it("is exact, at the root and at the /api/mcp suffix", async () => {
    for (const route of [prRoute, prSuffixRoute]) {
      const res = route.GET(get("https://app.workwrk.com/.well-known/oauth-protected-resource/api/mcp"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(await res.json()).toEqual({
        resource: "https://app.workwrk.com/api/mcp",
        authorization_servers: ["https://app.workwrk.com"],
        scopes_supported: ["mcp:read", "mcp:write"],
        bearer_methods_supported: ["header"],
        resource_name: "WorkwrK",
        resource_documentation: "https://docs.workwrk.com/connect-an-ai-app",
      });
    }
  });
});

describe("the authorization server metadata (RFC 8414)", () => {
  it("is exact", async () => {
    const res = asRoute.GET(get("https://app.workwrk.com/.well-known/oauth-authorization-server"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issuer: "https://app.workwrk.com",
      authorization_endpoint: "https://app.workwrk.com/oauth/authorize",
      token_endpoint: "https://app.workwrk.com/api/oauth/token",
      registration_endpoint: "https://app.workwrk.com/api/oauth/register",
      revocation_endpoint: "https://app.workwrk.com/api/oauth/revoke",
      scopes_supported: ["mcp:read", "mcp:write"],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
      service_documentation: "https://docs.workwrk.com/connect-an-ai-app",
    });
  });

  it("leaves the documentation out while MCP_DOCS_URL is unset, never a guess", async () => {
    delete process.env.MCP_DOCS_URL;
    expect(await asRoute.GET(get("https://app.workwrk.com/x")).json()).not.toHaveProperty("service_documentation");
    expect(await prRoute.GET(get("https://app.workwrk.com/x")).json()).not.toHaveProperty("resource_documentation");
  });
});

describe("the preflight of every discovery document", () => {
  it("allows GET and OPTIONS and the headers a 2025-06-18 browser client sends", () => {
    for (const route of [prRoute, prSuffixRoute, asRoute]) {
      const res = route.OPTIONS(get("https://app.workwrk.com/x", "OPTIONS"));
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
      expect(res.headers.get("access-control-allow-headers")).toBe("MCP-Protocol-Version, Content-Type, Authorization");
    }
  });
});

describe("requested scopes (3.4 step 4)", () => {
  it("drops unknown ones, lets write imply read, and gives both when none is left", () => {
    expect(requestedScopes("mcp:read")).toEqual(["mcp:read"]);
    expect(requestedScopes("mcp:write")).toEqual(["mcp:read", "mcp:write"]);
    expect(requestedScopes("openid profile")).toEqual(["mcp:read", "mcp:write"]);
    expect(requestedScopes(null)).toEqual(["mcp:read", "mcp:write"]);
    expect(requestedScopes("mcp:read admin")).toEqual(["mcp:read"]);
  });
});
