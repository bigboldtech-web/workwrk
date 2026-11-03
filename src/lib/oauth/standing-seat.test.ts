// An AI app's connection and the person's seat in its workspace
// (docs/plans/workspace-status.md step 2, D7). A grant made in a workspace
// the person works in through a membership stands only while that seat is
// live: a seat that workspace removed revokes it as "left", one it
// deactivated as "deactivated", exactly as for someone anchored there. Run
// with the real resolveActingPerson (src/lib/agents/acting.ts) and the real
// level reads, only the viewer, the access engine and the zones stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/access/viewer", () => ({
  viewerHeldIn: async (organizationId: string, userId: string) => ({ userId, organizationId, orgRole: "MEMBER", isAgent: false, adminScopes: [] }),
}));
vi.mock("@/lib/access", () => ({ can: async () => ({ allowed: true }) }));
vi.mock("@/lib/preferences", () => ({ getEffectivePreferences: async () => ({ home: { locale: { timezone: "UTC" } } }) }));
vi.mock("@/lib/work-schedule-server", () => ({ readOrgWorkSchedule: async () => ({ timezone: "UTC" }) }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: async () => undefined, logActivity: async () => undefined }));

import { enforceStanding, mcpWorkspacesFor, STANDING_GRANT_SELECT, type StandingGrant } from "./eligibility";
import { resolveActingPerson } from "@/lib/agents/acting";
import { seed, seedConnection, seedWorld, testDb as db, useMcpEnv } from "./oauth-test-db";
import { hashSecret } from "./tokens";

const saved = { ...process.env };
const seat = () => db.rows.organizationMembership.find((m) => m.id === "m-1")!;
const grantRow = () => db.rows.oAuthGrant.find((g) => g.id === "gr-b")!;
const judged = (): StandingGrant => {
  const g = grantRow();
  return Object.fromEntries(Object.keys(STANDING_GRANT_SELECT).map((k) => [k, g[k]])) as unknown as StandingGrant;
};

beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
  // Max is anchored in Acme and works in Beta through membership m-1; his connection is in Beta.
  seedConnection(db, hashSecret, { grantId: "gr-b", organizationId: "org-b" });
});
afterEach(() => {
  process.env = { ...saved };
});

describe("resolveActingPerson and a membership seat", () => {
  it("acts for a live seat, and says why not for an ended one: deactivated there is inactive, removed there is gone", async () => {
    expect(await resolveActingPerson("org-b", "u-max")).toMatchObject({ ok: true, person: { organizationId: "org-b" } });
    seat().status = "INACTIVE";
    // Before: "gone" for both.
    expect(await resolveActingPerson("org-b", "u-max")).toEqual({ ok: false, reason: "inactive" });
    seat().removedAt = new Date("2026-10-01");
    expect(await resolveActingPerson("org-b", "u-max")).toEqual({ ok: false, reason: "gone" });
  });
});

// The step 2 review L4: for a workspace the person works in through a
// membership the seat there decides, never the account's state at home.
describe("an account ended where it is anchored that still works here (D7's state)", () => {
  const account = () => db.rows.user.find((u) => u.id === "u-max")!;

  it("is acted for here, and its connection here stands, deactivated or removed at home", async () => {
    account().status = "INACTIVE";
    // Before: "inactive", and the grant revoked as deactivated for good.
    expect(await resolveActingPerson("org-b", "u-max")).toMatchObject({ ok: true, person: { organizationId: "org-b" } });
    expect((await enforceStanding(judged(), { id: "c", disabledAt: null })).ok).toBe(true);
    account().deletedAt = new Date("2026-10-30");
    // Before: "gone", and the grant revoked as left.
    expect(await resolveActingPerson("org-b", "u-max")).toMatchObject({ ok: true });
    expect((await enforceStanding(judged(), { id: "c", disabledAt: null })).ok).toBe(true);
    expect(grantRow().revokedAt).toBeNull();
    // At home the account row is the seat, as before.
    expect(await resolveActingPerson("org-a", "u-max")).toEqual({ ok: false, reason: "gone" });
  });

  it("an erased account is gone everywhere, its seats ended or not", async () => {
    const at = new Date("2026-10-30T10:00:00Z");
    Object.assign(account(), { status: "INACTIVE", deletedAt: at });
    seed(db, "consentRecord", { id: "cr", userId: "u-max", method: "erasure", withdrawnAt: at, createdAt: at });
    expect(await resolveActingPerson("org-b", "u-max")).toEqual({ ok: false, reason: "gone" });
    expect(await enforceStanding(judged(), { id: "c", disabledAt: null })).toEqual({ ok: false, revoke: "left" });
  });
});

describe("a connection in a workspace whose seat ended", () => {
  it("stands while the seat is live", async () => {
    const s = await enforceStanding(judged(), { id: "c", disabledAt: null });
    expect(s.ok).toBe(true);
    expect(grantRow().revokedAt).toBeNull();
  });

  it("is revoked as deactivated when that workspace deactivated them", async () => {
    seat().status = "INACTIVE";
    expect(await enforceStanding(judged(), { id: "c", disabledAt: null })).toEqual({ ok: false, revoke: "deactivated" });
    expect(grantRow()).toMatchObject({ revokedReason: "deactivated" });
    expect(grantRow().revokedAt).toBeInstanceOf(Date);
  });

  it("is revoked as left when that workspace removed them", async () => {
    Object.assign(seat(), { status: "INACTIVE", removedAt: new Date("2026-10-01") });
    expect(await enforceStanding(judged(), { id: "c", disabledAt: null })).toEqual({ ok: false, revoke: "left" });
    expect(grantRow()).toMatchObject({ revokedReason: "left" });
  });

  it("and that workspace is not offered for a new connection", async () => {
    seat().status = "INACTIVE";
    const e = await mcpWorkspacesFor({ userId: "u-max", sessionOrgId: "org-a", authAt: Date.now(), redirectHost: "localhost" });
    expect(e.workspaces.map((w) => w.id)).toEqual(["org-a"]);
    expect(e.unavailable).toBe(0);
  });
});
