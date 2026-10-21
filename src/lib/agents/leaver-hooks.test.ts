// The hooks that end a leaver's teammate access at once
// (src/lib/agents/leaver-hooks.ts, Decision 27): each wrapper calls both
// halves, Google's and the browser's, and a throw in one still runs the
// other, the error still reaching the caller's log. Phase 5 step 3: a
// person who left or was deactivated has their skills there marked too, a
// third half (docs/plans/ai-teammates-phase5.md Decision 14). The MCP
// server (docs/plans/mcp-server.md 3.9): their AI apps' grants end too, the
// last half of each hook, with the same reason.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => {
  const s = {
    calls: [] as Array<[string, ...unknown[]]>,
    throwIn: null as string | null,
    half: (name: string) => async (...args: unknown[]) => {
      s.calls.push([name, ...args]);
      if (s.throwIn === name) throw new Error(`${name} failed`);
      return 1;
    },
  };
  return s;
});

vi.mock("@/lib/connectors/connections", () => ({
  endConnectionsFor: st.half("endConnectionsFor"),
  endAllConnectionsOf: st.half("endAllConnectionsOf"),
  endWorkspaceConnections: st.half("endWorkspaceConnections"),
  endSuspendedWorkspaceConnections: st.half("endSuspendedWorkspaceConnections"),
}));
vi.mock("@/lib/browser/sessions", () => ({
  endBrowserSessionsFor: st.half("endBrowserSessionsFor"),
  endAllBrowserSessionsOf: st.half("endAllBrowserSessionsOf"),
  endWorkspaceBrowserSessions: st.half("endWorkspaceBrowserSessions"),
}));
// Phase 5 step 3: a leaver's skills begin their 30 days (Decision 14).
vi.mock("@/lib/skills/store", () => ({ markSkillsOrphaned: st.half("markSkillsOrphaned") }));
// The MCP server: their AI apps' grants (docs/plans/mcp-server.md 3.9).
vi.mock("@/lib/oauth/grants", () => ({
  revokeGrantsFor: st.half("revokeGrantsFor"),
  revokeAllGrantsOf: st.half("revokeAllGrantsOf"),
  revokeWorkspaceGrants: st.half("revokeWorkspaceGrants"),
}));

import { endAllTeammateAccessOf, endTeammateAccessFor, endWorkspaceTeammateAccess } from "./leaver-hooks";

beforeEach(() => {
  st.calls = [];
  st.throwIn = null;
});

