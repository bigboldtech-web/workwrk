// /api/mcp over HTTP (docs/plans/mcp-server.md 2.1, 2.3, 3.10, step 2 tests
// "transport: the production Host check: 404; MCP_OFFERED unset: 404;
// Origin, 415 with charset, 406, 413, 405; no session id, no cookie", and
// the step 2 review: a token-less request is answered the challenge, never a
// 429 (M3), so M19 now reads "no-credential requests from one address all
// answer 401, while 121 failed lookups of well-formed unknown tokens from it
// give 429 and a valid token from it still works"; and a 2025-03-26 batch is
// charged per message (M1). Through the route module itself.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));
vi.mock("@/lib/agents/acting", async () => {
  const { actingAs } = await import("@/lib/oauth/oauth-test-db");
  return { resolveActingPerson: async (o: string, u: string) => ({ ok: true, person: { ...actingAs(o, u), timezone: "UTC" } }) };
});

import * as route from "@/app/api/mcp/route";
import { seed, seedConnection, seedWorld, testDb as db, useMcpEnv } from "@/lib/oauth/oauth-test-db";
import { resetUnknownTokenFailures } from "./limits";
import { hashSecret } from "@/lib/oauth/tokens";

const saved = { ...process.env };
let token: string;
let ipSeq = 0;
let ip = "";

