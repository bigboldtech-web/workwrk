import { describe, expect, it } from "vitest";
import { canAddTool, canManageTool, canSeeTool, hasLogin, seesAllTools } from "./tool-access";

const admin = { userId: "a", toolAdmin: true, isManager: true };
const manager = { userId: "m", toolAdmin: false, isManager: true };
const member = { userId: "e", toolAdmin: false, isManager: false };

describe("tool access", () => {
  it("lets the tool admins see everything and a manager see what they added", () => {
    expect(seesAllTools(admin)).toBe(true);
    expect(seesAllTools(manager)).toBe(false);
    expect(canSeeTool(manager, { addedBy: "m" }, false)).toBe(true);
    expect(canSeeTool(manager, { addedBy: "x" }, false)).toBe(false);
    expect(canSeeTool(member, { addedBy: "x" }, true)).toBe(true);
  });

  it("keeps adding to managers and managing to tool admins and the adder", () => {
    expect(canAddTool(manager)).toBe(true);
    expect(canAddTool(member)).toBe(false);
    expect(canManageTool(admin, { addedBy: "x" })).toBe(true);
    expect(canManageTool(manager, { addedBy: "m" })).toBe(true);
    expect(canManageTool(manager, { addedBy: "x" })).toBe(false);
    expect(canManageTool(member, { addedBy: "e" })).toBe(false);
  });

  it("knows an empty login from a saved one", () => {
    expect(hasLogin(null)).toBe(false);
    expect(hasLogin({ username: "", password: " " })).toBe(false);
    expect(hasLogin({ username: "ops@acme.com" })).toBe(true);
  });
});
