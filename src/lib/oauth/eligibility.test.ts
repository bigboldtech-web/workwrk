// Eligibility (docs/plans/mcp-server.md 3.4 consent step 4, 3.8, 5.3, step 1
// tests "eligibility: the exclusions; the cap counts live grants only").

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  refuse: new Map<string, string>(),
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/agents/acting", async () => {
  const { actingAs } = await import("./oauth-test-db");
  return {
    resolveActingPerson: async (organizationId: string, userId: string) => {
      const reason = st.refuse.get(organizationId);
      return reason ? { ok: false, reason } : { ok: true, person: actingAs(organizationId, userId) };
    },
  };
});

import { grantStanding, liveGrantCount, mcpWorkspacesFor, type GrantForStanding } from "./eligibility";
import { seed, seedWorld, testDb as db, useMcpEnv } from "./oauth-test-db";
import { hashSecret } from "./tokens";

const saved = { ...process.env };
beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
  st.refuse.clear();
});
afterEach(() => {
  process.env = { ...saved };
});

const AUTH_AT = Date.parse("2026-10-21T09:00:00Z");
const elig = (redirectHost = "localhost", authAt: number | null = AUTH_AT) => mcpWorkspacesFor({ userId: "u-max", sessionOrgId: "org-a", authAt, redirectHost });
const ids = async (redirectHost?: string, authAt?: number | null) => (await elig(redirectHost, authAt)).workspaces.map((w) => w.id);
const org = (id: string) => db.rows.organization.find((o) => o.id === id)!;
const policy = (id: string) => db.rows.mcpPolicy.find((p) => p.organizationId === id)!;

describe("which workspaces a person may connect an app in", () => {
  it("keeps an ACTIVE or TRIAL workspace with the switch on, and leaves out every exclusion", async () => {
    expect(await ids()).toEqual(["org-a", "org-b"]);
    policy("org-b").enabled = false;
    expect(await ids()).toEqual(["org-a"]);
    policy("org-b").enabled = true;
    org("org-b").status = "SUSPENDED";
    expect(await ids()).toEqual(["org-a"]);
    org("org-b").status = "TRIAL";
    policy("org-b").allowedApps = ["claude.ai"];
    expect(await ids("localhost")).toEqual(["org-a"]);
    expect(await ids("claude.ai")).toEqual(["org-a", "org-b"]);
    policy("org-b").allowedApps = [];
    for (const reason of ["guest", "agent_account", "ai_off", "gone", "inactive"]) {
      st.refuse.set("org-b", reason);
      expect(await ids(), reason).toEqual(["org-a"]);
    }
    st.refuse.clear();
    // No row at all: off.
    db.rows.mcpPolicy = db.rows.mcpPolicy.filter((p) => p.organizationId !== "org-b");
    const e = await elig();
    expect(e.workspaces.map((w) => w.id)).toEqual(["org-a"]);
    expect(e.unavailable).toBe(1);
  });

  it("reads the holds from the database for each workspace, and sends a held own workspace to its hold page", async () => {
    org("org-b").settings = { security: { mfaRequired: "everyone" } };
    expect(await elig()).toMatchObject({ workspaces: [{ id: "org-a" }], held: null });
    org("org-a").settings = { security: { mfaRequired: "everyone" } };
    expect(await elig()).toMatchObject({ workspaces: [], held: "mfa" });
    db.rows.user[0].mfaEnabled = true;
    db.rows.user[0].passwordChangedAt = new Date("2025-01-01T00:00:00Z");
    org("org-a").settings = { security: { passwordMaxAgeDays: 30 } };
    expect(await elig()).toMatchObject({ held: "password" });
  });

  it("leaves out a workspace that signed everyone out after this session signed in", async () => {
    org("org-b").settings = { security: { signedOutEveryoneAt: "2026-10-21T10:00:00.000Z" } };
    expect(await ids()).toEqual(["org-a"]);
    expect(await ids("localhost", Date.parse("2026-10-21T11:00:00Z"))).toEqual(["org-a", "org-b"]);
    org("org-a").settings = { security: { signedOutEveryoneAt: "2026-10-21T10:00:00.000Z" } };
    expect((await elig()).ownEnded).toBe(true);
  });

  it("leaves out everything for a removed or deactivated account", async () => {
    db.rows.user[0].status = "INACTIVE";
    expect(await ids()).toEqual([]);
  });
});