beforeEach(() => {
  process.env = { ...saved };
  useMcpEnv();
  seedWorld(db, hashSecret);
  token = seedConnection(db, hashSecret, { scopes: ["mcp:read"] }).token;
  ip = `198.51.100.${(ipSeq += 1)}`;
  resetUnknownTokenFailures();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1.0" } } };

function post(body: unknown, h: Record<string, string | null> = {}): Request {
  const headers: Record<string, string> = {
    host: "app.workwrk.com",
    "content-type": "application/json; charset=utf-8",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    "x-real-ip": ip,
  };
  for (const [k, v] of Object.entries(h)) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  return new Request("https://app.workwrk.com/api/mcp", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

const bare = (method: string, host = "app.workwrk.com") => new Request("https://app.workwrk.com/api/mcp", { method, headers: { host } });

describe("serving at all", () => {
  it("is a 404 everywhere while MCP_OFFERED is unset", async () => {
    delete process.env.MCP_OFFERED;
    expect((await route.POST(post(INIT))).status).toBe(404);
    expect(route.GET(bare("GET")).status).toBe(404);
    expect(route.DELETE(bare("DELETE")).status).toBe(404);
    expect(route.OPTIONS(bare("OPTIONS")).status).toBe(404);
  });

  it("is a 404 in production on any Host but APP_HOST, and answers on it", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect((await route.POST(post(INIT, { host: "workwrk.com" }))).status).toBe(404);
    expect((await route.POST(post(INIT, { host: "admin.workwrk.com" }))).status).toBe(404);
    expect(route.GET(bare("GET", "evil.example")).status).toBe(404);
    expect((await route.POST(post(INIT))).status).toBe(200);
  });

  it("answers every method but POST and OPTIONS 405 with Allow: POST, OPTIONS, and the CORS headers for an allowed Origin", () => {
    for (const m of ["GET", "HEAD", "PUT", "PATCH", "DELETE"] as const) {
      const r = route[m](bare(m));
      expect(r.status, m).toBe(405);
      expect(r.headers.get("allow")).toBe("POST, OPTIONS");
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    const withOrigin = route.GET(new Request("https://app.workwrk.com/api/mcp", { method: "GET", headers: { host: "app.workwrk.com", origin: "https://app.workwrk.com" } }));
    expect(withOrigin.headers.get("access-control-allow-origin")).toBe("https://app.workwrk.com");
    expect(withOrigin.headers.get("vary")).toBe("Origin");
    const foreign = route.GET(new Request("https://app.workwrk.com/api/mcp", { method: "GET", headers: { host: "app.workwrk.com", origin: "https://evil.example" } }));
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("the checks before the token", () => {
  it("refuses a foreign Origin 403 before any credential is read", async () => {
    db.failing.add("oAuthToken");
    const r = await route.POST(post(INIT, { origin: "https://evil.example" }));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: { code: -32600 } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    db.failing.delete("oAuthToken");
    const own = await route.POST(post(INIT, { origin: "https://app.workwrk.com" }));
    expect(own.status).toBe(200);
    expect(own.headers.get("access-control-allow-origin")).toBe("https://app.workwrk.com");
  });

  it("takes application/json with any charset, and answers 415 for another type", async () => {
    expect((await route.POST(post(INIT, { "content-type": "application/json" }))).status).toBe(200);
    expect((await route.POST(post(INIT, { "content-type": "Application/JSON; charset=UTF-8" }))).status).toBe(200);
    expect((await route.POST(post(INIT, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await route.POST(post(INIT, { "content-type": null }))).status).toBe(415);
  });

  it("answers 406 when Accept allows no JSON, and takes */* or none", async () => {
    expect((await route.POST(post(INIT, { accept: "text/event-stream" }))).status).toBe(406);
    expect((await route.POST(post(INIT, { accept: "text/html" }))).status).toBe(406);
    expect((await route.POST(post(INIT, { accept: "*/*" }))).status).toBe(200);
    expect((await route.POST(post(INIT, { accept: null }))).status).toBe(200);
  });

  it("answers 413 past 262,144 bytes, whatever Content-Length says", async () => {
    const big = JSON.stringify({ ...INIT, params: { ...INIT.params, pad: "x".repeat(262_144) } });
    expect((await route.POST(post(big))).status).toBe(413);
    expect((await route.POST(post(big, { "content-length": "100" }))).status).toBe(413);
    expect((await route.POST(post(INIT, { "content-length": "999999" }))).status).toBe(413);
  });

  it("never refuses a token-less request: each is the 401 challenge, given before the body is read", async () => {
    process.env.MCP_PROOF_LIMITS = "1";
    for (let i = 0; i < 130; i += 1) expect((await route.POST(post(INIT, { authorization: null }))).status).toBe(401);
    const malformed = await route.POST(post(INIT, { authorization: "Bearer junk" }));
    expect(malformed.status).toBe(401);
    expect(malformed.headers.get("www-authenticate")).toContain('error="invalid_token"');
    // Before the body: an oversized one is still the challenge, not a 413.
    const big = JSON.stringify({ ...INIT, params: { ...INIT.params, pad: "x".repeat(262_144) } });
    expect((await route.POST(post(big, { authorization: null }))).status).toBe(401);
    expect((await route.POST(post(INIT))).status).toBe(200);
  });

  it("counts an address's failed lookups of well-formed unknown tokens: the 121st is 429 before the body, a valid token still works", async () => {
    const unknown = (i: number) => `Bearer wkmcp_at_${String(i).padStart(43, "Q")}`;
    for (let i = 0; i < 120; i += 1) expect((await route.POST(post(INIT, { authorization: unknown(i) }))).status).toBe(401);
    const r = await route.POST(post(INIT, { authorization: unknown(500) }));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    // Refused before the body is read.
    const big = JSON.stringify({ ...INIT, params: { ...INIT.params, pad: "x".repeat(262_144) } });
    expect((await route.POST(post(big, { authorization: unknown(501) }))).status).toBe(429);
    // The valid caller behind the same address is never blocked by strangers, and is never counted.
    expect((await route.POST(post(INIT))).status).toBe(200);
    // Token-less requests from it are still the challenge.
    expect((await route.POST(post(INIT, { authorization: null }))).status).toBe(401);
  });

  it("never counts a token that exists but was revoked or expired: that is a real app that must connect again", async () => {
    db.rows.oAuthToken[0].revokedAt = new Date();
    for (let i = 0; i < 130; i += 1) expect((await route.POST(post(INIT))).status).toBe(401);
    db.rows.oAuthToken[0].revokedAt = null;
    expect((await route.POST(post(INIT))).status).toBe(200);
  });
});

describe("the token", () => {
  it("answers 401 with the challenge, ignoring cookies and query tokens", async () => {
    const r = await route.POST(post(INIT, { authorization: null, cookie: "__Secure-next-auth.session-token=abc" }));
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://app.workwrk.com/.well-known/oauth-protected-resource/api/mcp", scope="mcp:read mcp:write"');
    const q = new Request(`https://app.workwrk.com/api/mcp?access_token=${token}`, { method: "POST", headers: { host: "app.workwrk.com", "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(INIT) });
    expect((await route.POST(q)).status).toBe(401);
    const bad = await route.POST(post(INIT, { authorization: `Bearer wkmcp_at_${"Z".repeat(43)}` }));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("checks the token before the body is parsed", async () => {
    expect((await route.POST(post("{not json", { authorization: null }))).status).toBe(401);
    const r = await route.POST(post("{not json"));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  });
});

describe("the answers", () => {
  it("initialize answers with no session id and no cookie, and the 401 neither", async () => {
    const r = await route.POST(post(INIT));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "workwrk", title: "WorkwrK" } } });
    for (const res of [r, await route.POST(post(INIT, { authorization: null }))]) {
      expect(res.headers.get("mcp-session-id")).toBeNull();
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("initialize ignores a bad version header; any other message is 400 with it", async () => {
    expect((await route.POST(post(INIT, { "mcp-protocol-version": "1999-01-01" }))).status).toBe(200);
    const r = await route.POST(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-protocol-version": "1999-01-01" }));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ id: 2, error: { code: -32600 } });
  });

  it("answers a notification 202 with no body", async () => {
    const r = await route.POST(post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-protocol-version": "2025-06-18" }));
    expect(r.status).toBe(202);
    expect(await r.text()).toBe("");
  });

  it("lists a read connection's ten tools, the cursor ignored, and runs who_am_i", async () => {
    const list = await route.POST(post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { cursor: "x" } }, { "mcp-protocol-version": "2025-06-18" }));
    const body = (await list.json()) as { result: { tools: Array<{ name: string }>; nextCursor?: string } };
    expect(body.result.tools).toHaveLength(10);
    expect(body.result.nextCursor).toBeUndefined();
    const call = await route.POST(post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "who_am_i", arguments: {} } }, { "mcp-protocol-version": "2025-06-18" }));
    expect(await call.json()).toMatchObject({ id: 4, result: { structuredContent: { person: { id: "u-max" }, access: "read" } } });
  });

  it("refuses a batch under 2025-06-18 and answers one under 2025-03-26", async () => {
    const batch = [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "ping" }];
    expect((await route.POST(post(batch, { "mcp-protocol-version": "2025-06-18" }))).status).toBe(400);
    const r = await route.POST(post(batch));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }, { jsonrpc: "2.0", id: 2, result: {} }]);
  });

  it("charges a 2025-03-26 batch per message: past 120 messages a minute each one over is -32000, and a batch with none admitted is 429", async () => {
    seed(db, "user", { id: "u-batch", email: "batch@acme.test", organizationId: "org-a", tokenVersion: 3 });
    const own = seedConnection(db, hashSecret, { grantId: "gr-batch", userId: "u-batch", token: `wkmcp_at_${"B".repeat(43)}`, scopes: ["mcp:read"] }).token;
    const ping = (i: number) => ({ jsonrpc: "2.0", id: i, method: "ping" });
    const send = (n: number, from: number) => route.POST(post(Array.from({ length: n }, (_, i) => ping(from + i)), { authorization: `Bearer ${own}` }));
    // 5 batches of 20 and one of 19: 119 messages, all answered.
    for (let b = 0; b < 5; b += 1) expect(((await (await send(20, b * 20)).json()) as unknown[]).length).toBe(20);
    expect(((await (await send(19, 100)).json()) as unknown[]).length).toBe(19);
    // The 120th runs; the two after it answer -32000 unrun.
    const partial = await send(3, 200);
    expect(partial.status).toBe(200);
    expect(Number(partial.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await partial.json()).toEqual([
      { jsonrpc: "2.0", id: 200, result: {} },
      { jsonrpc: "2.0", id: 201, error: { code: -32000, message: "Too many requests. Try again shortly." } },
      { jsonrpc: "2.0", id: 202, error: { code: -32000, message: "Too many requests. Try again shortly." } },
    ]);
    // None admitted: 429 for the batch, and for a lone message too.
    const full = await send(20, 300);
    expect(full.status).toBe(429);
    expect((await route.POST(post(ping(400), { authorization: `Bearer ${own}` }))).status).toBe(429);
    // Another connection is not charged for it.
    expect((await route.POST(post(ping(500)))).status).toBe(200);
  });

  it("answers the preflight for an allowed Origin", async () => {
    process.env.MCP_ALLOWED_ORIGINS = "https://claude.ai";
    const r = route.OPTIONS(new Request("https://app.workwrk.com/api/mcp", { method: "OPTIONS", headers: { host: "app.workwrk.com", origin: "https://claude.ai" } }));
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
  });
});
