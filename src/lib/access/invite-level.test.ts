import { describe, expect, it } from "vitest";
import { resolveInviteLevel } from "./invite-level";

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
    expect(resolveInviteLevel("HR", "MANAGER").ok).toBe(false);
    expect(resolveInviteLevel("MANAGER", "HR").ok).toBe(false);
  });
});
