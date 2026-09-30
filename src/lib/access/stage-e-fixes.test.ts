// Phase 8 stage E review fixes: the pure halves of each fix, pinned.

import { describe, expect, it } from "vitest";
import { matrixCellDecision, MATRIX_CELL_RULES } from "./matrix-rules";
import { classifyNodeMismatch, DECIDED_MATRIX_WIDENINGS, type NodeParityCase } from "./node-parity";
import { effectiveOrgRole, peopleTeamOf } from "./org-role";
import { liveToggleKeys, lockItDownChanges, lockItDownPatch, toggleStatuses } from "./toggle-status";
import { DEFAULT_ACCESS_SETTINGS } from "./settings";
import { ownerPickConflictOf } from "./backfill-plan";
import { canWritePersonGroup } from "../people/person-fields";

const member = { orgRole: "MEMBER" as const, isAgent: false, peopleTeam: false, hasReports: false };
const editors = { whoCanPublish: "editors" as const };

describe("SOP content cells never widen under the resolver (the unfiled-draft hole)", () => {
  it("sops.create, sops.edit and sops.publish are narrowOnly", () => {
    for (const a of ["create", "edit", "publish"]) {
      expect(MATRIX_CELL_RULES.find((r) => r.module === "sops" && r.action === a)?.narrowOnly).toBe(true);
    }
  });
  it("a Member without today's cell stays refused", () => {
    expect(matrixCellDecision("sops", "edit", member, editors, false)).toBe(false);
    expect(matrixCellDecision("sops", "publish", member, editors, false)).toBe(false);
    expect(matrixCellDecision("sops", "create", member, editors, false)).toBe(false);
  });
  it("a holder of today's cell keeps it where the rule allows", () => {
    expect(matrixCellDecision("sops", "edit", member, editors, true)).toBe(true);
  });
  it("the rule can still narrow: toggle 7 set to Admins and the People team", () => {
    expect(matrixCellDecision("sops", "publish", member, { whoCanPublish: "admins_people_team" }, true)).toBe(false);
  });
  it("a cell the table does not own is null (the matrix answers)", () => {
    expect(matrixCellDecision("meetings", "create", member, editors, true)).toBeNull();
  });
  it("a non-narrowOnly cell follows the rule (a Manager loses Invite)", () => {
    expect(matrixCellDecision("people", "create", { ...member, hasReports: true }, editors, true)).toBe(false);
  });
});

const matrixCase = (kind: string, truth: "VIEW" | "none", engine: "VIEW" | "none", viewer: Partial<NodeParityCase["viewer"]> = {}): NodeParityCase => ({
  id: `matrix:${kind}:u`,
  section: "matrix",
  kind,
  objectId: kind,
  viewer: { userId: "u", accessLevel: "EMPLOYEE", orgAdmin: false, peopleTeam: false, agent: false, hasReports: false, ...viewer },
  truth,
  engine,
});

describe("matrix parity: a widening is expected only where spec 9 names it", () => {
  const flags = { resolver: true, tables: true };
  it("a narrowing is expected", () => {
    expect(classifyNodeMismatch(matrixCase("people.create", "VIEW", "none", { accessLevel: "MANAGER" }), flags)).toBe("matrix-cell-narrows-to-section-9-gate-rule");
  });
  it("a SOP widening is UNEXPECTED", () => {
    expect(classifyNodeMismatch(matrixCase("sops.edit", "none", "VIEW"), flags)).toBeNull();
    expect(classifyNodeMismatch(matrixCase("sops.create", "none", "VIEW"), flags)).toBeNull();
  });
  it("the People team gaining KRA definitions is the named decision", () => {
    expect(classifyNodeMismatch(matrixCase("kras.create", "none", "VIEW", { peopleTeam: true }), flags)).toBe("matrix-cell-widens-by-named-decision");
  });
  it("the same cell widening for someone off the People team is UNEXPECTED", () => {
    expect(classifyNodeMismatch(matrixCase("kras.create", "none", "VIEW"), flags)).toBeNull();
  });
  it("assign cells widen for the People team or a person with reports", () => {
    expect(classifyNodeMismatch(matrixCase("kras.assign", "none", "VIEW", { hasReports: true }), flags)).toBe("matrix-cell-widens-by-named-decision");
  });
  it("no Owner-and-Admin cell is in the widening list", () => {
    for (const r of MATRIX_CELL_RULES.filter((x) => x.rule === "owner-admin")) expect(DECIDED_MATRIX_WIDENINGS[`${r.module}.${r.action}`]).toBeUndefined();
  });
});

