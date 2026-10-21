// The OAuth server's retention, run by the rate-limit cleanup cron
// (docs/plans/mcp-server.md 5.3, 5.4). Fails on the code before step 1: the
// cron swept rate-limit buckets only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));

import { POST as cleanup } from "@/app/api/cron/ratelimit-cleanup/route";
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
    expect(ids("oAuthAuthorizationRequest")).not.toContain("r-old");
    expect(ids("oAuthClient")).not.toContain("c-stale");
  });
});
