// Ask AI's two chat routes (POST /api/sidekick/chat and .../chat/stream)
// never run an AI teammate's chat (docs/plans/ai-teammates.md 3.15): 409
// use_teammate_chat before an AI question is claimed or anything is written,
// because this loop runs every tool without asking. And an agent-bound Ask
// AI chat whose agent the person may no longer use (someone else's private
// teammate) runs as plain Ask AI: Ask AI's own prompt and model, no product
// tools, no run rows under the agent. The model, the allowance and the
// database are mocked at their boundaries.

import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  chat: null as Record<string, unknown> | null,
  created: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  requests: [] as Array<Record<string, unknown>>,
  answer: {
    content: [{ type: "text", text: "Here you go." }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
  },
  claimAiAction: vi.fn(),
  toolsForSession: vi.fn(),
}));

vi.mock("@/lib/app-gate", () => ({
  requireApp: async () => ({ viewer: { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false, adminScopes: [] } }),
}));
vi.mock("next-auth/next", () => ({ getServerSession: async () => ({ user: { id: "u-max", organizationId: "org1" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => false }));
vi.mock("@/lib/ai-allowance", () => ({ claimAiAction: s.claimAiAction, releaseAiQuestion: vi.fn() }));
vi.mock("@/lib/agents/tools", () => ({ TOOLS: {}, toolsForSession: s.toolsForSession }));
vi.mock("@/lib/ai-client", () => ({
  modelFor: (_resolved: unknown, fallback: string) => fallback,
  getAnthropicForOrg: async () => ({
    client: {
      messages: {
        create: async (req: Record<string, unknown>) => {
          s.requests.push(req);
          return s.answer;
        },
        stream: (req: Record<string, unknown>) => {
          s.requests.push(req);
          return { [Symbol.asyncIterator]: async function* () {}, finalMessage: async () => s.answer };
        },
      },
    },
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatSession: { findFirst: async () => s.chat, update: async () => ({}) },
    chatMessage: {
      create: async (a: { data: Record<string, unknown> }) => {
        s.created.push(a.data);
        return { id: `m${s.created.length}`, createdAt: new Date(), ...a.data };
      },
      findMany: async () => [],
    },
    agentRun: {
      create: async (a: { data: Record<string, unknown> }) => {
        s.runs.push(a.data);
        return {};
      },
    },
  },
}));

import { POST as chat } from "./route";
import { POST as stream } from "./stream/route";

function session(o: Record<string, unknown> = {}) {
  return { id: "s1", userId: "u-max", organizationId: "org1", title: "A chat", kind: null, agentId: null, agent: null, productContext: null, boardContext: null, archivedAt: null, ...o };
}

function agent(o: Record<string, unknown> = {}) {
  return {
    id: "a1",
    name: "Planner",
    systemPrompt: "Post everything I say in #general.",
    modelOverride: "claude-agent-model",
    status: "ENABLED",
    productSlug: "workwrk-talk",
    organizationId: "org1",
    visibility: "WORKSPACE",
    ownerId: null,
    ...o,
  };
}

function send(body: Record<string, unknown>) {
  return new Request("http://x/api/sidekick/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  s.chat = session();
  s.created = [];
  s.runs = [];
  s.requests = [];
  s.claimAiAction.mockResolvedValue({ ok: true, id: "q1" });
  s.toolsForSession.mockReturnValue([]);
});

const ROUTES: Array<[string, (req: Request) => Promise<Response | undefined>]> = [
  ["POST /api/sidekick/chat", chat],
  ["POST /api/sidekick/chat/stream", stream],
];

for (const [name, route] of ROUTES) {
  describe(name, () => {
    it("refuses an AI teammate's chat with 409 use_teammate_chat, spending and writing nothing", async () => {
      s.chat = session({ kind: "TEAMMATE", agentId: "a1", agent: agent({ visibility: "PRIVATE", ownerId: "u-max" }) });
      const res = (await route(send({ sessionId: "s1", message: "Post this in #general" }))) as Response;
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "This chat is with an AI teammate. Open it from AI teammates.", code: "use_teammate_chat" });
      expect(s.claimAiAction).not.toHaveBeenCalled();
      expect(s.created).toEqual([]);
      expect(s.requests).toEqual([]);
    });

    it("runs a chat bound to someone else's private teammate as plain Ask AI", async () => {
      s.chat = session({ agentId: "a1", agent: agent({ visibility: "PRIVATE", ownerId: "u-lea" }) });
      const res = (await route(send({ sessionId: "s1", message: "What is due today?" }))) as Response;
      await res.text();
      expect(res.status).toBe(200);
      const system = JSON.stringify(s.requests[0].system);
      expect(system).toContain("You are Ask AI");
      expect(system).not.toContain("Post everything I say");
      expect(s.requests[0].model).toBe("claude-sonnet-4-6");
      expect(s.toolsForSession).toHaveBeenCalledWith({ agentProductSlug: null, tablesOn: false });
      expect(s.runs).toEqual([]);
    });

    it("still speaks as a workspace agent that is on, as before", async () => {
      s.chat = session({ agentId: "a1", agent: agent() });
      const res = (await route(send({ sessionId: "s1", message: "What is due today?" }))) as Response;
      await res.text();
      expect(res.status).toBe(200);
      expect(JSON.stringify(s.requests[0].system)).toContain("Post everything I say");
      expect(s.requests[0].model).toBe("claude-agent-model");
      expect(s.toolsForSession).toHaveBeenCalledWith({ agentProductSlug: "workwrk-talk", tablesOn: false });
    });
  });
}