describe("peopleTeamOf matches the engine in both flag states", () => {
  it("tables off: the configured list OR the HR level", () => {
    expect(peopleTeamOf({ userId: "hr", accessLevel: "HR", configured: ["x"], tablesOn: false })).toBe(true);
    expect(peopleTeamOf({ userId: "x", accessLevel: "EMPLOYEE", configured: ["x"], tablesOn: false })).toBe(true);
    expect(peopleTeamOf({ userId: "e", accessLevel: "EMPLOYEE", configured: [], tablesOn: false })).toBe(false);
  });
  it("tables on: a configured list governs, so an HR person taken off it is off", () => {
    expect(peopleTeamOf({ userId: "hr", accessLevel: "HR", configured: ["x"], tablesOn: true })).toBe(false);
    expect(peopleTeamOf({ userId: "x", accessLevel: "EMPLOYEE", configured: ["x"], tablesOn: true })).toBe(true);
  });
  it("tables on with an empty list falls back to HR", () => {
    expect(peopleTeamOf({ userId: "hr", accessLevel: "HR", configured: [], tablesOn: true })).toBe(true);
  });
});

describe("effectiveOrgRole reads the stored column only to narrow a Member to a Guest", () => {
  it("GUEST narrows a Member", () => {
    expect(effectiveOrgRole("EMPLOYEE", false, "GUEST")).toBe("GUEST");
  });
  it("a stale OWNER or ADMIN never widens", () => {
    expect(effectiveOrgRole("EMPLOYEE", false, "OWNER")).toBe("MEMBER");
    expect(effectiveOrgRole("COMPANY_ADMIN", false, "OWNER")).toBe("ADMIN");
  });
  it("GUEST never narrows an Admin (the level decides the rungs above Member)", () => {
    expect(effectiveOrgRole("COMPANY_ADMIN", false, "GUEST")).toBe("ADMIN");
  });
});

describe("Lock it down changes only the switches enforced now", () => {
  it("with the resolver off, only the live keys move", () => {
    const live = liveToggleKeys(toggleStatuses({ resolver: false, tables: false }));
    const patch = lockItDownPatch(live);
    expect(Object.keys(patch).every((k) => live.includes(k as never))).toBe(true);
    expect("newSpaceDefault" in patch).toBe(false);
  });
  it("with the resolver on, Who can create Spaces is in and the hidden switches are out", () => {
    const live = liveToggleKeys(toggleStatuses({ resolver: true, tables: true }));
    const changes = lockItDownChanges(DEFAULT_ACCESS_SETTINGS, live);
    expect(changes).toContain("whoCanCreateSpaces");
    expect(changes).not.toContain("findableSpaces");
    expect(changes).not.toContain("guestExpiryDays");
  });
  it("with no filter the whole preset (less the People team) is still available", () => {
    expect("peopleTeamUserIds" in lockItDownPatch()).toBe(false);
  });
});

describe("the manager chain's membership writes are flag-gated", () => {
  it("today the chain writes placement, reports-to and status", () => {
    expect(canWritePersonGroup("placement", "chain")).toBe(true);
    expect(canWritePersonGroup("status", "chain")).toBe(true);
  });
  it("with the resolver on the chain loses them, the People team and Admins keep them", () => {
    const off = { chainWritesMembership: false };
    expect(canWritePersonGroup("placement", "chain", off)).toBe(false);
    expect(canWritePersonGroup("reports-to", "chain", off)).toBe(false);
    expect(canWritePersonGroup("status", "chain", off)).toBe(false);
    expect(canWritePersonGroup("placement", "people-team", off)).toBe(true);
    expect(canWritePersonGroup("status", "admin", off)).toBe(true);
  });
});

describe("the backfill names an Owner-pick conflict for the founder", () => {
  const u = (id: string, accessLevel: string, t: number) => ({ id, name: id, accessLevel, createdAt: new Date(t) });
  it("an earlier SUPER_ADMIN keeps the earliest COMPANY_ADMIN out: reported", () => {
    const c = ownerPickConflictOf([u("staff", "SUPER_ADMIN", 1), u("first", "COMPANY_ADMIN", 2), u("second", "COMPANY_ADMIN", 3)]);
    expect(c?.earliestCompanyAdmin.id).toBe("first");
    expect(c?.earlierSuperAdmins.map((x) => x.id)).toEqual(["staff"]);
  });
  it("the earliest COMPANY_ADMIN first: no conflict", () => {
    expect(ownerPickConflictOf([u("first", "COMPANY_ADMIN", 1), u("later", "SUPER_ADMIN", 2)])).toBeNull();
  });
  it("no COMPANY_ADMIN: no conflict", () => {
    expect(ownerPickConflictOf([u("o", "SUPER_ADMIN", 1)])).toBeNull();
  });
});