describe("the leaver hooks", () => {
  it("end a leaver's Google connections and browsers, with the reason and the actor, and mark their skills there (Phase 5)", async () => {
    await endTeammateAccessFor("org1", ["u-max"], "deactivated", "u-admin");
    expect(st.calls.slice(0, 2)).toEqual([
      ["endConnectionsFor", "org1", ["u-max"], "deactivated", "u-admin"],
      ["endBrowserSessionsFor", "org1", ["u-max"], "deactivated", "u-admin"],
    ]);
    // Their skills in that workspace begin their 30 days, after the two Phase 4 halves (Decision 14). Before: never marked.
    expect(st.calls[2]?.[0]).toBe("markSkillsOrphaned");
    expect(st.calls[2]?.[1]).toEqual({ organizationId: "org1", userIds: ["u-max"] });
    expect(st.calls[2]?.[2]).toBeInstanceOf(Date);
    // Their AI apps there, with the same reason and actor (the MCP half). Before: never ended.
    expect(st.calls[3]).toEqual(["revokeGrantsFor", "org1", ["u-max"], "deactivated", "u-admin"]);
    st.calls = [];
    await endTeammateAccessFor("org1", ["u-lee"], "left", null);
    expect(st.calls.map((c) => c[0])).toEqual(["endConnectionsFor", "endBrowserSessionsFor", "markSkillsOrphaned", "revokeGrantsFor"]);
  });

  it("never marks the skills of someone only out of reach (a Guest, an agent account, AI off): those are kept", async () => {
    await endTeammateAccessFor("org1", ["u-max"], "no_access", "u-admin");
    expect(st.calls.map((c) => c[0])).toEqual(["endConnectionsFor", "endBrowserSessionsFor", "revokeGrantsFor"]);
    // A Guest or an agent account keeps no AI app either.
    expect(st.calls[2]).toEqual(["revokeGrantsFor", "org1", ["u-max"], "no_access", "u-admin"]);
  });

  it("still ends the browsers and marks the skills when an earlier half throws, then throws", async () => {
    st.throwIn = "endBrowserSessionsFor";
    await expect(endTeammateAccessFor("org1", ["u-max"], "left", null)).rejects.toThrow("endBrowserSessionsFor failed");
    expect(st.calls.map((c) => c[0])).toEqual(["endConnectionsFor", "endBrowserSessionsFor", "markSkillsOrphaned", "revokeGrantsFor"]);
  });

  it("end a deleted account's in every workspace", async () => {
    await endAllTeammateAccessOf("u-max", "u-max");
    expect(st.calls).toEqual([
      ["endAllConnectionsOf", "u-max", "left", "u-max"],
      ["endAllBrowserSessionsOf", "u-max", "u-max"],
      // Their AI apps in every workspace, before the erasure (the MCP half).
      ["revokeAllGrantsOf", "u-max", "left", "u-max"],
    ]);
  });

  it("end a deleted workspace's and a suspended one's, the suspension as the system", async () => {
    await endWorkspaceTeammateAccess("org1", "workspace_deleted", "u-owner");
    await endWorkspaceTeammateAccess("org2", "suspended", null);
    expect(st.calls).toEqual([
      ["endWorkspaceConnections", "org1", "workspace_deleted", "u-owner"],
      ["endWorkspaceBrowserSessions", "org1", "workspace_closed", "u-owner"],
      ["revokeWorkspaceGrants", "org1", "u-owner"],
      ["endSuspendedWorkspaceConnections", "org2"],
      ["endWorkspaceBrowserSessions", "org2", "workspace_closed", null],
      ["revokeWorkspaceGrants", "org2", null],
    ]);
  });

  it("still ends the browsers when Google's half throws, and the other way round, then throws", async () => {
    st.throwIn = "endConnectionsFor";
    await expect(endTeammateAccessFor("org1", ["u-max"], "left", null)).rejects.toThrow("endConnectionsFor failed");
    expect(st.calls.map((c) => c[0])).toEqual(["endConnectionsFor", "endBrowserSessionsFor", "markSkillsOrphaned", "revokeGrantsFor"]);
    st.calls = [];
    st.throwIn = "endAllBrowserSessionsOf";
    await expect(endAllTeammateAccessOf("u-max", null)).rejects.toThrow("endAllBrowserSessionsOf failed");
    expect(st.calls.map((c) => c[0])).toEqual(["endAllConnectionsOf", "endAllBrowserSessionsOf", "revokeAllGrantsOf"]);
    st.calls = [];
    st.throwIn = "endSuspendedWorkspaceConnections";
    await expect(endWorkspaceTeammateAccess("org1", "suspended", null)).rejects.toThrow();
    expect(st.calls.map((c) => c[0])).toEqual(["endSuspendedWorkspaceConnections", "endWorkspaceBrowserSessions", "revokeWorkspaceGrants"]);
    // And a failing MCP half never stops the others, its error still reaching the caller.
    st.calls = [];
    st.throwIn = "revokeGrantsFor";
    await expect(endTeammateAccessFor("org1", ["u-max"], "deactivated", null)).rejects.toThrow("revokeGrantsFor failed");
    expect(st.calls.map((c) => c[0])).toEqual(["endConnectionsFor", "endBrowserSessionsFor", "markSkillsOrphaned", "revokeGrantsFor"]);
  });
});
