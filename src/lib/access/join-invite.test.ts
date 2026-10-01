import { describe, expect, it } from "vitest";
import { cleanPersonName, inviteFailure, inviteOrgRole, inviteRoleLabel, joinLanding, joinVariant, spaceObjectRoleLabel } from "./join-invite";
import { WORK_HOME_HREF } from "../nav/route-hub";

describe("joinVariant", () => {
  it("picks the four variants from the session and the account", () => {
    expect(joinVariant({ sessionEmail: null, inviteEmail: "a@x.co", accountExists: false })).toBe("A");
    expect(joinVariant({ sessionEmail: null, inviteEmail: "a@x.co", accountExists: true })).toBe("B");
    expect(joinVariant({ sessionEmail: "A@X.co", inviteEmail: "a@x.co", accountExists: true })).toBe("C");
    expect(joinVariant({ sessionEmail: "b@x.co", inviteEmail: "a@x.co", accountExists: false })).toBe("D");
  });
});

describe("inviteFailure", () => {
  const now = new Date("2026-09-30T00:00:00Z");
  it("names the failure a row earns", () => {
    expect(inviteFailure(null, now)).toBe("invalid");
    expect(inviteFailure({ accepted: true, expiresAt: new Date("2026-10-30") }, now)).toBe("used");
    expect(inviteFailure({ accepted: false, expiresAt: new Date("2026-09-29") }, now)).toBe("expired");
    expect(inviteFailure({ accepted: false, expiresAt: new Date("2026-10-01") }, now)).toBeNull();
  });
});

describe("inviteOrgRole", () => {
  it("never gives Owner, and speaks the four-role words", () => {
    expect(inviteOrgRole("COMPANY_ADMIN")).toBe("ADMIN");
    expect(inviteOrgRole("SUPER_ADMIN")).toBe("ADMIN");
    expect(inviteOrgRole("MANAGER")).toBe("MEMBER");
    expect(inviteOrgRole("AGENT")).toBe("MEMBER");
    expect(inviteOrgRole(null)).toBe("MEMBER");
    expect(inviteOrgRole("EMPLOYEE", "GUEST")).toBe("GUEST");
    expect(inviteRoleLabel("MEMBER")).toBe("Member");
  });

  it("labels a Space role in the access model's words", () => {
    expect(spaceObjectRoleLabel("MEMBER")).toBe("Can edit");
    expect(spaceObjectRoleLabel("GUEST")).toBe("Can view");
    expect(spaceObjectRoleLabel("ADMIN")).toBe("Full access");
  });
});

describe("joinLanding", () => {
  it("prefers the object, then the Space, then Work home", () => {
    expect(joinLanding({ objectUrl: "/docs/1", spaceId: "s1" })).toBe("/docs/1");
    expect(joinLanding({ spaceId: "s1" })).toBe("/spaces/s1");
    expect(joinLanding({})).toBe(WORK_HOME_HREF);
    expect(joinLanding({ objectUrl: "//evil.example" })).toBe(WORK_HOME_HREF);
  });
});

describe("cleanPersonName", () => {
  it("strips markup and caps the length", () => {
    expect(cleanPersonName("  <b>Priya</b>  ")).toBe("bPriya/b");
    expect(cleanPersonName("x".repeat(100)).length).toBe(60);
    expect(cleanPersonName(42)).toBe("");
  });
});
