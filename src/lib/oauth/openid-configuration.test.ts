// /.well-known/openid-configuration answers 404 for every method, offered or
// not (docs/plans/mcp-server.md 3.1). Found by the live proof (M1): with no
// route of its own the path reached the app's catch-all page, which answers
// 200 with a login redirect inside the page. Fails on the code before the
// fix: the route did not exist.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as route from "@/app/.well-known/openid-configuration/route";

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

const req = (method: string) =>
  new Request("https://app.workwrk.com/.well-known/openid-configuration", {
    method,
    headers: { host: "app.workwrk.com" },
    ...(method === "GET" || method === "HEAD" ? {} : { body: "{}" }),
  });

describe("/.well-known/openid-configuration", () => {
  for (const offered of [false, true]) {
    it(`is a bare 404 for every method ${offered ? "while MCP_OFFERED=1" : "while MCP_OFFERED is unset"}`, async () => {
      if (offered) process.env.MCP_OFFERED = "1";
      else delete process.env.MCP_OFFERED;
      for (const m of METHODS) {
        const handler = (route as unknown as Record<string, Handler>)[m];
        expect(typeof handler, m).toBe("function");
        const res = await handler(req(m));
        expect(res.status, m).toBe(404);
        expect(res.headers.get("content-type") ?? "", m).not.toContain("json");
        expect(res.headers.get("cache-control") ?? "", m).toContain("no-store");
      }
    });
  }
});
