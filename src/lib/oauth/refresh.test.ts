// The refresh grant (docs/plans/mcp-server.md 3.5, step 1 tests): reuse at 5
// and at 11 seconds, unauthorized_client, invalid_scope, two rows per family,
// endsBy recomputed with the workspace's rule.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/agents/acting", async () => {
  const { actingAs } = await import("./oauth-test-db");
  return { resolveActingPerson: async (organizationId: string, userId: string) => ({ ok: true, person: actingAs(organizationId, userId) }) };
});

import { findClient, type ClientRow } from "./clients";
import { exchangeCode } from "./codes";
import { grantConsent } from "./grants";
import { CHALLENGE, LOOPBACK, NO_REFRESH_ID, PUBLIC_ID, VERIFIER, formOf, seedWorld, testDb as db, useMcpEnv } from "./oauth-test-db";
import { exchangeRefresh } from "./refresh";
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

const T0 = new Date("2026-10-21T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const OK = () => ({ ok: true, retryAfter: 0 });

async function connect(scopes: Array<"mcp:read" | "mcp:write"> = ["mcp:read", "mcp:write"]) {
  const g = await grantConsent({
    userId: "u-max", organizationId: "org-a", clientId: PUBLIC_ID, redirectUri: LOOPBACK, codeChallenge: CHALLENGE,
    resource: "https://app.workwrk.com/api/mcp", scopes, appName: "an app on this computer", redirectHost: "localhost",
    sessionTokenVersion: 3, grantMaxDays: 30, now: T0,
  });
  if (!g.ok) throw new Error(g.reason);
  const client = (await findClient(PUBLIC_ID)) as ClientRow;
  const r = await exchangeCode(client, formOf({ grant_type: "authorization_code", code: g.code, redirect_uri: LOOPBACK, code_verifier: VERIFIER, client_id: PUBLIC_ID }), { now: T0, clientLimit: OK, anonLimit: OK });
  if (!r.ok) throw new Error(r.error);
  return { grantId: g.grantId, refresh: r.body.refresh_token as string, client };
}

const counted: string[] = [];
async function refresh(client: ClientRow, token: string, now: Date, extra: Record<string, string> = {}) {
  return exchangeRefresh(client, formOf({ grant_type: "refresh_token", refresh_token: token, client_id: client.id, ...extra }), {
    now,
    familyLimit: () => (counted.push("family"), OK()),
    anonLimit: () => (counted.push("address"), OK()),
  });
}

const grant = (id: string) => db.rows.oAuthGrant.find((g) => g.id === id)!;

describe("rotation and reuse", () => {
  it("rotates, and a reuse inside 10 seconds is only refused (a retry), never a revocation", async () => {
    const c = await connect();
    const r2 = await refresh(c.client, c.refresh, at(1000));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.body.refresh_token).not.toBe(c.refresh);
    // 5 seconds after the first use: a lost answer's retry.
    expect(await refresh(c.client, c.refresh, at(6000))).toEqual({ ok: false, error: "invalid_grant" });
    expect(grant(c.grantId).revokedAt).toBeNull();
    expect((await refresh(c.client, r2.body.refresh_token as string, at(7000))).ok).toBe(true);
  });

  it("revokes the family and the grant on a reuse 11 seconds later, with a critical audit row and an Inbox notice", async () => {
    const c = await connect();
    const r2 = await refresh(c.client, c.refresh, at(1000));
    expect(r2.ok).toBe(true);
    expect(await refresh(c.client, c.refresh, at(12_000))).toEqual({ ok: false, error: "invalid_grant" });
    expect(grant(c.grantId)).toMatchObject({ revokedReason: "reuse_detected" });
    if (r2.ok) expect(await refresh(c.client, r2.body.refresh_token as string, at(13_000))).toEqual({ ok: false, error: "invalid_grant" });
    expect(db.rows.oAuthToken.every((t) => t.revokedAt instanceof Date)).toBe(true);
    expect(db.rows.activityLog.filter((a) => a.type === "mcp.app.reuse_detected").map((a) => a.severity)).toEqual(["critical"]);
    expect(db.rows.notification?.filter((n) => n.userId === "u-max" && n.type === "mcp_app").map((n) => n.title)).toContain("AI app disconnected for safety");
  });

  // Review of step 1, M1: rotation deleted every refresh row but the newest and its parent,
  // so a thief who rotated twice erased R1 and the real app's R1 answered a silent invalid_grant.
  it("still detects reuse of the first token after a thief rotated twice: the grant ends reuse_detected", async () => {
    const c = await connect();
    const r2 = await refresh(c.client, c.refresh, at(1000)); // the thief, with the stolen R1
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const r3 = await refresh(c.client, r2.body.refresh_token as string, at(2000)); // and again
    expect(r3.ok).toBe(true);
    // The real app, later, with the R1 it still holds.
    expect(await refresh(c.client, c.refresh, at(60_000))).toEqual({ ok: false, error: "invalid_grant" });
    expect(grant(c.grantId)).toMatchObject({ revokedReason: "reuse_detected" });
    expect(db.rows.activityLog.filter((a) => a.type === "mcp.app.reuse_detected")).toHaveLength(1);
    expect(db.rows.notification?.some((n) => n.title === "AI app disconnected for safety")).toBe(true);
    // The thief's newest token is dead with it.
    if (r3.ok) expect(await refresh(c.client, r3.body.refresh_token as string, at(61_000))).toEqual({ ok: false, error: "invalid_grant" });
  });

  it("keeps one unused refresh row a family, every used one as a tombstone until its own expiry", async () => {
    const c = await connect();
    let token = c.refresh;
    for (let i = 1; i <= 5; i++) {
      const r = await refresh(c.client, token, at(i * 60_000));
      expect(r.ok).toBe(true);
      if (r.ok) token = r.body.refresh_token as string;
    }
    const family = grant(c.grantId).familyId;
    const rows = db.rows.oAuthToken.filter((t) => t.kind === "refresh" && t.familyId === family);
    expect(rows.filter((t) => t.usedAt === null)).toHaveLength(1);
    expect(rows.filter((t) => t.usedAt instanceof Date)).toHaveLength(5);
    expect(rows.every((t) => (t.expiresAt as Date).getTime() > at(5 * 60_000).getTime())).toBe(true);
    // Expired access tokens go at each rotation; the live one stays.
    expect(db.rows.oAuthToken.filter((t) => t.kind === "access" && t.familyId === family && (t.expiresAt as Date).getTime() <= at(5 * 60_000).getTime())).toEqual([]);
  });

  it("counts a token nobody holds by address, never by a family", async () => {
    const c = await connect();
    counted.length = 0;
    expect(await refresh(c.client, `wkmcp_rt_${"n".repeat(43)}`, at(1000))).toEqual({ ok: false, error: "invalid_grant" });
    expect(counted).toEqual(["address"]);
    counted.length = 0;
    expect((await refresh(c.client, c.refresh, at(2000))).ok).toBe(true);
    expect(counted).toEqual(["family"]);
  });
});

