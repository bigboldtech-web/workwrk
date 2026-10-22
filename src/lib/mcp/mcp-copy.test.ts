// The copy rule for the MCP server (docs/plans/mcp-server.md conventions,
// 6.4): no em dash, no en dash and no double hyphen in any export, and no
// reachable sentence says "teammate", "approval" or "card". The banned
// pattern is src/lib/agents/teammate-copy.test.ts's, written by code point.

import { describe, expect, it } from "vitest";
import * as copy from "./mcp-copy";

const BANNED = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]|--`);
const WORDS = /\b(teammate|approval|card)s?\b/i;

/** Every string an export holds, builders called with sample arguments. */
function strings(value: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof value === "string") out.push([path, value]);
  else if (typeof value === "function") strings((value as (...a: unknown[]) => unknown)("Claude", 3), `${path}()`, out);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
}

describe("mcp-copy", () => {
  const all: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(copy)) strings(v, k, all);
  // Builders that take a number are called with it too.
  all.push(["otherWorkspaces(1)", copy.MCP_CONSENT_COPY.otherWorkspaces(1)], ["tooFast(9)", copy.MCP_TOOL_COPY.errors.tooFast(9)]);
  // Step 4's builders that take numbers, with the numbers the pages pass.
  for (const n of [0, 1, 3]) {
    all.push(
      [`turnOffBody(${n})`, copy.MCP_SETTINGS_COPY.turnOffBody(n)],
      [`connections(${n})`, copy.MCP_SETTINGS_COPY.connections(n, n)],
      [`today(${n})`, copy.MCP_SETTINGS_COPY.today(n, n)],
      [`disconnected(${n})`, copy.MCP_SETTINGS_COPY.disconnected(n)],
      [`changes(${n})`, copy.MCP_CONNECTED_COPY.changes(n)],
    );
  }
  all.push(["where(write)", copy.MCP_CONNECTED_COPY.where("Acme", true)], ["where(read)", copy.MCP_CONNECTED_COPY.where("Acme", false)]);

  it("holds the sentences", () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it("has no dash in any export", () => {
    expect(all.filter(([, s]) => BANNED.test(s)).map(([p]) => p)).toEqual([]);
  });

  it("never says teammate, approval or card", () => {
    expect(all.filter(([, s]) => WORDS.test(s)).map(([p]) => p)).toEqual([]);
  });

  it("carries the spec's exact sentences", () => {
    expect(copy.MCP_CONSENT_COPY.notChecked).toBe("WorkwrK has not checked this app. Allow it only if you started connecting it yourself just now.");
    expect(copy.MCP_CONSENT_COPY.never).toBe("It can never delete anything, change who can see what, or see anything you can't.");
    expect(copy.MCP_TOOL_COPY.errors.readOnly).toBe("This connection can only read. To let it make changes, connect the app again and choose Read and change.");
    expect(copy.MCP_OAUTH_COPY.invalidToken).toBe("The connection ended or the token expired. Connect again.");
    expect(copy.MCP_LABEL_COPY.loopback).toBe("an app on this computer");
    expect(copy.MCP_LABEL_COPY.scheme("cursor")).toBe("the cursor app");
  });

  // Step 4 (6.2, 6.3): the pages' sentences the spec writes out. Fails on the code before step 4: none existed.
  it("carries the pages' sentences as the spec writes them", () => {
    const S = copy.MCP_SETTINGS_COPY;
    expect(S.title).toBe("AI apps (MCP)");
    expect(S.intro).toBe(
      "Let people connect the AI apps they use, such as Claude, ChatGPT, Cursor and VS Code. Each app works as the person who connects it, sees only what they can, and can never delete anything.",
    );
    expect(S.switchLabel).toBe("Let people connect AI apps (MCP)");
    expect(S.switchHint).toBe("Off by default. What an app reads goes to the company that makes it.");
    expect(S.turnOffBody(3)).toBe("This disconnects every AI app in this workspace now (3 connections). People can connect again once it is back on.");
    expect(S.turnOffBody(1)).toBe("This disconnects every AI app in this workspace now (1 connection). People can connect again once it is back on.");
    expect(S.turnOffBody(0)).toBe("This disconnects every AI app in this workspace now. People can connect again once it is back on.");
    expect(S.connections(3, 2)).toBe("3 connections now, held by 2 people.");
    expect(S.today(1, 0)).toBe("Today (UTC): 1 request and 0 changes.");
    const A = copy.MCP_CONNECTED_COPY;
    expect(A.title).toBe("AI apps");
    expect(A.intro).toBe("AI apps you connected to WorkwrK. Each works as you, in one workspace.");
    expect(A.notChecked).toBe("Not checked by WorkwrK");
    expect(A.showChanges).toBe("Show changes");
    expect(A.disconnectBody).toBe("It loses access at once. To use it again, connect it from the app.");
    expect(A.none).toBe("No AI apps connected.");
    expect(A.howTo).toBe("How to connect one");
    expect(copy.MCP_VIA_COPY.personVia("Max Member", copy.MCP_VIA_COPY.actorLabel("Claude"))).toBe("Max Member via Claude (MCP)");
  });
});
