// Ask AI asks first (docs/plans/ai-teammates.md, follow-up 1.5c), through
// both chat routes: what other people would see waits for the person on the
// card AI teammates use (one PENDING request with no teammate, then an
// APPROVAL row after the answer), the call after a waiting one may use no
// tool, what the model reads comes inside <tool_data>, a tool the chat does
// not offer or an input its schema does not describe never runs, the
// person's own work still runs at once, and what was decided since comes
// once as a note. Approving runs the tool once, exactly as Ask AI runs one.
// The queue is the real actions.ts and ask-ai-calls.ts over the shared queue
// double (src/lib/agents/test-fixtures.ts); the model is scripted.

import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  requests: [] as Array<Record<string, unknown>>,
  /** One scripted model answer per call, in order; the last repeats. */
  answers: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/app-gate", () => ({
  requireApp: async () => ({ viewer: { userId: "me", organizationId: "org", orgRole: "MEMBER", isAgent: false, adminScopes: [] } }),
}));
vi.mock("next-auth/next", () => ({ getServerSession: async () => ({ user: { id: "me", organizationId: "org" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/entitlements", async () => ({ isModuleActive: (await import("@/lib/agents/test-fixtures")).fakeIsModuleActive }));
vi.mock("@/lib/ai-allowance", () => ({ claimAiAction: async () => ({ ok: true, id: "q1" }), releaseAiQuestion: vi.fn() }));
vi.mock("@/lib/agents/acting", async () => (await import("@/lib/agents/test-fixtures")).actingFake);
vi.mock("@/lib/agents/previews", async () => ({ prepareCall: (await import("@/lib/agents/test-fixtures")).fakePrepareCall }));
vi.mock("@/lib/activity", async () => ({ logActivity: (await import("@/lib/agents/test-fixtures")).fakeLogActivity }));
vi.mock("@/lib/agents/tools", async () => {
  const { fakeTools } = await import("@/lib/agents/test-fixtures");
  const { askAiToolNames } = await import("@/lib/agents/tool-names");
  const TOOLS = fakeTools();
  return { TOOLS, toolsForSession: (o: { agentProductSlug?: string | null; tablesOn?: boolean }) => askAiToolNames(o).map((n) => TOOLS[n]) };
});
vi.mock("@/lib/ai-client", () => {
  const next = (req: Record<string, unknown>) => {
    s.requests.push(JSON.parse(JSON.stringify(req)));
    const i = Math.min(s.requests.length - 1, s.answers.length - 1);
    return s.answers[i];
  };
  return {
    modelFor: (_resolved: unknown, fallback: string) => fallback,
    createMessageWithFallback: async (_c: unknown, req: Record<string, unknown>) => next(req),
    getAnthropicForOrg: async () => ({
      client: {
        messages: {
          create: async (req: Record<string, unknown>) => next(req),
          stream: (req: Record<string, unknown>) => {
            const answer = next(req);
            return { [Symbol.asyncIterator]: async function* () {}, finalMessage: async () => answer };
          },
        },
      },
    }),
  };
});
vi.mock("@/lib/prisma", async () => {
  const { prismaFake } = await import("@/lib/agents/test-fixtures");
  return {
    prisma: {
      ...prismaFake,
      chatSession: {
        ...prismaFake.chatSession,
        findFirst: async (a: { where: Record<string, unknown> }) =>
          // The route's own read (by session and person), else the queue's.
          a.where.archivedAt === null
            ? { id: "s1", userId: "me", organizationId: "org", title: "A chat", kind: null, agentId: null, agent: null, productContext: null, boardContext: null, archivedAt: null }
            : prismaFake.chatSession.findFirst(),
        update: async () => ({}),
      },
      chatMessage: {
        create: async (a: { data: Record<string, unknown> }) => {
          s.created.push(a.data);
          return { id: `m${s.created.length}`, createdAt: (a.data.createdAt as Date | undefined) ?? new Date(), ...a.data };
        },
        findMany: async () => [{ id: "m-user", role: "USER", content: "Thank Max for the launch", createdAt: new Date() }],
      },
      agentRun: { create: async () => ({}) },
    },
  };
});

import { POST as chat } from "./route";
import { POST as stream } from "./stream/route";
import { decideActions } from "@/lib/agents/actions";
import { PERSON, VIEWER, fx, resetFixtures, seedAction } from "@/lib/agents/test-fixtures";

function send() {
  return new Request("http://x/api/sidekick/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "s1", message: "Thank Max for the launch" }) });
}

const toolUse = (name: string, input: Record<string, unknown>) => ({
  content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "tu1", name, input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 10, output_tokens: 5 },
});
const said = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });

/** The SSE events a stream answered, parsed. */
async function events(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("data:"))
    .map((part) => JSON.parse(part.slice(5)) as Record<string, unknown>);
}

beforeEach(() => {
  resetFixtures();
  s.created = [];
  s.requests = [];
  s.answers = [];
  fx.cards.send_kudos = { title: "Send kudos to Max" };
});

const ROUTES: Array<[string, (req: Request) => Promise<Response | undefined>, boolean]> = [
  ["POST /api/sidekick/chat", chat, false],
  ["POST /api/sidekick/chat/stream", stream, true],
];

for (const [name, route, streaming] of ROUTES) {
  describe(`${name}: Ask AI asks first`, () => {
    it("asks before anything other people would see, and only says so after", async () => {
      s.answers = [toolUse("send_kudos", { email: "max@x.com", message: "Thanks for the launch" }), said("I asked for your approval.")];
      const res = (await route(send())) as Response;
      const sse = streaming ? await events(res) : [];
      const body = streaming ? null : ((await res.json()) as Record<string, unknown>);
      expect(res.status).toBe(200);

      // Nothing ran: one request waits, with no teammate, in this chat.
      expect(fx.handlerCalls).toEqual([]);
      expect(fx.actions).toHaveLength(1);
      const action = fx.actions[0];
      expect(action).toMatchObject({ agentId: null, actingForId: "me", sessionId: "s1", toolName: "send_kudos", status: "PENDING", runId: null });
      // One turn's requests share one card: the turn is the person's saved message (m1).
      expect(s.created[0]).toMatchObject({ role: "USER" });
      expect(action.groupKey).toBe("m1:send_kudos");
      // Ask AI never offers "don't ask again".
      expect(action.preview).toEqual({ title: "Send kudos to Max" });

      // The call after the waiting one may use no tool, and read the result as data.
      expect(s.requests[0].tool_choice).toBeUndefined();
      expect(s.requests[1].tool_choice).toEqual({ type: "none" });
      const results = (s.requests[1].messages as Array<{ role: string; content: unknown }>).at(-1)?.content as Array<{ content: string }>;
      expect(results[0].content).toMatch(/^<tool_data tool="send_kudos">.*waiting_for_approval.*<\/tool_data>$/);
      expect(JSON.stringify(s.requests[0].system)).toContain("waiting_for_approval");

      // The card row, after the answer, naming the request.
      const card = s.created.find((m) => m.kind === "APPROVAL");
      expect(card).toMatchObject({ sessionId: "s1", role: "SYSTEM", meta: { actionIds: [action.id] } });
      const answer = s.created.find((m) => m.role === "ASSISTANT");
      expect((card?.createdAt as Date).getTime()).toBeGreaterThan(((answer?.createdAt as Date | undefined) ?? new Date(0)).getTime() - 1);
      expect(answer?.toolCalls).toEqual([expect.objectContaining({ name: "send_kudos", state: "waiting", actionId: action.id })]);

      if (streaming) {
        expect(sse.find((e) => e.type === "approval")).toMatchObject({ action: { id: action.id, status: "PENDING" } });
        expect(sse.find((e) => e.type === "tool_result")).toMatchObject({ name: "send_kudos", isError: false, state: "waiting", title: "Send kudos to Max" });
        expect(sse.find((e) => e.type === "done")).toMatchObject({ approval: { actionIds: [action.id] } });
      } else {
        expect(body).toMatchObject({ approval: { actionIds: [action.id] } });
      }
    });

    it("runs the person's own work at once, in their own context, as before", async () => {
      s.answers = [toolUse("create_task", { title: "Call Acme" }), said("Done.")];
      await ((await route(send())) as Response).text();
      expect(fx.actions).toEqual([]);
      expect(fx.handlerCalls).toEqual([{ tool: "create_task", ctx: { orgId: "org", userId: "me" }, input: { title: "Call Acme" } }]);
      expect(s.requests[1].tool_choice).toBeUndefined();
    });

    it("never runs a tool the chat does not offer, a teammate's included", async () => {
      s.answers = [toolUse("post_in_talk", { conversationId: "c1", text: "Hello" }), said("I can't do that here.")];
      await ((await route(send())) as Response).text();
      expect(fx.handlerCalls).toEqual([]);
      expect(fx.actions).toEqual([]);
      const results = (s.requests[1].messages as Array<{ content: unknown }>).at(-1)?.content as Array<{ content: string; is_error?: boolean }>;
      expect(results[0]).toMatchObject({ is_error: true });
      expect(results[0].content).toContain("Ask AI can't use that tool in this chat.");
    });

    it("never runs an input its tool's schema does not describe", async () => {
      s.answers = [toolUse("create_task", { title: { contains: "" } }), said("That didn't work.")];
      await ((await route(send())) as Response).text();
      expect(fx.handlerCalls).toEqual([]);
      const results = (s.requests[1].messages as Array<{ content: unknown }>).at(-1)?.content as Array<{ content: string }>;
      expect(results[0].content).toContain("wasn't in a form the tool can use");
    });

    it("tells it once what was decided on its requests since it last heard", async () => {
      seedAction({ toolName: "send_kudos", agentId: null, sessionId: "s1", status: "DENIED", decidedVia: "person", decidedAt: new Date(), preview: { title: "Send kudos to Lea" } });
      s.answers = [said("Noted.")];
      await ((await route(send())) as Response).text();
      const last = (s.requests[0].messages as Array<{ role: string; content: unknown }>).at(-1);
      expect(JSON.stringify(last?.content)).toContain("<workspace_note>");
      expect(JSON.stringify(last?.content)).toContain("Said no: Send kudos to Lea");
      expect(fx.actions[0].reportedAt).not.toBeNull();

      s.requests = [];
      await ((await route(send())) as Response).text();
      expect(JSON.stringify((s.requests[0].messages as Array<{ content: unknown }>).at(-1)?.content)).not.toContain("<workspace_note>");
    });
  });
}

describe("approving Ask AI's request", () => {
  it("runs it once, exactly as Ask AI runs a tool, and never makes the chat carry on", async () => {
    s.answers = [toolUse("send_kudos", { email: "max@x.com", message: "Thanks for the launch" }), said("I asked for your approval.")];
    await ((await stream(send())) as Response).text();
    const id = fx.actions[0].id;

    const out = await decideActions(VIEWER as never, [{ id, decision: "approve" }], { always: true });
    expect(out).toMatchObject({ resume: false, agentSlug: null, results: [{ id, status: "EXECUTED" }] });
    expect(fx.handlerCalls).toEqual([{ tool: "send_kudos", ctx: { orgId: "org", userId: "me" }, input: { email: "max@x.com", message: "Thanks for the launch" } }]);
    // On record as Ask AI acting for the person; no "don't ask again" stored.
    expect(fx.activity).toEqual([expect.objectContaining({ actorType: "agent", actorLabel: `Ask AI for ${PERSON.name}`, metadata: expect.objectContaining({ agentId: null, actionId: id, decidedVia: "person" }) })]);
    expect(fx.settings.size).toBe(0);
    // The decision's line is in the chat, and nothing about it marks a teammate's Inbox row.
    expect(s.created.filter((m) => m.kind === "EVENT")).toEqual([expect.objectContaining({ sessionId: "s1", role: "SYSTEM", content: "You approved: Send kudos to Max" })]);
    expect(fx.notifications.at(-1)?.where).toMatchObject({ link: { in: [`/sidekick?session=s1&action=${id}`] } });

    const again = await decideActions(VIEWER as never, [{ id, decision: "approve" }]);
    expect(again.results).toEqual([{ id, status: "EXECUTED", code: "already_decided" }]);
    expect(fx.handlerCalls).toHaveLength(1);
  });

  it("cancels a request whose tool the chat no longer offers, and runs nothing", async () => {
    s.answers = [toolUse("send_kudos", { email: "max@x.com", message: "Thanks" }), said("I asked.")];
    await ((await chat(send())) as Response).text();
    const id = fx.actions[0].id;
    fx.chat = null;
    const out = await decideActions(VIEWER as never, [{ id, decision: "approve" }]);
    expect(out.results).toEqual([{ id, status: "CANCELLED", code: "tool_off", error: "Cancelled: Ask AI can no longer use this tool in this chat." }]);
    expect(fx.handlerCalls).toEqual([]);
  });
});
