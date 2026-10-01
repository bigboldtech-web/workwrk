import { describe, expect, it } from "vitest";
import { mfaRequiredFor, mfaRequirementOf, passwordAgeOf, passwordMaxAgeDaysOf, securityHoldFor } from "./security-policy";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-30T12:00:00Z");

describe("mfa requirement", () => {
  it("is off for every org that has not chosen a rule", () => {
    expect(mfaRequirementOf(null)).toBe("off");
    expect(mfaRequirementOf({})).toBe("off");
    expect(mfaRequirementOf({ security: { minPasswordLength: 10 } })).toBe("off");
  });
  it("never reads the legacy twoFactorEnabled key", () => {
    expect(mfaRequirementOf({ security: { twoFactorEnabled: true } })).toBe("off");
  });
  it("migrates a stored true to everyone", () => {
    expect(mfaRequirementOf({ security: { mfaRequired: true } })).toBe("everyone");
  });
  it("applies admins to Owners and Admins only", () => {
    const s = { security: { mfaRequired: "admins" } };
    expect(mfaRequiredFor(s, "OWNER")).toBe(true);
    expect(mfaRequiredFor(s, "ADMIN")).toBe(true);
    expect(mfaRequiredFor(s, "MEMBER")).toBe(false);
    expect(mfaRequiredFor(s, "GUEST")).toBe(false);
  });
  it("applies everyone to every role", () => {
    const s = { security: { mfaRequired: "everyone" } };
    for (const r of ["OWNER", "ADMIN", "MEMBER", "GUEST"] as const) expect(mfaRequiredFor(s, r)).toBe(true);
  });
  it("ignores an unknown value", () => {
    expect(mfaRequirementOf({ security: { mfaRequired: "sometimes" } })).toBe("off");
  });
});

describe("password age", () => {
  it("reads max age only as a sane whole number of days", () => {
    expect(passwordMaxAgeDaysOf({ security: { passwordMaxAgeDays: 90 } })).toBe(90);
    expect(passwordMaxAgeDaysOf({ security: { passwordMaxAgeDays: 0 } })).toBeNull();
    expect(passwordMaxAgeDaysOf({ security: { passwordMaxAgeDays: "90" } })).toBeNull();
    expect(passwordMaxAgeDaysOf({})).toBeNull();
  });
  it("treats a null change date as unknown, never as expired", () => {
    expect(passwordAgeOf(null, 30, now).kind).toBe("unknown");
    expect(passwordAgeOf("not a date", 30, now).kind).toBe("unknown");
  });
  it("is ok without a max age", () => {
    expect(passwordAgeOf(new Date(now.getTime() - 400 * DAY), null, now).kind).toBe("ok");
  });
  it("warns inside the last week and expires after", () => {
    const soon = passwordAgeOf(new Date(now.getTime() - 26 * DAY), 30, now);
    expect(soon).toMatchObject({ kind: "soon", daysLeft: 4 });
    expect(passwordAgeOf(new Date(now.getTime() - 31 * DAY), 30, now).kind).toBe("expired");
    expect(passwordAgeOf(new Date(now.getTime() - 5 * DAY), 30, now).kind).toBe("ok");
  });
});

describe("security hold", () => {
  it("is null for every org without a rule (the shipped state)", () => {
    expect(securityHoldFor({ settings: {}, orgRole: "ADMIN", mfaEnabled: false, passwordChangedAt: null, now })).toBeNull();
  });
  it("asks an unenrolled admin to enrol when admins are required", () => {
    expect(securityHoldFor({ settings: { security: { mfaRequired: "admins" } }, orgRole: "ADMIN", mfaEnabled: false, passwordChangedAt: null, now })).toBe("mfa");
  });
  it("leaves an enrolled member alone", () => {
    expect(securityHoldFor({ settings: { security: { mfaRequired: "everyone" } }, orgRole: "MEMBER", mfaEnabled: true, passwordChangedAt: null, now })).toBeNull();
  });
  it("holds on an expired password, MFA first", () => {
    const settings = { security: { mfaRequired: "everyone", passwordMaxAgeDays: 30 } };
    const old = new Date(now.getTime() - 60 * DAY);
    expect(securityHoldFor({ settings, orgRole: "MEMBER", mfaEnabled: false, passwordChangedAt: old, now })).toBe("mfa");
    expect(securityHoldFor({ settings, orgRole: "MEMBER", mfaEnabled: true, passwordChangedAt: old, now })).toBe("password");
  });
});