describe("the cap of 20", () => {
  it("counts live grants only: not revoked, not past endsBy, not behind the account's tokenVersion", async () => {
    const base = { clientId: "c", organizationId: "org-a", userId: "u-max", scopes: ["mcp:read"], appName: "x", redirectHost: "x", familyId: "f", authorizedAt: new Date() };
    const later = new Date(Date.now() + 86_400_000);
    seed(db, "oAuthGrant", { ...base, id: "live", tokenVersion: 3, endsBy: later });
    seed(db, "oAuthGrant", { ...base, id: "revoked", tokenVersion: 3, endsBy: later, revokedAt: new Date(), revokedReason: "person" });
    seed(db, "oAuthGrant", { ...base, id: "ended", tokenVersion: 3, endsBy: new Date(Date.now() - 1000) });
    seed(db, "oAuthGrant", { ...base, id: "behind", tokenVersion: 2, endsBy: later });
    seed(db, "oAuthGrant", { ...base, id: "someone-else", userId: "u-mia", tokenVersion: 3, endsBy: later });
    expect(await liveGrantCount("u-max", 3)).toBe(1);
  });
});

describe("whether a grant still stands (3.8 steps 3 to 10)", () => {
  const grant = (o: Partial<GrantForStanding> = {}): GrantForStanding => ({
    id: "g1", clientId: "c", organizationId: "org-a", userId: "u-max", appName: "x", redirectHost: "localhost", tokenVersion: 3,
    authorizedAt: new Date("2026-10-21T09:00:00Z"), endsBy: new Date(Date.now() + 86_400_000), revokedAt: null, ...o,
  });
  const live = { disabledAt: null };

  it("names the reason each failure revokes with, in order", async () => {
    expect(await grantStanding(grant(), live)).toMatchObject({ ok: true, blocked: null });
    expect(await grantStanding(grant({ endsBy: new Date(Date.now() - 1) }), live)).toEqual({ ok: false, revoke: "expired" });
    expect(await grantStanding(grant(), { disabledAt: new Date() })).toMatchObject({ ok: false, revoke: "client_disabled", clientWide: true });
    policy("org-a").allowedApps = ["claude.ai"];
    expect(await grantStanding(grant(), live)).toEqual({ ok: false, revoke: "app_not_allowed" });
    policy("org-a").allowedApps = [];
    policy("org-a").enabled = false;
    expect(await grantStanding(grant(), live)).toEqual({ ok: false, revoke: "admin_off" });
    policy("org-a").enabled = true;
    org("org-a").status = "CANCELLED";
    expect(await grantStanding(grant(), live)).toEqual({ ok: false, revoke: "workspace_closed" });
    org("org-a").status = "ACTIVE";
    expect(await grantStanding(grant({ tokenVersion: 2 }), live)).toEqual({ ok: false, revoke: "sessions_ended" });
    for (const [reason, revoke] of [["gone", "left"], ["inactive", "deactivated"], ["guest", "no_access"], ["agent_account", "no_access"]]) {
      st.refuse.set("org-a", reason);
      expect(await grantStanding(grant(), live), reason).toEqual({ ok: false, revoke });
    }
    st.refuse.clear();
    db.rows.user[0].passwordChangedAt = new Date("2026-10-21T10:00:00Z");
    expect(await grantStanding(grant(), live)).toEqual({ ok: false, revoke: "password_changed" });
    db.rows.user[0].passwordChangedAt = null;
    org("org-a").settings = { security: { signedOutEveryoneAt: "2026-10-21T10:00:00.000Z" } };
    expect(await grantStanding(grant(), live)).toEqual({ ok: false, revoke: "signed_out_everyone" });
  });

  it("only blocks for AI off and for a hold, never revokes", async () => {
    st.refuse.set("org-a", "ai_off");
    expect(await grantStanding(grant(), live)).toMatchObject({ ok: true, blocked: "ai_off", person: null });
    st.refuse.clear();
    org("org-a").settings = { security: { mfaRequired: "everyone" } };
    expect(await grantStanding(grant(), live)).toMatchObject({ ok: true, blocked: "mfa" });
  });
});
