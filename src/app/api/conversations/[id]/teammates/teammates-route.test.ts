// POST /api/conversations/[id]/teammates (docs/plans/ai-teammates-phase2.md
// step 6): another person's private teammate answers as an unknown one; five
// asks a minute; a refused claim posts nothing; a message already sent with
// its key starts no turn; the answer is posted as the person's agent post,
// pinging nobody, under its own key; a Guest who joined during the turn
// means nothing is posted; the keep-alive always stops.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  /** The runs whose question went back (giveBackTurn). */
  givenBack: [] as string[],
  /** Runs while the turn runs. */
  duringTurn: null as null | (() => void),
  /** Whether the person can still be acted for. */
  actingOk: true,
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
  removed: [] as string[],
  insertThrows: false,
  readerIds: ["u-olivia", "u-sam"] as string[],
  tooMany: false,
  readerQueue: [] as Array<{ ids: string[]; tooMany: boolean }>,
  afterSent: [] as Row[],
  userN: 0,
  convType: "CHANNEL" as "CHANNEL" | "GROUP" | "DM",
  audits: [] as Row[],
}));

const conversation = () => ({ id: "c1", type: st.convType, name: st.convType === "DM" ? null : "proof", restricted: true, archivedAt: null });
const viewerFor = () => ({ userId: `u-${st.userN}`, organizationId: "org1", orgRole: "MEMBER", isAgent: false });

