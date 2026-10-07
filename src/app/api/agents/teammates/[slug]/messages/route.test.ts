// POST /api/agents/teammates/[slug]/messages (docs/plans/ai-teammates.md 4):
// the chat's order. Nothing is claimed for a paused or removed teammate, for
// a workspace without AI set up, or for a person a teammate may not act for;
// the question is claimed before the message is saved, and the turn reads
// that saved row; a turn that failed before anything gives its question
// back; a continue with nothing new gives it back and runs no turn; and the
// turn runs to the end when the client goes away. The engine, the budget and
// the queue are mocked at their boundaries; the database is the routes'
// in-memory double.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/agents/teammate-route-fixtures")).routeDb }));
vi.mock("@/lib/app-gate", async () => (await import("@/lib/agents/teammate-route-fixtures")).appGateFake);
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => true }));

type TurnArgs = {
  trigger: string;
  userText: string | null;
  userMessageId?: string | null;
  practice: boolean;
  runId: string;
  questionId: string;
  sessionId: string;
  streaming: boolean;
  outcomes?: unknown[];
  emit?: (e: Record<string, unknown>) => void;
};
type TurnOut = { failedBeforeAnything: boolean; giveBack: boolean; error: string | null; messages: unknown[] };

const m = vi.hoisted(() => ({
  order: [] as string[],
  isAiConfigured: vi.fn(async () => true),
  resolveActingPerson: vi.fn(),
  getOrCreateTeammateSession: vi.fn(),
  claimTeammateTurn: vi.fn(),
  giveBackTurn: vi.fn(),
  claimUnreportedOutcomes: vi.fn(),
  runTeammateTurn: vi.fn(),
}));
vi.mock("@/lib/ai-client", () => ({ isAiConfigured: m.isAiConfigured }));
vi.mock("@/lib/agents/acting", () => ({ resolveActingPerson: m.resolveActingPerson, personZone: async () => "UTC" }));
vi.mock("@/lib/agents/engine", () => ({
  getOrCreateTeammateSession: m.getOrCreateTeammateSession,
  runTeammateTurn: m.runTeammateTurn,
  teammateAgentFrom: (r: unknown) => r,
}));
vi.mock("@/lib/agents/budget", () => ({
  claimTeammateTurn: m.claimTeammateTurn,
  giveBackTurn: m.giveBackTurn,
  // budget.ts abandonTurn, over the mocked give-back and the route's database double.
  abandonTurn: async (runId: string, questionId: string) => {
    await m.giveBackTurn(runId, questionId);
    const { routeDb } = await import("@/lib/agents/teammate-route-fixtures");
    await (routeDb.agentRun as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { id: runId, questionId: null } }).catch(() => {});
  },
  agentMonthUsage: async () => ({ used: 0, monthStart: new Date("2026-10-01T00:00:00Z") }),
}));
vi.mock("@/lib/agents/actions", () => ({ claimUnreportedOutcomes: m.claimUnreportedOutcomes, actionViews: async () => ({}) }));

import { POST } from "./route";
import { PEOPLE, db, jsonRequest, paramsOf, resetRouteDb, routeDb, seedAgent } from "@/lib/agents/teammate-route-fixtures";

const SLUG = "t-planner-aaaaaa";
const PERSON = { userId: "u-max", organizationId: "org1", name: "Max Chen", firstName: "Max", timezone: "UTC" };
const ANSWER = { id: "m-answer", kind: "agent", createdAt: "2026-10-06T09:00:00.000Z", text: "Done.", practice: false, toolCalls: [] };

function send(body: unknown) {
  return POST(jsonRequest("POST", body), paramsOf({ slug: SLUG }));
}

