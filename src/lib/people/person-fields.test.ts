import { describe, expect, it } from "vitest";
import { canWritePersonField, checkPersonPatch, dobOverwriteAllowed, readsPeopleData, visibleStatus } from "./person-fields";

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
    expect(bulkSkippedWords(0, 0)).toBe("");
    // Before (Members): "{n} moved" alone, whoever was skipped.
    expect(bulkSkippedWords(2, 0)).toBe(" · 2 skipped (not yours to change)");
    expect(bulkSkippedWords(1, 1)).toBe(" · 1 skipped: they are working in another workspace, so their details here are read-only");
    expect(bulkSkippedWords(3, 1)).toBe(" · 3 skipped: 1 working in another workspace, whose details here are read-only, and 2 not yours to change");
    expect(bulkSkippedWords(1, 5)).toBe(" · 1 skipped: they are working in another workspace, so their details here are read-only");
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
