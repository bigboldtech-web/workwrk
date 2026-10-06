// Running one routine (routines-server.ts runRoutine, Run now's path and the
// scheduled runner's): every check comes before anything is spent, each
// refusal says whether a scheduled run pauses or skips, the run acts as the
// routine's own person, a run the AI never answered gives its question back,
// and a practice run leaves the routine as it was. And pausing one writes its
// line once. The engine, the budget and the person are mocked at their
// boundaries.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Update = { where: { id: string; status?: string }; data: Record<string, unknown> };

const s = vi.hoisted(() => ({
  org: { settings: {} } as { settings: unknown } | null,
  agent: null as Record<string, unknown> | null,
  routineStatus: "active",
  updates: [] as Array<{ where: { id: string; status?: string }; data: Record<string, unknown> }>,
  lines: [] as Array<{ sessionId: string | null; line: Record<string, unknown> }>,
  resolveActingPerson: vi.fn(),
  isAiConfigured: vi.fn(),
  getOrCreateTeammateSession: vi.fn(),
  claimTeammateTurn: vi.fn(),
  giveBackTurn: vi.fn(),
  runTeammateTurn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: async () => s.org },
    agent: { findFirst: async () => s.agent },
    agentRoutine: {
      updateMany: async (a: Update) => {
        s.updates.push(a);
        // A pause is a swap from active: only one call makes it.
        if (a.where.status === "active") {
          if (s.routineStatus !== "active") return { count: 0 };
          s.routineStatus = String(a.data.status);
        }
        return { count: 1 };
      },
    },
    chatSession: { findFirst: async () => ({ id: "s1" }) },
  },
}));
vi.mock("@/lib/ai-client", () => ({ isAiConfigured: s.isAiConfigured }));
vi.mock("./acting", () => ({ resolveActingPerson: s.resolveActingPerson }));
vi.mock("./budget", () => ({ claimTeammateTurn: s.claimTeammateTurn, giveBackTurn: s.giveBackTurn }));
vi.mock("./engine", () => ({
  TEAMMATE_AGENT_SELECT: {},
  getOrCreateTeammateSession: s.getOrCreateTeammateSession,
  runTeammateTurn: s.runTeammateTurn,
  teammateAgentFrom: (r: unknown) => r,
}));
vi.mock("./actions", () => ({
  writeEventLine: async (sessionId: string | null, line: Record<string, unknown>) => {
    s.lines.push({ sessionId, line });
    return null;
  },
}));
vi.mock("./autonomous", () => ({ computeNextRunAt: () => new Date("2026-10-07T09:00:00Z") }));

import { pauseRoutine, runRoutine, type RoutineRunRow } from "./routines-server";

const ROUTINE: RoutineRunRow = {
  id: "r1",
  organizationId: "org1",
  agentId: "a1",
  actingForId: "u-max",
  name: "Daily brief",
  prompt: "Tell me my top three.",
  schedule: "CRON_TZ=UTC 0 9 * * 1-5",
  status: "active",
};

const VIEWER = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false, adminScopes: [] };
const PERSON = { userId: "u-max", organizationId: "org1", name: "Max Chen", firstName: "Max", timezone: "UTC", viewer: VIEWER };
const DUE = new Date("2026-10-06T09:00:00Z");
const NOW = new Date("2026-10-06T09:02:00Z");

function agent(o: Record<string, unknown> = {}) {
  return { id: "a1", slug: "planner", name: "Planner", organizationId: "org1", status: "ENABLED", visibility: "WORKSPACE", ownerId: null, toolNames: [], ...o };
}

function turn(o: Record<string, unknown> = {}) {
  return { assistantMessageId: "m-report", approvalMessageId: null, proposedActionIds: [], text: "Top three.", failedBeforeAnything: false, tokensIn: 1, tokensOut: 1, error: null, messages: [], ...o };
}

const run = (o: { practice?: boolean; rateLimit?: boolean } = {}) => runRoutine(ROUTINE, { practice: false, rateLimit: false, dueAt: DUE, now: NOW, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  s.org = { settings: {} };
  s.agent = agent();
  s.routineStatus = "active";
  s.updates = [];
  s.lines = [];
  s.resolveActingPerson.mockResolvedValue({ ok: true, person: PERSON });
  s.isAiConfigured.mockResolvedValue(true);
  s.getOrCreateTeammateSession.mockResolvedValue({ id: "s1", created: false });
  s.claimTeammateTurn.mockResolvedValue({ ok: true, runId: "run1", questionId: "q1" });
  s.runTeammateTurn.mockResolvedValue(turn());
});

