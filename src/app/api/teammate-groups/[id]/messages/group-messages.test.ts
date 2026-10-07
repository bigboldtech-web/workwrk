// POST /api/teammate-groups/[id]/messages (docs/plans/ai-teammates-phase2.md
// step 3): nothing is saved before the first answerer's question is
// claimed; a member who cannot answer gets a line and no claim; named
// answerers each claim their own question, in the order named; the plan
// running out stops the rest, each with a line; a continue hears only its
// own teammate's outcomes; and the keep-alive always stops. The route's
// collaborators are mocked at their boundaries.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  group: null as Row | null,
  claims: [] as Row[],
  claimAnswers: [] as Row[],
  saved: [] as Row[],
  lines: [] as Row[],
  turns: [] as Row[],
  outcomeClaims: [] as Array<[string, string | null | undefined]>,
  outcomes: [] as Row[],
  abandoned: [] as string[],
}));

function agent(slug: string, name: string, over: Row = {}): Row {
  return {
    id: `a-${slug}`, organizationId: "org1", slug, name, description: "", systemPrompt: "", modelOverride: null, productSlug: null, toolNames: ["search_tasks"],
    approvalRules: {}, avatar: null, hue: null, visibility: "WORKSPACE", ownerId: null, status: "ENABLED", template: null, monthlyQuestionCap: null,
    autonomousEnabled: false, scheduleCron: null, ...over,
  };
}

const VIEWER = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false };

vi.mock("@/lib/app-gate", () => ({ requireApp: async () => ({ viewer: VIEWER }) }));
vi.mock("@/lib/ai-client", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/agents/acting", () => ({
  resolveActingPerson: async () => ({ ok: true, person: { userId: "u-max", organizationId: "org1", firstName: "Max", name: "Max Chen", viewer: VIEWER } }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      create: async (a: { data: Row }) => {
        st.saved.push(a.data);
        return { id: "u1", role: "USER", content: a.data.content, kind: null, meta: a.data.meta, toolCalls: null, createdAt: new Date("2026-10-07T10:00:00Z") };
      },
    },
    chatSession: { updateMany: async () => ({ count: 1 }) },
  },
}));
vi.mock("@/lib/agents/actions", () => ({
  claimUnreportedOutcomes: async (sessionId: string, agentId?: string | null) => {
    st.outcomeClaims.push([sessionId, agentId]);
    return st.outcomes;
  },
  writeEventLine: async (sessionId: string, line: Row) => {
    st.lines.push({ sessionId, ...line });
    return { id: `l${st.lines.length}`, kind: "event", text: line.text, createdAt: "2026-10-07T10:00:00.000Z", event: line.event, routineId: null, actionId: null };
  },
}));
vi.mock("@/lib/agents/budget", () => ({
  claimTeammateTurn: async (a: Row) => {
    st.claims.push(a);
    return st.claimAnswers.shift() ?? { ok: true, runId: `run${st.claims.length}`, questionId: `q${st.claims.length}` };
  },
  giveBackTurn: async () => {},
  abandonTurn: async (runId: string) => void st.abandoned.push(runId),
}));
vi.mock("@/lib/agents/engine", () => ({
  teammateAgentFrom: (r: Row) => r,
  runTeammateTurn: async (a: Row) => {
    st.turns.push(a);
    return { assistantMessageId: `m${st.turns.length}`, approvalMessageId: null, proposedActionIds: [], text: "ok", failedBeforeAnything: false, giveBack: false, tokensIn: 1, tokensOut: 1, error: null, messages: [] };
  },
}));
vi.mock("@/lib/agents/group-server", async () => {
  const real = await vi.importActual<typeof import("@/lib/agents/group-server")>("@/lib/agents/group-server");
  return { ...real, loadGroup: async () => st.group };
});

import { POST } from "./route";

function groupOf(agents: Row[]): Row {
  return { id: "g1", title: "Offsite crew", createdAt: new Date(), lastReadAt: null, members: agents.map((a, i) => ({ position: i, agent: a })) };
}

async function send(body: Row): Promise<{ status: number; events: Row[]; json: Row | null }> {
  const res = (await POST(new Request("https://app.example.test/api/teammate-groups/g1/messages", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "g1" }),
  })) as Response;
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) return { status: res.status, events: [], json: await res.json() };
  const text = await res.text();
  const events = text.split("\n\n").filter((c) => c.startsWith("data: ")).map((c) => JSON.parse(c.slice(6)) as Row);
  return { status: res.status, events, json: null };
}

const PM = agent("pm", "Project Manager");
const TRIAGE = agent("triage", "Triage");

