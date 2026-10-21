// The authorization code grant (docs/plans/mcp-server.md 3.5, review M2,
// step 1 tests): a wrong verifier, redirect, resource and an old family's
// code leave the code unused and the right exchange then works; a second
// exchange after a successful one revokes; the token scopes are the grant's.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/agents/acting", async () => {
  const { actingAs } = await import("./oauth-test-db");
  return { resolveActingPerson: async (organizationId: string, userId: string) => ({ ok: true, person: actingAs(organizationId, userId) }) };
});

import { findClient, type ClientRow } from "./clients";
import { exchangeCode } from "./codes";
import { grantConsent, type ConsentInput } from "./grants";
import { CHALLENGE, LOOPBACK, NO_REFRESH_ID, PUBLIC_ID, VERIFIER, formOf, seedWorld, testDb as db, useMcpEnv } from "./oauth-test-db";
import { hashSecret } from "./tokens";

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

const RESOURCE = "https://app.workwrk.com/api/mcp";

async function consent(o: Partial<ConsentInput> = {}): Promise<{ code: string; grantId: string }> {
  const r = await grantConsent({
    userId: "u-max",
    organizationId: "org-a",
    clientId: PUBLIC_ID,
    redirectUri: LOOPBACK,
    codeChallenge: CHALLENGE,
    resource: RESOURCE,
    scopes: ["mcp:read", "mcp:write"],
    appName: "an app on this computer",
    redirectHost: "localhost",
    sessionTokenVersion: 3,
    sessionMaxDays: 30,
    ...o,
  });
  if (!r.ok) throw new Error(r.reason);
  return r;
}

async function exchange(code: string, extra: Record<string, string> = {}, clientId = PUBLIC_ID) {
  const client = (await findClient(clientId)) as ClientRow;
  return exchangeCode(client, formOf({ grant_type: "authorization_code", code, redirect_uri: LOOPBACK, code_verifier: VERIFIER, client_id: clientId, ...extra }), {
    clientLimit: () => ({ ok: true, retryAfter: 0 }),
  });
}

const codeRow = (code: string) => db.rows.oAuthAuthorizationCode.find((r) => r.id === hashSecret(code))!;
const grantRow = (id: string) => db.rows.oAuthGrant.find((r) => r.id === id)!;

describe("the code grant checks everything before it claims the code (M2)", () => {
  it("leaves the code unused on a wrong verifier, redirect or resource, and the right exchange then works", async () => {
    const { code } = await consent();
    expect(await exchange(code, { code_verifier: "x".repeat(43) })).toEqual({ ok: false, error: "invalid_grant" });
    expect(codeRow(code).usedAt).toBeNull();
    expect(await exchange(code, { redirect_uri: "http://127.0.0.1:18800/callback" })).toEqual({ ok: false, error: "invalid_grant" });
    expect(codeRow(code).usedAt).toBeNull();
    expect(await exchange(code, { resource: "https://evil.example/api/mcp" })).toEqual({ ok: false, error: "invalid_target" });
    expect(codeRow(code).usedAt).toBeNull();
    expect(await exchange(code, { code_verifier: "short" })).toEqual({ ok: false, error: "invalid_grant" });
    // Nothing was revoked by any of them.
    expect(db.rows.oAuthGrant.every((g) => g.revokedAt === null)).toBe(true);

    const ok = await exchange(code, { resource: RESOURCE });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "mcp:read mcp:write" });
    expect(ok.body.access_token).toMatch(/^wkmcp_at_[A-Za-z0-9_-]{43}$/);
    expect(ok.body.refresh_token).toMatch(/^wkmcp_rt_[A-Za-z0-9_-]{43}$/);
    expect(codeRow(code).usedAt).toBeInstanceOf(Date);
    // Stored as hashes only, bound to the resource.
    const tokens = db.rows.oAuthToken;
    expect(tokens.map((t) => t.id)).toEqual([hashSecret(ok.body.access_token), hashSecret(ok.body.refresh_token as string)]);
    expect(tokens.every((t) => t.resource === RESOURCE)).toBe(true);
  });

  it("refuses an older family's code after a re-consent, leaving it unused, and the new code works", async () => {
    const first = await consent();
    const second = await consent({ scopes: ["mcp:read"] });
    expect(second.grantId).toBe(first.grantId);
    expect(await exchange(first.code)).toEqual({ ok: false, error: "invalid_grant" });
    expect(codeRow(first.code).usedAt).toBeNull();
    expect(grantRow(first.grantId).revokedAt).toBeNull();
    const ok = await exchange(second.code);
    expect(ok).toMatchObject({ ok: true, body: { scope: "mcp:read" } });
  });

  it("refuses another client's code, an expired code and a stale grant, revoking only the stale one", async () => {
    const { code, grantId } = await consent();
    expect(await exchange(code, { client_id: NO_REFRESH_ID }, NO_REFRESH_ID)).toEqual({ ok: false, error: "invalid_grant" });
    expect(codeRow(code).usedAt).toBeNull();
    codeRow(code).expiresAt = new Date(Date.now() - 1000);
    expect(await exchange(code)).toEqual({ ok: false, error: "invalid_grant" });
    expect(grantRow(grantId).revokedAt).toBeNull();

    const again = await consent();
    db.rows.user[0].tokenVersion = 4; // Sign out everywhere, say
    expect(await exchange(again.code)).toEqual({ ok: false, error: "invalid_grant" });
    expect(grantRow(again.grantId).revokedReason).toBe("sessions_ended");
    expect(codeRow(again.code).usedAt).toBeNull();
  });
});

describe("a code used twice", () => {
  it("revokes the family and the grant (code_reuse) on a second exchange after a successful one", async () => {
    const { code, grantId } = await consent();
    const ok = await exchange(code);
    expect(ok.ok).toBe(true);
    expect(await exchange(code)).toEqual({ ok: false, error: "invalid_grant" });
    expect(grantRow(grantId)).toMatchObject({ revokedReason: "code_reuse" });
    expect(db.rows.oAuthToken.every((t) => t.revokedAt instanceof Date)).toBe(true);
    const audit = db.rows.activityLog.filter((a) => a.type === "mcp.app.reuse_detected");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ severity: "critical", actorId: null, actingForId: "u-max", organizationId: "org-a" });
    expect(JSON.stringify(audit[0])).not.toContain(code);
  });
});

describe("the tokens a code gives", () => {
  it("carry the grant's scopes, and a refresh token only for a client that registered refresh_token", async () => {
    const readOnly = await consent({ scopes: ["mcp:read"] });
    const r = await exchange(readOnly.code);
    expect(r).toMatchObject({ ok: true, body: { scope: "mcp:read" } });
    expect(db.rows.oAuthToken.every((t) => JSON.stringify(t.scopes) === JSON.stringify(["mcp:read"]))).toBe(true);

    const once = await consent({ clientId: NO_REFRESH_ID });
    const o = await exchange(once.code, { client_id: NO_REFRESH_ID }, NO_REFRESH_ID);
    expect(o.ok).toBe(true);
    if (o.ok) expect(o.body.refresh_token).toBeUndefined();
  });
});
