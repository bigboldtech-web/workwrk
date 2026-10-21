// CORS and the Origin check (docs/plans/mcp-server.md 3.11, 2.1 step 2,
// step 2 tests "cors: the preflight, the OAuth headers, /api/mcp echoing
// allowed origins only, never credentials"). The /api/mcp half fails on the
// code before step 2 (cors.ts did not exist); the OAuth half is a guard
// (oauth-errors.ts answered it since step 1).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { oauthJson, oauthPreflight } from "@/lib/oauth/oauth-errors";
import { checkOrigin, mcpCorsHeaders, mcpPreflight } from "./cors";

const saved = { ...process.env };
beforeEach(() => {
  process.env.NEXTAUTH_URL = "https://app.workwrk.com";
  process.env.MCP_ALLOWED_ORIGINS = "https://claude.ai, https://chatgpt.com/ , not a url";
  (process.env as Record<string, string>).NODE_ENV = "production";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("/api/mcp", () => {
  it("serves no Origin, its own, and the listed ones; refuses any other, look-alikes included", () => {
    expect(checkOrigin(null)).toEqual({ kind: "absent" });
    expect(checkOrigin("https://app.workwrk.com")).toEqual({ kind: "allowed", origin: "https://app.workwrk.com" });
    expect(checkOrigin("https://claude.ai")).toEqual({ kind: "allowed", origin: "https://claude.ai" });
    expect(checkOrigin("https://chatgpt.com")).toEqual({ kind: "allowed", origin: "https://chatgpt.com" });
    expect(checkOrigin("https://app.workwrk.com.evil.example")).toEqual({ kind: "refused", host: "app.workwrk.com.evil.example" });
    expect(checkOrigin("https://evil.claude.ai")).toMatchObject({ kind: "refused" });
    expect(checkOrigin("http://claude.ai")).toMatchObject({ kind: "refused" });
    expect(checkOrigin("null")).toMatchObject({ kind: "refused" });
    // Loopback only outside production.
    expect(checkOrigin("http://localhost:6274")).toMatchObject({ kind: "refused" });
    (process.env as Record<string, string>).NODE_ENV = "development";
    expect(checkOrigin("http://localhost:6274")).toEqual({ kind: "allowed", origin: "http://localhost:6274" });
    expect(checkOrigin("http://127.0.0.1:3000")).toMatchObject({ kind: "allowed" });
  });

  it("echoes an allowed Origin with Vary and the exposed headers, never credentials, and nothing for no Origin", () => {
    const h = mcpCorsHeaders(checkOrigin("https://claude.ai"));
    expect(h).toEqual({ "Access-Control-Allow-Origin": "https://claude.ai", "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version", Vary: "Origin" });
    expect(mcpCorsHeaders(checkOrigin(null))).toEqual({});
    expect(mcpCorsHeaders(checkOrigin("https://evil.example"))).toEqual({});
  });

  it("answers the preflight for an allowed Origin, and 403 with no CORS for a refused one", () => {
    const ok = mcpPreflight(checkOrigin("https://claude.ai"));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
    expect(ok.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(ok.headers.get("access-control-allow-headers")).toBe("Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID");
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
    expect(ok.headers.get("vary")).toBe("Origin");
    const no = mcpPreflight(checkOrigin("https://evil.example"));
    expect(no.status).toBe(403);
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("the OAuth endpoints (guard)", () => {
  it("answer CORS with *, POST and OPTIONS, Content-Type and Authorization, never credentials", () => {
    for (const r of [oauthPreflight(), oauthJson({ ok: true })]) {
      expect(r.headers.get("access-control-allow-origin")).toBe("*");
      expect(r.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
      expect(r.headers.get("access-control-allow-headers")).toBe("Content-Type, Authorization");
      expect(r.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });
});
