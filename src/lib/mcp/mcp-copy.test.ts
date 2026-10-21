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
});
