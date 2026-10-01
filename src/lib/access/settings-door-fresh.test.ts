import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 8 walk, group 12. The Workspace settings door (page gate, Members,
// Teams and the invitations list) answered from the session's claim, which is
// re-checked only every five minutes, so an Admin demoted a moment ago kept
// opening the sign-in policy editor and reading every member's email. The
// door now re-reads the person from the database whenever the session claims
// the manager tier or above, and a Member's session reads nothing.

let row: { deletedAt: Date | null; status: string; accessLevel: string; organizationId: string; tokenVersion: number; adminScopes: string[] } | null = null;
let lookups = 0;
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async () => { lookups++; return row; } },
    organizationMembership: { findUnique: async () => null },
  },
}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/admin/company-detail", () => ({ ownerIdsFor: async () => ["owner"] }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => {} }));
vi.mock("./flags", () => ({ accessV2Resolver: () => false, settingsGateLogOnly: () => false, accessV2Tables: () => false }));

import { settingsDoorAllows, settingsReaderPagesFor } from "./settings-door";
import { requestRolesCoveredBy, requestTypesForNode, roleCoversRequest } from "./access-requests";

const admin = (tokenVersion = 3) => ({ user: { id: "a1", organizationId: "o1", accessLevel: "COMPANY_ADMIN", tokenVersion } });
const dbRow = (accessLevel: string, tokenVersion = 3) => ({ deletedAt: null, status: "ACTIVE", accessLevel, organizationId: "o1", tokenVersion, adminScopes: [] });

describe("settingsDoorAllows reads the person fresh", () => {
  beforeEach(() => { lookups = 0; row = null; });

  it("opens Members and Security for an Admin the database still holds as Admin", async () => {
    row = dbRow("COMPANY_ADMIN");
    expect(await settingsDoorAllows("members", admin())).toBe(true);
    expect(await settingsDoorAllows("security", admin())).toBe(true);
  });

  it("shuts every door for an Admin demoted a moment ago (the bump moved tokenVersion)", async () => {
    row = dbRow("EMPLOYEE", 4);
    for (const page of ["members", "access", "security", "audit", "overview"] as const) {
      expect(await settingsDoorAllows(page, admin(3))).toBe(false);
    }
  });

  it("shuts the doors when the database level dropped even without a version bump", async () => {
    row = dbRow("EMPLOYEE", 3);
    expect(await settingsDoorAllows("members", admin(3))).toBe(false);
    expect(await settingsDoorAllows("security", admin(3))).toBe(false);
  });

  it("shuts a manager-tier reader page for a Manager the database now holds as Employee", async () => {
    row = dbRow("EMPLOYEE", 3);
    expect(await settingsDoorAllows("members", { user: { id: "m1", organizationId: "o1", accessLevel: "MANAGER", tokenVersion: 3 } })).toBe(false);
  });

  it("never opens an Admin page early for a promotion the session has not picked up", async () => {
    row = dbRow("COMPANY_ADMIN", 3);
    expect(await settingsDoorAllows("overview", { user: { id: "m1", organizationId: "o1", accessLevel: "MANAGER", tokenVersion: 3 } })).toBe(false);
  });

  it("costs a Member nothing: no database read, door shut", async () => {
    expect(await settingsDoorAllows("members", { user: { id: "e1", organizationId: "o1", accessLevel: "EMPLOYEE" } })).toBe(false);
    expect(lookups).toBe(0);
  });

  it("reads the database once for the reader sidebar's four pages", async () => {
    row = dbRow("COMPANY_ADMIN");
    expect(await settingsReaderPagesFor(admin())).toEqual(["members", "structure", "access", "scoring"]);
    expect(lookups).toBe(1);
    row = dbRow("EMPLOYEE", 4);
    expect(await settingsReaderPagesFor(admin(3))).toEqual([]);
  });
});

describe("a grant answers the matching access requests", () => {
  it("covers an ask at or below the role held, never above or with none", () => {
    expect(roleCoversRequest("EDIT", "EDIT")).toBe(true);
    expect(roleCoversRequest("FULL", "EDIT")).toBe(true);
    expect(roleCoversRequest("OWNER", "VIEW")).toBe(true);
    expect(roleCoversRequest("VIEW", "EDIT")).toBe(false);
    expect(roleCoversRequest("COMMENT", "EDIT")).toBe(false);
    expect(roleCoversRequest("none", "VIEW")).toBe(false);
    expect(roleCoversRequest(null, "VIEW")).toBe(false);
    // An ask in a spelling this module does not know reads as the strictest.
    expect(roleCoversRequest("COMMENT", "WHATEVER")).toBe(false);
    expect(roleCoversRequest("EDIT", "WHATEVER")).toBe(true);
  });

  it("lists the asks a held role answers", () => {
    expect(requestRolesCoveredBy("VIEW")).toEqual(["VIEW"]);
    expect(requestRolesCoveredBy("EDIT")).toEqual(["VIEW", "COMMENT", "EDIT"]);
    expect(requestRolesCoveredBy("none")).toEqual([]);
  });

  it("matches both spellings a List and a Canvas request are stored under", () => {
    expect(requestTypesForNode("list")).toEqual(["list", "board"]);
    expect(requestTypesForNode("canvas")).toEqual(["canvas", "whiteboard"]);
    expect(requestTypesForNode("doc")).toEqual(["doc"]);
  });
});
