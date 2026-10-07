// POST /api/conversations/[id]/teammates (docs/plans/ai-teammates-phase2.md
// step 6): another person's private teammate answers as an unknown one; five
// asks a minute; a refused claim posts nothing; a message already sent with
// its key starts no turn; the answer is posted as the person's agent post,
// pinging nobody, under its own key; a Guest who joined during the turn
// means nothing is posted; the keep-alive always stops.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  teammates: {} as Record<string, Row | null>,
  inserted: [] as Row[],
  already: null as Row | null,
  claims: [] as Row[],
  claim: null as Row | null,
  turns: [] as Row[],
  turnAnswer: null as Row | null,
  guests: [] as boolean[],
  states: [] as Row[],
  abandoned: [] as string[],
  lines: [] as Row[],
  notified: [] as Row[],
  nudged: [] as string[],
  userN: 0,
}));

const CONVERSATION = { id: "c1", type: "CHANNEL", name: "proof", restricted: true, archivedAt: null };
const viewerFor = () => ({ userId: `u-${st.userN}`, organizationId: "org1", orgRole: "MEMBER", isAgent: false });

vi.mock("@/lib/talk-gate", () => ({
  requireConversation: async () => ({
    ctx: { conversation: CONVERSATION, viewer: { userId: `u-${st.userN}`, orgRole: "MEMBER", isMember: true }, membershipId: "mem1", role: "edit", gate: { userId: `u-${st.userN}`, organizationId: "org1" } },
  }),
  loadConversationRole: async () => ({ conversation: CONVERSATION, viewer: { userId: `u-${st.userN}`, orgRole: "MEMBER", isMember: true }, role: "edit" }),
}));
vi.mock("@/lib/talk-access", () => ({ canPost: () => true }));
vi.mock("@/lib/app-gate", () => ({ requireApp: async () => ({ viewer: viewerFor() }) }));
vi.mock("@/lib/ai-client", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => {}, publishToConversation: (id: string) => void st.nudged.push(id) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationMessage: { findFirst: async () => st.already, findMany: async () => [] },
    conversationMember: { findMany: async () => [] },
    agentAction: { findFirst: async () => null },
    notification: { create: async (a: Row) => void st.notified.push(a) },
  },
}));
vi.mock("@/lib/talk-post", () => ({
  insertConversationMessage: async (a: Row) => {
    st.inserted.push(a);
    return { ok: true, message: { id: `m${st.inserted.length}`, createdAt: new Date("2026-10-07T10:00:00Z"), body: a.body, metadata: a.metadata } };
  },
  afterMessageSent: async () => {},
}));
vi.mock("@/lib/agents/acting", () => ({
  resolveActingPerson: async () => ({ ok: true, person: { userId: `u-${st.userN}`, organizationId: "org1", firstName: "Max", name: "Max Chen", viewer: viewerFor() } }),
}));
vi.mock("@/lib/agents/actions", () => ({
  actionHref: (slug: string, id: string) => `/agents?chat=${slug}&action=${id}`,
  writeEventLine: async (sessionId: string, line: Row) => void st.lines.push({ sessionId, ...line }),
}));
vi.mock("@/lib/agents/budget", () => ({
  claimTeammateTurn: async (a: Row) => (st.claims.push(a), st.claim ?? { ok: true, runId: "run1", questionId: "q1" }),
  abandonTurn: async (runId: string) => void st.abandoned.push(runId),
  giveBackTurn: async () => {},
}));
vi.mock("@/lib/agents/engine", () => ({
  getOrCreateTeammateSession: async () => ({ id: "s-cos", created: false }),
  teammateAgentFrom: (r: Row) => r,
  runTeammateTurn: async (a: Row) => (st.turns.push(a), st.turnAnswer ?? { text: "Summary for @Olivia: see [the plan](https://x.test).", error: null, giveBack: false, proposedActionIds: [], messages: [] }),
}));
vi.mock("@/lib/agents/talk-turn", () => ({
  conversationHasGuests: async () => st.guests.shift() ?? false,
  talkContext: async () => [],
  setRequestState: async (messageId: string, state: Row) => void st.states.push({ messageId, ...state }),
  noticeTalkApprovals: async (userId: string, agent: { slug: string }, ids: string[]) =>
    void st.notified.push({ data: { type: "agent_approval", link: `/agents?chat=${agent.slug}&action=${ids[0]}` } }),
  auditTalkAnswer: async () => {},
}));
vi.mock("@/lib/agents/teammate-server", async () => {
  const real = await vi.importActual<typeof import("@/lib/agents/teammate-server")>("@/lib/agents/teammate-server");
  return { ...real, loadTeammate: async (slug: string) => st.teammates[slug] ?? null };
});
vi.mock("@/lib/agents/teammate-tools", async () => {
  const real = await vi.importActual<typeof import("@/lib/agents/teammate-tools")>("@/lib/agents/teammate-tools");
  return { ...real, placeOf: async () => "#proof", talkAudience: async () => 2 };
});

import { POST } from "./route";

const COS: Row = { id: "a-cos", slug: "t-cos", name: "Chief of Staff", status: "ENABLED", organizationId: "org1" };

