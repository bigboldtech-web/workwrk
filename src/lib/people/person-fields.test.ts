import { describe, expect, it } from "vitest";
import { canWritePersonField, checkPersonPatch, dobOverwriteAllowed, readsPeopleData, visibleStatus } from "./person-fields";

describe("SEAT_FIELDS: what this workspace writes for someone here through a membership (workspace-status-2.md E7, step 5)", () => {
  it("is every field but their shared identity: name, phone, photo and birthday", async () => {
    const { SEAT_FIELDS, PATCHABLE_PERSON_FIELDS } = await import("./person-fields");
    // Before: status, orgRole, memberTier and accessLevel only.
    expect([...SEAT_FIELDS].sort()).toEqual(["accessLevel", "customFields", "departmentId", "managerId", "memberTier", "officeId", "orgRole", "roleId", "status", "weeklyCapacityHours", "workSchedule"]);
    expect([...PATCHABLE_PERSON_FIELDS].filter((f) => !SEAT_FIELDS.has(f)).sort()).toEqual(["avatar", "dateOfBirth", "firstName", "lastName", "phone"]);
    expect(Object.keys(await import("./person-fields"))).not.toContain("PROFILE_ELSEWHERE");
  });
});

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

  it("lets a dotted-line or below-manager-tier chain read but never write", () => {
    expect(readsPeopleData("chain-view")).toBe(true);
    for (const f of ["roleId", "departmentId", "officeId", "weeklyCapacityHours", "workSchedule", "customFields", "managerId", "status", "dateOfBirth", "firstName", "accessLevel"]) {
      expect(canWritePersonField(f, "chain-view")).toBe(false);
    }
  });

  it("never lets a viewer who sees only day and month replace a birth date", () => {
    expect(dobOverwriteAllowed("chain", false)).toBe(true);
    expect(dobOverwriteAllowed("chain", true)).toBe(false);
    expect(dobOverwriteAllowed("org-wide", true)).toBe(false);
    expect(dobOverwriteAllowed("people-team", true)).toBe(true);
    expect(dobOverwriteAllowed("self", true)).toBe(true);
    expect(dobOverwriteAllowed("chain-view", false)).toBe(false);
  });

  it("shows raw employment status only with people data", () => {
    expect(visibleStatus("PIP", false)).toBe("ACTIVE");
    expect(visibleStatus("NOTICE_PERIOD", false)).toBe("ACTIVE");
    expect(visibleStatus("INACTIVE", false)).toBe("INACTIVE");
    expect(visibleStatus("PIP", true)).toBe("PIP");
  });
});

// The final review of docs/plans/workspace-status.md, product L5 and M4.
describe("bulkSkippedWords and SIGN_IN_ELSEWHERE", () => {
  it("says how many a bulk change skipped, and why", async () => {
    const { bulkSkippedWords } = await import("./person-fields");
    expect(bulkSkippedWords(0)).toBe("");
    // Before (Members): "{n} moved" alone, whoever was skipped.
    expect(bulkSkippedWords(2)).toBe(" · 2 skipped (not yours to change)");
    // Since workspace-status-2.md step 5 nobody is skipped for working here
    // through a membership, so no sentence says their details are read-only.
    expect(bulkSkippedWords(1)).not.toMatch(/read-only|another workspace/);
  });

  it("gives Members' last sign-in a tooltip for someone working elsewhere", async () => {
    const { SIGN_IN_ELSEWHERE } = await import("./person-fields");
    expect(SIGN_IN_ELSEWHERE).toBe("Not shown while they are working in another workspace.");
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/src/app/(dashboard)/settings/members/page.tsx`, "utf8");
    // Before: "Never" for every membership person, nudging a seat trim.
    expect(src).toContain('m.profileHere === false ? <span title={SIGN_IN_ELSEWHERE}>·</span> : "Never"');
  });
});
