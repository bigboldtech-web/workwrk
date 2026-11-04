// Security > Provisioning's one switch, "Let your identity provider set
// Reports to" (docs/plans/workspace-status-2.md, the final review, product
// H1): stored in the workspace's settings JSON (the security section, no
// schema change), off unless an Admin turns it on, and changed only through
// PATCH /api/settings with that section's gates: the actor re-read now
// (freshWorkspaceActor), a tab showing another workspace refused, the Owner
// page's rule (the Admins who manage SCIM), and an Audit row in words. The
// database and the session are faked; the route, its gates and its merge are
// the real ones.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  session: null as unknown as { user: Record<string, unknown> },
  /** The actor's row as the database holds it now. */
  actor: {} as Record<string, unknown>,
  /** The x-workspace-id a tab sends, or none. */
  tab: null as string | null,
  settings: {} as Record<string, unknown>,
  audit: [] as Array<Record<string, unknown>>,
}));

vi.mock("next-auth", () => ({ getServerSession: async () => st.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(st.tab ? { "x-workspace-id": st.tab } : {}) }));
vi.mock("@/lib/auth/session-cookie", () => ({ sessionEndedNow: async () => false }));
vi.mock("@/lib/admin/company-detail", () => ({ ownerIdsFor: async () => [] }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: (row: Record<string, unknown>) => { st.audit.push(row); } }));
vi.mock("@/lib/access/access-grant-store", () => ({ lockOrgSettings: async () => true }));
vi.mock("@/lib/org-settings-write", async (orig) => ({
  ...(await orig<typeof import("@/lib/org-settings-write")>()),
  writeOrgSettingsKeys: async (_org: string, patch: Record<string, unknown>) => { st.settings = { ...st.settings, ...patch }; return true; },
}));
vi.mock("@/lib/prisma", () => {
  const organization = { findUnique: async () => ({ id: "org1", settings: st.settings }) };
  return {
    prisma: {
      user: { findUnique: async () => st.actor },
      organizationMembership: { findUnique: async () => null },
      organization,
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ organization }),
    },
  };
});

import { PATCH } from "./route";
import { idpSetsReportsToOf } from "@/lib/settings/org-policy";

const save = (data: unknown) => PATCH(new Request("https://app.test/api/settings", { method: "PATCH", body: JSON.stringify({ section: "security", data }) }));
const switchRows = () => st.audit.filter((r) => r.type === "security.provisioning.updated");

/** The actor's row, at this level, as the database holds it now. */
const actorRow = (level: string) => ({ deletedAt: null, status: "ACTIVE", ...legacyLevelRow(level), organizationId: "org1", tokenVersion: 0, adminScopes: [] as string[] });

beforeEach(() => {
  st.session = legacyTestSession("ada", "COMPANY_ADMIN", "org1");
  st.actor = actorRow("COMPANY_ADMIN");
  st.tab = null;
  // A workspace with a sign-in policy saved, and the switch never touched.
  st.settings = { security: { minPasswordLength: 12, requireSymbol: true } };
  st.audit = [];
});

describe("Let your identity provider set Reports to", () => {
  it("is off until an Admin turns it on, and is stored beside the sign-in policy, which it leaves as it was", async () => {
    expect(idpSetsReportsToOf(st.settings)).toBe(false);
    expect(idpSetsReportsToOf({})).toBe(false);
    expect(idpSetsReportsToOf({ security: { identityProviderSetsReportsTo: "yes" } })).toBe(false);
    const res = await save({ identityProviderSetsReportsTo: true });
    // Before: 400, "Unknown security setting".
    expect(res.status).toBe(200);
    expect(st.settings.security).toEqual({ minPasswordLength: 12, requireSymbol: true, identityProviderSetsReportsTo: true });
    expect(idpSetsReportsToOf(st.settings)).toBe(true);
  });

  it("writes an Audit row in words each time it changes, and none when it is saved as it was", async () => {
    await save({ identityProviderSetsReportsTo: true });
    await save({ identityProviderSetsReportsTo: true });
    await save({ identityProviderSetsReportsTo: false });
    expect(switchRows()).toEqual([
      expect.objectContaining({ actorId: "ada", organizationId: "org1", description: "Let the identity provider set Reports to", oldValue: { identityProviderSetsReportsTo: false }, newValue: { identityProviderSetsReportsTo: true }, targetType: "Organization", targetId: "org1" }),
      expect.objectContaining({ description: "Stopped the identity provider setting Reports to", oldValue: { identityProviderSetsReportsTo: true }, newValue: { identityProviderSetsReportsTo: false } }),
    ]);
    // A save of the sign-in policy alone never writes the switch's row.
    await save({ minPasswordLength: 14 });
    expect(switchRows()).toHaveLength(2);
    expect((st.settings.security as Record<string, unknown>).identityProviderSetsReportsTo).toBe(false);
  });

  it("is refused to anyone who does not manage the Security page, and to a tab showing another workspace, writing nothing", async () => {
    // A Manager: not an Admin.
    st.session = legacyTestSession("max", "MANAGER", "org1");
    st.actor = actorRow("MANAGER");
    const manager = await save({ identityProviderSetsReportsTo: true });
    expect(manager.status).toBe(403);
    expect(await manager.json()).toMatchObject({ code: "owner_only" });
    // An Admin demoted a moment ago: the database says Member.
    st.session = legacyTestSession("ada", "COMPANY_ADMIN", "org1");
    st.actor = actorRow("EMPLOYEE");
    expect((await save({ identityProviderSetsReportsTo: true })).status).toBe(403);
    // An Admin's tab still showing the workspace she switched away from.
    st.actor = actorRow("COMPANY_ADMIN");
    st.tab = "org2";
    const stale = await save({ identityProviderSetsReportsTo: true });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "workspace_changed" });
    expect(idpSetsReportsToOf(st.settings)).toBe(false);
    expect(st.audit).toEqual([]);
  });

  it("takes only a true or a false", async () => {
    expect((await save({ identityProviderSetsReportsTo: "on" })).status).toBe(400);
    expect(idpSetsReportsToOf(st.settings)).toBe(false);
  });
});
