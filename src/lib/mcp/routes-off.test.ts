// Every method of every MCP and OAuth route answers 404 while MCP_OFFERED
// is unset (docs/plans/mcp-server.md Decision 1; review of step 2: GET
// /api/oauth/register answered Next's own 405 in production, which says the
// route exists). Each route exports all seven methods, so Next never answers
// for one; a method a route does not take answers 405 once offered. Fails
// on the code before the review fix: the routes exported only the methods
// they take.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
// Any database call throws: while off, nothing is read.
vi.mock("@/lib/prisma", () => {
  const boom = (): unknown =>
    new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? undefined : boom()),
      apply: () => {
        throw new Error("no database read while off");
      },
    });
  return { prisma: boom() };
});

import * as asRoute from "@/app/.well-known/oauth-authorization-server/route";
import * as prRoute from "@/app/.well-known/oauth-protected-resource/route";
import * as prSuffix from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import * as decision from "@/app/(auth)/oauth/decision/route";
import * as policy from "@/app/api/ai-apps/policy/route";
import * as mcp from "@/app/api/mcp/route";
import * as register from "@/app/api/oauth/register/route";
import * as revoke from "@/app/api/oauth/revoke/route";
import * as token from "@/app/api/oauth/token/route";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
type Handler = (req: Request) => Response | Promise<Response>;

const ROUTES: Record<string, { mod: Record<string, unknown>; takes: readonly string[]; allow: string }> = {
  "/.well-known/oauth-authorization-server": { mod: asRoute, takes: ["GET", "HEAD", "OPTIONS"], allow: "GET, HEAD, OPTIONS" },
  "/.well-known/oauth-protected-resource": { mod: prRoute, takes: ["GET", "HEAD", "OPTIONS"], allow: "GET, HEAD, OPTIONS" },
  "/.well-known/oauth-protected-resource/api/mcp": { mod: prSuffix, takes: ["GET", "HEAD", "OPTIONS"], allow: "GET, HEAD, OPTIONS" },
  "/oauth/decision": { mod: decision, takes: ["POST"], allow: "POST" },
  "/api/ai-apps/policy": { mod: policy, takes: ["GET", "PUT"], allow: "GET, PUT" },
  "/api/mcp": { mod: mcp, takes: ["POST", "OPTIONS"], allow: "POST, OPTIONS" },
  "/api/oauth/register": { mod: register, takes: ["POST", "OPTIONS"], allow: "POST, OPTIONS" },
  "/api/oauth/revoke": { mod: revoke, takes: ["POST", "OPTIONS"], allow: "POST, OPTIONS" },
  "/api/oauth/token": { mod: token, takes: ["POST", "OPTIONS"], allow: "POST, OPTIONS" },
};

const saved = { ...process.env };
beforeEach(() => {
  process.env = { ...saved };
  delete process.env.MCP_OFFERED;
  process.env.NEXTAUTH_URL = "https://app.workwrk.com";
  process.env.APP_HOST = "app.workwrk.com";
});
afterEach(() => {
  process.env = { ...saved };
});

const req = (path: string, method: string) =>
  new Request(`https://app.workwrk.com${path}`, {
    method,
    headers: { host: "app.workwrk.com", "content-type": "application/json" },
    ...(method === "GET" || method === "HEAD" ? {} : { body: "{}" }),
  });

describe("while MCP_OFFERED is unset", () => {
  it("every route exports all seven methods, so Next's own 405 never answers", () => {
    for (const [path, r] of Object.entries(ROUTES)) for (const m of METHODS) expect(typeof r.mod[m], `${m} ${path}`).toBe("function");
  });

  it("every method of every route answers 404, in development and in production, reading nothing", async () => {
    for (const env of ["test", "production"]) {
      (process.env as Record<string, string>).NODE_ENV = env;
      for (const [path, r] of Object.entries(ROUTES)) {
        for (const m of METHODS) {
          const res = await (r.mod[m] as Handler)(req(path, m));
          expect(res.status, `${env} ${m} ${path}`).toBe(404);
        }
      }
    }
  });
});

describe("once offered", () => {
  it("a method a route does not take answers 405 with the methods it does", async () => {
    process.env.MCP_OFFERED = "1";
    for (const [path, r] of Object.entries(ROUTES)) {
      for (const m of METHODS.filter((x) => !r.takes.includes(x))) {
        const res = await (r.mod[m] as Handler)(req(path, m));
        expect(res.status, `${m} ${path}`).toBe(405);
        expect(res.headers.get("allow"), `${m} ${path}`).toBe(r.allow);
      }
    }
  });

  it("HEAD on a discovery document is its GET without the body", async () => {
    process.env.MCP_OFFERED = "1";
    const res = await (asRoute.HEAD as Handler)(req("/.well-known/oauth-authorization-server", "HEAD"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.text()).toBe("");
  });
});
