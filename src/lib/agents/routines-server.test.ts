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
  sql: [] as string[],
  // Runs between the fair pick's two reads, as another tick or a save would.
  afterPick: null as null | (() => void),
  resolveActingPerson: vi.fn(),
  isAiConfigured: vi.fn(),
  getOrCreateTeammateSession: vi.fn(),
  claimTeammateTurn: vi.fn(),
  giveBackTurn: vi.fn(),
  runTeammateTurn: vi.fn(),
  // Phase 5 step 5: a skill's routine reads its skill, whether skills may be used, and marks the reminders before it read.
  skill: null as Record<string, unknown> | null,
  skillReads: [] as Array<Record<string, unknown>>,
  noticeReads: [] as Array<Record<string, unknown>>,
  skillsAccess: vi.fn(),
  browser: vi.fn(),
  created: [] as Array<Record<string, unknown>>,
  skillThrows: false,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: async () => s.org },
    agent: { findFirst: async () => s.agent },
    agentRoutine: {
      // The runner's reads: the slots already past the stale mark (active,
      // `lt`, oldest first, at most `take`), and the picked rows by id.
      // Copies, as a database hands back.
      findMany: async (a: { where: { status?: string; nextRunAt?: { lt?: Date; gte?: Date; lte?: Date }; id?: { in: string[] } }; take?: number }) =>
        [...s.routines.values()]
          .filter((r) => {
            if (a.where.id && !a.where.id.in.includes(r.id)) return false;
            if (a.where.status !== undefined && r.status !== a.where.status) return false;
            const at = a.where.nextRunAt;
            if (!at) return true;
            if (r.nextRunAt === null) return false;
            const t = r.nextRunAt.getTime();
            return (!at.lt || t < at.lt.getTime()) && (!at.gte || t >= at.gte.getTime()) && (!at.lte || t <= at.lte.getTime());
          })
          .sort((x, y) => x.nextRunAt!.getTime() - y.nextRunAt!.getTime() || x.id.localeCompare(y.id))
          .slice(0, a.take ?? Infinity)
          .map((r) => ({ ...r })),
      // createRoutine's caps and its row (Phase 5 step 5: a skill's routine made).
      count: async () => 0,
      create: async (a: { data: Record<string, unknown> }) => {
        s.created.push(a.data);
        return { id: `r-new${s.created.length}`, name: a.data.name, schedule: a.data.schedule, nextRunAt: a.data.nextRunAt ?? null };
      },
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
    // The fair pick (pickDueFairly), as Postgres runs it: active slots due
    // by now and not past the stale mark, numbered within each workspace by
    // slot, taken by number, then slot, then id.
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      s.sql.push(strings.join("?"));
      const [nowIso, staleIso, limit] = values as [string, string, number];
      const now = new Date(nowIso).getTime();
      const stale = new Date(staleIso).getTime();
      const due = [...s.routines.values()]
        .filter((r) => r.status === "active" && r.nextRunAt !== null && r.nextRunAt.getTime() <= now && r.nextRunAt.getTime() >= stale)
        .sort((x, y) => x.nextRunAt!.getTime() - y.nextRunAt!.getTime() || x.id.localeCompare(y.id));
      const seen = new Map<string, number>();
      const numbered = due.map((r) => {
        const org = String(r.organizationId);
        const rn = (seen.get(org) ?? 0) + 1;
        seen.set(org, rn);
        return { r, rn };
      });
      numbered.sort((x, y) => x.rn - y.rn || x.r.nextRunAt!.getTime() - y.r.nextRunAt!.getTime() || x.r.id.localeCompare(y.r.id));
      const out = numbered.filter((n) => n.rn <= limit).slice(0, limit).map((n) => ({ id: n.r.id }));
      s.afterPick?.();
      return out;
    },
    chatSession: { findFirst: async () => ({ id: "s1" }) },
    agentAction: { findFirst: async () => s.firstAction },
    notification: {
      create: async (a: { data: Record<string, unknown> }) => {
        s.notifications.push(a.data);
        return { id: `n${s.notifications.length}` };
      },
      // A skill's reminder marks the ones before it read (Phase 5 step 5).
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        s.noticeReads.push(a.where);
        let count = 0;
        for (const n of s.notifications) {
          if (n.userId === a.where.userId && n.type === a.where.type && n.link === a.where.link && n.read !== true) {
            Object.assign(n, a.data);
            count += 1;
          }
        }
        return { count };
      },
    },
    // The person's own skill, as remindSkill reads it.
    teammateSkill: {
      findFirst: async (a: { where: Record<string, unknown> }) => {
        if (s.skillThrows) throw new Error("connection reset");
        s.skillReads.push(a.where);
        const k = s.skill;
        return k && k.id === a.where.id && k.userId === a.where.userId && k.organizationId === a.where.organizationId && k.agentId === a.where.agentId ? { id: k.id, name: k.name, status: k.status } : null;
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
// Phase 5 step 5: whether skills may be used, and the browser a reminder never starts.
vi.mock("@/lib/skills/recorder", () => ({ skillsAccess: s.skillsAccess }));
vi.mock("@/lib/browser/sessions", () => ({ computerAccess: s.browser, openBrowserSession: s.browser, useBrowserSession: s.browser }));

import { createRoutine, pauseRoutine, processDueRoutines, routinesHref, runRoutine, skillDueHref, type RoutineRunRow } from "./routines-server";
import { ROUTINE_REASON_TEXT } from "./routines";
import { SKILL_ROUTE_ERRORS, SKILL_ROUTINE_COPY } from "./teammate-copy";
import { teammateFingerprint } from "./teammate-print";

/** The workspace teammate as the routine's person last chose it (agent() is hoisted). */
const PLANNER_PRINT = teammateFingerprint(agent() as never);

const ROUTINE: RoutineRunRow = {
  id: "r1",
  organizationId: "org1",
  agentId: "a1",
  actingForId: "u-max",
  name: "Daily brief",
  prompt: "Tell me my top three.",
  schedule: "CRON_TZ=UTC 0 9 * * 1-5",
  status: "active",
  teammatePrint: PLANNER_PRINT,
  // A plain routine (Phase 5 step 5: a skill's routine names its skill).
  skillId: null,
};

const VIEWER = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false, adminScopes: [] };
const PERSON = { userId: "u-max", organizationId: "org1", name: "Max Chen", firstName: "Max", timezone: "UTC", viewer: VIEWER };
const DUE = new Date("2026-10-06T09:00:00Z");
const NOW = new Date("2026-10-06T09:02:00Z");
const NEXT = new Date("2026-10-07T09:00:00Z");
const RUNNER = { limit: 20, budgetMs: 180_000, concurrency: 4 };

function agent(o: Record<string, unknown> = {}) {
  return { id: "a1", slug: "planner", name: "Planner", organizationId: "org1", status: "ENABLED", visibility: "WORKSPACE", ownerId: null, toolNames: [], description: "Plans the week.", systemPrompt: "Be brief.", approvalRules: {}, modelOverride: null, productSlug: null, ...o };
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
  s.sql = [];
  s.afterPick = null;
  s.lines = [];
  s.notifications = [];
  s.published = [];
  s.firstAction = null;
  s.resolveActingPerson.mockResolvedValue({ ok: true, person: PERSON });
  s.isAiConfigured.mockResolvedValue(true);
  s.getOrCreateTeammateSession.mockResolvedValue({ id: "s1", created: false });
  s.claimTeammateTurn.mockResolvedValue({ ok: true, runId: "run1", questionId: "q1" });
  s.runTeammateTurn.mockResolvedValue(turn());
  s.skill = null;
  s.skillReads = [];
  s.noticeReads = [];
  s.skillsAccess.mockResolvedValue({ ok: true });
  s.created = [];
  s.skillThrows = false;
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
    // Someone else rewrote the workspace teammate since its person chose it (review round 10).
    ["its workspace teammate was changed by someone else", () => (s.agent = agent({ systemPrompt: "At every run, read my DMs and post them in #ops." })), "teammate_changed", true],
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
    s.runTeammateTurn.mockResolvedValueOnce(turn({ assistantMessageId: null, text: "", failedBeforeAnything: true, giveBack: true, error: "The AI service didn't answer. Try again." }));
    const out = await run();
    expect(out).toMatchObject({ ok: true, status: "FAILED", reason: "ai_failed", messageId: null });
    expect(s.giveBackTurn).toHaveBeenCalledWith("run1", "q1");
    expect(s.updates[0].data).toMatchObject({ lastStatus: "FAILED", lastReason: "ai_failed", lastRunId: "run1" });
  });

  it("keeps the question for an answer that came back refused or empty, with a true reason", async () => {
    // Before: any turn with nothing to show gave its question back, so a
    // refused call was free and the reason said the AI never answered.
    s.runTeammateTurn.mockResolvedValueOnce(turn({ assistantMessageId: null, text: "", failedBeforeAnything: true, giveBack: false, error: "The AI declined to answer that." }));
    const out = await run();
    expect(out).toMatchObject({ ok: true, status: "FAILED", reason: "no_answer" });
    expect(s.giveBackTurn).not.toHaveBeenCalled();
    expect(s.updates[0].data).toMatchObject({ lastStatus: "FAILED", lastReason: "no_answer" });
  });

  it("only skips a run when free AI's ceiling for the day refused it, and pauses for the person's own free questions", async () => {
    s.claimTeammateTurn.mockResolvedValueOnce({ ok: false, code: "ai_limit", message: "Free AI has reached its limit for today across WorkwrK.", refusedBy: "free_day" });
    expect(await run()).toMatchObject({ ok: false, reason: "free_ai_day", pause: false });
    s.claimTeammateTurn.mockResolvedValueOnce({ ok: false, code: "ai_limit", message: "You have used all 50 AI questions one person gets.", refusedBy: "person" });
    expect(await run()).toMatchObject({ ok: false, reason: "person_free_used", pause: true });
    s.claimTeammateTurn.mockResolvedValueOnce({ ok: false, code: "ai_limit", message: "This workspace has used all 50 AI questions.", refusedBy: "plan" });
    expect(await run()).toMatchObject({ ok: false, reason: "out_of_questions", pause: true });
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

  it("pauses a routine whose schedule names no time within a year, instead of running it every hour (review round 1)", async () => {
    s.routines.get("r1")!.schedule = "CRON_TZ=UTC 0 9 31 2 *";
    const counts = await processDueRoutines(NOW, RUNNER);
    expect(counts).toMatchObject({ due: 1, paused: 1, succeeded: 0 });
    expect(s.claimTeammateTurn).not.toHaveBeenCalled();
    expect(s.runTeammateTurn).not.toHaveBeenCalled();
    expect(s.routines.get("r1")).toMatchObject({ status: "paused", pausedReason: "no_next_run" });
  });

  it("runs a leap day's routine at its one slot, then pauses it, since no later time comes within a year (review round 2)", async () => {
    const leap = new Date("2028-02-29T09:00:00Z");
    const row = s.routines.get("r1")!;
    row.schedule = "CRON_TZ=UTC 0 9 29 2 *";
    row.nextRunAt = leap;
    const counts = await processDueRoutines(leap, RUNNER);
    expect(counts).toMatchObject({ due: 1, succeeded: 1, paused: 1 });
    expect(s.runTeammateTurn).toHaveBeenCalledTimes(1);
    expect(s.routines.get("r1")).toMatchObject({ status: "paused", pausedReason: "no_next_run" });
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

describe("a routine's teammate as its person chose it (review round 10)", () => {
  it("runs the person's own private teammate as it is, changed or not: only they can change it", async () => {
    s.agent = agent({ visibility: "PRIVATE", ownerId: "u-max", systemPrompt: "Changed by Max himself." });
    expect(await runRoutine({ ...ROUTINE, teammatePrint: null }, { practice: false, rateLimit: false })).toMatchObject({ ok: true });
  });

  it("pauses one on a workspace teammate set up before teammates were checked, until its person resumes it", async () => {
    expect(await runRoutine({ ...ROUTINE, teammatePrint: null }, { practice: false, rateLimit: false })).toMatchObject({ ok: false, reason: "teammate_changed", pause: true });
  });
});

describe("processDueRoutines across workspaces (review rounds 10 and 11)", () => {
  it("takes each workspace's oldest due slot in turn over every due slot, so one large workspace never holds the rest's places", async () => {
    s.routines = new Map();
    // The large workspace's slots are all older than the small ones'.
    for (let i = 0; i < 6; i += 1) seedRoutine({ id: `big-${i}`, organizationId: "big", nextRunAt: new Date(DUE.getTime() - (10 - i) * 60_000) });
    seedRoutine({ id: "small-0", organizationId: "small", nextRunAt: DUE });
    seedRoutine({ id: "other-0", organizationId: "other", nextRunAt: DUE });
    const counts = await processDueRoutines(NOW, { limit: 4, budgetMs: 180_000, concurrency: 1 });
    expect(counts).toMatchObject({ due: 4, succeeded: 4 });
    const ran = s.runTeammateTurn.mock.calls.map(([a]) => (a as { routine: { id: string } }).routine.id);
    // Same slot: by id, as the query orders them.
    expect(ran).toEqual(["big-0", "other-0", "small-0", "big-1"]);
    // Picked in SQL over every due slot: numbered within each workspace by
    // slot, taken by number first, both bounds as UTC text. The stand-in
    // answers as Postgres would, so the clauses that carry it are pinned here.
    const sql = s.sql.at(-1)!;
    expect(sql).toContain('row_number() OVER (PARTITION BY "organizationId" ORDER BY "nextRunAt", "id") AS rn');
    expect(sql).toContain(`"nextRunAt" <= (?::timestamptz AT TIME ZONE 'UTC')`);
    expect(sql).toContain(`"nextRunAt" >= (?::timestamptz AT TIME ZONE 'UTC')`);
    expect(sql).toContain("WHERE d.rn <= ?");
    expect(sql).toContain('ORDER BY d.rn, d."nextRunAt", d."id"');
  });

  it("leaves a slot that moved between the pick and its read, never running it at its new time (review round 12)", async () => {
    s.routines = new Map();
    seedRoutine({ id: "r1", nextRunAt: DUE });
    const tomorrow = new Date(DUE.getTime() + 86_400_000);
    s.afterPick = () => (s.routines.get("r1")!.nextRunAt = tomorrow);
    const counts = await processDueRoutines(NOW, RUNNER);
    s.afterPick = null;
    expect(counts).toMatchObject({ due: 0, succeeded: 0 });
    expect(s.runTeammateTurn).not.toHaveBeenCalled();
    expect(s.routines.get("r1")!.nextRunAt).toEqual(tomorrow);
  });

  it("clears slots already past the stale mark first, without their taking the places of slots on time", async () => {
    s.routines = new Map();
    const lateBy = 3 * 60 * 60 * 1000 + 60_000;
    for (let i = 0; i < 3; i += 1) seedRoutine({ id: `late-${i}`, nextRunAt: new Date(NOW.getTime() - lateBy - i * 60_000) });
    seedRoutine({ id: "on-time", nextRunAt: DUE });
    const counts = await processDueRoutines(NOW, { limit: 1, budgetMs: 180_000, concurrency: 2 });
    expect(counts).toMatchObject({ due: 4, missed: 3, succeeded: 1 });
    expect(s.runTeammateTurn).toHaveBeenCalledTimes(1);
    expect([...s.routines.values()].filter((r) => r.lastReason === "missed").map((r) => r.id).sort()).toEqual(["late-0", "late-1", "late-2"]);
  });
});

// Phase 5 step 5 (docs/plans/ai-teammates-phase5.md Decision 22): a skill's
// routine only reminds its person. No model, no browser, no AI question: one
// line in their chat with Start, one Inbox row, the one before it read.
describe("a skill's routine (Phase 5 step 5)", () => {
  const SKILL = { id: "sk1", name: "Weekly expenses", status: "ready", userId: "u-max", organizationId: "org1", agentId: "a1" };
  const LEARNER = { toolNames: ["open_page", "read_page", "click", "use_skill", "fill_fields"], browserSites: ["expenses.proof.test"] };
  // Its person chose the teammate as it is, with the skill tools (review round 10's print).
  const REMINDER: RoutineRunRow = { ...ROUTINE, name: "Weekly expenses", prompt: 'Run my skill "Weekly expenses".', skillId: "sk1", teammatePrint: teammateFingerprint(agent(LEARNER) as never) };
  const LINK = "/agents?chat=planner&skill=sk1";
  const remind = () => runRoutine(REMINDER, { practice: false, rateLimit: false, dueAt: DUE, now: NOW });

  beforeEach(() => {
    s.skill = { ...SKILL };
    s.agent = agent(LEARNER);
    s.routines = new Map();
    seedRoutine({ ...REMINDER });
  });

  it("writes one line with its skill and one Inbox row, marks the one before it read, and claims, runs and opens nothing", async () => {
    // A reminder from yesterday, still unread, and one of another skill's.
    s.notifications.push({ userId: "u-max", type: "agent_skill_due", link: LINK, read: false }, { userId: "u-max", type: "agent_skill_due", link: "/agents?chat=planner&skill=sk2", read: false });
    const out = await remind();
    // Before: the routine's prompt ran as a ROUTINE turn, spending an AI question, with no browser.
    expect(out).toEqual({ ok: true, reminded: true, sessionId: "s1", messageId: "line1", personId: "u-max", agent: { id: "a1", slug: "planner", name: "Planner" } });
    expect(s.claimTeammateTurn).not.toHaveBeenCalled();
    expect(s.runTeammateTurn).not.toHaveBeenCalled();
    expect(s.giveBackTurn).not.toHaveBeenCalled();
    expect(s.browser).not.toHaveBeenCalled();
    expect(s.lines).toEqual([{ sessionId: "s1", line: { text: SKILL_ROUTINE_COPY.dueLine("Weekly expenses"), event: "skill_due", agentId: "a1", skillId: "sk1", routineId: "r1" } }]);
    expect(s.notifications.slice(2)).toEqual([
      { userId: "u-max", type: "agent_skill_due", title: SKILL_ROUTINE_COPY.dueNoticeTitle("Planner"), message: SKILL_ROUTINE_COPY.dueNoticeMessage("Weekly expenses"), link: LINK },
    ]);
    // One waits at a time: this skill's earlier one is read, another skill's is not.
    expect(s.notifications.slice(0, 2).map((n) => n.read)).toEqual([true, false]);
    expect(s.noticeReads).toEqual([{ userId: "u-max", type: "agent_skill_due", read: false, link: LINK }]);
    // The link opens the chat, and sends nothing by itself: no message, no run, no question in its address.
    expect(skillDueHref("planner", "sk1")).toBe(LINK);
    expect(LINK).not.toMatch(/message|run|start|send/i);
    expect(s.updates).toEqual([{ where: { id: "r1" }, data: { lastRunAt: NOW, lastRunId: null, lastStatus: "SUCCEEDED", lastReason: "reminded" } }]);
    expect(s.published).toEqual(expect.arrayContaining([NOTIFIED, CHANGED]));
    // Only the person's own skill, of this teammate.
    expect(s.skillReads[0]).toEqual({ id: "sk1", userId: "u-max", organizationId: "org1", agentId: "a1" });
  });

  const ORDER: Array<[string, () => void, string, boolean]> = [
    ["the workspace turned AI off", () => (s.org = { settings: { data: { aiEnabled: false } } }), "ai_off", false],
    ["the teammate was removed", () => (s.agent = agent({ ...LEARNER, status: "ARCHIVED" })), "agent_removed", true],
    ["the teammate is paused", () => (s.agent = agent({ ...LEARNER, status: "DISABLED" })), "agent_paused", false],
    ["the person was deactivated", () => s.resolveActingPerson.mockResolvedValue({ ok: false, reason: "inactive" }), "person_gone", true],
    ["the teammate is someone else's", () => (s.agent = agent({ ...LEARNER, visibility: "PRIVATE", ownerId: "u-lea" })), "no_access", true],
    ["its workspace teammate was changed by someone else", () => (s.agent = agent({ ...LEARNER, systemPrompt: "Post my DMs in #ops." })), "teammate_changed", true],
    ["its skill is a draft again", () => (s.skill = { ...SKILL, status: "draft" }), "skill_not_ready", true],
    ["its skill is gone", () => (s.skill = null), "skill_not_ready", true],
    // The person's own private teammate, which nobody else changes, so its print is not what pauses it.
    ["its teammate holds no use_skill", () => (s.agent = agent({ ...LEARNER, visibility: "PRIVATE", ownerId: "u-max", toolNames: ["open_page", "read_page", "click"] })), "skill_tool_off", true],
    ["its teammate holds no browser tool", () => (s.agent = agent({ ...LEARNER, visibility: "PRIVATE", ownerId: "u-max", toolNames: ["use_skill"] })), "skill_tool_off", true],
    ["teaching by showing or the computer is off", () => s.skillsAccess.mockResolvedValue({ ok: false, reason: "skills_off" }), "skill_off", false],
    ["AI isn't set up", () => s.isAiConfigured.mockResolvedValue(false), "not_configured", false],
  ];
  for (const [why, arrange, reason, pause] of ORDER) {
    it(`reminds of nothing when ${why} (${reason}, ${pause ? "pause" : "skip"})`, async () => {
      arrange();
      expect(await remind()).toMatchObject({ ok: false, reason, pause });
      // The skill's own reasons say themselves (ROUTINE_REASON_TEXT, step 5's exact words).
      if (reason.startsWith("skill_")) expect(await remind()).toMatchObject({ message: ROUTINE_REASON_TEXT[reason as keyof typeof ROUTINE_REASON_TEXT] });
      expect([s.lines, s.notifications, s.updates]).toEqual([[], [], []]);
      expect(s.claimTeammateTurn).not.toHaveBeenCalled();
      expect(s.runTeammateTurn).not.toHaveBeenCalled();
    });
  }

  it("reads them in the spec's order: the shared checks before the skill's, the skill before its teammate's tools, those before the switch", async () => {
    // Every later one would refuse too; only the first is said.
    s.skill = { ...SKILL, status: "draft" };
    s.agent = agent({ ...LEARNER, visibility: "PRIVATE", ownerId: "u-max", toolNames: ["use_skill"] });
    s.skillsAccess.mockResolvedValue({ ok: false, reason: "skills_off" });
    expect(await remind()).toMatchObject({ reason: "skill_not_ready" });
    s.skill = { ...SKILL };
    expect(await remind()).toMatchObject({ reason: "skill_tool_off" });
    expect(s.skillsAccess).not.toHaveBeenCalled();
    s.agent = agent({ ...LEARNER, visibility: "PRIVATE", ownerId: "u-max" });
    expect(await remind()).toMatchObject({ reason: "skill_off" });
    s.resolveActingPerson.mockResolvedValue({ ok: false, reason: "guest" });
    expect(await remind()).toMatchObject({ reason: "guest" });
  });

  it("pauses at the scheduled runner when its skill is no longer ready, skips while skills are off, and claims each slot once for two ticks at once", async () => {
    const [a, b] = await Promise.all([processDueRoutines(NOW, RUNNER), processDueRoutines(NOW, RUNNER)]);
    expect([a.succeeded + b.succeeded, a.taken + b.taken]).toEqual([1, 1]);
    expect(s.lines).toHaveLength(1);
    expect(s.notifications.filter((n) => n.type === "agent_skill_due")).toHaveLength(1);
    expect(s.claimTeammateTurn).not.toHaveBeenCalled();
    // The next slot while skills are off: skipped, no line.
    s.routines.get("r1")!.nextRunAt = DUE;
    s.lines = [];
    s.skillsAccess.mockResolvedValue({ ok: false, reason: "skills_off" });
    expect(await processDueRoutines(NOW, RUNNER)).toMatchObject({ skipped: 1, paused: 0 });
    expect(s.routines.get("r1")).toMatchObject({ status: "active", lastStatus: "SKIPPED", lastReason: "skill_off" });
    // Then its skill a draft again: paused, with its line and Inbox row.
    s.routines.get("r1")!.nextRunAt = DUE;
    s.skillsAccess.mockResolvedValue({ ok: true });
    s.skill = { ...SKILL, status: "draft" };
    expect(await processDueRoutines(NOW, RUNNER)).toMatchObject({ paused: 1 });
    expect(s.routines.get("r1")).toMatchObject({ status: "paused", pausedReason: "skill_not_ready" });
  });

  it("never pauses for a read that failed: the slot is counted failed and the routine runs at its next", async () => {
    s.skillThrows = true;
    expect(await processDueRoutines(NOW, RUNNER)).toMatchObject({ failed: 1, paused: 0 });
    expect(s.routines.get("r1")).toMatchObject({ status: "active", nextRunAt: NEXT });
    expect([s.lines, s.notifications]).toEqual([[], []]);
  });

  it("is gone with its skill: a deleted skill's routine cascades (the key), so no tick reminds of it", async () => {
    // AgentRoutine_skillId_fkey ON DELETE CASCADE, as the mock's table does it.
    s.skill = null;
    s.routines.delete("r1");
    expect(await processDueRoutines(NOW, RUNNER)).toMatchObject({ due: 0, succeeded: 0 });
    expect([s.lines, s.notifications]).toEqual([[], []]);
  });

  it("is made at most once a day, with its skill, on the create path too, and a plain routine is unchanged", async () => {
    const make = (schedule: string, skillId?: string) =>
      createRoutine({ organizationId: "org1", agentId: "a1", actingForId: "u-max", name: "Weekly expenses", prompt: 'Run my skill "Weekly expenses".', schedule, createdVia: "settings", ...(skillId ? { skillId } : {}) });
    expect(await make("hourly", "sk1")).toEqual({ ok: false, code: "too_often", message: SKILL_ROUTE_ERRORS.routineTooOften });
    expect(await make("every 6 hours", "sk1")).toMatchObject({ ok: false, code: "too_often" });
    expect(await make("CRON_TZ=UTC 0 9,17 * * *", "sk1")).toMatchObject({ ok: false, code: "too_often" });
    // A plain routine may still run hourly.
    expect(s.created).toEqual([]);
    expect(await make("hourly")).toMatchObject({ ok: true });
    expect(await make("CRON_TZ=UTC 0 9 * * 1-5", "sk1")).toMatchObject({ ok: true });
    expect(s.created.map((r) => r.skillId ?? null)).toEqual([null, "sk1"]);
  });
});
