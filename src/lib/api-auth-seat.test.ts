// An API key works only while the person who made it still works in its
// workspace (docs/plans/workspace-status.md D15, the step 3 review M2).
// endSeat revokes a person's keys when their seat ends, but a key of
// someone ended before the deploy, by SCIM, by their own erasure or by any
// path that did not revoke it kept reading the company's data. Run through
// the real authenticate on an in-memory database.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { authenticate, hashKey } from "./api-auth";
import { seatDb as db } from "@/lib/access/seat-test-db";

const KEY = "wk_live_abcdefghijklmnopqrstuvwxyz";
const call = () => authenticate(new NextRequest("https://app.test/api/v1/people", { headers: { authorization: `Bearer ${KEY}` } }), "READ");

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  db.seed("user", { id: "ivy", email: "ivy@x.test", organizationId: "b" });
  db.seed("apiKey", { id: "k1", name: "Sync", prefix: KEY.slice(0, 12), hashedKey: hashKey(KEY), scopes: ["READ"], revokedAt: null, organizationId: "b", createdById: "ivy", rateLimitPerMinute: 120, rateLimitPerDay: 50000, requestCount: 0 });
});

describe("an API key whose maker no longer works in its workspace stops working", () => {
  it("works while its maker holds a live seat there, anchored or through a membership", async () => {
    expect((await call()).ctx).toMatchObject({ organizationId: "b", via: "api_key", apiKeyId: "k1" });
    // Ivy moved her anchor to A and works in B through a live membership.
    db.row("user", "ivy").organizationId = "a";
    db.seed("organizationMembership", { id: "m-ivy-b", userId: "ivy", organizationId: "b" });
    expect((await call()).ctx).toMatchObject({ organizationId: "b" });
  });

  it("is refused once its maker is deactivated or removed there, or erased, or never worked there", async () => {
    const refused = async () => {
      const r = await call();
      expect(r.ctx).toBeNull();
      expect(r.error?.status).toBe(401);
      expect(await r.error?.json()).toEqual({ error: "This API key stopped working because the person who made it no longer works in this workspace. An Admin can make a new key in Settings, API keys." });
    };
    // Before: each of these still answered, the key's own revokedAt being null.
    db.row("user", "ivy").status = "INACTIVE";
    await refused();
    db.row("user", "ivy").status = "ACTIVE";
    db.row("user", "ivy").deletedAt = new Date("2026-10-01");
    await refused();
    // Working in B through a membership B ended.
    db.row("user", "ivy").deletedAt = null;
    db.row("user", "ivy").organizationId = "a";
    db.seed("organizationMembership", { id: "m-ivy-b", userId: "ivy", organizationId: "b", status: "INACTIVE" });
    await refused();
    db.row("organizationMembership", "m-ivy-b").status = "ACTIVE";
    db.row("organizationMembership", "m-ivy-b").removedAt = new Date("2026-10-01");
    await refused();
    // No seat in B at all.
    db.tables.organizationMembership.length = 0;
    await refused();
  });
});
