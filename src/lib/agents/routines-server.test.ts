// Running one routine (routines-server.ts runRoutine, Run now's path and the
// scheduled runner's): every check comes before anything is spent, each
// refusal says whether a scheduled run pauses or skips, the run acts as the
// routine's own person, a run the AI never answered gives its question back,
// and a practice run leaves the routine as it was. Pausing one writes its
// line and its Inbox row once. And the scheduled runner (processDueRoutines)
// claims each slot once, skips a stale one, pauses or skips as the refusal
// says, runs the routine as a ROUTINE turn for its slot, writes one approval
// notice per run that asked for something, and starts nothing past its
// budget. The engine, the budget and the person are mocked at their
// boundaries; the routines are a small table.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Update = { where: { id: string; status?: string; nextRunAt?: Date | null }; data: Record<string, unknown> };
type RoutineRow = Record<string, unknown> & { id: string; status: string; nextRunAt: Date | null };

const s = vi.hoisted(() => ({
  org: { settings: {} } as { settings: unknown } | null,
  agent: null as Record<string, unknown> | null,
  routines: new Map<string, Record<string, unknown> & { id: string; status: string; nextRunAt: Date | null }>(),
  updates: [] as Array<{ where: { id: string; status?: string; nextRunAt?: Date | null }; data: Record<string, unknown> }>,
  lines: [] as Array<{ sessionId: string | null; line: Record<string, unknown> }>,
  notifications: [] as Array<Record<string, unknown>>,
  published: [] as Array<{ userId: string; event: unknown }>,
  firstAction: null as Record<string, unknown> | null,
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
      // The runner's read: active, due by `lte`, oldest slot first, at most `take`. Copies, as a database hands back.
      findMany: async (a: { where: { status: string; nextRunAt: { lte: Date } }; take: number }) =>
        [...s.routines.values()]
          .filter((r) => r.status === a.where.status && r.nextRunAt !== null && r.nextRunAt.getTime() <= a.where.nextRunAt.lte.getTime())
          .sort((x, y) => x.nextRunAt!.getTime() - y.nextRunAt!.getTime() || x.id.localeCompare(y.id))
          .slice(0, a.take)
          .map((r) => ({ ...r })),
      // Every condition in the where must hold, so a swap changes one row once.
      updateMany: async (a: Update) => {
        s.updates.push(a);
        const row = s.routines.get(a.where.id);
        if (!row) return { count: 0 };
        if (a.where.status !== undefined && row.status !== a.where.status) return { count: 0 };
        if (a.where.nextRunAt !== undefined && row.nextRunAt?.getTime() !== a.where.nextRunAt?.getTime()) return { count: 0 };
        Object.assign(row, a.data);
        return { count: 1 };
      },
    },
    chatSession: { findFirst: async () => ({ id: "s1" }) },
    agentAction: { findFirst: async () => s.firstAction },
    notification: {
      create: async (a: { data: Record<string, unknown> }) => {
        s.notifications.push(a.data);
        return { id: `n${s.notifications.length}` };
      },
    },
  },
}));
vi.mock("@/lib/realtime-bus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/realtime-bus")>()),
  publishToUser: (userId: string, event: unknown) => void s.published.push({ userId, event }),
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
  // actions.ts actionHref's shape (actions.test.ts holds it).
  actionHref: (slug: string, id: string) => `/agents?chat=${encodeURIComponent(slug)}&action=${encodeURIComponent(id)}`,
  writeEventLine: async (sessionId: string | null, line: Record<string, unknown>) => {
    s.lines.push({ sessionId, line });
    return { id: `line${s.lines.length}` };
  },
}));
vi.mock("./autonomous", () => ({ computeNextRunAt: () => new Date("2026-10-07T09:00:00Z") }));

import { pauseRoutine, processDueRoutines, routinesHref, runRoutine, type RoutineRunRow } from "./routines-server";

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
const NEXT = new Date("2026-10-07T09:00:00Z");
const RUNNER = { limit: 20, budgetMs: 180_000, concurrency: 4 };

function agent(o: Record<string, unknown> = {}) {
  return { id: "a1", slug: "planner", name: "Planner", organizationId: "org1", status: "ENABLED", visibility: "WORKSPACE", ownerId: null, toolNames: [], ...o };
}

function turn(o: Record<string, unknown> = {}) {
  return { assistantMessageId: "m-report", approvalMessageId: null, proposedActionIds: [], text: "Top three.", failedBeforeAnything: false, tokensIn: 1, tokensOut: 1, error: null, messages: [], ...o };
}

