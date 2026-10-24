// POST /api/oauth/revoke, RFC 7009 (docs/plans/mcp-server.md 3.6, step 1
// tests): a public client's token is revoked with no client_id; a
// confidential client's is not; always 200 for a well-formed request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/agents/acting", async () => {
  const { actingAs } = await import("@/lib/oauth/oauth-test-db");
  return { resolveActingPerson: async (organizationId: string, userId: string) => ({ ok: true, person: actingAs(organizationId, userId) }) };
});

import { findClient, type ClientRow } from "@/lib/oauth/clients";
import { exchangeCode } from "@/lib/oauth/codes";
import { grantConsent } from "@/lib/oauth/grants";
import { redirectHostOf } from "@/lib/oauth/redirect-uri";
import { CHALLENGE, CLAUDE_REDIRECT, CONF_ID, CONF_SECRET, LOOPBACK, ORIGIN, PUBLIC_ID, VERIFIER, basic, formOf, seedWorld, testDb as db, useMcpEnv } from "@/lib/oauth/oauth-test-db";
import { hashSecret } from "@/lib/oauth/tokens";
import { POST } from "./route";

const saved = { ...process.env };
beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

async function tokensFor(clientId: string, redirectUri: string, auth: Record<string, string> = {}) {
  const g = await grantConsent({
    userId: "u-max", organizationId: "org-a", clientId, redirectUri, codeChallenge: CHALLENGE, resource: `${ORIGIN}/api/mcp`,
    // The redirect's own host, as a consent writes it (two clients on one https host are one app: final review, contract L5).
    scopes: ["mcp:read"], appName: "x", redirectHost: redirectHostOf(redirectUri), sessionTokenVersion: 3, grantMaxDays: 30,
  });
  if (!g.ok) throw new Error(g.reason);
  const client = (await findClient(clientId)) as ClientRow;
  const r = await exchangeCode(client, formOf({ grant_type: "authorization_code", code: g.code, redirect_uri: redirectUri, code_verifier: VERIFIER, ...auth }), { clientLimit: () => ({ ok: true, retryAfter: 0 }), anonLimit: () => ({ ok: true, retryAfter: 0 }) });
  if (!r.ok) throw new Error(r.error);
  return { grantId: g.grantId, access: r.body.access_token, refresh: r.body.refresh_token as string };
}

function revoke(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return POST(new Request(`${ORIGIN}/api/oauth/revoke`, {
    method: "POST",
    headers: { host: "app.workwrk.com", "content-type": "application/x-www-form-urlencoded; charset=utf-8", "x-real-ip": "198.19.0.1", ...headers },
    body: new URLSearchParams(fields).toString(),
  }));
}

const grant = (id: string) => db.rows.oAuthGrant.find((g) => g.id === id)!;
const tokenRow = (t: string) => db.rows.oAuthToken.find((r) => r.id === hashSecret(t))!;

describe("revocation", () => {
  it("revokes a public client's refresh token held alone, with no client_id, ending the grant", async () => {
    const t = await tokensFor(PUBLIC_ID, LOOPBACK);
    const res = await revoke({ token: t.refresh });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(grant(t.grantId).revokedReason).toBe("client_revoked");
    expect(db.rows.activityLog.filter((a) => a.type === "mcp.app.revoked").length).toBe(1);
  });

  it("never revokes a confidential client's token sent with no client_id, and still answers 200", async () => {
    const t = await tokensFor(CONF_ID, CLAUDE_REDIRECT, { client_id: CONF_ID });
    expect((await revoke({ token: t.refresh })).status).toBe(200);
    expect(grant(t.grantId).revokedAt).toBeNull();
    // With its credentials it is revoked.
    expect((await revoke({ token: t.refresh }, { authorization: basic(CONF_ID, CONF_SECRET) })).status).toBe(200);
    expect(grant(t.grantId).revokedReason).toBe("client_revoked");
  });

  it("revokes only the access token itself, and only for its own client", async () => {
    const t = await tokensFor(PUBLIC_ID, LOOPBACK);
    const other = await tokensFor(CONF_ID, CLAUDE_REDIRECT, { client_id: CONF_ID });
    expect((await revoke({ token: other.access, client_id: PUBLIC_ID })).status).toBe(200);
    expect(tokenRow(other.access).revokedAt).toBeNull();
    expect((await revoke({ token: t.access, client_id: PUBLIC_ID })).status).toBe(200);
    expect(tokenRow(t.access).revokedAt).toBeInstanceOf(Date);
    expect(grant(t.grantId).revokedAt).toBeNull();
  });

  // Review of step 1: a token already revoked, or of a family a re-consent replaced, ends nothing current.
  it("revokes nothing current for a revoked, expired or old-family refresh token", async () => {
    const t = await tokensFor(PUBLIC_ID, LOOPBACK);
    tokenRow(t.refresh).revokedAt = new Date();
    expect((await revoke({ token: t.refresh })).status).toBe(200);
    expect(grant(t.grantId).revokedAt).toBeNull();
    tokenRow(t.refresh).revokedAt = null;
    tokenRow(t.refresh).expiresAt = new Date(Date.now() - 1000);
    expect((await revoke({ token: t.refresh })).status).toBe(200);
    expect(grant(t.grantId).revokedAt).toBeNull();
    tokenRow(t.refresh).expiresAt = new Date(Date.now() + 86_400_000);
    // A re-consent made a new family: the old family's token is no key to the connection now.
    grant(t.grantId).familyId = "fam_new";
    expect((await revoke({ token: t.refresh })).status).toBe(200);
    expect(grant(t.grantId).revokedAt).toBeNull();
    grant(t.grantId).familyId = tokenRow(t.refresh).familyId;
    expect((await revoke({ token: t.refresh })).status).toBe(200);
    expect(grant(t.grantId).revokedReason).toBe("client_revoked");
  });

  it("answers 200 for an unknown or malformed token, 400 with no token, 401 for bad credentials", async () => {
    expect((await revoke({ token: `wkmcp_rt_${"q".repeat(43)}` })).status).toBe(200);
    expect((await revoke({ token: "whatever" })).status).toBe(200);
    expect((await revoke({})).status).toBe(400);
    expect((await revoke({ token: `wkmcp_rt_${"q".repeat(43)}` }, { authorization: basic(CONF_ID, "nope") })).status).toBe(401);
  });
});