beforeEach(() => {
  st.group = groupOf([PM, TRIAGE]);
  st.claims = [];
  st.claimAnswers = [];
  st.saved = [];
  st.lines = [];
  st.turns = [];
  st.outcomeClaims = [];
  st.outcomes = [];
  st.abandoned = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a group message", () => {
  it("goes to the lead when it names nobody, as one claim and one turn", async () => {
    const out = await send({ message: "Status?" });
    expect(out.status).toBe(200);
    expect(st.claims).toEqual([expect.objectContaining({ agentId: "a-pm", trigger: "CHAT", sessionId: "g1", rateLimit: true, what: "AI teammate group message" })]);
    expect(st.saved).toEqual([{ sessionId: "g1", role: "USER", content: "Status?", meta: { answerers: ["a-pm"] } }]);
    expect(st.turns).toHaveLength(1);
    expect(st.turns[0]).toMatchObject({ trigger: "CHAT", userText: null, userMessageId: "u1", sessionId: "g1", group: { name: "Offsite crew", selfAgentId: "a-pm", messageId: "u1" } });
    expect(out.events.map((e) => e.type)).toEqual(["user_message", "answer_start", "answer_done", "done"]);
  });

  it("saves nothing when the first answerer's question is refused", async () => {
    st.claimAnswers = [{ ok: false, code: "rate_limited", message: "Too many AI requests.", retryAfter: 9 }];
    const out = await send({ message: "Status?" });
    expect(out.status).toBe(429);
    expect(out.json).toEqual({ error: "Too many AI requests.", code: "rate_limited" });
    expect(st.saved).toEqual([]);
    expect(st.turns).toEqual([]);
  });

  it("answers no_one_to_answer, saving and claiming nothing, when nobody can answer", async () => {
    st.group = groupOf([agent("pm", "Project Manager", { status: "DISABLED" }), agent("triage", "Triage", { status: "ARCHIVED" })]);
    const out = await send({ message: "Status?" });
    expect(out.status).toBe(409);
    expect(out.json).toMatchObject({ code: "no_one_to_answer" });
    expect(st.claims).toEqual([]);
    expect(st.saved).toEqual([]);
  });

  it("gives a paused teammate it names one line and no claim", async () => {
    st.group = groupOf([PM, agent("triage", "Triage", { status: "DISABLED" })]);
    const out = await send({ message: "@Triage and @Project Manager, what is late?" });
    expect(st.claims.map((c) => c.agentId)).toEqual(["a-pm"]);
    expect(st.lines).toEqual([{ sessionId: "g1", text: "Triage didn't answer: it is paused.", event: "group_skipped", agentId: "a-triage", replyTo: "u1" }]);
    expect(st.saved[0].meta).toEqual({ answerers: ["a-triage", "a-pm"] });
    expect(out.events.map((e) => e.type)).toEqual(["user_message", "skipped", "answer_start", "answer_done", "done"]);
  });

  it("claims each named teammate's own question, in the order the message names them", async () => {
    await send({ message: "@Triage then @Project Manager: what is late?" });
    expect(st.claims.map((c) => c.agentId)).toEqual(["a-triage", "a-pm"]);
    expect(st.turns.map((t) => (t.group as Row).selfAgentId)).toEqual(["a-triage", "a-pm"]);
  });

  it("stops at the plan's limit: the rest each get a line, and nothing more is claimed", async () => {
    st.group = groupOf([PM, TRIAGE, agent("cos", "Chief of Staff")]);
    st.claimAnswers = [{ ok: true, runId: "run1", questionId: "q1" }, { ok: false, code: "ai_limit", message: "This workspace has used all its AI questions." }];
    const out = await send({ message: "@Project Manager @Triage @Chief of Staff go" });
    expect(st.claims.map((c) => c.agentId)).toEqual(["a-pm", "a-triage"]);
    expect(st.turns).toHaveLength(1);
    expect(st.lines.map((l) => [l.agentId, l.text])).toEqual([
      ["a-triage", "Triage didn't answer: This workspace has used all its AI questions."],
      ["a-cos", "Chief of Staff didn't answer: This workspace has used all its AI questions."],
    ]);
    expect(out.events.at(-1)).toMatchObject({ type: "done" });
  });

  it("always stops the keep-alive", async () => {
    const cleared = vi.spyOn(globalThis, "clearInterval");
    await send({ message: "Status?" });
    expect(cleared).toHaveBeenCalled();
  });
});

describe("a group continue", () => {
  it("runs only the named teammate and hears only its outcomes", async () => {
    st.outcomes = [{ id: "o1" }];
    const out = await send({ resume: true, agentSlug: "triage" });
    expect(out.status).toBe(200);
    expect(st.outcomeClaims).toEqual([["g1", "a-triage"]]);
    expect(st.claims).toEqual([expect.objectContaining({ agentId: "a-triage", trigger: "RESUME", what: "AI teammate continue" })]);
    expect(st.turns[0]).toMatchObject({ trigger: "RESUME", group: { selfAgentId: "a-triage", messageId: null } });
  });

  it("gives the question back when nothing is left to continue", async () => {
    const out = await send({ resume: true, agentSlug: "triage" });
    expect(out.status).toBe(409);
    expect(out.json).toMatchObject({ code: "nothing_to_continue" });
    expect(st.abandoned).toEqual(["run1"]);
  });

  it("refuses a teammate that is not in the group, or is paused", async () => {
    expect((await send({ resume: true, agentSlug: "someone-else" })).status).toBe(404);
    st.group = groupOf([PM, agent("triage", "Triage", { status: "DISABLED" })]);
    expect((await send({ resume: true, agentSlug: "triage" })).json).toMatchObject({ code: "agent_paused" });
    expect(st.claims).toEqual([]);
  });
});
