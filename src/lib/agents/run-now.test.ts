// Run now in Workspace agents (docs/plans/ai-teammates-phase2.md step 2):
// the old loop acted without asking, so an agent told to invite someone sent
// the invitation. Run now is a chat turn as the person now. Here
// runLegacyAgentNow, runTeammateTurn, executeToolCall and the approval queue
// run for real; the model, the database, the tool registry, the card
// builder and the question budget are stand-ins (review round 4: the step's
// own test mocked the engine, so nothing pinned this).

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  replies: [] as unknown[],
  requests: [] as Row[],
  claims: [] as Row[],
  runUpdates: [] as Row[],
}));

vi.mock("@/lib/prisma", async () => {
  const { fx, prismaFake } = await import("./test-fixtures");
  return {
    prisma: {
      ...prismaFake,
      agent: {
        findFirst: async () => ({
          ...fx.agent,
          description: "Keeps hiring moving.",
          systemPrompt: "Be brief.",
          modelOverride: null,
          autonomousPrompt: "Invite new.hire@x.com to the workspace as an Employee.",
        }),
      },
      chatSession: { ...prismaFake.chatSession, findFirst: async () => ({ id: "s1" }), updateMany: async () => ({ count: 1 }) },
      chatMessage: { ...prismaFake.chatMessage, findMany: async () => [], findFirst: async () => null },
      agentRun: { updateMany: async (a: Row) => (st.runUpdates.push(a), { count: 1 }) },
      organization: { findUnique: async () => ({ name: "Acme" }) },
      agentMemory: { findMany: async () => [] },
    },
  };
});
vi.mock("./acting", async () => ({ ...(await import("./test-fixtures")).actingFake, personZone: async () => "UTC" }));
vi.mock("./previews", async () => ({ prepareCall: (await import("./test-fixtures")).fakePrepareCall }));
vi.mock("./tools", async () => ({ TOOLS: (await import("./test-fixtures")).fakeTools() }));
vi.mock("@/lib/activity", async () => ({ logActivity: (await import("./test-fixtures")).fakeLogActivity }));
vi.mock("@/lib/entitlements", async () => ({ isModuleActive: (await import("./test-fixtures")).fakeIsModuleActive }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => {}, publishToConversation: () => {} }));
vi.mock("./budget", () => ({
  claimTeammateTurn: async (a: Row) => (st.claims.push(a), { ok: true, runId: "run1", questionId: "q1" }),
  abandonTurn: async () => {},
  giveBackTurn: async () => {},
}));
vi.mock("@/lib/ai-client", () => {
  const client = {
    messages: {
      create: async (params: Row) => {
        st.requests.push(structuredClone(params));
        const next = st.replies.shift();
        if (!next) throw new Error("no reply left");
        return next;
      },
    },
  };
  return {
    isAiConfigured: async () => true,
    getAnthropicForOrg: async () => ({ client, source: "shared", preferredModel: null }),
    modelFor: (_r: unknown, fallback: string) => fallback,
    createMessageWithFallback: (c: typeof client, params: Row) => c.messages.create(params),
  };
});

import { runLegacyAgentNow } from "./legacy-schedules";
import { AGENT_SLUG, VIEWER, fx, resetFixtures } from "./test-fixtures";

const reply = (content: Row[], stop: string) => ({
  id: "msg",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-6",
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 20 },
});

beforeEach(() => {
  resetFixtures();
  st.replies = [];
  st.requests = [];
  st.claims = [];
  st.runUpdates = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Run now", () => {
  it("asks before it invites anyone: one PENDING request, and the invitation is never sent", async () => {
    st.replies = [
      reply([{ type: "tool_use", id: "tu1", name: "invite_person_with_role", input: { email: "new.hire@x.com", role: "Employee" } }], "tool_use"),
      reply([{ type: "text", text: "I asked you to approve inviting new.hire@x.com.", citations: null }], "end_turn"),
    ];
    const out = await runLegacyAgentNow({ id: "a1", slug: AGENT_SLUG, name: "Chief of Staff" }, VIEWER as never);

    expect(out).toMatchObject({ ok: true, result: { runId: "run1", status: "SUCCEEDED", waiting: 1 } });
    // A turn in the person's own chat, as them, that honours what they chose there.
    expect(st.claims).toEqual([expect.objectContaining({ trigger: "CHAT", sessionId: "s1", userId: "me", practice: false })]);
    // The request waits for the person; the tool itself never ran.
    expect(fx.actions).toHaveLength(1);
    expect(fx.actions[0]).toMatchObject({ toolName: "invite_person_with_role", status: "PENDING", sessionId: "s1" });
    expect(fx.handlerCalls.filter((c) => c.tool === "invite_person_with_role")).toEqual([]);
    // The model was offered the tool, and asked twice: the call, then its last word.
    expect(st.requests).toHaveLength(2);
    expect(((st.requests[0].tools ?? []) as Row[]).map((t) => t.name)).toContain("invite_person_with_role");
  });

  it("asks again even where the person chose Don't ask: an invitation always asks", async () => {
    fx.settings.set("a1:me", { invite_person_with_role: "always" });
    st.replies = [
      reply([{ type: "tool_use", id: "tu1", name: "invite_person_with_role", input: { email: "new.hire@x.com", role: "Employee" } }], "tool_use"),
      reply([{ type: "text", text: "Waiting for your approval.", citations: null }], "end_turn"),
    ];
    await runLegacyAgentNow({ id: "a1", slug: AGENT_SLUG, name: "Chief of Staff" }, VIEWER as never);
    expect(fx.actions.map((a) => [a.toolName, a.status])).toEqual([["invite_person_with_role", "PENDING"]]);
    expect(fx.handlerCalls.filter((c) => c.tool === "invite_person_with_role")).toEqual([]);
  });
});
