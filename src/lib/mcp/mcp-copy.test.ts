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
    // Final review, privacy M1: moving a task or assigning someone changes who can see that task, so the old "never change who can see what" went.
    expect(copy.MCP_CONSENT_COPY.never).toBe(
      "It can never delete anything, change anyone's access, or see anything you can't. Like you, it can move a task to another List or assign someone to it, which changes who can see that task.",
    );
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
    expect(S.switchHint).toBe("Off by default. What an app reads goes to the company that makes it and to the AI model it uses.");
    expect(S.turnOffBody(3)).toBe("This disconnects every AI app in this workspace now (3 connections). People can connect again once it is back on.");
    expect(S.turnOffBody(1)).toBe("This disconnects every AI app in this workspace now (1 connection). People can connect again once it is back on.");
    expect(S.turnOffBody(0)).toBe("This disconnects every AI app in this workspace now. People can connect again once it is back on.");
    expect(S.connections(3, 2)).toBe("3 connections now, held by 2 people.");
    expect(S.today(1, 0)).toBe("Today (UTC): 1 request, and 0 things made or changed.");
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

  // Review of step 4, L7: "change" meant two things. The card counts its audit rows, one for each request that
  // made or changed something; Settings and the export count McpUsageDay.writes, every thing made or changed, each
  // subtask one. Each count now says what it counts, in words the other never uses. Fails on eb8a880b: both said
  // "changes".
  it("names the two counts apart: times an app made changes, and things made or changed", () => {
    const A = copy.MCP_CONNECTED_COPY;
    expect([A.changes(0), A.changes(1), A.changes(3)]).toEqual(["No changes yet.", "It made changes once.", "It made changes 3 times."]);
    const S = copy.MCP_SETTINGS_COPY;
    expect(S.today(12, 15)).toBe("Today (UTC): 12 requests, and 15 things made or changed.");
    expect(S.today(1, 1)).toBe("Today (UTC): 1 request, and 1 thing made or changed.");
    const note = copy.MCP_EXPORT_COPY.connectedAppsNote;
    expect(note).toContain("for each day, how many requests it made and how many things it made or changed, where a task and each of its subtasks count one each");
    // The card's count never says things, and the day counts never say changes.
    for (const n of [0, 1, 3]) expect(A.changes(n)).not.toMatch(/\bthings?\b/);
    for (const t of [S.today(3, 3), note]) expect(t).not.toMatch(/\bchanges\b/);
  });

  // docs/plans/mcp-server.md 11.2 (step 4 departure 5): the Security page's Log out everywhere gains the clause,
  // from this module. Fails on eb8a880b: no such copy.
  it("carries the Log out everywhere clause the Security page adds where AI apps are offered", () => {
    expect(copy.MCP_LOGOUT_COPY.alsoDisconnects).toBe("and disconnects your AI apps");
  });

  // Found by the live proof (scripts/live-proof-mcp.ts, the Security page's
  // screenshot): a sentence that starts with an app's label started with a
  // small letter ("an app on this computer (MCP) was disconnected: ...", and
  // the Inbox notices the same). Fails on 66d3ff1a.
  it("starts a sentence that leads with an app's label with a capital, and keeps the label as frozen elsewhere", () => {
    const loop = "an app on this computer";
    const Sec = copy.MCP_SECURITY_COPY;
    const N = copy.MCP_NOTICE_COPY;
    expect(Sec.disconnected(loop, Sec.why.admin_off)).toBe("An app on this computer (MCP) was disconnected: an Owner or Admin turned off AI apps in the workspace");
    expect(Sec.disconnectedPlain(loop)).toBe("An app on this computer (MCP) was disconnected");
    expect(Sec.reuse(loop)).toBe("An app on this computer (MCP) was disconnected for safety: one of its keys was used twice");
    expect(N.connectedMessage(loop, "Acme")).toMatch(/^An app on this computer can now work in Acme as you\./);
    expect(N.reuseMessage(loop, "Acme")).toMatch(/^An app on this computer was disconnected from Acme because/);
    // Mid-sentence the label stays as the person saw it on the consent page.
    expect(Sec.connected(loop)).toBe("Connected an app on this computer (MCP)");
    expect(Sec.disconnectedByYou(loop)).toBe("Disconnected an app on this computer (MCP)");
    expect(copy.MCP_CONNECTED_COPY.disconnectTitle(loop)).toBe("Disconnect an app on this computer?");
    expect(Sec.disconnectedPlain("the cursor app")).toBe("The cursor app (MCP) was disconnected");
    // A name or a host the app goes by is left as the person saw it at consent.
    expect(Sec.disconnected("Claude", Sec.why.left)).toMatch(/^Claude \(MCP\) was disconnected/);
    expect(Sec.disconnectedPlain("claude.ai")).toBe("claude.ai (MCP) was disconnected");
  });

  // The step 5 proof's screenshot: AI features turned off while the switch was on said "this can't be turned
  // on" beside a switch that was on. Fails on the old copy (no aiOffWhileOn).
  it("says AI apps pause, not that the switch can't be turned on, when AI goes off with the switch already on", () => {
    const S = copy.MCP_SETTINGS_COPY;
    expect(S.aiOffWhileOn).toMatch(/can't work here for now/);
    expect(S.aiOffWhileOn).not.toMatch(/can't be turned on/);
    expect(S.aiOff).toMatch(/can't be turned on/);
  });

  // The final review of the MCP server. Fails on fcca4075 (each sentence said less, or something untrue).
  it("names the AI model an app uses, says how to recover an unknown app, and names the sites the real apps use (final review)", () => {
    const C = copy.MCP_CONSENT_COPY;
    // Privacy L1: what an app reads also goes to the AI model it uses.
    expect(C.whereItGoes).toBe(
      "What it reads goes to the company that makes it and to the AI model it uses, which another company may run, under their own terms. You can disconnect it at any time in My settings, Calendar & connections.",
    );
    // Contract H1: an app that keeps its registration loops on "start again"; removing WorkwrK and adding it again is the way out.
    expect(C.errors.unknownApp.body).toBe("Its request does not name an app registered with WorkwrK. In the app, remove WorkwrK, then add it again.");
    // Contract M1: claude.ai and claude.com, Cursor on the web, and this computer. Settings clean-up Phase 2 (B6):
    // the hint is one line and the sites are behind its Show more (allowedMore), so each is still one click away
    // on the page; the hint still says what an entry does to the apps it leaves out.
    const hint = copy.MCP_SETTINGS_COPY.allowedHint;
    const more = copy.MCP_SETTINGS_COPY.allowedMore;
    for (const site of ["claude.ai", "claude.com", "*.cursor.com", "localhost", "Claude Code", "VS Code", "Cursor's desktop app"]) expect(more, site).toContain(site);
    expect(hint).toBe("Leave it empty to allow any app. Once it holds one, only those can connect, and others are disconnected.");
    expect(hint.length).toBeLessThanOrEqual(110);
    // Cursor's desktop app comes back to localhost (its docs name no cursor: scheme): an admin sent to add only
    // cursor: would shut it out.
    for (const t of [hint, more]) {
      expect(t).not.toContain("cursor:");
      expect(t).not.toContain("*.example.com");
    }
    const bad = copy.MCP_POLICY_COPY.badApp("not a host!");
    for (const site of ["claude.ai", "claude.com", "*.cursor.com", "localhost"]) expect(bad, site).toContain(site);
    // Privacy H1: the writer's part of an Admin's turning AI apps off, by type only.
    expect(copy.MCP_WRITER_PART_COPY.disconnected).toBe("Disconnected another person's AI app");
  });
});