/** A routine in the table, due at DUE unless told otherwise. */
function seedRoutine(o: Partial<RoutineRow> = {}): RoutineRow {
  const row: RoutineRow = { ...ROUTINE, nextRunAt: DUE, lastRunAt: null, lastRunId: null, lastStatus: null, lastReason: null, pausedReason: null, ...o };
  s.routines.set(row.id, row);
  return row;
}

const run = (o: { practice?: boolean; rateLimit?: boolean } = {}) => runRoutine(ROUTINE, { practice: false, rateLimit: false, dueAt: DUE, now: NOW, ...o });

const CHANGED = { userId: "u-max", event: { type: "agent.changed", agentId: "a1" } };
const NOTIFIED = { userId: "u-max", event: { type: "notification" } };

beforeEach(() => {
  vi.clearAllMocks();
  s.org = { settings: {} };
  s.agent = agent();
  s.routines = new Map();
  seedRoutine();
  s.updates = [];
  s.lines = [];
  s.notifications = [];
  s.published = [];
  s.firstAction = null;
  s.resolveActingPerson.mockResolvedValue({ ok: true, person: PERSON });
  s.isAiConfigured.mockResolvedValue(true);
  s.getOrCreateTeammateSession.mockResolvedValue({ id: "s1", created: false });
  s.claimTeammateTurn.mockResolvedValue({ ok: true, runId: "run1", questionId: "q1" });
  s.runTeammateTurn.mockResolvedValue(turn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runRoutine", () => {
  it("runs as the routine's own person, then records the run and tells the person's tabs", async () => {
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
    expect(s.published).toEqual([CHANGED]);
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
      expect(s.published).toEqual([]);
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
  it("pauses once, with its line in the person's chat and one Inbox row, and tells their tabs", async () => {
    expect(await pauseRoutine(ROUTINE, "agent_removed")).toBe(true);
    expect(await pauseRoutine(ROUTINE, "agent_removed")).toBe(false);
    expect(s.updates.map((u) => u.data)).toEqual([
      { status: "paused", pausedReason: "agent_removed", nextRunAt: null },
      { status: "paused", pausedReason: "agent_removed", nextRunAt: null },
    ]);
    expect(s.lines).toEqual([
      { sessionId: "s1", line: { text: "Routine paused: Daily brief. This teammate was removed.", event: "routine_paused", routineId: "r1" } },
    ]);
    expect(s.notifications).toEqual([
      {
        userId: "u-max",
        type: "agent_routine_paused",
        title: "Planner paused a routine",
        message: "Daily brief: This teammate was removed.",
        link: "/agents?chat=planner&settings=routines",
      },
    ]);
    expect(s.published).toEqual([NOTIFIED, CHANGED]);
  });

  it("names the teammate its caller passes without reading it again", async () => {
    s.agent = null;
    expect(await pauseRoutine(ROUTINE, "out_of_questions", { name: "Status Reporter", slug: "status-reporter" })).toBe(true);
    expect(s.notifications[0]).toMatchObject({ title: "Status Reporter paused a routine", link: routinesHref("status-reporter") });
  });
});

describe("processDueRoutines", () => {
  it("claims a slot by one swap on nextRunAt, so two ticks at once run it once", async () => {
    const [a, b] = await Promise.all([processDueRoutines(NOW, RUNNER), processDueRoutines(NOW, RUNNER)]);
    expect([a, b].map((c) => [c.due, c.succeeded, c.taken])).toEqual([
      [1, 1, 0],
      [1, 0, 1],
    ]);
    expect(s.runTeammateTurn).toHaveBeenCalledTimes(1);
    expect(s.claimTeammateTurn).toHaveBeenCalledTimes(1);
    const swaps = s.updates.filter((u) => "nextRunAt" in u.where);
    expect(swaps).toEqual([
      { where: { id: "r1", status: "active", nextRunAt: DUE }, data: { nextRunAt: NEXT } },
      { where: { id: "r1", status: "active", nextRunAt: DUE }, data: { nextRunAt: NEXT } },
    ]);
    expect(s.routines.get("r1")).toMatchObject({ nextRunAt: NEXT, lastStatus: "SUCCEEDED", lastRunId: "run1" });

    // The next tick finds nothing due until the next slot.
    expect(await processDueRoutines(NOW, RUNNER)).toMatchObject({ due: 0, succeeded: 0 });
  });

  it("runs the slot as a ROUTINE turn for its person and its slot (the engine writes the REPORT row), then tells their tabs", async () => {
    const counts = await processDueRoutines(NOW, RUNNER);
    expect(counts).toEqual({ due: 1, succeeded: 1, failed: 0, skipped: 0, missed: 0, paused: 0, taken: 0, deferred: 0 });
    expect(s.claimTeammateTurn).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-max", trigger: "ROUTINE", routineId: "r1", practice: false, rateLimit: false }));
    expect(s.runTeammateTurn).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "ROUTINE", practice: false, person: PERSON, routine: { id: "r1", name: "Daily brief", prompt: "Tell me my top three.", dueAt: DUE } }),
    );
    expect(s.published).toEqual([CHANGED]);
    expect(s.notifications).toEqual([]);
  });

  it("skips a slot reached more than three hours late as missed, and runs it at its next", async () => {
    const late = new Date(DUE.getTime() + 3 * 60 * 60 * 1000 + 60_000);
    const counts = await processDueRoutines(late, RUNNER);
    expect(counts).toMatchObject({ due: 1, missed: 1, succeeded: 0 });
    expect(s.claimTeammateTurn).not.toHaveBeenCalled();
    expect(s.runTeammateTurn).not.toHaveBeenCalled();
    expect(s.routines.get("r1")).toMatchObject({ status: "active", nextRunAt: NEXT, lastStatus: "SKIPPED", lastReason: "missed", lastRunAt: late, lastRunId: null });
    expect(s.lines).toEqual([]);
    expect(s.notifications).toEqual([]);

    // Just inside the three hours, it runs.
    seedRoutine({ id: "r2", nextRunAt: DUE });
    const inTime = new Date(DUE.getTime() + 3 * 60 * 60 * 1000 - 60_000);
    expect(await processDueRoutines(inTime, RUNNER)).toMatchObject({ due: 1, succeeded: 1, missed: 0 });
  });

  const PAUSES: Array<[string, () => void, string, string]> = [
    ["the teammate was removed", () => (s.agent = agent({ status: "ARCHIVED" })), "agent_removed", "This teammate was removed."],
    ["the person was deactivated", () => s.resolveActingPerson.mockResolvedValue({ ok: false, reason: "inactive" }), "person_gone", "The person it works for is no longer in the workspace."],
    ["the person is a Guest now", () => s.resolveActingPerson.mockResolvedValue({ ok: false, reason: "guest" }), "guest", "A guest can't run routines."],
    ["the person is an agent account", () => s.resolveActingPerson.mockResolvedValue({ ok: false, reason: "agent_account" }), "agent_account", "An agent account can't run routines."],
    ["the teammate is someone else's", () => (s.agent = agent({ visibility: "PRIVATE", ownerId: "u-lea" })), "no_access", "The person it works for can no longer use this teammate."],
    [
      "the plan's questions are used",
      () => s.claimTeammateTurn.mockResolvedValue({ ok: false, code: "ai_limit", message: "This workspace has used all 50 AI questions on the Starter plan." }),
      "out_of_questions",
      "This workspace has used all its AI questions. Resume it after the plan changes.",
    ],
  ];
  for (const [why, arrange, reason, text] of PAUSES) {
    it(`pauses the routine when ${why} (${reason}), with one line, one Inbox row and its tabs told`, async () => {
      arrange();
      const counts = await processDueRoutines(NOW, RUNNER);
      expect(counts).toMatchObject({ due: 1, paused: 1, succeeded: 0, skipped: 0 });
      expect(s.routines.get("r1")).toMatchObject({ status: "paused", pausedReason: reason, nextRunAt: null });
      expect(s.runTeammateTurn).not.toHaveBeenCalled();
      expect(s.lines).toEqual([{ sessionId: "s1", line: { text: `Routine paused: Daily brief. ${text}`, event: "routine_paused", routineId: "r1" } }]);
      expect(s.notifications).toHaveLength(1);
      expect(s.notifications[0]).toMatchObject({ userId: "u-max", type: "agent_routine_paused", message: `Daily brief: ${text}`, link: "/agents?chat=planner&settings=routines" });
      expect(s.published).toEqual([NOTIFIED, CHANGED]);
    });
  }

  const SKIPS: Array<[string, () => void, string]> = [
    ["the workspace turned AI off", () => (s.org = { settings: { data: { aiEnabled: false } } }), "ai_off"],
    ["the teammate is paused", () => (s.agent = agent({ status: "DISABLED" })), "agent_paused"],
    ["AI isn't set up", () => s.isAiConfigured.mockResolvedValue(false), "not_configured"],
    ["the teammate used its month", () => s.claimTeammateTurn.mockResolvedValue({ ok: false, code: "agent_cap", message: "Planner has used its 40 AI questions for October." }), "agent_cap"],
  ];
  for (const [why, arrange, reason] of SKIPS) {
    it(`skips only this slot when ${why} (${reason}): still active, its next slot kept, no Inbox row`, async () => {
      arrange();
      const counts = await processDueRoutines(NOW, RUNNER);
      expect(counts).toMatchObject({ due: 1, skipped: 1, paused: 0, succeeded: 0 });
      expect(s.routines.get("r1")).toMatchObject({ status: "active", nextRunAt: NEXT, lastStatus: "SKIPPED", lastReason: reason, lastRunAt: NOW, lastRunId: null });
      expect(s.runTeammateTurn).not.toHaveBeenCalled();
      expect(s.notifications).toEqual([]);
    });
  }

  it("says the teammate's month is used in the chat once a month, not every slot", async () => {
    s.claimTeammateTurn.mockResolvedValue({ ok: false, code: "agent_cap", message: "Planner has used its 40 AI questions for October." });
    await processDueRoutines(NOW, RUNNER);
    const line = { sessionId: "s1", line: { text: "Routine skipped: Daily brief. This teammate has used its AI questions for the month.", event: "routine_skipped", routineId: "r1" } };
    expect(s.lines).toEqual([line]);
    expect(s.published).toEqual([CHANGED]);

    // The next slot, the same October: recorded, not said again.
    await processDueRoutines(new Date("2026-10-07T09:01:00Z"), RUNNER);
    expect(s.routines.get("r1")).toMatchObject({ lastReason: "agent_cap", lastStatus: "SKIPPED" });
    expect(s.lines).toEqual([line]);

    // November: said again, once.
    s.routines.get("r1")!.nextRunAt = new Date("2026-11-02T09:00:00Z");
    await processDueRoutines(new Date("2026-11-02T09:01:00Z"), RUNNER);
    expect(s.lines).toEqual([line, line]);
  });

  it("writes one approval notice per run that asked for something, linked to its first card", async () => {
    s.runTeammateTurn.mockResolvedValue(turn({ approvalMessageId: "m-card", proposedActionIds: ["act1", "act2", "act3"] }));
    s.firstAction = { id: "act1", toolName: "post_in_talk", risk: "OUTWARD", status: "PENDING", preview: { title: "Post in #team" }, createdAt: NOW, expiresAt: NEXT };
    await processDueRoutines(NOW, RUNNER);
    expect(s.notifications).toEqual([
      {
        userId: "u-max",
        type: "agent_approval",
        title: "Planner is waiting for your approval",
        message: "3 things from Daily brief",
        link: "/agents?chat=planner&action=act1",
      },
    ]);
    expect(s.published).toEqual([CHANGED, NOTIFIED]);

    // One request: the row says what it is.
    seedRoutine({ id: "r2", nextRunAt: DUE });
    s.runTeammateTurn.mockResolvedValue(turn({ approvalMessageId: "m-card", proposedActionIds: ["act1"] }));
    await processDueRoutines(NOW, RUNNER);
    expect(s.notifications[1]).toMatchObject({ message: "Post in #team", link: "/agents?chat=planner&action=act1" });
  });

  it("starts nothing past its budget, and leaves those routines due for the next tick", async () => {
    seedRoutine({ id: "r2", nextRunAt: DUE });
    const counts = await processDueRoutines(NOW, { ...RUNNER, budgetMs: 0 });
    expect(counts).toMatchObject({ due: 2, deferred: 2, succeeded: 0 });
    expect(s.updates).toEqual([]);
    expect(s.runTeammateTurn).not.toHaveBeenCalled();
    expect([...s.routines.values()].map((r) => r.nextRunAt)).toEqual([DUE, DUE]);
  });

  it("takes the oldest slots first, at most `limit` a tick, and `concurrency` at a time", async () => {
    s.routines = new Map();
    for (let i = 0; i < 6; i += 1) seedRoutine({ id: `r${i}`, nextRunAt: new Date(DUE.getTime() - i * 60_000) });
    let running = 0;
    let most = 0;
    s.runTeammateTurn.mockImplementation(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return turn();
    });
    const counts = await processDueRoutines(NOW, { limit: 4, budgetMs: 180_000, concurrency: 2 });
    expect(counts).toMatchObject({ due: 4, succeeded: 4 });
    expect(most).toBe(2);
    const ran = s.runTeammateTurn.mock.calls.map(([a]) => (a as { routine: { id: string } }).routine.id).sort();
    expect(ran).toEqual(["r2", "r3", "r4", "r5"]);
    expect(s.routines.get("r0")?.nextRunAt).toEqual(DUE);
  });
});
