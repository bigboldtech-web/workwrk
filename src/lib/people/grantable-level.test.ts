import { describe, expect, it } from "vitest";
import { ACCESS_LEVELS, grantableAccessLevel } from "./grantable-level";

describe("grantableAccessLevel", () => {
  it("an absent level is the column default", () => {
    expect(grantableAccessLevel("MANAGER", undefined)).toBe("EMPLOYEE");
    expect(grantableAccessLevel("MANAGER", "")).toBe("EMPLOYEE");
  });
  it("a manager or director can never mint an admin, a director or HR", () => {
    for (const l of ["COMPANY_ADMIN", "SUPER_ADMIN", "HR", "DIRECTOR", "VP", "C_LEVEL", "MANAGER", "TEAM_LEAD"]) {
      expect(grantableAccessLevel("MANAGER", l), l).toBeNull();
      expect(grantableAccessLevel("DIRECTOR", l), l).toBeNull();
    }
    expect(grantableAccessLevel("MANAGER", "EMPLOYEE")).toBe("EMPLOYEE");
    expect(grantableAccessLevel("MANAGER", "AGENT")).toBe("AGENT");
  });
  it("HR places a new hire at any non-admin level, never an admin", () => {
    for (const l of ACCESS_LEVELS) {
      const admin = l === "SUPER_ADMIN" || l === "COMPANY_ADMIN";
      expect(grantableAccessLevel("HR", l), l).toBe(admin ? null : l);
    }
  });
  it("a company admin gives anything but SUPER_ADMIN; a super admin gives anything", () => {
    for (const l of ACCESS_LEVELS) {
      expect(grantableAccessLevel("COMPANY_ADMIN", l)).toBe(l === "SUPER_ADMIN" ? null : l);
      expect(grantableAccessLevel("SUPER_ADMIN", l)).toBe(l);
    }
  });
  it("an unknown or non-string level is refused, never guessed", () => {
    expect(grantableAccessLevel("SUPER_ADMIN", "OWNER")).toBeNull();
    expect(grantableAccessLevel("COMPANY_ADMIN", 3)).toBeNull();
    expect(grantableAccessLevel(null, "EMPLOYEE")).toBe("EMPLOYEE");
  });
});
