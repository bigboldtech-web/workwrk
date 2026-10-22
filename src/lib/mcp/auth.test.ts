// The bearer check (docs/plans/mcp-server.md 3.8, step 2 tests "auth: every
// 401, every revoke step (sessions_ended included), blocks without
// revoking, the scope intersection"). Fails on the code before step 2:
// mcpContext did not exist.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ refuse: null as string | null }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));
vi.mock("@/lib/agents/acting", async () => {
  const { actingAs } = await import("@/lib/oauth/oauth-test-db");
  return {
    resolveActingPerson: async (organizationId: string, userId: string) =>
      st.refuse ? { ok: false, reason: st.refuse } : { ok: true, person: { ...actingAs(organizationId, userId), timezone: "UTC" } },
  };
});

import { grantConsent, signOutBump } from "@/lib/oauth/grants";
import { CHALLENGE, LOOPBACK, seed, seedConnection, seedWorld, testDb as db, useMcpEnv, PUBLIC_ID } from "@/lib/oauth/oauth-test-db";
import { hashSecret } from "@/lib/oauth/tokens";
import { bearerOf, challenge, challengeHeader, hasWellFormedCredential, mcpContext } from "./auth";

const saved = { ...process.env };
const NOW = new Date("2026-10-21T12:00:00Z");
let token: string;

beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
  st.refuse = null;
  token = seedConnection(db, hashSecret, { now: NOW }).token;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  while (restores.length) restores.pop()!();
  vi.restoreAllMocks();
});

type Op = (args: Record<string, unknown>) => Promise<unknown>;
const restores: Array<() => void> = [];

/** Once: `then` runs just before the check reads the account (grantStanding's read, the only one that selects passwordChangedAt). */
function beforeTheCheck(then: () => Promise<unknown>): void {
  const m = (db.prisma as unknown as Record<string, Record<string, Op>>).user;
  const real = m.findUnique;
  let done = false;
  m.findUnique = async (args) => {
    if (!done && (args.select as Record<string, unknown> | undefined)?.passwordChangedAt === true) {
      done = true;
      await then();
    }
    return real(args);
  };
  restores.push(() => { m.findUnique = real; });
}

const bearer = (t = token) => `Bearer ${t}`;
const grant = () => db.rows.oAuthGrant.find((g) => g.id === "gr-1")!;
const tokenRow = () => db.rows.oAuthToken.find((t) => t.grantId === "gr-1")!;
const reasonAfter = async () => {
  const r = await mcpContext(bearer(), NOW);
  expect(r).toEqual({ ok: false, sent: true });
  return grant().revokedReason;
};