describe("what a refresh may ask", () => {
  it("is unauthorized_client for a client that did not register refresh_token", async () => {
    const once = (await findClient(NO_REFRESH_ID)) as ClientRow;
    expect(await refresh(once, `wkmcp_rt_${"z".repeat(43)}`, at(1000))).toEqual({ ok: false, error: "unauthorized_client" });
  });

  it("refuses a wider scope (invalid_scope) without spending the token, and keeps a narrower one", async () => {
    const ro = await connect(["mcp:read"]);
    expect(await refresh(ro.client, ro.refresh, at(1000), { scope: "mcp:read mcp:write" })).toEqual({ ok: false, error: "invalid_scope" });
    expect(db.rows.oAuthToken.find((t) => t.id === hashSecret(ro.refresh))?.usedAt).toBeNull();
    expect((await refresh(ro.client, ro.refresh, at(2000))).ok).toBe(true);

    seedWorld(db, hashSecret);
    const rw = await connect();
    const narrow = await refresh(rw.client, rw.refresh, at(1000), { scope: "mcp:read" });
    expect(narrow).toMatchObject({ ok: true, body: { scope: "mcp:read" } });
    // RFC 6749 6: the new refresh token keeps the presented one's scope; only the access token narrows.
    if (!narrow.ok) return;
    expect(db.rows.oAuthToken.find((t) => t.id === hashSecret(narrow.body.access_token))?.scopes).toEqual(["mcp:read"]);
    expect(db.rows.oAuthToken.find((t) => t.id === hashSecret(narrow.body.refresh_token as string))?.scopes).toEqual(["mcp:read", "mcp:write"]);
    const wide = await refresh(rw.client, narrow.body.refresh_token as string, at(2000));
    expect(wide).toMatchObject({ ok: true, body: { scope: "mcp:read mcp:write" } });
  });

  it("refuses another resource (invalid_target) without spending the token", async () => {
    const c = await connect();
    expect(await refresh(c.client, c.refresh, at(1000), { resource: "https://evil.example/api/mcp" })).toEqual({ ok: false, error: "invalid_target" });
    expect((await refresh(c.client, c.refresh, at(2000), { resource: "https://app.workwrk.com/api/mcp" })).ok).toBe(true);
  });
});

describe("the connection's end (endsBy)", () => {
  it("is recomputed with the workspace's sessionMaxDays now, and past it the grant ends as expired", async () => {
    const c = await connect();
    db.rows.organization[0].settings = { security: { sessionMaxDays: 10 } };
    expect((await refresh(c.client, c.refresh, at(86_400_000))).ok).toBe(true);
    expect((grant(c.grantId).endsBy as Date).getTime()).toBe(T0.getTime() + 10 * 86_400_000);

    seedWorld(db, hashSecret);
    const d = await connect();
    db.rows.organization[0].settings = { security: { sessionMaxDays: 1 } };
    expect(await refresh(d.client, d.refresh, at(2 * 86_400_000))).toEqual({ ok: false, error: "invalid_grant" });
    expect(grant(d.grantId).revokedReason).toBe("expired");
  });

  // Review of the longer-sessions fix, L4: the session default is 90 days
  // since 2026-10-22; a connection keeps 30 unless the workspace stored one.
  it("is 30 days where the workspace stored no session lifetime, not the 90 day session default", async () => {
    const c = await connect();
    db.rows.organization[0].settings = {};
    expect((await refresh(c.client, c.refresh, at(86_400_000))).ok).toBe(true);
    expect((grant(c.grantId).endsBy as Date).getTime()).toBe(T0.getTime() + 30 * 86_400_000);
  });
});
