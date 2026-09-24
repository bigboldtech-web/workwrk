import { describe, expect, it } from "vitest";
import { canManageObject } from "./object-manage";

describe("canManageObject (delete and public link, until the engine flips)", () => {
  it("lets the creator manage their own object", () => {
    expect(canManageObject({ userId: "u1", orgRole: "MEMBER" }, "u1")).toBe(true);
  });
  it("refuses another member", () => {
    expect(canManageObject({ userId: "u2", orgRole: "MEMBER" }, "u1")).toBe(false);
    expect(canManageObject({ userId: "u2", orgRole: "GUEST" }, "u1")).toBe(false);
  });
  it("lets Owners and Admins manage anything", () => {
    expect(canManageObject({ userId: "a", orgRole: "ADMIN" }, "u1")).toBe(true);
    expect(canManageObject({ userId: "o", orgRole: "OWNER" }, "u1")).toBe(true);
  });
  it("refuses a signed-out caller and an object with no creator for members", () => {
    expect(canManageObject(null, "u1")).toBe(false);
    expect(canManageObject({ userId: "u1", orgRole: "MEMBER" }, null)).toBe(false);
  });
});
