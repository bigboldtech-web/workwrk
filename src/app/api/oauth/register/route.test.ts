// POST /api/oauth/register, RFC 7591 (docs/plans/mcp-server.md 3.3, 3.10,
// review H2 and H3): a public and a confidential client, the secret shown
// once and stored as a hash, "Claude Code (workwrk)" accepted, nothing of a
// logo kept, our own origin refused as a redirect, and the proof's burst
// window (6 in 60 seconds, the seventh 429).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));

import { LOOPBACK, ORIGIN, testDb as db, useMcpEnv } from "@/lib/oauth/oauth-test-db";
import { hashSecret } from "@/lib/oauth/tokens";
import { POST } from "./route";

const saved = { ...process.env };
let ipN = 0;
let ip = "";
beforeEach(() => {
  useMcpEnv();
  db.reset();
  ip = `198.20.0.${++ipN}`;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

const register = (body: unknown, contentType = "application/json; charset=utf-8") =>
  POST(new Request(`${ORIGIN}/api/oauth/register`, { method: "POST", headers: { host: "app.workwrk.com", "content-type": contentType, "x-real-ip": ip }, body: JSON.stringify(body) }));

describe("registration", () => {
  it("registers a public client, keeping 'Claude Code (workwrk)' and no logo", async () => {
    const res = await register({ client_name: "Claude Code (workwrk)", redirect_uris: [LOOPBACK], token_endpoint_auth_method: "none", logo_uri: "https://evil.example/l.png" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ client_name: "Claude Code (workwrk)", redirect_uris: [LOOPBACK], token_endpoint_auth_method: "none", response_types: ["code"], grant_types: ["authorization_code", "refresh_token"] });
    expect(body.client_id).toMatch(/^wkc_[A-Za-z0-9_-]{32}$/);
    expect(body).not.toHaveProperty("client_secret");
    expect(body).not.toHaveProperty("logo_uri");
    const row = db.rows.oAuthClient[0];
    expect(row).toMatchObject({ id: body.client_id, secretHash: null, authMethod: "none" });
    expect(JSON.stringify(row)).not.toContain("evil.example");
  });

  it("shows a confidential client's secret once and stores only its hash", async () => {
    const body = await (await register({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] })).json();
    expect(body.token_endpoint_auth_method).toBe("client_secret_basic");
    expect(body.client_secret).toMatch(/^wkmcp_cs_[A-Za-z0-9_-]{43}$/);
    expect(body.client_secret_expires_at).toBe(0);
    expect(db.rows.oAuthClient[0].secretHash).toBe(hashSecret(body.client_secret));
    expect(JSON.stringify(db.rows.oAuthClient)).not.toContain(body.client_secret);
  });

  it("refuses our own origin and an address that carries another, as invalid_redirect_uri", async () => {
    for (const uri of [`${ORIGIN}/oauth/consent`, "https://www.google.com/url?q=https://evil.example"]) {
      const res = await register({ redirect_uris: [uri], token_endpoint_auth_method: "none" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_redirect_uri" });
    }
    expect((await register({ redirect_uris: [LOOPBACK] }, "text/plain")).status).toBe(400);
    expect(db.rows.oAuthClient ?? []).toEqual([]);
  });

  it("lets a burst of 6 in a minute through under the proof's limits, and refuses the seventh with Retry-After", async () => {
    process.env.MCP_PROOF_LIMITS = "1";
    for (let i = 0; i < 6; i++) expect((await register({ redirect_uris: [LOOPBACK], token_endpoint_auth_method: "none" })).status).toBe(201);
    const seventh = await register({ redirect_uris: [LOOPBACK], token_endpoint_auth_method: "none" });
    expect(seventh.status).toBe(429);
    expect(seventh.headers.get("retry-after")).toBeTruthy();
  });

  it("lets 60 a minute through by default, from one address", async () => {
    for (let i = 0; i < 60; i++) expect((await register({ redirect_uris: [LOOPBACK], token_endpoint_auth_method: "none" })).status).toBe(201);
    expect((await register({ redirect_uris: [LOOPBACK], token_endpoint_auth_method: "none" })).status).toBe(429);
  });
});
