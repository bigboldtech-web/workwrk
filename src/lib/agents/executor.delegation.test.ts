// One teammate asking another (ask_teammate; src/lib/agents/executor.ts
// runDelegation, docs/plans/ai-teammates-phase2.md step 5): only from a turn
// the person watches, at most three per answer, never in practice (which
// says what it would ask), never itself, never a paused or someone else's
// teammate; each ask is the delegate's own claimed question, traced to the
// caller's run; what the delegate asks for waits in its own chat, and the
// caller's chat gets a line that opens it; the answer comes back as data.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  named: {} as Record<string, Row[]>,
  claims: [] as Row[],
  claimAnswer: null as Row | null,
  turns: [] as Row[],
  turnAnswer: null as Row | null,
  published: [] as Row[],
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./test-fixtures")).prismaFake }));
vi.mock("./acting", async () => (await import("./test-fixtures")).actingFake);
vi.mock("./previews", async () => ({ prepareCall: (await import("./test-fixtures")).fakePrepareCall }));
vi.mock("./tools", async () => ({ TOOLS: (await import("./test-fixtures")).fakeTools() }));
vi.mock("@/lib/activity", async () => ({ logActivity: (await import("./test-fixtures")).fakeLogActivity }));
vi.mock("@/lib/entitlements", async () => ({ isModuleActive: (await import("./test-fixtures")).fakeIsModuleActive }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: (userId: string, e: Row) => void st.published.push({ userId, ...e }) }));
vi.mock("./teammate-server", () => ({
  usableTeammatesNamed: async (_viewer: unknown, name: string) => st.named[name.toLowerCase()] ?? [],
}));
vi.mock("./budget", () => ({
  claimTeammateTurn: async (a: Row) => {
    st.claims.push(a);
    return st.claimAnswer ?? { ok: true, runId: `drun${st.claims.length}`, questionId: `dq${st.claims.length}` };
  },
  giveBackTurn: async () => {},
}));
vi.mock("./engine", () => ({
  getOrCreateTeammateSession: async (agent: { id: string }, userId: string) => ({ id: `chat:${agent.id}:${userId}`, created: false }),
  teammateAgentFrom: (r: Row) => r,
  runTeammateTurn: async (a: Row) => {
    st.turns.push(a);
    return st.turnAnswer ?? { text: "Two tasks are stuck: <b>Call Acme</b>.", error: null, giveBack: false, proposedActionIds: [], messages: [] };
  },
}));

import { executeToolCall, type ExecuteArgs } from "./executor";
import { DELEGATION_COPY } from "./teammate-copy";
import { AGENT_SLUG, PERSON, fx, resetFixtures, seedAction } from "./test-fixtures";

const PM: Row = { id: "a-pm", slug: "t-pm-abc", name: "Project Manager", status: "ENABLED", organizationId: "org" };
const ENABLED = ["search_tasks", "ask_teammate"];

function call(input: Row, o: Partial<ExecuteArgs> = {}) {
  return executeToolCall({
    name: "ask_teammate",
    input,
    person: PERSON as never,
    agent: { id: "a1", slug: AGENT_SLUG, name: "Chief of Staff" },
    turn: { sessionId: "s1", routineId: null, trigger: "CHAT", runId: "run1" },
    enabled: ENABLED,
    agentRules: {},
    personRules: {},
    practice: false,
    counters: { calls: 0, proposals: 0, delegations: 0 },
    ...o,
  });
}

function dataOf(content: string): Row {
  const m = /^<tool_data tool="ask_teammate">([\s\S]*)<\/tool_data>$/.exec(content);
  if (!m) throw new Error(`not a tool_data block: ${content.slice(0, 80)}`);
  return JSON.parse(m[1]) as Row;
}

const ASK = { teammate: "Project Manager", request: "Which tasks are stuck?" };

beforeEach(() => {
  resetFixtures();
  st.named = { "project manager": [PM] };
  st.claims = [];
  st.claimAnswer = null;
  st.turns = [];
  st.turnAnswer = null;
  st.published = [];
});