describe("the header and the token (3.8 steps 1 and 2)", () => {
  it("passes a live token, with the grant, the client and the person", async () => {
    const r = await mcpContext(bearer(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ctx.grant.id).toBe("gr-1");
    expect(r.ctx.client.id).toBe(PUBLIC_ID);
    expect(r.ctx.person).toMatchObject({ userId: "u-max", organizationId: "org-a" });
    expect(r.ctx.blocked).toBeNull();
    expect(r.ctx.scopes).toEqual(["mcp:read", "mcp:write"]);
  });

  it("answers 401 for no token (no error), a non-Bearer one, and a malformed one (invalid_token)", async () => {
    expect(await mcpContext(null, NOW)).toEqual({ ok: false, sent: false });
    expect(await mcpContext("Basic dXNlcjpwYXNz", NOW)).toEqual({ ok: false, sent: false });
    expect(await mcpContext("Bearer abc", NOW)).toEqual({ ok: false, sent: true });
    expect(await mcpContext(`Bearer wk_live_${"a".repeat(40)}`, NOW)).toEqual({ ok: false, sent: true });
    expect(await mcpContext(`Bearer ${token}x`, NOW)).toEqual({ ok: false, sent: true });
    expect(bearerOf(`bearer ${token}`)).toEqual({ kind: "token", token });
    expect(hasWellFormedCredential(`Bearer ${token}`)).toBe(true);
    expect(hasWellFormedCredential("Bearer abc")).toBe(false);
  });

  it("answers 401 for an unknown token, a refresh token, a revoked or expired one, and one for another resource", async () => {
    // An unknown one says so, for the transport's per-address count of failed lookups.
    expect(await mcpContext(bearer(`wkmcp_at_${"U".repeat(43)}`), NOW)).toEqual({ ok: false, sent: true, unknown: true });
    tokenRow().kind = "refresh";
    expect((await mcpContext(bearer(), NOW)).ok).toBe(false);
    tokenRow().kind = "access";
    tokenRow().revokedAt = new Date(NOW.getTime() - 1000);
    expect((await mcpContext(bearer(), NOW)).ok).toBe(false);
    tokenRow().revokedAt = null;
    tokenRow().expiresAt = NOW;
    expect((await mcpContext(bearer(), NOW)).ok).toBe(false);
    tokenRow().expiresAt = new Date(NOW.getTime() + 60_000);
    tokenRow().resource = "https://app.workwrk.com/api/other";
    expect((await mcpContext(bearer(), NOW)).ok).toBe(false);
    tokenRow().resource = "https://app.workwrk.com/api/mcp/";
    expect((await mcpContext(bearer(), NOW)).ok).toBe(true);
    // None of these ended the connection.
    expect(grant().revokedAt).toBeNull();
  });
});

describe("the grant (3.8 step 3)", () => {
  it("answers 401 for a revoked grant (read on every request) and a token of an older family, revoking nothing more", async () => {
    expect((await mcpContext(bearer(), NOW)).ok).toBe(true);
    grant().revokedAt = new Date(NOW.getTime() - 1000);
    grant().revokedReason = "person";
    expect(await mcpContext(bearer(), NOW)).toEqual({ ok: false, sent: true });
    expect(grant().revokedReason).toBe("person");
    grant().revokedAt = null;
    grant().revokedReason = null;
    tokenRow().familyId = "fam-0";
    expect(await mcpContext(bearer(), NOW)).toEqual({ ok: false, sent: true });
    expect(grant().revokedAt).toBeNull();
  });

  it("revokes a grant past its endsBy (expired)", async () => {
    grant().endsBy = new Date(NOW.getTime() - 1);
    expect(await reasonAfter()).toBe("expired");
  });
});

describe("every revoke step (3.8 steps 4 to 9)", () => {
  it("client disabled: every grant of the client", async () => {
    seed(db, "oAuthGrant", { ...grant(), id: "gr-2", organizationId: "org-b", familyId: "fam-2" });
    db.rows.oAuthClient.find((c) => c.id === PUBLIC_ID)!.disabledAt = new Date(NOW.getTime() - 1000);
    expect(await reasonAfter()).toBe("client_disabled");
    expect(db.rows.oAuthGrant.find((g) => g.id === "gr-2")!.revokedReason).toBe("client_disabled");
  });

  it("the switch off, and the app off the allowed list", async () => {
    db.rows.mcpPolicy.find((p) => p.organizationId === "org-a")!.allowedApps = ["claude.ai"];
    expect(await reasonAfter()).toBe("app_not_allowed");
    seedWorld(db, hashSecret);
    seedConnection(db, hashSecret, { now: NOW });
    db.rows.mcpPolicy.find((p) => p.organizationId === "org-a")!.enabled = false;
    expect(await reasonAfter()).toBe("admin_off");
  });

  it("the workspace closed", async () => {
    db.rows.organization.find((o) => o.id === "org-a")!.status = "SUSPENDED";
    expect(await reasonAfter()).toBe("workspace_closed");
  });

  it("the account's sessions ended (a tokenVersion past the grant's)", async () => {
    db.rows.user.find((u) => u.id === "u-max")!.tokenVersion = 4;
    expect(await reasonAfter()).toBe("sessions_ended");
  });

  // Review of step 4, M2: the check read the grant, then the account, and revoked by id alone, so a log out in
  // another browser (carrying the grant's tokenVersion with the account's) or a reconnect (renewing the grant)
  // landing in between was revoked as sessions_ended. Now only the row as judged is revoked, and a moved one is
  // judged again as it is. Both fail on eb8a880b; the test above is the guard that a real gap still revokes.
  it("revokes nothing when a log out in another browser lands between the grant's read and the check, and lets the call through", async () => {
    beforeTheCheck(() => signOutBump("u-max"));
    const r = await mcpContext(bearer(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ctx.grant).toMatchObject({ id: "gr-1", tokenVersion: 4 });
    expect(grant()).toMatchObject({ revokedAt: null, tokenVersion: 4 });
    expect((db.rows.activityLog ?? []).filter((a) => a.type === "mcp.app.revoked")).toEqual([]);
  });

  it("revokes nothing when a reconnect renews the grant between its read and the check, and refuses the old family's token", async () => {
    // Left behind by a real bump (the grant holds 2, the account 3), renewed by Allow while the check runs.
    grant().tokenVersion = 2;
    beforeTheCheck(() =>
      grantConsent({
        userId: "u-max", organizationId: "org-a", clientId: PUBLIC_ID, redirectUri: LOOPBACK, codeChallenge: CHALLENGE, resource: "https://app.workwrk.com/api/mcp",
        scopes: ["mcp:read", "mcp:write"], appName: "an app on this computer", redirectHost: "localhost", sessionTokenVersion: 3, grantMaxDays: 30, now: NOW,
      }),
    );
    expect(await mcpContext(bearer(), NOW)).toEqual({ ok: false, sent: true });
    expect(grant()).toMatchObject({ revokedAt: null, tokenVersion: 3 });
    expect(grant().familyId).not.toBe("fam-1");
    expect((db.rows.activityLog ?? []).filter((a) => a.type === "mcp.app.revoked")).toEqual([]);
  });

  it("the person left, was deactivated, or became a Guest or an agent account", async () => {
    for (const [refusal, reason] of [["gone", "left"], ["inactive", "deactivated"], ["guest", "no_access"], ["agent_account", "no_access"]] as const) {
      seedWorld(db, hashSecret);
      seedConnection(db, hashSecret, { now: NOW });
      st.refuse = refusal;
      expect(await reasonAfter(), refusal).toBe(reason);
    }
  });

  it("a password change, and a Sign everyone out, after the consent", async () => {
    db.rows.user.find((u) => u.id === "u-max")!.passwordChangedAt = new Date(NOW.getTime() - 1000);
    expect(await reasonAfter()).toBe("password_changed");
    seedWorld(db, hashSecret);
    seedConnection(db, hashSecret, { now: NOW });
    db.rows.organization.find((o) => o.id === "org-a")!.settings = { security: { signedOutEveryoneAt: new Date(NOW.getTime() - 1000).toISOString() } };
    expect(await reasonAfter()).toBe("signed_out_everyone");
  });
});

describe("blocks without revoking (3.8 steps 8 and 10)", () => {
  it("AI off: the connection stands, with no person, blocked ai_off", async () => {
    st.refuse = "ai_off";
    const r = await mcpContext(bearer(), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect([r.ctx.blocked, r.ctx.person]).toEqual(["ai_off", null]);
    expect(grant().revokedAt).toBeNull();
  });

  it("the two step hold and the password hold, read from the database", async () => {
    db.rows.organization.find((o) => o.id === "org-a")!.settings = { security: { mfaRequired: "everyone" } };
    const mfa = await mcpContext(bearer(), NOW);
    expect(mfa.ok && mfa.ctx.blocked).toBe("mfa");
    db.rows.organization.find((o) => o.id === "org-a")!.settings = { security: { passwordMaxAgeDays: 30 } };
    db.rows.user.find((u) => u.id === "u-max")!.passwordChangedAt = new Date("2025-01-01T00:00:00Z");
    const pw = await mcpContext(bearer(), NOW);
    expect(pw.ok && pw.ctx.blocked).toBe("password");
    expect(grant().revokedAt).toBeNull();
  });
});

describe("the result (3.8 step 11)", () => {
  it("holds only the scopes both the token and the grant hold", async () => {
    grant().scopes = ["mcp:read"];
    const narrowed = await mcpContext(bearer(), NOW);
    expect(narrowed.ok && narrowed.ctx.scopes).toEqual(["mcp:read"]);
    grant().scopes = ["mcp:read", "mcp:write"];
    tokenRow().scopes = ["mcp:read"];
    const token2 = await mcpContext(bearer(), NOW);
    expect(token2.ok && token2.ctx.scopes).toEqual(["mcp:read"]);
  });

  it("writes lastUsedAt at most once a minute", async () => {
    await mcpContext(bearer(), NOW);
    expect(grant().lastUsedAt).toEqual(NOW);
    await mcpContext(bearer(), new Date(NOW.getTime() + 30_000));
    expect(grant().lastUsedAt).toEqual(NOW);
    const later = new Date(NOW.getTime() + 61_000);
    await mcpContext(bearer(), later);
    expect(grant().lastUsedAt).toEqual(later);
  });
});

describe("the challenge", () => {
  it("names the resource metadata and both scopes, and invalid_token only when a token was sent", async () => {
    expect(challengeHeader(false)).toBe('Bearer resource_metadata="https://app.workwrk.com/.well-known/oauth-protected-resource/api/mcp", scope="mcp:read mcp:write"');
    expect(challengeHeader(true)).toBe(
      'Bearer resource_metadata="https://app.workwrk.com/.well-known/oauth-protected-resource/api/mcp", scope="mcp:read mcp:write", error="invalid_token", error_description="The connection ended or the token expired. Connect again."',
    );
    const r = challenge(true);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