async function ask(body: Row): Promise<{ status: number; events: Row[]; json: Row | null }> {
  const res = (await POST(new Request("https://app.example.test/api/conversations/c1/teammates", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "c1" }),
  })) as Response;
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) return { status: res.status, events: [], json: await res.json() };
  const text = await res.text();
  return { status: res.status, events: text.split("\n\n").filter((c) => c.startsWith("data: ")).map((c) => JSON.parse(c.slice(6)) as Row), json: null };
}

const ASK = { body: "@Chief of Staff summarise this", teammate: "t-cos", clientId: "temp-12345678" };

beforeEach(() => {
  st.userN += 1;
  st.teammates = { "t-cos": COS };
  st.inserted = [];
  st.already = null;
  st.claims = [];
  st.claim = null;
  st.turns = [];
  st.turnAnswer = null;
  st.guests = [];
  st.states = [];
  st.abandoned = [];
  st.lines = [];
  st.notified = [];
  st.nudged = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("asking a teammate in Talk", () => {
  it("posts the request, runs the turn as the person, and posts the answer as their agent post, pinging nobody", async () => {
    const out = await ask(ASK);
    expect(out.events.map((e) => e.type)).toEqual(["message", "answer"]);
    expect(st.claims).toEqual([expect.objectContaining({ trigger: "TALK", agentId: "a-cos", sessionId: "s-cos", rateLimit: true })]);
    expect(st.inserted[0]).toMatchObject({ body: "@Chief of Staff summarise this", clientId: "temp-12345678", metadata: { teammate: { id: "a-cos", state: "running", runId: "run1" } } });
    expect(st.inserted[1]).toMatchObject({
      membershipId: null,
      clientId: "tm_m1",
      body: "Summary for Olivia: see the plan.",
      metadata: { kind: "agent_post", agent: { id: "a-cos", name: "Chief of Staff" }, replyTo: "m1", runId: "run1", via: "talk" },
    });
    expect(st.turns[0]).toMatchObject({ trigger: "TALK", userText: "@Chief of Staff summarise this", origin: { kind: "talk", conversationId: "c1", messageId: "m1", place: "#proof", audience: 2 } });
    expect(st.states).toEqual([expect.objectContaining({ messageId: "m1", id: "a-cos", state: "answered", answerId: "m2" })]);
    expect(st.lines[0]).toMatchObject({ sessionId: "s-cos", event: "talk_asked", text: "Asked in #proof: @Chief of Staff summarise this", link: { kind: "talk", conversationId: "c1", messageId: "m1" } });
  });

  it("answers another person's private teammate exactly as an unknown one", async () => {
    const hidden = await ask({ ...ASK, teammate: "t-oliv-private" });
    const unknown = await ask({ ...ASK, teammate: "t-nobody" });
    expect(hidden).toEqual(unknown);
    expect(hidden.status).toBe(404);
    expect(st.claims).toEqual([]);
  });

  it("asks only a teammate the words still name", async () => {
    const out = await ask({ ...ASK, body: "summarise this" });
    expect(out).toMatchObject({ status: 400, json: { code: "not_addressed" } });
  });

  it("takes five asks a minute from one person", async () => {
    for (let i = 0; i < 5; i += 1) expect((await ask({ ...ASK, clientId: `temp-0000000${i}` })).status).toBe(200);
    const sixth = await ask({ ...ASK, clientId: "temp-00000009" });
    expect(sixth).toMatchObject({ status: 429, json: { code: "rate_limited" } });
  });

  it("posts nothing when the question is refused", async () => {
    st.claim = { ok: false, code: "ai_limit", message: "This workspace has used all its AI questions." };
    const out = await ask(ASK);
    expect(out).toMatchObject({ status: 403, json: { code: "ai_limit" } });
    expect(st.inserted).toEqual([]);
  });

  it("starts no turn for a message already sent with its key", async () => {
    st.already = { id: "m-old", body: "@Chief of Staff summarise this" };
    const out = await ask(ASK);
    expect(out.events).toEqual([{ type: "message", message: { id: "m-old", body: "@Chief of Staff summarise this" } }]);
    expect(st.claims).toEqual([]);
    expect(st.inserted).toEqual([]);
  });

  it("posts nothing, and says so, when a Guest joined during the turn", async () => {
    st.guests = [false, true];
    const out = await ask(ASK);
    expect(out.events.map((e) => e.type)).toEqual(["message", "no_answer"]);
    expect(st.inserted).toHaveLength(1);
    expect(st.states).toEqual([expect.objectContaining({ state: "no_answer" })]);
    // The open panes are told, or "working on it" stays on every screen.
    expect(st.nudged).toEqual(["c1"]);
  });

  it("refuses where a Guest reads, before anything is spent", async () => {
    st.guests = [true];
    const out = await ask(ASK);
    expect(out).toMatchObject({ status: 403, json: { code: "has_guests" } });
    expect(st.claims).toEqual([]);
  });

  it("writes one Inbox row when the turn asked for something", async () => {
    st.turnAnswer = { text: "", error: null, giveBack: false, proposedActionIds: ["x1", "x2"], messages: [] };
    await ask(ASK);
    expect(st.notified).toEqual([{ data: expect.objectContaining({ type: "agent_approval", link: "/agents?chat=t-cos&action=x1" }) }]);
    expect(st.inserted).toHaveLength(1);
  });

  it("always stops the keep-alive", async () => {
    const cleared = vi.spyOn(globalThis, "clearInterval");
    await ask(ASK);
    expect(cleared).toHaveBeenCalled();
  });
});