describe("ask_teammate", () => {
  it("runs the delegate's own turn, claimed against its own limits and traced to the caller's run", async () => {
    const r = await call(ASK);
    expect(r.record.state).toBe("ran");
    expect(st.claims).toEqual([
      expect.objectContaining({ agentId: "a-pm", trigger: "DELEGATED", rateLimit: true, practice: false, parentRunId: "run1", sessionId: `chat:a-pm:${PERSON.userId}` }),
    ]);
    expect(st.turns[0]).toMatchObject({
      trigger: "DELEGATED",
      userText: null,
      origin: { kind: "delegated", by: { agentId: "a1", name: "Chief of Staff", sessionId: "s1", runId: "run1" }, request: "Which tasks are stuck?" },
    });
    // The delegate's chat says who asked.
    expect(fx.messages[0]).toMatchObject({ sessionId: `chat:a-pm:${PERSON.userId}`, kind: "EVENT", content: "Asked by Chief of Staff: Which tasks are stuck?", meta: { event: "delegated_asked", agentId: "a-pm" } });
  });

  it("hands the answer back as data, its markup escaped", async () => {
    const r = await call(ASK);
    expect(r.modelContent).not.toContain("<b>");
    expect(dataOf(r.modelContent)).toMatchObject({ ok: true, teammate: { name: "Project Manager" }, answer: "Two tasks are stuck: <b>Call Acme</b>." });
  });

  it("says what it would ask in a practice run, and asks nobody", async () => {
    const r = await call(ASK, { practice: true });
    expect(r.record.state).toBe("practice");
    expect(dataOf(r.modelContent)).toEqual({ practice: true, wouldDo: "Ask Project Manager" });
    expect(st.claims).toEqual([]);
  });

  it("asks at most three teammates per answer", async () => {
    const counters = { calls: 0, proposals: 0, delegations: 0 };
    for (let i = 0; i < 3; i += 1) expect((await call(ASK, { counters })).record.state).toBe("ran");
    const fourth = await call(ASK, { counters });
    expect(dataOf(fourth.modelContent)).toEqual({ error: DELEGATION_COPY.tooManyAsks });
    expect(st.claims).toHaveLength(3);
  });

  it("never asks itself, a paused teammate, or one the person cannot use", async () => {
    st.named["chief of staff"] = [{ ...PM, id: "a1", name: "Chief of Staff" }];
    expect(dataOf((await call({ teammate: "Chief of Staff", request: "x" })).modelContent)).toEqual({ error: DELEGATION_COPY.cantAskItself });
    st.named["triage"] = [{ ...PM, id: "a-tr", name: "Triage", status: "DISABLED" }];
    expect(dataOf((await call({ teammate: "Triage", request: "x" })).modelContent)).toEqual({ error: DELEGATION_COPY.delegatePaused("Triage") });
    // Another person's private teammate is not one this person may use: it reads as a name nobody has.
    const hidden = await call({ teammate: "Olivia's Planner", request: "x" });
    const missing = await call({ teammate: "Nobody", request: "x" });
    expect(dataOf(hidden.modelContent)).toEqual({ error: DELEGATION_COPY.noTeammateNamed("Olivia's Planner") });
    expect(dataOf(missing.modelContent)).toEqual({ error: DELEGATION_COPY.noTeammateNamed("Nobody") });
    st.named["pm"] = [PM, { ...PM, id: "a-pm2" }];
    expect(dataOf((await call({ teammate: "PM", request: "x" })).modelContent)).toEqual({ error: DELEGATION_COPY.severalNamed("PM") });
    expect(st.claims).toEqual([]);
  });

  it("answers a refused claim as a result the model reads, never a throw", async () => {
    st.claimAnswer = { ok: false, code: "agent_cap", message: "Project Manager has used its 40 AI questions for October." };
    const r = await call(ASK);
    expect(dataOf(r.modelContent)).toEqual({ error: "Project Manager has used its 40 AI questions for October." });
    expect(st.turns).toEqual([]);
  });

  it("is offered only where the person watches: a delegated turn never asks on", async () => {
    const r = await call(ASK, { turn: { sessionId: "s1", routineId: null, trigger: "DELEGATED", runId: "run1" } });
    expect(r.record.state).toBe("failed");
    expect(st.claims).toEqual([]);
  });

  it("points the caller's chat at what the delegate asked for, which waits in the delegate's own chat", async () => {
    const card = seedAction({ id: "x1", toolName: "move_task", sessionId: `chat:a-pm:${PERSON.userId}`, preview: { title: 'Move "Call Acme" to Backlog' } });
    st.turnAnswer = { text: "I asked to move it.", error: null, giveBack: false, proposedActionIds: [card.id], messages: [] };
    const events: Row[] = [];
    const r = await call(ASK, { emit: (e) => void events.push(e as never) });
    const line = fx.messages.find((m) => m.sessionId === "s1");
    expect(line).toMatchObject({
      kind: "EVENT",
      content: 'Project Manager is waiting for your approval: Move "Call Acme" to Backlog',
      meta: { event: "delegate_waiting", agentId: "a1", link: { kind: "chat", slug: "t-pm-abc", actionId: "x1" } },
    });
    expect(events.map((e) => e.type)).toEqual(["event"]);
    expect(dataOf(r.modelContent)).toMatchObject({ waiting: [{ title: 'Move "Call Acme" to Backlog' }], note: DELEGATION_COPY.waitingNote(PERSON.firstName, "Project Manager") });
    expect(st.published).toEqual([{ userId: PERSON.userId, type: "agent.changed", agentId: "a-pm" }]);
  });

  it("says the delegate didn't answer when nothing came back", async () => {
    st.turnAnswer = { text: "", error: "The AI service didn't answer. Try again.", giveBack: true, proposedActionIds: [], messages: [] };
    const r = await call(ASK);
    expect(r.record.state).toBe("failed");
    expect(dataOf(r.modelContent)).toEqual({ error: DELEGATION_COPY.delegateNoAnswer("Project Manager") });
  });

  it("still says what waits when the delegate left a card but no words (review round 1)", async () => {
    const card = seedAction({ id: "x2", toolName: "post_in_talk", sessionId: `chat:a-pm:${PERSON.userId}`, preview: { title: "Post in #team" } });
    st.turnAnswer = { text: "", error: "The AI service didn't answer. Try again.", giveBack: false, proposedActionIds: [card.id], messages: [] };
    const r = await call(ASK);
    expect(r.record.state).toBe("failed");
    expect(dataOf(r.modelContent)).toEqual({
      error: DELEGATION_COPY.delegateNoAnswer("Project Manager"),
      waiting: [{ title: "Post in #team" }],
      note: DELEGATION_COPY.waitingNote(PERSON.firstName, "Project Manager"),
    });
  });

  it("marks an answer that stopped part way, so the caller never passes it on as whole (review round 5)", async () => {
    st.turnAnswer = { text: "Stuck: Call Acme, Renew", error: "The answer was cut short.", giveBack: false, proposedActionIds: [], messages: [] };
    const cut = await call(ASK);
    expect(cut.record.state).toBe("ran");
    expect(dataOf(cut.modelContent)).toMatchObject({ answer: "Stuck: Call Acme, Renew", endedEarly: true, note: DELEGATION_COPY.endedEarlyNote("Project Manager") });
    // Whole, only not saved in the delegate's chat: no mark.
    st.turnAnswer = { text: "Two are stuck.", error: "The answer couldn't be saved. Check what it did before asking again.", giveBack: false, proposedActionIds: [], messages: [] };
    const whole = await call(ASK);
    expect(dataOf(whole.modelContent)).not.toHaveProperty("endedEarly");
  });

  it("refuses a request too long to pass on, asking nobody (review round 1)", async () => {
    const r = await call({ ...ASK, request: "x".repeat(4001) });
    expect(r.record.state).toBe("failed");
    expect(dataOf(r.modelContent)).toMatchObject({ error: DELEGATION_COPY.requestTooLong(4000) });
    expect(st.claims).toEqual([]);
  });
});
