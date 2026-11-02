// A key works only while its maker holds a live seat in its workspace
// (src/lib/access/seat-api-keys.ts creatorsWithoutLiveSeat; the rule
// src/lib/api-auth.ts refuses by, GET /api/keys marks as Stopped, and the
// SQL file's step three revokes by on the deploy: docs/plans/workspace-status.md,
// the final review, security L4 and product M2). Run on the in-memory database.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "olga", organizationId: "b" } } }),
  getOrgId: () => "b",
  getUserId: () => "olga",
}));
vi.mock("@/lib/access/settings-write", () => ({ settingsWriteGate: async () => ({ ok: true }) }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: async () => undefined }));

import { seatDb as db } from "./seat-test-db";
import { creatorsWithoutLiveSeat } from "./seat-api-keys";
import { GET } from "@/app/api/keys/route";

const person = (id: string, organizationId: string, extra: Record<string, unknown> = {}) => db.seed("user", { id, email: `${id}@x.test`, firstName: id, lastName: "Lee", organizationId, ...extra });
const seat = (userId: string, organizationId: string, extra: Record<string, unknown> = {}) => db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, ...extra });

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  person("olga", "b");
  // Anchored here: live, deactivated, removed.
  person("live", "b");
  person("off", "b", { status: "INACTIVE" });
  person("gone", "b", { status: "INACTIVE", deletedAt: new Date("2026-10-01") });
  // Here through a membership: live, deactivated, removed; and one with no seat here.
  person("m-live", "a");
  seat("m-live", "b");
  person("m-off", "a");
  seat("m-off", "b", { status: "INACTIVE" });
  person("m-gone", "a");
  seat("m-gone", "b", { status: "INACTIVE", removedAt: new Date("2026-10-01") });
  person("never", "a");
  // Ended at home but live here (D7's state): the seat here decides.
  person("home-off", "a", { status: "INACTIVE" });
  seat("home-off", "b");
  // Anchored here but deactivated, with a live stale row of its own: the account decides.
  person("stale", "b", { status: "INACTIVE" });
  seat("stale", "b");
});

describe("creatorsWithoutLiveSeat states the rule once", () => {
  it("names exactly the makers with no live seat in the workspace", async () => {
    const all = ["live", "off", "gone", "m-live", "m-off", "m-gone", "never", "home-off", "stale", "no-such-person"];
    expect([...(await creatorsWithoutLiveSeat(db.prisma as never, "b", all))].sort()).toEqual(["gone", "m-gone", "m-off", "never", "no-such-person", "off", "stale"]);
  });
});

describe("GET /api/keys says Stopped for a live key whose maker is gone (product M2)", () => {
  it("marks it stopped, never Active; a revoked key is not stopped, it is revoked", async () => {
    for (const [id, by, revokedAt] of [["k1", "live", null], ["k2", "off", null], ["k3", "m-gone", null], ["k4", "gone", new Date("2026-10-02")]] as const) {
      db.seed("apiKey", { id, name: id, prefix: `wk_live_${id}`, scopes: ["READ"], organizationId: "b", createdById: by, revokedAt, createdAt: new Date(), rateLimitPerMinute: 120, rateLimitPerDay: 50000, requestCount: 0, lastUsedAt: null, lastUsedIp: null });
    }
    const body = (await (await GET(new NextRequest("https://app.test/api/keys"))).json()) as { data: Array<{ id: string; stopped: boolean }> };
    const stopped = Object.fromEntries(body.data.map((k) => [k.id, k.stopped]));
    // Before: no such flag, so the page said Active for k2 and k3.
    expect(stopped).toEqual({ k1: false, k2: true, k3: true, k4: false });
    expect(JSON.stringify(body)).not.toContain("createdById");
  });
});
