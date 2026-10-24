// The OAuth server's retention, run by the rate-limit cleanup cron
// (docs/plans/mcp-server.md 5.3, 5.4). Fails on the code before step 1: the
// cron swept rate-limit buckets only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));

import { POST as cleanup } from "@/app/api/cron/ratelimit-cleanup/route";
import { LEFT_BEHIND_BATCH, revokeLeftBehind } from "./grants";
import { seed, seedWorld, testDb as db, useMcpEnv } from "./oauth-test-db";
import { sweepOAuth } from "./sweep";
import { hashSecret } from "./tokens";

const NOW = new Date("2026-10-21T03:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 86_400_000;
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

const grantBase = { organizationId: "org-a", userId: "u-max", scopes: ["mcp:read"], appName: "x", redirectHost: "x", familyId: "f", tokenVersion: 3, authorizedAt: ago(40 * DAY) };

function seedRetention() {
  // Clients: registered 2 days ago and never granted; registered an hour ago; granted, grants gone, last consent 40 days ago; granted with a live grant.
  seed(db, "oAuthClient", { id: "c-stale", name: "", redirectUris: ["x"], authMethod: "none", createdAt: ago(2 * DAY) });
  seed(db, "oAuthClient", { id: "c-new", name: "", redirectUris: ["x"], authMethod: "none", createdAt: ago(3600_000) });
  seed(db, "oAuthClient", { id: "c-old", name: "", redirectUris: ["x"], authMethod: "none", createdAt: ago(200 * DAY), lastUsedAt: ago(40 * DAY) });
  seed(db, "oAuthClient", { id: "c-live", name: "", redirectUris: ["x"], authMethod: "none", createdAt: ago(200 * DAY), lastUsedAt: ago(40 * DAY) });
  seed(db, "oAuthGrant", { ...grantBase, id: "g-live", clientId: "c-live", endsBy: new Date(NOW.getTime() + DAY) });
  seed(db, "oAuthGrant", { ...grantBase, id: "g-past", clientId: "c-live", organizationId: "org-b", endsBy: ago(1000) });
  seed(db, "oAuthGrant", { ...grantBase, id: "g-gone", clientId: "c-live", userId: "u-mia", endsBy: ago(50 * DAY), revokedAt: ago(91 * DAY), revokedReason: "person" });
  seed(db, "oAuthGrant", { ...grantBase, id: "g-recent", clientId: "c-live", userId: "u-lee", endsBy: ago(50 * DAY), revokedAt: ago(30 * DAY), revokedReason: "person" });
  seed(db, "oAuthAuthorizationRequest", { id: "r-old", clientId: "c-new", redirectUri: "x", scopes: ["mcp:read"], codeChallenge: "c", resource: "r", expiresAt: ago(1000) });
  seed(db, "oAuthAuthorizationRequest", { id: "r-live", clientId: "c-new", redirectUri: "x", scopes: ["mcp:read"], codeChallenge: "c", resource: "r", expiresAt: new Date(NOW.getTime() + 60_000) });
  seed(db, "oAuthAuthorizationCode", { id: "k-old", grantId: "g-live", clientId: "c-live", redirectUri: "x", codeChallenge: "c", resource: "r", familyId: "f", expiresAt: ago(2 * DAY) });
  seed(db, "oAuthAuthorizationCode", { id: "k-new", grantId: "g-live", clientId: "c-live", redirectUri: "x", codeChallenge: "c", resource: "r", familyId: "f", expiresAt: ago(3600_000) });
  seed(db, "oAuthToken", { id: "t-old", grantId: "g-live", kind: "access", familyId: "f", scopes: ["mcp:read"], resource: "r", expiresAt: ago(2 * DAY) });
  seed(db, "oAuthToken", { id: "t-new", grantId: "g-live", kind: "refresh", familyId: "f", scopes: ["mcp:read"], resource: "r", expiresAt: new Date(NOW.getTime() + DAY) });
  seed(db, "mcpUsageDay", { grantId: "g-live", day: "2026-07-01", organizationId: "org-a", clientId: "c-live", userId: "u-max" });
  seed(db, "mcpUsageDay", { grantId: "g-live", day: "2026-10-01", organizationId: "org-a", clientId: "c-live", userId: "u-max" });
}

const ids = (model: string) => (db.rows[model] ?? []).map((r) => r.id ?? r.day).sort();

describe("the OAuth sweep", () => {
  it("keeps each kind of row exactly as long as 5.4 says", async () => {
    seedRetention();
    const counts = await sweepOAuth(NOW);
    expect(ids("oAuthAuthorizationRequest")).toEqual(["r-live"]);
    expect(ids("oAuthAuthorizationCode")).toEqual(["k-new"]);
    expect(ids("oAuthToken")).toEqual(["t-new"]);
    // Past its end: revoked as expired, with its audit row; revoked 91 days ago: deleted; 30 days ago: kept.
    expect(db.rows.oAuthGrant.find((g) => g.id === "g-past")).toMatchObject({ revokedReason: "expired" });
    expect(ids("oAuthGrant")).toEqual(["g-live", "g-past", "g-recent"]);
    expect(db.rows.activityLog.filter((a) => a.type === "mcp.app.revoked").length).toBe(1);
    expect(ids("mcpUsageDay")).toEqual(["2026-10-01"]);
    // Never granted after 24 hours, and granted once with nothing left after 30 days; a client with grants stays.
    expect(ids("oAuthClient").filter((id) => String(id).startsWith("c-"))).toEqual(["c-live", "c-new"]);
    expect(counts).toMatchObject({ requests: 1, codes: 1, tokens: 1, expired: 1, grants: 1, usageDays: 1, clients: 2 });
  });

  // Review of step 1: a consent may be landing on an old, never-granted client.
  it("keeps a client touched in the last hour, and deletes each one only after re-checking under its lock", async () => {
    seedRetention();
    // c-stale gets an authorization request 30 minutes ago (long expired: requests last 10 minutes).
    seed(db, "oAuthAuthorizationRequest", { id: "r-landing", clientId: "c-stale", redirectUri: "x", scopes: ["mcp:read"], codeChallenge: "c", resource: "r", createdAt: ago(30 * 60_000), expiresAt: ago(20 * 60_000) });
    db.raw.length = 0;
    const counts = await sweepOAuth(NOW);
    expect(ids("oAuthClient")).toContain("c-stale");
    expect(counts.clients).toBe(1);
    // The expired request itself is still swept, after the clients were.
    expect(ids("oAuthAuthorizationRequest")).not.toContain("r-landing");
    // The one client deleted was deleted under its lock (73_052, the lock a consent landing on it holds).
    expect(db.raw.filter((r) => r.includes("pg_advisory_xact_lock") && r.includes("73052"))).toEqual(["SELECT pg_advisory_xact_lock(?::int, hashtext(?)) [73052, c-old]"]);
  });

  it("never stops on a step that fails", async () => {
    seedRetention();
    db.failing.add("oAuthToken");
    const counts = await sweepOAuth(NOW);
    db.failing.clear();
    expect(counts.tokens).toBe(0);
    expect(counts.clients).toBe(2);
  });
});

describe("the rate-limit cleanup cron", () => {
  it("runs the OAuth sweep after its own buckets, and answers its counts", async () => {
    seedRetention();
    const res = await cleanup(new NextRequest("https://app.workwrk.com/api/cron/ratelimit-cleanup", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.oauth).toMatchObject({ requests: expect.any(Number), clients: expect.any(Number) });
    expect(body.deleted).toEqual({ minute: 0, day: 0 });
    // And the ended sessions past their expiresAt (src/lib/auth/ended-sessions.ts).
    expect(body.endedSessions).toBe(0);
    expect(ids("oAuthAuthorizationRequest")).not.toContain("r-old");
    expect(ids("oAuthClient")).not.toContain("c-stale");
  });
});

// Final review of the MCP server, privacy M2: a tokenVersion bump that does
// not revoke (Sign everyone out, a demotion, a staff action, a deprovision)
// left the person's grants unrevoked until their endsBy, up to 365 days,
// when their app was never used again; the privacy page's "until 90 days
// after the connection ends" was not true of them. Fails on fcca4075: the
// sweep had no such step, and revokeLeftBehind did not exist.
describe("grants a tokenVersion bump left behind", () => {
  const live = { ...grantBase, clientId: "c-live", authorizedAt: ago(5 * DAY), endsBy: new Date(NOW.getTime() + 300 * DAY) };
  const seedLeftBehind = () => {
    seed(db, "oAuthClient", { id: "c-live", name: "", redirectUris: ["x"], authMethod: "none", createdAt: ago(200 * DAY), lastUsedAt: ago(5 * DAY) });
    seed(db, "user", { id: "u-mia", email: "mia@acme.test", organizationId: "org-a", tokenVersion: 7 });
    // Max holds 3: a demotion bumped him from 2 and left this one behind.
    seed(db, "oAuthGrant", { ...live, id: "g-behind", tokenVersion: 2 });
    seed(db, "oAuthToken", { id: "t-behind", grantId: "g-behind", kind: "refresh", familyId: "f", scopes: ["mcp:read"], resource: "r", expiresAt: new Date(NOW.getTime() + DAY) });
    seed(db, "oAuthGrant", { ...live, id: "g-current", organizationId: "org-b" });
    seed(db, "oAuthGrant", { ...live, id: "g-mia", userId: "u-mia", tokenVersion: 6 });
    seed(db, "oAuthGrant", { ...live, id: "g-ended", tokenVersion: 1, revokedAt: ago(DAY), revokedReason: "person" });
    // An account the grant outlived for a moment (its row going with it in the database): left alone.
    seed(db, "oAuthGrant", { ...live, id: "g-nobody", userId: "u-gone", tokenVersion: 1 });
  };
  const grant = (id: string) => db.rows.oAuthGrant.find((g) => g.id === id)!;

  it("are revoked by the sweep as sessions_ended, before the expired step, each with its tokens and its audit row", async () => {
    seedLeftBehind();
    const counts = await sweepOAuth(NOW);
    expect(counts.leftBehind).toBe(2);
    expect(grant("g-behind")).toMatchObject({ revokedReason: "sessions_ended", revokedById: null });
    expect(grant("g-mia")).toMatchObject({ revokedReason: "sessions_ended" });
    expect(db.rows.oAuthToken.find((t) => t.id === "t-behind")?.revokedAt).toBeInstanceOf(Date);
    // What still holds its account's version, one already ended, and one with no account: as they were.
    expect(grant("g-current").revokedAt).toBeNull();
    expect(grant("g-ended").revokedReason).toBe("person");
    expect(grant("g-nobody").revokedAt).toBeNull();
    const rows = db.rows.activityLog.filter((a) => a.type === "mcp.app.revoked");
    expect(rows.map((a) => [a.targetId, a.actingForId, (a.metadata as { reason: string }).reason]).sort()).toEqual([
      ["g-behind", "u-max", "sessions_ended"],
      ["g-mia", "u-mia", "sessions_ended"],
    ]);
  });

  it("ends only the named people's grants for Sign everyone out, with its Owner as the actor", async () => {
    seedLeftBehind();
    expect(await revokeLeftBehind({ userIds: ["u-mia"], actorId: "u-tia", now: NOW })).toBe(1);
    expect(grant("g-mia")).toMatchObject({ revokedReason: "sessions_ended", revokedById: "u-tia" });
    expect(grant("g-behind").revokedAt).toBeNull();
    expect(await revokeLeftBehind({ userIds: [], now: NOW })).toBe(0);
  });

  it("never ends a grant the ordinary log out carried with its account between the two reads", async () => {
    seedLeftBehind();
    // signOutBump moves the account and its matching grant together; here it lands after the grants were read.
    seed(db, "oAuthGrant", { ...live, id: "g-carried", userId: "u-mia", tokenVersion: 7 });
    const users = db.prisma.user as { findMany: (a: unknown) => Promise<unknown> };
    const read = users.findMany;
    users.findMany = async (a: unknown) => {
      db.rows.user.find((u) => u.id === "u-mia")!.tokenVersion = 8;
      grant("g-carried").tokenVersion = 8;
      return read(a);
    };
    try {
      await revokeLeftBehind({ userIds: ["u-mia"], now: NOW });
    } finally {
      users.findMany = read;
    }
    // The log out did land between the reads, and the grant it carried still stands.
    expect([db.rows.user.find((u) => u.id === "u-mia")!.tokenVersion, grant("g-carried").tokenVersion]).toEqual([8, 8]);
    expect(grant("g-carried").revokedAt).toBeNull();
    // The one the earlier bump left behind still ends.
    expect(grant("g-mia").revokedReason).toBe("sessions_ended");
  });

  it("reads in bounded batches and reaches every one", async () => {
    seedLeftBehind();
    const n = LEFT_BEHIND_BATCH * 2 + 7;
    for (let i = 0; i < n; i += 1) seed(db, "oAuthGrant", { ...live, id: `g-many-${String(i).padStart(5, "0")}`, tokenVersion: 0 });
    const counts = await sweepOAuth(NOW);
    expect(counts.leftBehind).toBe(n + 2);
    expect(db.rows.oAuthGrant.filter((g) => String(g.id).startsWith("g-many-") && g.revokedReason !== "sessions_ended")).toEqual([]);
  });
});
