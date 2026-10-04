import { describe, expect, it } from "vitest";
import {
  canAddTool, canEditTool, canManageTool, canSeeTool, canShareTool, hasLogin, seesAllTools, storedToolShareRole, toolShareRole,
  toolViewerRole, type ToolRole, type ToolViewer,
} from "./tool-access";

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

describe("a role on a tool share (batch 7, read only while ACCESS_V2_TABLES is on)", () => {
  const agent = { userId: "bot", toolAdmin: false, isManager: false, isAgent: true };

  it("reads every share as Can view while the roles are off, whatever it stores", () => {
    expect(toolShareRole(null, false)).toBeNull();
    expect(toolShareRole({ role: "FULL" }, false)).toBe("VIEW");
    expect(toolShareRole({ role: "EDIT" }, false)).toBe("VIEW");
    expect(toolShareRole({ role: null }, false)).toBe("VIEW");
  });

  it("reads the stored role while they are on, and a row without one as Can view", () => {
    expect(toolShareRole(null, true)).toBeNull();
    expect(toolShareRole({ role: null }, true)).toBe("VIEW");
    expect(toolShareRole({ role: "EDIT" }, true)).toBe("EDIT");
    expect(toolShareRole({ role: "FULL" }, true)).toBe("FULL");
    expect(toolShareRole({ role: "OWNER" }, true)).toBe("VIEW");
    expect(storedToolShareRole("VIEW")).toBeNull();
    expect(storedToolShareRole("EDIT")).toBe("EDIT");
    expect(storedToolShareRole("FULL")).toBe("FULL");
  });

  it("gives Can edit the fields and the login, and Full access sharing and delete", () => {
    expect(toolViewerRole(member, { addedBy: "x" }, "EDIT")).toBe("EDIT");
    expect(canEditTool(member, { addedBy: "x" }, "EDIT")).toBe(true);
    expect(canShareTool(member, { addedBy: "x" }, "EDIT")).toBe(false);
    expect(toolViewerRole(member, { addedBy: "x" }, "FULL")).toBe("FULL");
    expect(canShareTool(member, { addedBy: "x" }, "FULL")).toBe(true);
    expect(canEditTool(member, { addedBy: "x" }, "VIEW")).toBe(false);
    expect(toolViewerRole(member, { addedBy: "x" }, null)).toBeNull();
  });

  it("keeps the maker whose role no longer manages tools at Can view, and caps an Agent at Can edit", () => {
    expect(toolViewerRole(member, { addedBy: "e" }, null)).toBe("VIEW");
    expect(toolViewerRole(agent, { addedBy: "x" }, "FULL")).toBe("EDIT");
    expect(canShareTool(agent, { addedBy: "x" }, "FULL")).toBe(false);
    expect(canEditTool(agent, { addedBy: "x" }, "FULL")).toBe(true);
  });

  it("answers exactly as canManageTool for every viewer while the roles are off", () => {
    const viewers: ToolViewer[] = [admin, manager, member, agent, { userId: "c", toolAdmin: true, isManager: false }];
    const tools = [{ addedBy: "a" }, { addedBy: "m" }, { addedBy: "e" }, { addedBy: "bot" }, { addedBy: "x" }];
    const shares: Array<ToolRole | null> = [toolShareRole(null, false), toolShareRole({ role: "FULL" }, false)];
    for (const v of viewers) for (const t of tools) for (const share of shares) {
      expect(canEditTool(v, t, share)).toBe(canManageTool(v, t));
      expect(canShareTool(v, t, share)).toBe(canManageTool(v, t));
      expect(toolViewerRole(v, t, share) !== null).toBe(canSeeTool(v, t, share !== null));
    }
  });
});
