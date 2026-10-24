// Every other /.well-known/ path answers a bare 404 for every method, offered
// or not (final review of the MCP server, contract L4). Fails on fcca4075:
// the route did not exist, and such a path reached the app's catch-all page,
// which answers 200 with HTML.

import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as rest from "@/app/.well-known/[...rest]/route";
import * as asRoute from "@/app/.well-known/oauth-authorization-server/route";
import * as prRoute from "@/app/.well-known/oauth-protected-resource/route";
import * as prSuffix from "@/app/.well-known/oauth-protected-resource/api/mcp/route";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
type Handler = (req: Request) => Response | Promise<Response>;

const saved = { ...process.env };
beforeEach(() => {
  process.env = { ...saved };
  process.env.NEXTAUTH_URL = "https://app.workwrk.com";
  process.env.APP_HOST = "app.workwrk.com";
});
afterEach(() => {
  process.env = { ...saved };
});

const req = (path: string, method: string) =>
  new Request(`https://app.workwrk.com${path}`, {
    method,
    headers: { host: "app.workwrk.com" },
    ...(method === "GET" || method === "HEAD" ? {} : { body: "{}" }),
  });

describe("/.well-known/[...rest]", () => {
  for (const offered of [false, true]) {
    it(`is a bare 404 for every method and every path ${offered ? "while MCP_OFFERED=1" : "while MCP_OFFERED is unset"}`, async () => {
      if (offered) process.env.MCP_OFFERED = "1";
      else delete process.env.MCP_OFFERED;
      for (const path of ["/.well-known/oauth-authorization-server/api/mcp", "/.well-known/oauth-protected-resource/x", "/.well-known/security.txt", "/.well-known/anything/at/all"]) {
        for (const m of METHODS) {
          const handler = (rest as unknown as Record<string, Handler>)[m];
          expect(typeof handler, m).toBe("function");
          const res = await handler(req(path, m));
          expect(res.status, `${m} ${path}`).toBe(404);
          expect(res.headers.get("content-type") ?? "", m).not.toContain("html");
          expect(res.headers.get("content-type") ?? "", m).not.toContain("json");
          expect(res.headers.get("cache-control") ?? "", m).toContain("no-store");
        }
      }
    });
  }

  it("shadows none of the well-known documents: each keeps its own static route, which answers while offered", async () => {
    for (const dir of ["oauth-authorization-server", "oauth-protected-resource", "oauth-protected-resource/api/mcp", "openid-configuration"]) {
      expect(existsSync(`src/app/.well-known/${dir}/route.ts`), dir).toBe(true);
    }
    process.env.MCP_OFFERED = "1";
    for (const [path, mod] of [
      ["/.well-known/oauth-authorization-server", asRoute],
      ["/.well-known/oauth-protected-resource", prRoute],
      ["/.well-known/oauth-protected-resource/api/mcp", prSuffix],
    ] as const) {
      const res = await (mod as unknown as Record<string, Handler>).GET(req(path, "GET"));
      expect(res.status, path).toBe(200);
    }
  });
});
