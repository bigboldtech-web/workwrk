// The hooks that end a leaver's teammate access at once
// (src/lib/agents/leaver-hooks.ts, Decision 27): each wrapper calls both
// halves, Google's and the browser's, and a throw in one still runs the
// other, the error still reaching the caller's log.

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

import { endAllTeammateAccessOf, endTeammateAccessFor, endWorkspaceTeammateAccess } from "./leaver-hooks";

beforeEach(() => {
  st.calls = [];
  st.throwIn = null;
});

describe("the leaver hooks", () => {
  it("end a leaver's Google connections and browsers, with the reason and the actor", async () => {
    await endTeammateAccessFor("org1", ["u-max"], "deactivated", "u-admin");
    expect(st.calls).toEqual([
      ["endConnectionsFor", "org1", ["u-max"], "deactivated", "u-admin"],
      ["endBrowserSessionsFor", "org1", ["u-max"], "deactivated", "u-admin"],
    ]);
  });

  it("end a deleted account's in every workspace", async () => {
    await endAllTeammateAccessOf("u-max", "u-max");
    expect(st.calls).toEqual([
      ["endAllConnectionsOf", "u-max", "left", "u-max"],
      ["endAllBrowserSessionsOf", "u-max", "u-max"],
    ]);
  });

  it("end a deleted workspace's and a suspended one's, the suspension as the system", async () => {
    await endWorkspaceTeammateAccess("org1", "workspace_deleted", "u-owner");
    await endWorkspaceTeammateAccess("org2", "suspended", null);
    expect(st.calls).toEqual([
      ["endWorkspaceConnections", "org1", "workspace_deleted", "u-owner"],
      ["endWorkspaceBrowserSessions", "org1", "workspace_closed", "u-owner"],
      ["endSuspendedWorkspaceConnections", "org2"],
      ["endWorkspaceBrowserSessions", "org2", "workspace_closed", null],
    ]);
  });

  it("still ends the browsers when Google's half throws, and the other way round, then throws", async () => {
    st.throwIn = "endConnectionsFor";
    await expect(endTeammateAccessFor("org1", ["u-max"], "left", null)).rejects.toThrow("endConnectionsFor failed");
    expect(st.calls.map((c) => c[0])).toEqual(["endConnectionsFor", "endBrowserSessionsFor"]);
    st.calls = [];
    st.throwIn = "endAllBrowserSessionsOf";
    await expect(endAllTeammateAccessOf("u-max", null)).rejects.toThrow("endAllBrowserSessionsOf failed");
    expect(st.calls.map((c) => c[0])).toEqual(["endAllConnectionsOf", "endAllBrowserSessionsOf"]);
    st.calls = [];
    st.throwIn = "endSuspendedWorkspaceConnections";
    await expect(endWorkspaceTeammateAccess("org1", "suspended", null)).rejects.toThrow();
    expect(st.calls.map((c) => c[0])).toEqual(["endSuspendedWorkspaceConnections", "endWorkspaceBrowserSessions"]);
  });
});
