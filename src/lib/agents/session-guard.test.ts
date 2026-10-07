// Ask AI and AI teammates kept apart (src/lib/agents/session-guard.ts): the
// helper Ask AI's chat routes use refuses a teammate's chat with 409
// use_teammate_chat, its lists read only kind null, and an agent-bound Ask
// AI chat speaks as its agent only while the person may still use it.

import { describe, expect, it } from "vitest";
import { ASK_AI_CHATS, USE_TEAMMATE_CHAT, askAiAgent, teammateChatRefusal } from "./session-guard";

const MAX = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER" as const, isAgent: false };
const ADMIN = { userId: "u-admin", organizationId: "org1", orgRole: "ADMIN" as const, isAgent: false };

function agent(o: Record<string, unknown> = {}) {
  return { id: "a1", organizationId: "org1", visibility: "WORKSPACE", ownerId: null as string | null, status: "ENABLED", systemPrompt: "Be a planner.", ...o };
}

describe("teammateChatRefusal", () => {
  it("refuses a teammate's chat with 409 use_teammate_chat and the sentence", async () => {
    const res = teammateChatRefusal({ kind: "TEAMMATE" });
    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: "This chat is with an AI teammate. Open it from AI teammates.", code: USE_TEAMMATE_CHAT });
    expect(USE_TEAMMATE_CHAT).toBe("use_teammate_chat");
  });

  it("lets an Ask AI chat through, and refuses a kind it does not know rather than run it", () => {
    expect(teammateChatRefusal({ kind: null })).toBeNull();
    expect(teammateChatRefusal({})).toBeNull();
    expect(teammateChatRefusal({ kind: "SOMETHING_NEW" })?.status).toBe(409);
  });

  it("refuses a group chat: Ask AI never runs one (Phase 2)", async () => {
    const res = teammateChatRefusal({ kind: "TEAMMATE_GROUP" });
    expect(res?.status).toBe(409);
    expect(await res?.json()).toMatchObject({ code: USE_TEAMMATE_CHAT });
    expect(ASK_AI_CHATS).toEqual({ kind: null });
  });
});

describe("ASK_AI_CHATS", () => {
  it("is the kind null filter every Ask AI list and session route spreads", () => {
    expect(ASK_AI_CHATS).toEqual({ kind: null });
    expect({ userId: "u-max", ...ASK_AI_CHATS, archivedAt: null }).toEqual({ userId: "u-max", kind: null, archivedAt: null });
  });
});

describe("askAiAgent", () => {
  it("keeps a workspace agent that is on", () => {
    expect(askAiAgent(agent(), MAX)?.systemPrompt).toBe("Be a planner.");
  });

  it("speaks as plain Ask AI for someone else's private teammate, an Admin's chat included", () => {
    expect(askAiAgent(agent({ visibility: "PRIVATE", ownerId: "u-lea" }), MAX)).toBeNull();
    expect(askAiAgent(agent({ visibility: "PRIVATE", ownerId: "u-lea" }), ADMIN)).toBeNull();
    expect(askAiAgent(agent({ visibility: "PRIVATE", ownerId: "u-max" }), MAX)).not.toBeNull();
  });

  it("speaks as plain Ask AI when the agent is paused, removed, another workspace's or missing", () => {
    expect(askAiAgent(agent({ status: "DISABLED" }), MAX)).toBeNull();
    expect(askAiAgent(agent({ status: "ARCHIVED" }), MAX)).toBeNull();
    expect(askAiAgent(agent({ organizationId: "org2" }), MAX)).toBeNull();
    expect(askAiAgent(null, MAX)).toBeNull();
  });
});
