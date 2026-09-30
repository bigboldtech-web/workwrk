import { describe, expect, it } from "vitest";
import { backfillAssertions, planOrgBackfill, reportTreeSizes, type BackfillSnapshot } from "./backfill-plan";

const user = (id: string, accessLevel: string, createdAt: string, managerId: string | null = null, extra: Partial<BackfillSnapshot["users"][number]> = {}) => ({
  id, name: id, accessLevel, createdAt, managerId, orgRole: null, isAgent: false, live: true, ...extra,
});

function snap(over: Partial<BackfillSnapshot> = {}): BackfillSnapshot {
  return {
    organizationId: "o",
    organizationName: "Org",
    settings: null,
    users: [
      user("a1", "COMPANY_ADMIN", "2026-01-01"),
      user("a2", "COMPANY_ADMIN", "2026-02-01"),
      user("hr", "HR", "2026-03-01"),
      user("vp", "VP", "2026-03-02"),
      user("m", "MANAGER", "2026-03-03"),
      user("e", "EMPLOYEE", "2026-03-04", "vp"),
      user("bot", "AGENT", "2026-03-05"),
    ],
    apiKeys: [],
    sopFolderAccess: [],
    spaces: [],
    folders: [],
    boards: [],
    orgVisibleStandaloneDocs: 0,
    orgWideWhiteboards: 0,
    unscopedTables: 0,
    existingGrantKeys: new Set(),
    ...over,
  };
}

describe("access backfill plan", () => {
  it("the earliest COMPANY_ADMIN is the Owner; the other admin is Admin; the rest Members; AGENT gets the flag", () => {
    const p = planOrgBackfill(snap());
    const role = Object.fromEntries(p.userUpdates.map((u) => [u.id, u.orgRole]));
    expect(role).toMatchObject({ a1: "OWNER", a2: "ADMIN", hr: "MEMBER", vp: "MEMBER", e: "MEMBER", bot: "MEMBER" });
    expect(p.userUpdates.find((u) => u.id === "bot")?.isAgent).toBe(true);
    expect(p.preflight.owners.map((o) => o.id)).toEqual(["a1"]);
  });
  it("a SUPER_ADMIN created first is the Owner and no COMPANY_ADMIN is", () => {
    const p = planOrgBackfill(snap({ users: [user("s", "SUPER_ADMIN", "2025-01-01"), user("a", "COMPANY_ADMIN", "2026-01-01")] }));
    expect(p.preflight.owners.map((o) => o.id)).toEqual(["s"]);
    expect(p.userUpdates.find((u) => u.id === "a")?.orgRole).toBe("ADMIN");
  });
  it("a workspace with no admin has no Owner and is flagged", () => {
    const p = planOrgBackfill(snap({ users: [user("e", "EMPLOYEE", "2026-01-01")] }));
    expect(p.preflight.noOwner).toBe(true);
  });
  it("the pre-flight names executives without the whole tree and managers with no reports", () => {
    const p = planOrgBackfill(snap());
    expect(p.preflight.executivesNotWholeOrg.map((x) => x.id)).toEqual(["vp"]);
    expect(p.preflight.managersWithNoReports.map((x) => x.id)).toEqual(["m"]);
  });
  it("flags an ADMIN key whose creator is not an admin", () => {
    const p = planOrgBackfill(snap({ apiKeys: [
      { id: "k1", name: "ops", scopes: ["ADMIN"], createdById: "m", revoked: false },
      { id: "k2", name: "ok", scopes: ["ADMIN"], createdById: "a1", revoked: false },
      { id: "k3", name: "gone", scopes: ["ADMIN"], createdById: "m", revoked: true },
    ] }));
    expect(p.preflight.adminKeysWithNonAdminCreator.map((k) => k.id)).toEqual(["k1"]);
  });
  it("writes today's enforced toggles only where the org has none, and seeds the People team with HR", () => {
    const p = planOrgBackfill(snap());
    expect(p.accessSettingsWrite?.findableSpaces).toBe(false);
    expect(p.accessSettingsWrite?.editorsCanShare).toBe(false);
    expect(p.peopleTeamSeed).toEqual(["hr"]);
    const kept = planOrgBackfill(snap({ settings: { access: { findableSpaces: true, peopleTeamUserIds: ["x"] } } }));
    expect(kept.accessSettingsWrite).toBeNull();
    expect(kept.peopleTeamSeed).toBeNull();
    expect(kept.preflight.widenedAccessToggles).toBe(true);
  });
  it("maps SOP folder grants and G5's Space-owner Full on Private Lists, never twice", () => {
    const p = planOrgBackfill(snap({
      sopFolderAccess: [{ folderId: "f", userId: "e", role: "EDITOR" }],
      spaces: [{ id: "s", visibility: "WORKSPACE", ownerId: "a2", ownerRowUserId: null, restricted: false, findable: false }],
      boards: [
        { id: "b1", visibility: "PRIVATE", ownerId: "e", ownerRowUserId: null, spaceId: "s", restricted: false },
        { id: "b2", visibility: "PRIVATE", ownerId: "a2", ownerRowUserId: null, spaceId: "s", restricted: false },
      ],
      existingGrantKeys: new Set(),
    }));
    expect(p.grants.map((g) => `${g.objectType}:${g.objectId}:${g.subjectId}:${g.objectRole}`)).toEqual(["SOP_FOLDER:f:e:EDIT", "LIST:b1:a2:FULL"]);
    expect(p.restrictedBoards).toEqual(["b1", "b2"]);
    const again = planOrgBackfill(snap({
      sopFolderAccess: [{ folderId: "f", userId: "e", role: "EDITOR" }],
      existingGrantKeys: new Set(["SOP_FOLDER:f:e"]),
    }));
    expect(again.grants).toEqual([]);
  });
  it("fills a missing owner from the OWNER member row and marks ORG Spaces findable", () => {
    const p = planOrgBackfill(snap({ spaces: [{ id: "s", visibility: "ORG", ownerId: null, ownerRowUserId: "a1", restricted: false, findable: false }] }));
    expect(p.ownerFills).toEqual([{ type: "Space", id: "s", ownerId: "a1" }]);
    expect(p.findableSpaces).toEqual(["s"]);
    expect(p.deferredEveryone.spaces).toBe(1);
  });
  it("report trees survive a manager loop", () => {
    const t = reportTreeSizes([
      { id: "x", managerId: "y", live: true },
      { id: "y", managerId: "x", live: true },
    ]);
    expect(t.get("x")).toBe(1);
  });
  it("assertions name every count that does not match", () => {
    const p = planOrgBackfill(snap());
    expect(backfillAssertions(p, { users: p.userUpdates.length, grants: 0, restrictedFolders: 0, restrictedBoards: 0, findable: 0, ownerFills: 0, usersWithoutRole: 0, owners: 1 })).toEqual([]);
    expect(backfillAssertions(p, { users: 0, grants: 0, restrictedFolders: 0, restrictedBoards: 0, findable: 0, ownerFills: 0, usersWithoutRole: 2, owners: 0 })).toHaveLength(3);
  });
});
