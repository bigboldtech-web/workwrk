// The Inbox's approval pane (inbox-approval-panel.tsx). An agent_approval row
// opens as the chat's own approval card, decided through the chat's own call,
// and never makes the teammate carry on: a chat continues only while it is
// open (teammate-store.ts), because carrying on is another model call, an AI
// question the person did not ask for from the Inbox.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const pane = read("src/components/inbox/inbox-target-pane.tsx");
const panel = read("src/components/inbox/inbox-approval-panel.tsx");
const store = read("src/lib/agents/teammate-store.ts");

describe("the Inbox's approval pane", () => {
  it("opens an agent_approval row as the approval card", () => {
    expect(pane).toContain('notification.type === "agent_approval" && notification.target.kind === "agent"');
    expect(pane).toContain("<ApprovalPane notification={notification}");
    expect(panel).toContain("<ApprovalCard actions={state.data.actions}");
  });

  it("decides through the chat's own call", () => {
    expect(panel).toContain("await sendDecisions(decisions, opts)");
    expect(store).toContain("await sendDecisions(decisions, opts)");
  });

  it("never makes the teammate carry on", () => {
    // Code only: the panel's comments may say why.
    const code = panel.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bresume\b/);
    expect(code).not.toContain("/messages");
  });

  it("lets the Inbox list and the bell read again after a decision", () => {
    expect(panel).toContain("window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.notifChanged))");
  });
});
