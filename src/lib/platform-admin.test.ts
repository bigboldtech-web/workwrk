import { describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({ prisma: {} }));

import { staffAccountPasses } from "./platform-admin";

const base = {
  email: "staff@workwrk.com",
  emailVerifiedAt: new Date("2026-09-01T00:00:00Z"),
  deletedAt: null,
  status: "ACTIVE",
};

describe("staffAccountPasses", () => {
  it("admits a live, verified account whose claim is its address", () => {
    expect(staffAccountPasses(base, "Staff@WorkwrK.com")).toBe(true);
    expect(staffAccountPasses(base, null)).toBe(true);
  });
  it("refuses an account that never proved the mailbox (the look-alike takeover)", () => {
    expect(staffAccountPasses({ ...base, emailVerifiedAt: null }, base.email)).toBe(false);
  });
  it("refuses deleted and deactivated accounts, and no account", () => {
    expect(staffAccountPasses({ ...base, deletedAt: new Date() }, base.email)).toBe(false);
    expect(staffAccountPasses({ ...base, status: "INACTIVE" }, base.email)).toBe(false);
    expect(staffAccountPasses(null, base.email)).toBe(false);
  });
  it("refuses a session whose email claim no longer matches the account", () => {
    expect(staffAccountPasses(base, "someone.else@workwrk.com")).toBe(false);
  });
});
