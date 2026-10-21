// ONE SWITCH (docs/plans/mcp-server.md Decision 1, 3.1, step 1): while
// MCP_OFFERED is unset every route of the OAuth server answers 404 and the
// two pages render nothing (notFound), so production is unchanged until the
// founder sets it. In production the origin must be https on APP_HOST, and
// a request on another host is a 404 too. Fails on the code before step 1:
// none of these routes exists.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ host: "app.workwrk.com" }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: st.host }),
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/components/auth/auth-shell", () => ({ AuthShell: () => null }));

import * as asRoute from "@/app/.well-known/oauth-authorization-server/route";
import * as prRoute from "@/app/.well-known/oauth-protected-resource/route";
import * as prSuffix from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import * as register from "@/app/api/oauth/register/route";
import * as revoke from "@/app/api/oauth/revoke/route";
import * as token from "@/app/api/oauth/token/route";
import * as decision from "@/app/(auth)/oauth/decision/route";
import AuthorizePage from "@/app/(auth)/oauth/authorize/page";
import ConsentPage from "@/app/(auth)/oauth/consent/page";
import { mcpOffered } from "@/lib/mcp/config";

const saved = { ...process.env };
beforeEach(() => {
  process.env = { ...saved };
  delete process.env.MCP_OFFERED;
  process.env.NEXTAUTH_URL = "https://app.workwrk.com";
  process.env.APP_HOST = "app.workwrk.com";
  st.host = "app.workwrk.com";
});
afterEach(() => {
  process.env = { ...saved };
});

const req = (method: string, host = "app.workwrk.com") =>
  new Request("https://app.workwrk.com/x", { method, headers: { host, "content-type": "application/x-www-form-urlencoded" }, ...(method === "POST" ? { body: "a=b" } : {}) });

async function allAnswers(host?: string): Promise<number[]> {
  return [
    asRoute.GET(req("GET", host)).status,
    asRoute.OPTIONS(req("OPTIONS", host)).status,
    prRoute.GET(req("GET", host)).status,
    prRoute.OPTIONS(req("OPTIONS", host)).status,
    prSuffix.GET(req("GET", host)).status,
    prSuffix.OPTIONS(req("OPTIONS", host)).status,
    (await register.POST(req("POST", host))).status,
    register.OPTIONS(req("OPTIONS", host)).status,
    (await token.POST(req("POST", host))).status,
    token.OPTIONS(req("OPTIONS", host)).status,
    (await revoke.POST(req("POST", host))).status,
    revoke.OPTIONS(req("OPTIONS", host)).status,
    (await decision.POST(req("POST", host))).status,
    decision.GET(req("GET", host)).status,
  ];
}

const page = (p: (a: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>) => p({ searchParams: Promise.resolve({}) });

describe("MCP_OFFERED unset", () => {
  it("every OAuth route answers 404", async () => {
    expect(mcpOffered()).toBe(false);
    expect(new Set(await allAnswers())).toEqual(new Set([404]));
  });

  it("the authorize and consent pages render nothing", async () => {
    await expect(page(AuthorizePage)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(page(ConsentPage)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("only 1 or true turns it on", () => {
    for (const v of ["0", "false", "yes", ""]) {
      process.env.MCP_OFFERED = v;
      expect(mcpOffered(), v).toBe(false);
    }
    process.env.MCP_OFFERED = "1";
    expect(mcpOffered()).toBe(true);
  });
});

describe("in production", () => {
  beforeEach(() => {
    process.env.MCP_OFFERED = "1";
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("offers nothing unless NEXTAUTH_URL is https on APP_HOST", () => {
    expect(mcpOffered()).toBe(true);
    process.env.NEXTAUTH_URL = "http://app.workwrk.com";
    expect(mcpOffered()).toBe(false);
    process.env.NEXTAUTH_URL = "https://workwrk.com";
    expect(mcpOffered()).toBe(false);
    delete process.env.APP_HOST;
    process.env.NEXTAUTH_URL = "https://app.workwrk.com";
    expect(mcpOffered()).toBe(false);
  });

  it("answers 404 on any host but the app host, pages included", async () => {
    expect(new Set(await allAnswers("workwrk.com"))).toEqual(new Set([404]));
    st.host = "workwrk.com";
    await expect(page(AuthorizePage)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(page(ConsentPage)).rejects.toThrow("NEXT_NOT_FOUND");
    // And serves the app host.
    expect(asRoute.GET(req("GET", "app.workwrk.com")).status).toBe(200);
  });
});
