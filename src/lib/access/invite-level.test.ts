import { describe, expect, it } from "vitest";
import { levelForInviteRole, resolveGrantLevel, resolveInviteLevel } from "./invite-level";

describe("resolveInviteLevel", () => {
  it("defaults to Employee and names an unknown level", () => {
    expect(resolveInviteLevel("COMPANY_ADMIN", undefined)).toEqual({ ok: true, level: "EMPLOYEE" });
    expect(resolveInviteLevel("COMPANY_ADMIN", "OVERLORD")).toEqual({ ok: false, status: 400, error: "Unknown access level: OVERLORD" });
  });
  it("never invites WorkwrK staff, even for an admin", () => {
    expect(resolveInviteLevel("SUPER_ADMIN", "SUPER_ADMIN").ok).toBe(false);
    expect(resolveInviteLevel("COMPANY_ADMIN", "SUPER_ADMIN").ok).toBe(false);
  });
  it("lets an admin invite any other level, including another admin", () => {
    for (const l of ["COMPANY_ADMIN", "C_LEVEL", "HR", "MANAGER", "EMPLOYEE", "AGENT"]) {
      expect(resolveInviteLevel("COMPANY_ADMIN", l)).toEqual({ ok: true, level: l });
    }
  });
  it("stops the manager tier minting an admin (the live escalation)", () => {
    for (const inviter of ["MANAGER", "TEAM_LEAD", "HR", "DIRECTOR", "VP", "C_LEVEL"]) {
      expect(resolveInviteLevel(inviter, "COMPANY_ADMIN")).toMatchObject({ ok: false, status: 403 });
    }
  });
  it("keeps a non-admin at or below their own rung", () => {
    expect(resolveInviteLevel("MANAGER", "MANAGER").ok).toBe(true);
    expect(resolveInviteLevel("MANAGER", "EMPLOYEE").ok).toBe(true);
    expect(resolveInviteLevel("MANAGER", "VP").ok).toBe(false);
    expect(resolveInviteLevel("TEAM_LEAD", "MANAGER").ok).toBe(false);
    expect(resolveInviteLevel("EMPLOYEE", "EMPLOYEE").ok).toBe(true);
    expect(resolveInviteLevel("HR", "HR").ok).toBe(true);
    expect(resolveInviteLevel("MANAGER", "HR").ok).toBe(false);
  });
  it("lets HR invite a new hire at any non-admin level, as it could before", () => {
    for (const l of ["C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "AGENT", "HR"]) {
      expect(resolveInviteLevel("HR", l), l).toEqual({ ok: true, level: l });
    }
    expect(resolveInviteLevel("HR", "COMPANY_ADMIN")).toMatchObject({ ok: false, status: 403 });
  });
});

describe("resolveGrantLevel: one rule for invite and direct create", () => {
  it("agrees with the invite rule for admins and HR on both paths", () => {
    for (const caller of ["COMPANY_ADMIN", "HR"]) {
      for (const l of ["C_LEVEL", "MANAGER", "EMPLOYEE", "AGENT", "HR"]) {
        expect(resolveGrantLevel(caller, l, "create").ok, `${caller}:${l}`).toBe(resolveGrantLevel(caller, l, "invite").ok);
      }
    }
  });
  it("direct create below HR gives Employee or Agent only (the creator picks the password)", () => {
    expect(resolveGrantLevel("MANAGER", "MANAGER", "create").ok).toBe(false);
    expect(resolveGrantLevel("MANAGER", "MANAGER", "invite").ok).toBe(true);
    expect(resolveGrantLevel("MANAGER", "EMPLOYEE", "create").ok).toBe(true);
    expect(resolveGrantLevel("MANAGER", "AGENT", "create").ok).toBe(true);
  });
  it("SUPER_ADMIN: only a SUPER_ADMIN creates one, nobody invites one", () => {
    expect(resolveGrantLevel("SUPER_ADMIN", "SUPER_ADMIN", "create").ok).toBe(true);
    expect(resolveGrantLevel("SUPER_ADMIN", "SUPER_ADMIN", "invite").ok).toBe(false);
    expect(resolveGrantLevel("COMPANY_ADMIN", "SUPER_ADMIN", "create").ok).toBe(false);
  });
  it("the agent tool's worst case: a Manager asking for C_LEVEL or an Admin is refused", () => {
    expect(resolveInviteLevel("MANAGER", "C_LEVEL")).toMatchObject({ ok: false, status: 403 });
    expect(resolveInviteLevel("MANAGER", "COMPANY_ADMIN")).toMatchObject({ ok: false, status: 403 });
  });
});

describe("levelForInviteRole", () => {
  it("maps the wizard's four-role words onto the stored level", () => {
    expect(levelForInviteRole("ADMIN", false)).toEqual({ ok: true, level: "COMPANY_ADMIN" });
    expect(levelForInviteRole("MEMBER", false)).toEqual({ ok: true, level: "EMPLOYEE" });
    expect(levelForInviteRole("MEMBER", true)).toEqual({ ok: true, level: "AGENT" });
    expect(levelForInviteRole("ADMIN", true)).toEqual({ ok: true, level: "COMPANY_ADMIN" });
  });
  it("refuses Guest and anything unknown with a 400, never Owner", () => {
    expect(levelForInviteRole("GUEST", false)).toMatchObject({ ok: false, status: 400 });
    expect(levelForInviteRole("OWNER", false)).toMatchObject({ ok: false, status: 400 });
    expect(levelForInviteRole(undefined, false)).toMatchObject({ ok: false, status: 400 });
  });
});