vi.mock("@/lib/talk-gate", () => ({
  requireConversation: async () => ({
    ctx: { conversation: conversation(), viewer: { userId: `u-${st.userN}`, orgRole: "MEMBER", isMember: true }, membershipId: "mem1", role: "edit", gate: { userId: `u-${st.userN}`, organizationId: "org1" } },
  }),
  loadConversationRole: async () => ({ conversation: conversation(), viewer: { userId: `u-${st.userN}`, orgRole: "MEMBER", isMember: true }, role: "edit" }),
}));
vi.mock("@/lib/talk-access", () => ({ canPost: () => true }));
vi.mock("@/lib/app-gate", () => ({ requireApp: async () => ({ viewer: viewerFor() }) }));
vi.mock("@/lib/ai-client", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => {}, publishToConversation: (id: string) => void st.nudged.push(id) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationMessage: {
      // A thread's parent (a top-level message here), else the message already sent with this key.
      findFirst: async (a: { where: { id?: string; parentId?: null } }) => (a.where.id && a.where.parentId === null ? { id: a.where.id } : st.already),
      findMany: async () => [],
      // A removed message is soft-deleted: only a read that leaves deleted rows out stops counting it (review round 6).
      count: async (a: { where: { id: { in: string[] }; conversationId?: string; deletedAt?: null } }) =>
        a.where.conversationId === "c1" ? a.where.id.in.filter((x) => a.where.deletedAt !== null || !st.removed.includes(x)).length : 0,
    },
    conversationMember: { findMany: async () => [] },
    agentAction: { findFirst: async () => null },
    notification: { create: async (a: Row) => void st.notified.push(a) },
  },
}));
vi.mock("@/lib/talk-post", () => ({
  insertConversationMessage: async (a: Row) => {
    if (st.insertThrows) throw new Error("connection reset");
    st.inserted.push(a);
    return { ok: true, message: { id: `m${st.inserted.length}`, createdAt: new Date("2026-10-07T10:00:00Z"), body: a.body, metadata: a.metadata } };
  },
  afterMessageSent: async (a: Row) => void st.afterSent.push(a),
}));
vi.mock("@/lib/agents/acting", () => ({
  resolveActingPerson: async () => (st.actingOk ? { ok: true, person: { userId: `u-${st.userN}`, organizationId: "org1", firstName: "Max", name: "Max Chen", viewer: viewerFor() } } : { ok: false, reason: "inactive" }),
}));
vi.mock("@/lib/agents/actions", () => ({
  actionHref: (slug: string, id: string) => `/agents?chat=${slug}&action=${id}`,
  writeEventLine: async (sessionId: string, line: Row) => void st.lines.push({ sessionId, ...line }),
}));
vi.mock("@/lib/agents/budget", () => ({
  claimTeammateTurn: async (a: Row) => (st.claims.push(a), st.claim ?? { ok: true, runId: "run1", questionId: "q1" }),
  abandonTurn: async (runId: string) => void st.abandoned.push(runId),
  giveBackTurn: async (runId: string) => void st.givenBack.push(runId),
}));
vi.mock("@/lib/agents/engine", () => ({
  getOrCreateTeammateSession: async () => ({ id: "s-cos", created: false }),
  teammateAgentFrom: (r: Row) => r,
  runTeammateTurn: async (a: Row) => (st.turns.push(a), st.duringTurn?.(), st.turnAnswer ?? { text: "Summary for @Olivia: see [the plan](https://x.test).", error: null, giveBack: false, proposedActionIds: [], messages: [] }),
}));
vi.mock("@/lib/agents/talk-turn", () => ({
  conversationHasGuests: async () => st.guests.shift() ?? false,
  conversationReaderIds: async () => st.readerQueue.shift() ?? { ids: st.readerIds, tooMany: st.tooMany },
  talkContext: async () => [],
  setRequestState: async (messageId: string, state: Row) => void st.states.push({ messageId, ...state }),
  noticeTalkApprovals: async (userId: string, agent: { slug: string }, ids: string[]) =>
    void st.notified.push({ data: { type: "agent_approval", link: `/agents?chat=${agent.slug}&action=${ids[0]}` } }),
  auditTalkAnswer: async (a: Row) => void st.audits.push(a),
  recordTalkOutcome: async () => {},
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
  st.givenBack = [];
  st.duringTurn = null;
  st.actingOk = true;
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
  st.removed = [];
  st.insertThrows = false;
  st.readerIds = ["u-olivia", "u-sam"];
  st.tooMany = false;
  st.readerQueue = [];
  st.afterSent = [];
  st.convType = "CHANNEL";
  st.audits = [];
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
    // Who was here when it posted, the asker first: nobody added later reads it (review round 1).
    expect((st.inserted[1].metadata as Row).readers).toEqual([`u-${st.userN}`, "u-olivia", "u-sam"]);
    expect(st.turns[0]).toMatchObject({ trigger: "TALK", userText: "@Chief of Staff summarise this", origin: { kind: "talk", conversationId: "c1", messageId: "m1", place: "#proof", placeKind: "channel", audience: 2 } });
    expect(st.states).toEqual([expect.objectContaining({ messageId: "m1", id: "a-cos", state: "answered", answerId: "m2" })]);
    expect(st.lines[0]).toMatchObject({ sessionId: "s-cos", event: "talk_asked", text: "Asked in #proof: @Chief of Staff summarise this", link: { kind: "talk", conversationId: "c1", messageId: "m1" } });
  });

  it("records a direct message's answer for admins in the third person (review round 4)", async () => {
    await ask(ASK);
    expect(st.audits.at(-1)).toMatchObject({ what: "Answered in #proof" });
    st.convType = "DM";
    await ask({ ...ASK, clientId: "temp-dm000001" });
    expect(st.audits.at(-1)).toMatchObject({ what: "Answered in a direct message" });
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

  it("gives the question back when nothing came back, and only then (review round 6)", async () => {
    st.turnAnswer = { text: "", error: "The AI service didn't answer. Try again.", giveBack: true, proposedActionIds: [], messages: [] };
    await ask(ASK);
    expect(st.givenBack).toEqual(["run1"]);
    st.givenBack = [];
    st.turnAnswer = null;
    await ask({ ...ASK, clientId: "temp-answered1" });
    expect(st.givenBack).toEqual([]);
  });

  it("writes one Inbox row when the turn asked for something", async () => {
    st.turnAnswer = { text: "", error: null, giveBack: false, proposedActionIds: ["x1", "x2"], messages: [] };
    await ask(ASK);
    expect(st.notified).toEqual([{ data: expect.objectContaining({ type: "agent_approval", link: "/agents?chat=t-cos&action=x1" }) }]);
    expect(st.inserted).toHaveLength(1);
  });

  it("posts nothing when the thread's first message was removed during the turn (review round 6)", async () => {
    st.removed = ["p1"];
    const out = await ask({ ...ASK, parentId: "p1" });
    expect(out.events.map((e) => e.type)).toEqual(["message", "no_answer"]);
    expect(st.inserted).toHaveLength(1);
  });

  it("posts nothing as the person when they were deactivated, or the teammate removed or paused, during the turn (review round 7)", async () => {
    st.duringTurn = () => void (st.actingOk = false);
    expect((await ask(ASK)).events.map((e) => e.type)).toEqual(["message", "no_answer"]);
    st.actingOk = true;
    st.duringTurn = () => void (st.teammates["t-cos"] = { ...COS, status: "DISABLED" });
    expect((await ask({ ...ASK, clientId: "temp-paused01" })).events.map((e) => e.type)).toEqual(["message", "no_answer"]);
    st.duringTurn = () => void (st.teammates["t-cos"] = null);
    st.teammates["t-cos"] = COS;
    expect((await ask({ ...ASK, clientId: "temp-removed1" })).events.map((e) => e.type)).toEqual(["message", "no_answer"]);
    // Only the requests: no answer was posted.
    expect(st.inserted.every((m) => (m.metadata as Row | undefined)?.kind !== "agent_post")).toBe(true);
  });

  it("posts nothing when the person removed the request during the turn (review of step 6)", async () => {
    st.removed = ["m1"];
    const out = await ask(ASK);
    expect(out.events.map((e) => e.type)).toEqual(["message", "no_answer"]);
    expect(st.inserted).toHaveLength(1);
    expect(st.states).toEqual([expect.objectContaining({ messageId: "m1", state: "no_answer" })]);
  });

  it("never posts a half answer: a turn cut short or declined stays in the person's chat", async () => {
    st.turnAnswer = { text: "Here is the first half of", error: "The answer was cut short.", giveBack: false, proposedActionIds: [], messages: [] };
    const out = await ask(ASK);
    expect(out.events.map((e) => e.type)).toEqual(["message", "no_answer"]);
    expect(st.inserted).toHaveLength(1);
  });

  it("gives the question back when the request cannot be saved", async () => {
    st.insertThrows = true;
    const out = await ask(ASK);
    expect(out).toMatchObject({ status: 500, json: { code: "not_saved" } });
    expect(st.abandoned).toEqual(["run1"]);
    expect(st.turns).toEqual([]);
  });

  it("refuses a key whose message was removed, as a plain send does", async () => {
    st.already = { id: "m-old", body: "@Chief of Staff summarise this", deletedAt: new Date("2026-10-07T10:00:00Z") };
    const out = await ask(ASK);
    expect(out).toMatchObject({ status: 409, json: { code: "removed" } });
    expect(st.claims).toEqual([]);
  });

  it("spends none of the per-minute limit on a message that already landed", async () => {
    for (let i = 0; i < 5; i += 1) expect((await ask({ ...ASK, clientId: `temp-1000000${i}` })).status).toBe(200);
    st.already = { id: "m-old", body: "@Chief of Staff summarise this" };
    const again = await ask(ASK);
    expect(again.events).toEqual([{ type: "message", message: { id: "m-old", body: "@Chief of Staff summarise this" } }]);
  });

  it("posts nothing when someone joined during the turn: its context was checked against who was here (review round 2)", async () => {
    st.readerQueue = [{ ids: ["u-olivia"], tooMany: false }, { ids: ["u-olivia", "u-eve"], tooMany: false }];
    const out = await ask(ASK);
    expect(out.events.map((e) => e.type)).toEqual(["message", "no_answer"]);
    expect(st.inserted).toHaveLength(1);
  });

  it("sends the answer's Inbox notices to its readers only (review round 2)", async () => {
    await ask(ASK);
    expect(st.afterSent.at(-1)).toMatchObject({ onlyUserIds: [`u-${st.userN}`, "u-olivia", "u-sam"] });
    // Naming the teammate, never the person alone (review round 7); the request itself is the person's own.
    expect(st.afterSent.at(-1)).toMatchObject({ senderLabel: "Chief of Staff for Max Chen" });
    expect(st.afterSent[0]).not.toHaveProperty("senderLabel");
  });

  it("is asked only where at most 250 people read, and posts nothing past it", async () => {
    st.tooMany = true;
    expect(await ask(ASK)).toMatchObject({ status: 403, json: { code: "too_many_people" } });
    expect(st.claims).toEqual([]);
  });

  it("answers a key that already landed before any refusal, as a plain send does", async () => {
    st.already = { id: "m-old", body: "@Chief of Staff summarise this" };
    st.guests = [true];
    st.teammates = {};
    const out = await ask(ASK);
    expect(out.events).toEqual([{ type: "message", message: { id: "m-old", body: "@Chief of Staff summarise this" } }]);
  });

  it("always stops the keep-alive", async () => {
    const cleared = vi.spyOn(globalThis, "clearInterval");
    await ask(ASK);
    expect(cleared).toHaveBeenCalled();
  });
});