/** The stream's events, one JSON object per `data:` line. */
async function events(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

function turnReturns(out: Partial<TurnOut>) {
  m.runTeammateTurn.mockImplementation(async (a: TurnArgs) => {
    m.order.push("turn");
    a.emit?.({ type: "text_delta", text: "Done." });
    return { assistantMessageId: "m-answer", approvalMessageId: null, proposedActionIds: [], text: "Done.", tokensIn: 10, tokensOut: 5, failedBeforeAnything: false, error: null, messages: [ANSWER], ...out };
  });
}

beforeEach(() => {
  resetRouteDb();
  vi.clearAllMocks();
  m.order.length = 0;
  seedAgent({ slug: SLUG, name: "Planner", visibility: "PRIVATE", ownerId: "u-max" });
  db.viewer = PEOPLE.max;
  db.runs.push({ id: "run1", questionId: "q1" });
  m.isAiConfigured.mockResolvedValue(true);
  m.resolveActingPerson.mockResolvedValue({ ok: true, person: PERSON });
  m.getOrCreateTeammateSession.mockImplementation(async () => {
    m.order.push("session");
    return { id: "s1", created: false };
  });
  m.claimTeammateTurn.mockImplementation(async () => {
    m.order.push(`claim (messages: ${db.messages.length})`);
    return { ok: true, runId: "run1", questionId: "q1" };
  });
  // Giving a question back clears the run's questionId, as budget.ts does.
  m.giveBackTurn.mockImplementation(async (runId: string) => {
    m.order.push("give back");
    for (const r of db.runs) if (r.id === runId) r.questionId = null;
  });
  m.claimUnreportedOutcomes.mockImplementation(async () => {
    m.order.push("outcomes");
    return [];
  });
  turnReturns({});
});

describe("nothing is claimed before the teammate can answer", () => {
  it("refuses a paused teammate, and claims nothing", async () => {
    db.agents[0].status = "DISABLED";
    const res = await send({ message: "Hello" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Planner is paused, so your message wasn't sent.", code: "agent_paused" });
    expect(m.getOrCreateTeammateSession).not.toHaveBeenCalled();
    expect(m.claimTeammateTurn).not.toHaveBeenCalled();
    expect(routeDb.writes).toEqual([]);
  });

  it("refuses a removed teammate, and claims nothing", async () => {
    db.agents[0].status = "ARCHIVED";
    const res = await send({ message: "Hello" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Planner was removed. Its chat is kept.", code: "agent_removed" });
    expect(m.claimTeammateTurn).not.toHaveBeenCalled();
  });

  it("answers 503 when AI isn't set up, and claims nothing", async () => {
    m.isAiConfigured.mockResolvedValue(false);
    const res = await send({ message: "Hello" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "AI isn't set up for this workspace yet.", code: "not_configured" });
    expect(m.claimTeammateTurn).not.toHaveBeenCalled();
  });

  it("refuses a person a teammate may not act for, and claims nothing", async () => {
    m.resolveActingPerson.mockResolvedValue({ ok: false, reason: "gone" });
    const res = await send({ message: "Hello" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("person_cannot");
    expect(m.claimTeammateTurn).not.toHaveBeenCalled();
  });

  it("takes a message with words in it, or a continue, never both", async () => {
    for (const body of [{}, { message: "   " }, { message: "Hi", resume: true }, { resume: false }, null]) {
      const res = await send(body);
      expect(res.status).toBe(400);
    }
    expect(m.claimTeammateTurn).not.toHaveBeenCalled();
  });

  it("passes on the claim's refusals with their sentences, and saves nothing", async () => {
    m.claimTeammateTurn.mockResolvedValueOnce({ ok: false, code: "rate_limited", message: "Too many AI requests at once. Try again in 12 seconds.", retryAfter: 12 });
    const limited = await send({ message: "Hello" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("12");
    expect(await limited.json()).toEqual({ error: "Too many AI requests at once. Try again in 12 seconds.", code: "rate_limited" });

    m.claimTeammateTurn.mockResolvedValueOnce({ ok: false, code: "agent_cap", message: "Planner has used its 40 AI questions for October." });
    expect(await (await send({ message: "Hello" })).json()).toEqual({ error: "Planner has used its 40 AI questions for October.", code: "agent_cap" });

    m.claimTeammateTurn.mockResolvedValueOnce({ ok: false, code: "ai_limit", message: "This workspace has used all 50 AI questions on the Starter plan." });
    const out = await send({ message: "Hello" });
    expect(out.status).toBe(403);
    expect((await out.json()).code).toBe("ai_limit");

    expect(db.messages).toEqual([]);
    expect(m.runTeammateTurn).not.toHaveBeenCalled();
  });
});

describe("a message", () => {
  it("claims the question, then saves the message, then runs the turn on that row", async () => {
    const res = await send({ message: "Make a task to call Acme", practice: true });
    expect(res.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    const got = await events(res);
    expect(m.order).toEqual(["session", "claim (messages: 0)", "turn"]);
    expect(m.claimTeammateTurn).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "a-t-planner-aaaaaa", userId: "u-max", what: "AI teammate message", trigger: "CHAT", sessionId: "s1", practice: true, rateLimit: true }),
    );
    expect(db.messages).toEqual([expect.objectContaining({ sessionId: "s1", role: "USER", content: "Make a task to call Acme", meta: { practice: true } })]);
    const saved = db.messages[0];
    const args = m.runTeammateTurn.mock.calls[0][0] as TurnArgs;
    expect(args).toMatchObject({ trigger: "CHAT", userText: "Make a task to call Acme", userMessageId: saved.id, practice: true, runId: "run1", questionId: "q1", sessionId: "s1", streaming: true, outcomes: [] });

    expect(got.map((e) => e.type)).toEqual(["user_message", "text_delta", "done"]);
    expect(got[0].message).toMatchObject({ id: saved.id, kind: "user", practice: true, text: "Make a task to call Acme" });
    expect(got[2]).toEqual({ type: "done", messages: [ANSWER], error: null });
    // It answered: the question is kept.
    expect(m.giveBackTurn).not.toHaveBeenCalled();
  });

  it("keeps the question when the model answered but nothing came of it (a refusal, an empty answer)", async () => {
    // Before: any turn with nothing to show gave its question back, so a
    // script could buy refused or cut-off answers for nothing.
    turnReturns({ failedBeforeAnything: true, giveBack: false, error: "The AI declined to answer that.", messages: [] });
    await events(await send({ message: "Hello" }));
    expect(m.giveBackTurn).not.toHaveBeenCalled();
  });

  it("gives the question back when the model never answered", async () => {
    turnReturns({ failedBeforeAnything: true, giveBack: true, error: "The AI service didn't answer. Try again.", messages: [] });
    const got = await events(await send({ message: "Hello" }));
    expect(m.giveBackTurn).toHaveBeenCalledWith("run1", "q1");
    expect(got.at(-1)).toEqual({ type: "done", messages: [], error: "The AI service didn't answer. Try again." });
    // The person's message stays in the chat; only the question goes back.
    expect(db.messages).toHaveLength(1);
  });

  it("runs the turn to the end, and still gives back a failed one, when the client goes away", async () => {
    let finish: (out: Record<string, unknown>) => void = () => {};
    m.runTeammateTurn.mockImplementation(
      (a: TurnArgs) =>
        new Promise((resolve) => {
          finish = (out) => {
            // The engine keeps emitting into a closed stream.
            a.emit?.({ type: "text_delta", text: "late" });
            resolve({ assistantMessageId: null, approvalMessageId: null, proposedActionIds: [], text: "", tokensIn: 0, tokensOut: 0, messages: [], ...out });
          };
        }),
    );
    const res = await send({ message: "Hello" });
    await res.body?.cancel();
    expect(m.runTeammateTurn).toHaveBeenCalledTimes(1);
    finish({ failedBeforeAnything: true, giveBack: true, error: "The AI service didn't answer. Try again." });
    await vi.waitFor(() => expect(m.giveBackTurn).toHaveBeenCalledWith("run1", "q1"));
  });
});

describe("a continue", () => {
  it("gives the question back and runs no turn when nothing new was decided", async () => {
    const res = await send({ resume: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "There's nothing new to continue from.", code: "nothing_to_continue" });
    expect(m.order).toEqual(["session", "claim (messages: 0)", "outcomes", "give back"]);
    expect(m.claimTeammateTurn).toHaveBeenCalledWith(expect.objectContaining({ trigger: "RESUME", what: "AI teammate continue", practice: false }));
    expect(m.runTeammateTurn).not.toHaveBeenCalled();
    // The run that never ran is not left behind in the history.
    expect(db.runs).toEqual([]);
    expect(db.messages).toEqual([]);
  });

  it("hands the outcomes it claimed to the turn, and saves no message", async () => {
    const decided = { id: "act1", toolName: "post_in_talk", risk: "OUTWARD", status: "EXECUTED", preview: { title: "Post in #general" }, createdAt: new Date(), expiresAt: new Date() };
    m.claimUnreportedOutcomes.mockResolvedValueOnce([decided]);
    const got = await events(await send({ resume: true }));
    const args = m.runTeammateTurn.mock.calls[0][0] as TurnArgs;
    expect(args).toMatchObject({ trigger: "RESUME", userText: null, userMessageId: null, practice: false, outcomes: [decided] });
    expect(db.messages).toEqual([]);
    expect(got.map((e) => e.type)).toEqual(["text_delta", "done"]);
    expect(m.giveBackTurn).not.toHaveBeenCalled();
  });
});
