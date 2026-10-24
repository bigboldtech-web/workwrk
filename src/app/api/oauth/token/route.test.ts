// POST /api/oauth/token (docs/plans/mcp-server.md 3.5, 3.10, step 1 tests):
// the form with a charset; the three client methods, each exactly as
// registered; a Basic 401 with its challenge; no-store on every answer; the
// address limit only without a well-formed credential.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/agents/acting", async () => {
  const { actingAs } = await import("@/lib/oauth/oauth-test-db");
  return { resolveActingPerson: async (organizationId: string, userId: string) => ({ ok: true, person: actingAs(organizationId, userId) }) };
});

import { grantConsent } from "@/lib/oauth/grants";
import { redirectHostOf } from "@/lib/oauth/redirect-uri";
import {
  CHALLENGE, CLAUDE_REDIRECT, CONF_ID, CONF_SECRET, LOOPBACK, ORIGIN, POST_ID, POST_SECRET, PUBLIC_ID, VERIFIER, basic, seedWorld, testDb as db, useMcpEnv,
} from "@/lib/oauth/oauth-test-db";
import { hashSecret } from "@/lib/oauth/tokens";
import { POST } from "./route";

const saved = { ...process.env };
let ipN = 0;
let ip = "";
beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
  ip = `198.18.0.${++ipN}`;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

async function codeFor(clientId: string, redirectUri: string): Promise<string> {
  const g = await grantConsent({
    userId: "u-max", organizationId: "org-a", clientId, redirectUri, codeChallenge: CHALLENGE, resource: `${ORIGIN}/api/mcp`,
    // The redirect's own host, as a consent writes it (two clients on one https host are one app: final review, contract L5).
    scopes: ["mcp:read"], appName: "Claude", redirectHost: redirectHostOf(redirectUri), sessionTokenVersion: 3, grantMaxDays: 30,
  });
  if (!g.ok) throw new Error(g.reason);
  return g.code;
}

function token(fields: Record<string, string>, headers: Record<string, string> = {}, contentType = "application/x-www-form-urlencoded; charset=UTF-8") {
  return POST(new Request(`${ORIGIN}/api/oauth/token`, {
    method: "POST",
    headers: { host: "app.workwrk.com", "content-type": contentType, "x-real-ip": ip, ...headers },
    body: new URLSearchParams(fields).toString(),
  }));
}

const codeFields = (code: string, redirect_uri: string) => ({ grant_type: "authorization_code", code, redirect_uri, code_verifier: VERIFIER });

describe("the token endpoint", () => {
  it("takes a form with a charset, answers no-store, and authenticates a public client by its id alone", async () => {
    const code = await codeFor(PUBLIC_ID, LOOPBACK);
    const res = await token({ ...codeFields(code, LOOPBACK), client_id: PUBLIC_ID });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "mcp:read" });
  });

  it("authenticates client_secret_basic and client_secret_post each by exactly their own method", async () => {
    const c1 = await codeFor(CONF_ID, CLAUDE_REDIRECT);
    expect((await token(codeFields(c1, CLAUDE_REDIRECT), { authorization: basic(CONF_ID, CONF_SECRET) })).status).toBe(200);
    const c2 = await codeFor(POST_ID, CLAUDE_REDIRECT);
    expect((await token({ ...codeFields(c2, CLAUDE_REDIRECT), client_id: POST_ID, client_secret: POST_SECRET })).status).toBe(200);
  });

  it("answers 401 invalid_client with a Basic challenge for a wrong secret, the wrong method, or a missing one, and spends no code", async () => {
    const code = await codeFor(CONF_ID, CLAUDE_REDIRECT);
    const wrong = await token(codeFields(code, CLAUDE_REDIRECT), { authorization: basic(CONF_ID, `wkmcp_cs_${"x".repeat(43)}`) });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toMatch(/^Basic /);
    expect(await wrong.json()).toMatchObject({ error: "invalid_client" });
    // A Basic client sending its secret in the body: the wrong method.
    const post = await token({ ...codeFields(code, CLAUDE_REDIRECT), client_id: CONF_ID, client_secret: CONF_SECRET });
    expect(post.status).toBe(401);
    expect(post.headers.get("www-authenticate")).toMatch(/^Basic /);
    // A Basic client with no secret at all.
    expect((await token({ ...codeFields(code, CLAUDE_REDIRECT), client_id: CONF_ID })).status).toBe(401);
    // A public client sending a secret.
    const pub = await codeFor(PUBLIC_ID, LOOPBACK);
    expect((await token({ ...codeFields(pub, LOOPBACK), client_id: PUBLIC_ID, client_secret: "x" })).status).toBe(401);
    expect(db.rows.oAuthAuthorizationCode.every((c) => c.usedAt === null)).toBe(true);
    // And the right one still works.
    expect((await token(codeFields(code, CLAUDE_REDIRECT), { authorization: basic(CONF_ID, CONF_SECRET) })).status).toBe(200);
  });

  it("refuses another body type, a parameter sent twice and an unknown grant type", async () => {
    expect((await token({ grant_type: "authorization_code" }, {}, "application/json")).status).toBe(400);
    const res = await POST(new Request(`${ORIGIN}/api/oauth/token`, {
      method: "POST", headers: { host: "app.workwrk.com", "content-type": "application/x-www-form-urlencoded", "x-real-ip": ip },
      body: "grant_type=authorization_code&code=a&code=b",
    }));
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
    expect(await (await token({ grant_type: "password", client_id: PUBLIC_ID })).json()).toMatchObject({ error: "unsupported_grant_type" });
  });
});

describe("the token endpoint's limits (3.10)", () => {
  it("counts by address only without a well-formed credential, so a valid app on the same address still works", async () => {
    for (let i = 0; i < 120; i++) expect((await token({ grant_type: "authorization_code", code: "junk" })).status).toBe(401);
    const limited = await token({ grant_type: "authorization_code", code: "junk" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    const code = await codeFor(PUBLIC_ID, LOOPBACK);
    expect((await token({ ...codeFields(code, LOOPBACK), client_id: PUBLIC_ID })).status).toBe(200);
  });
});