describe("runRoutine", () => {
  it("runs as the routine's own person, then records the run", async () => {
    const out = await run({ rateLimit: true });
    expect(out).toMatchObject({ ok: true, runId: "run1", sessionId: "s1", status: "SUCCEEDED", reason: null, messageId: "m-report", personId: "u-max" });
    expect(s.resolveActingPerson).toHaveBeenCalledWith("org1", "u-max");
    expect(s.claimTeammateTurn).toHaveBeenCalledWith({
      organizationId: "org1",
      agentId: "a1",
      userId: "u-max",
      what: "AI teammate routine",
      trigger: "ROUTINE",
      sessionId: "s1",
      routineId: "r1",
      practice: false,
      rateLimit: true,
    });
    expect(s.runTeammateTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        person: PERSON,
        sessionId: "s1",
        trigger: "ROUTINE",
        userText: null,
        practice: false,
        routine: { id: "r1", name: "Daily brief", prompt: "Tell me my top three.", dueAt: DUE },
        runId: "run1",
        questionId: "q1",
        streaming: false,
      }),
    );
    expect(s.updates).toEqual([{ where: { id: "r1" }, data: { lastRunAt: NOW, lastRunId: "run1", lastStatus: "SUCCEEDED", lastReason: null } }]);
    expect(s.giveBackTurn).not.toHaveBeenCalled();
  });

  const REFUSALS: Array<[string, () => void, string, boolean]> = [
    ["the workspace turned AI off", () => (s.org = { settings: { data: { aiEnabled: false } } }), "ai_off", false],
    ["the teammate is gone", () => (s.agent = null), "agent_removed", true],
    ["the teammate was removed", () => (s.agent = agent({ status: "ARCHIVED" })), "agent_removed", true],
    ["the teammate is paused", () => (s.agent = agent({ status: "DISABLED" })), "agent_paused", false],
    ["the person was deactivated", () => s.resolveActingPerson.mockResolvedValue({ ok: false, reason: "inactive" }), "person_gone", true],
    ["the person is a Guest now", () => s.resolveActingPerson.mockResolvedValue({ ok: false, reason: "guest" }), "guest", true],
    ["the teammate is someone else's", () => (s.agent = agent({ visibility: "PRIVATE", ownerId: "u-lea" })), "no_access", true],
    ["AI isn't set up", () => s.isAiConfigured.mockResolvedValue(false), "not_configured", false],
  ];
  for (const [why, arrange, reason, pause] of REFUSALS) {
    it(`claims nothing when ${why} (${reason}, ${pause ? "pause" : "skip"})`, async () => {
      arrange();
      const out = await run();
      expect(out).toMatchObject({ ok: false, reason, pause });
      expect(s.claimTeammateTurn).not.toHaveBeenCalled();
      expect(s.runTeammateTurn).not.toHaveBeenCalled();
      expect(s.updates).toEqual([]);
    });
  }

  it("passes on the claim's refusals: the teammate's month skips, the plan's questions pause, the per-minute limit is Run now's", async () => {
    s.claimTeammateTurn.mockResolvedValueOnce({ ok: false, code: "agent_cap", message: "Planner has used its 40 AI questions for October." });
    expect(await run()).toEqual({ ok: false, reason: "agent_cap", message: "Planner has used its 40 AI questions for October.", pause: false });
    s.claimTeammateTurn.mockResolvedValueOnce({ ok: false, code: "ai_limit", message: "This workspace has used all 50 AI questions on the Starter plan." });
    expect(await run()).toMatchObject({ ok: false, reason: "out_of_questions", pause: true });
    s.claimTeammateTurn.mockResolvedValueOnce({ ok: false, code: "rate_limited", message: "Too many AI requests at once. Try again in 9 seconds.", retryAfter: 9 });
    expect(await run({ rateLimit: true })).toMatchObject({ ok: false, reason: "rate_limited", retryAfter: 9, pause: false });
    expect(s.runTeammateTurn).not.toHaveBeenCalled();
    expect(s.updates).toEqual([]);
  });

  it("gives the question back when the AI never answered, and records the run as failed", async () => {
    s.runTeammateTurn.mockResolvedValueOnce(turn({ assistantMessageId: null, text: "", failedBeforeAnything: true, error: "The AI service didn't answer. Try again." }));
    const out = await run();
    expect(out).toMatchObject({ ok: true, status: "FAILED", reason: "ai_failed", messageId: null });
    expect(s.giveBackTurn).toHaveBeenCalledWith("run1", "q1");
    expect(s.updates[0].data).toMatchObject({ lastStatus: "FAILED", lastReason: "ai_failed", lastRunId: "run1" });
  });

  it("leaves the routine as it was after a practice run", async () => {
    const out = await run({ practice: true });
    expect(out).toMatchObject({ ok: true, status: "SUCCEEDED" });
    expect(s.claimTeammateTurn).toHaveBeenCalledWith(expect.objectContaining({ practice: true }));
    expect(s.runTeammateTurn).toHaveBeenCalledWith(expect.objectContaining({ practice: true }));
    expect(s.updates).toEqual([]);
  });
});

describe("pauseRoutine", () => {
  it("pauses once, with its line in the person's chat", async () => {
    expect(await pauseRoutine(ROUTINE, "agent_removed")).toBe(true);
    expect(await pauseRoutine(ROUTINE, "agent_removed")).toBe(false);
    expect(s.updates.map((u) => u.data)).toEqual([
      { status: "paused", pausedReason: "agent_removed", nextRunAt: null },
      { status: "paused", pausedReason: "agent_removed", nextRunAt: null },
    ]);
    expect(s.lines).toEqual([
      { sessionId: "s1", line: { text: "Routine paused: Daily brief. This teammate was removed.", event: "routine_paused", routineId: "r1" } },
    ]);
  });
});
