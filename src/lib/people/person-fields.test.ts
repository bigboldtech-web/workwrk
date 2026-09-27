import { describe, expect, it } from "vitest";
import { canWritePersonField, checkPersonPatch } from "./person-fields";

describe("person field whitelist", () => {
  it("lets the person edit their own name but not their placement", () => {
    expect(canWritePersonField("firstName", "self")).toBe(true);
    expect(canWritePersonField("departmentId", "self")).toBe(false);
    expect(canWritePersonField("managerId", "self")).toBe(false);
  });

  it("keeps a manager-tier viewer's own placement edit (yesterday's rule)", () => {
    expect(canWritePersonField("departmentId", "self", { managerTierSelf: true })).toBe(true);
  });

  it("lets the chain write placement, reports to and birthday, never names or access", () => {
    for (const f of ["roleId", "departmentId", "officeId", "weeklyCapacityHours", "managerId", "status", "dateOfBirth"]) {
      expect(canWritePersonField(f, "chain")).toBe(true);
    }
    expect(canWritePersonField("firstName", "chain")).toBe(false);
    expect(canWritePersonField("accessLevel", "chain")).toBe(false);
  });

  it("gives a stranger nothing", () => {
    for (const f of ["firstName", "dateOfBirth", "roleId", "managerId", "accessLevel"]) {
      expect(canWritePersonField(f, "none")).toBe(false);
    }
  });

  it("leaves access level to Admins", () => {
    expect(canWritePersonField("accessLevel", "admin")).toBe(true);
    expect(canWritePersonField("accessLevel", "people-team")).toBe(false);
    expect(canWritePersonField("accessLevel", "org-wide")).toBe(false);
  });

  it("splits a body into unknown and forbidden keys", () => {
    const r = checkPersonPatch({ firstName: "A", roleId: "r", passwordHash: "x", email: "e", skip: undefined }, "self");
    expect(r.unknown.sort()).toEqual(["email", "passwordHash"]);
    expect(r.forbidden).toEqual(["roleId"]);
  });
});
