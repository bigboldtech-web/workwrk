// The old Workspace agents schedules moving onto routines, and Run now
// (src/lib/agents/legacy-schedules.ts; docs/plans/ai-teammates-phase2.md
// step 2). The database, the person check and the engine are mocked at their
// boundaries; what is pinned is who a schedule works as (its creator, never
// anyone else), that each moves once, and that Run now is the clicking
// person's own gated chat turn.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  agents: [] as Row[],
  /** How many rows each compare-and-swap moves (1 unless a test says). */
  casCount: 1,
  casWhere: [] as Row[],
  /** An agent whose move throws (a database error). */
  throwFor: null as string | null,
  casData: [] as Row[],
  routines: [] as Row[],
  agentUpdates: [] as Row[],
  userReads: 0,
  routineCounts: 0,
  messages: [] as Row[],
  failMessage: false,
  people: {} as Record<string, { ok: true; person: Row } | { ok: false; reason: string }>,
  lines: [] as Array<{ sessionId: string; line: Row }>,
  audits: [] as Row[],
  published: [] as Array<{ userId: string; event: Row }>,
  claims: [] as Row[],
  claim: { ok: true, runId: "run1", questionId: "q1" } as Row,
  turns: [] as Row[],
  turn: { error: null, giveBack: false, proposedActionIds: [] as string[], text: "Done." } as Row,
  givenBack: [] as string[],
  abandoned: [] as string[],
  configured: true,
  personSetting: null as Row | null,
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    agent: {
      updateMany: async (a: { where: Row; data: Row }) => {
        if (a.where.id === st.throwFor) throw new Error("db down");
        st.casWhere.push(a.where);
        st.casData.push(a.data);
        return { count: st.casCount };
      },
      update: async (a: { where: Row; data: Row }) => {
        st.agentUpdates.push({ ...a.where, ...a.data });
        return {};
      },
    },
    agentRoutine: {
      create: async (a: { data: Row }) => {
        st.routines.push(a.data);
        return { id: `r${st.routines.length}` };
      },
    },
  };
  return {
    prisma: {
      agent: {
        findMany: async () => st.agents,
        findFirst: async (a: { where: { id: string } }) => st.agents.find((r) => r.id === a.where.id) ?? null,
        updateMany: async (a: Row) => (st.agentUpdates.push(a), { count: 1 }),
      },
      agentRoutine: { count: async () => (st.routineCounts += 1, 30) },
      agentPersonSetting: { findUnique: async () => st.personSetting },
      user: {
        findFirst: async () => (st.userReads += 1, null),
        findMany: async () => (st.userReads += 1, []),
      },
      chatMessage: {
        create: async (a: { data: Row }) => {
          if (st.failMessage) throw new Error("db down");
          st.messages.push(a.data);
          return { id: "u1" };
        },
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock("./acting", () => ({
  resolveActingPerson: async (_org: string, userId: string) => st.people[userId] ?? { ok: false, reason: "gone" },
  personZone: async () => "Asia/Kolkata",
}));
vi.mock("./actions", () => ({
  writeEventLine: async (sessionId: string, line: Row) => void st.lines.push({ sessionId, line }),
}));
vi.mock("./audit", () => ({ auditAgent: async (a: Row) => void st.audits.push(a) }));
vi.mock("./budget", () => ({
  claimTeammateTurn: async (a: Row) => (st.claims.push(a), st.claim),
  giveBackTurn: async (runId: string) => void st.givenBack.push(runId),
  abandonTurn: async (runId: string) => void st.abandoned.push(runId),
}));
vi.mock("./engine", () => ({
  TEAMMATE_AGENT_SELECT: { id: true },
  getOrCreateTeammateSession: async (agent: { id: string }, userId: string) => ({ id: `chat:${agent.id}:${userId}`, created: false }),
  runTeammateTurn: async (a: Row) => (st.turns.push(a), st.turn),
  teammateAgentFrom: (r: Row) => ({ ...r, fromRow: true }),
}));
vi.mock("./routines-server", () => ({ nextRoutineRun: () => new Date("2026-10-07T11:00:00Z"), routineTeammatePrint: async () => "print-at-move" }));
vi.mock("@/lib/ai-client", () => ({ isAiConfigured: async () => st.configured }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: (userId: string, event: Row) => void st.published.push({ userId, event }) }));

import { convertLegacySchedules, legacyScheduleOutcome, runLegacyAgentNow, type LegacyScheduleRow } from "./legacy-schedules";
import { LEGACY_COPY } from "./teammate-copy";
import { serverTimeZone } from "./schedule-words";

const NOW = new Date("2026-10-07T10:00:00Z");

function agent(over: Partial<LegacyScheduleRow> & Row = {}): LegacyScheduleRow & Row {
  return {
    id: "a1",
    organizationId: "org1",
    slug: "deal-desk",
    name: "Deal desk",
    status: "ENABLED",
    visibility: "WORKSPACE",
    ownerId: null,
    createdById: "u-olivia",
    scheduleCron: "every 10 minutes",
    autonomousPrompt: "Flag deals stuck a week.",
    nextRunAt: new Date("2026-10-07T10:05:00Z"),
    ...over,
  };
}

function person(userId: string, orgRole = "OWNER"): { ok: true; person: Row } {
  return { ok: true, person: { userId, organizationId: "org1", firstName: userId, viewer: { userId, organizationId: "org1", orgRole, isAgent: false } } };
}

beforeEach(() => {
  Object.assign(st, {
    agents: [], casCount: 1, casWhere: [], throwFor: null, casData: [], routines: [], agentUpdates: [], userReads: 0, routineCounts: 0,
    messages: [], failMessage: false, people: {}, lines: [], audits: [], published: [], claims: [],
    claim: { ok: true, runId: "run1", questionId: "q1" }, turns: [],
    turn: { error: null, giveBack: false, proposedActionIds: [], text: "Done." }, givenBack: [], abandoned: [], configured: true,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("moving an old schedule", () => {
  it("turns off, and never moves twice, a moved schedule an older build turned back on (review round 1)", async () => {
    st.agents = [agent({ scheduleMovedAt: new Date("2026-10-07T08:00:00Z"), scheduleRoutineId: "r-old" })];
    expect(await convertLegacySchedules(NOW, { limit: 100 })).toEqual({ found: 1, moved: 0, stopped: 1, taken: 0, failed: 0 });
    expect(st.routines).toEqual([]);
    expect(st.agentUpdates.at(-1)).toEqual({ where: { id: "a1", autonomousEnabled: true, scheduleCron: "every 10 minutes" }, data: { autonomousEnabled: false, nextRunAt: null } });
    expect(st.audits.at(-1)).toMatchObject({ action: "schedule_stopped", metadata: { routineId: "r-old", reason: "already_moved" } });
  });

  it("never brings back a routine its creator deleted (review round 2)", async () => {
    // The creator can still be acted for, so a move again would succeed: only the moved-before rule stops it (review round 6).
    st.people["u-olivia"] = person("u-olivia");
    st.agents = [agent({ scheduleMovedAt: new Date("2026-10-07T08:00:00Z"), scheduleRoutineId: "r-deleted" })];
    expect(await convertLegacySchedules(NOW, { limit: 100 })).toMatchObject({ moved: 0, stopped: 1 });
    expect(st.routines).toEqual([]);
    expect(st.casData).toEqual([]);
    expect(st.audits.at(-1)).toMatchObject({ action: "schedule_stopped", metadata: { routineId: "r-deleted", reason: "already_moved" } });
  });

  it("names the server zone on a changed bare cron too (review round 2)", async () => {
    st.people["u-olivia"] = person("u-olivia");
    expect(await legacyScheduleOutcome(agent({ scheduleCron: "0,30 9-17 * * 1-5" }), NOW)).toMatchObject({ schedule: `CRON_TZ=${serverTimeZone()} 0 9-17 * * 1-5`, changed: true });
  });

  it("makes it its creator's routine, at most hourly, and stops the old schedule in the same step", async () => {
    st.people["u-olivia"] = person("u-olivia");
    st.agents = [agent()];
    expect(await convertLegacySchedules(NOW, { limit: 100 })).toEqual({ found: 1, moved: 1, stopped: 0, taken: 0, failed: 0 });
    expect(st.casWhere).toEqual([{ id: "a1", autonomousEnabled: true, scheduleCron: "every 10 minutes", autonomousPrompt: "Flag deals stuck a week.", scheduleMovedAt: null }]);
    expect(st.casData).toEqual([{ autonomousEnabled: false, nextRunAt: null, scheduleMovedAt: NOW, scheduleMoveReason: null }]);
    expect(st.routines).toEqual([
      {
        organizationId: "org1",
        agentId: "a1",
        actingForId: "u-olivia",
        name: "Scheduled check",
        prompt: "Flag deals stuck a week.",
        schedule: "hourly",
        status: "active",
        // The schedule changed, so its own next slot, not the old one.
        nextRunAt: new Date("2026-10-07T11:00:00Z"),
        createdVia: "legacy",
        // The teammate as the old schedule ran it, at the move (review round 10).
        teammatePrint: "print-at-move",
      },
    ]);
    expect(st.agentUpdates).toEqual([{ id: "a1", scheduleRoutineId: "r1" }]);
  });

  it("says the routine keeps what the creator chose not to be asked about (review round 1)", async () => {
    st.people["u-olivia"] = person("u-olivia");
    st.personSetting = { approvalRules: { comment_on_task: "always" } };
    st.agents = [agent({ scheduleCron: "CRON_TZ=Asia/Kolkata 0 9 * * 1-5" })];
    await convertLegacySchedules(NOW, { limit: 100 });
    expect(st.lines.at(-1)?.line).toMatchObject({ text: LEGACY_COPY.movedLineKept("Deal desk", "Weekdays at 9:00") });
    st.personSetting = null;
  });

  it("tells the creator in their own chat with the agent, and audits it as the system", async () => {
    st.people["u-olivia"] = person("u-olivia");
    st.agents = [agent({ scheduleCron: "CRON_TZ=Asia/Kolkata 0 9 * * 1-5" })];
    await convertLegacySchedules(NOW, { limit: 100 });
    expect(st.lines).toEqual([
      {
        sessionId: "chat:a1:u-olivia",
        line: { text: LEGACY_COPY.movedLine("Deal desk", "Weekdays at 9:00"), event: "schedule_moved", routineId: "r1" },
      },
    ]);
    expect(st.published).toEqual([{ userId: "u-olivia", event: { type: "agent.changed", agentId: "a1" } }]);
    expect(st.audits).toEqual([
      expect.objectContaining({
        actorId: null,
        actorType: "system",
        action: "schedule_moved",
        metadata: { routineId: "r1", actingForId: "u-olivia", reason: null, schedule: "CRON_TZ=Asia/Kolkata 0 9 * * 1-5", changed: false },
      }),
    ]);
  });

  it("keeps a slot the old schedule already had coming when the schedule is unchanged", async () => {
    st.people["u-olivia"] = person("u-olivia");
    st.agents = [agent({ scheduleCron: "daily", nextRunAt: new Date("2026-10-08T09:00:00Z") })];
    await convertLegacySchedules(NOW, { limit: 100 });
    expect(st.routines[0]).toMatchObject({ schedule: "daily", nextRunAt: new Date("2026-10-08T09:00:00Z") });
  });

  it("uses the old loop's own line when it had no instructions", async () => {
    st.people["u-olivia"] = person("u-olivia");
    st.agents = [agent({ autonomousPrompt: "   " })];
    await convertLegacySchedules(NOW, { limit: 100 });
    expect(st.routines[0].prompt).toBe(LEGACY_COPY.defaultPrompt);
  });

  it("moves it once: a compare-and-swap someone else won makes no routine", async () => {
    st.people["u-olivia"] = person("u-olivia");
    st.agents = [agent()];
    st.casCount = 0;
    expect(await convertLegacySchedules(NOW, { limit: 100 })).toEqual({ found: 1, moved: 0, stopped: 0, taken: 1, failed: 0 });
    expect(st.routines).toEqual([]);
    expect(st.audits).toEqual([]);
    expect(st.lines).toEqual([]);
  });

  it("never runs as anyone else when nobody is on record as its creator (the old loop took the first admin)", async () => {
    st.agents = [agent({ createdById: null })];
    expect(await convertLegacySchedules(NOW, { limit: 100 })).toMatchObject({ moved: 0, stopped: 1 });
    expect(st.casData[0]).toMatchObject({ autonomousEnabled: false, scheduleMoveReason: "no_creator" });
    expect(st.routines).toEqual([]);
    expect(st.userReads).toBe(0);
    expect(st.audits).toEqual([expect.objectContaining({ action: "schedule_stopped", actorId: null, actorType: "system" })]);
  });

  it("ignores the routine limits, so a workspace keeps every schedule it had", async () => {
    st.people["u-olivia"] = person("u-olivia");
    st.agents = [agent()];
    await convertLegacySchedules(NOW, { limit: 100 });
    expect(st.routineCounts).toBe(0);
    expect(st.routines).toHaveLength(1);
  });

  it("goes on with the next agent when one throws", async () => {
    st.people["u-olivia"] = person("u-olivia");
    st.agents = [agent({ id: "a-bad" }), agent({ id: "a2" })];
    st.throwFor = "a-bad";
    expect(await convertLegacySchedules(NOW, { limit: 100 })).toEqual({ found: 2, moved: 1, stopped: 0, taken: 0, failed: 1 });
  });
});

describe("legacyScheduleOutcome", () => {
  it("stops a removed agent, a blank schedule and one no routine can run", async () => {
    expect(await legacyScheduleOutcome(agent({ status: "ARCHIVED" }), NOW)).toEqual({ kind: "stop", reason: "agent_removed" });
    expect(await legacyScheduleOutcome(agent({ scheduleCron: "  " }), NOW)).toEqual({ kind: "stop", reason: "no_schedule" });
    expect(await legacyScheduleOutcome(agent({ scheduleCron: "every 48 hours" }), NOW)).toEqual({ kind: "stop", reason: "unsupported_schedule" });
  });
  it("stops when its creator is a Guest, gone, deactivated or an agent account", async () => {
    st.people["u-gil"] = { ok: false, reason: "guest" };
    st.people["u-max"] = { ok: false, reason: "inactive" };
    st.people["u-bot"] = { ok: false, reason: "agent_account" };
    expect(await legacyScheduleOutcome(agent({ createdById: "u-gil" }), NOW)).toEqual({ kind: "stop", reason: "guest" });
    expect(await legacyScheduleOutcome(agent({ createdById: "u-max" }), NOW)).toEqual({ kind: "stop", reason: "person_gone" });
    expect(await legacyScheduleOutcome(agent({ createdById: "u-left" }), NOW)).toEqual({ kind: "stop", reason: "person_gone" });
    expect(await legacyScheduleOutcome(agent({ createdById: "u-bot" }), NOW)).toEqual({ kind: "stop", reason: "agent_account" });
  });
  it("stops when its creator can no longer use the agent", async () => {
    st.people["u-max"] = person("u-max", "MEMBER");
    expect(await legacyScheduleOutcome(agent({ createdById: "u-max", visibility: "PRIVATE", ownerId: "u-olivia" }), NOW)).toEqual({ kind: "stop", reason: "no_access" });
  });
  it("still makes the routine when AI is only off for its creator: the routine skips until it is back", async () => {
    st.people["u-olivia"] = { ok: false, reason: "ai_off" };
    expect(await legacyScheduleOutcome(agent(), NOW)).toEqual({ kind: "routine", schedule: "hourly", changed: true, actingForId: "u-olivia" });
    expect(await legacyScheduleOutcome(agent({ visibility: "PRIVATE", ownerId: "u-max" }), NOW)).toEqual({ kind: "stop", reason: "no_access" });
  });
  it("keeps a schedule a routine can run as it was, naming the server's zone it ran in (review round 1)", async () => {
    st.people["u-olivia"] = person("u-olivia");
    expect(await legacyScheduleOutcome(agent({ scheduleCron: "0 9 * * 1-5" }), NOW)).toEqual({
      kind: "routine",
      schedule: `CRON_TZ=${serverTimeZone()} 0 9 * * 1-5`,
      changed: false,
      actingForId: "u-olivia",
    });
    // One that names its zone, and a keyword, are kept as written.
    expect(await legacyScheduleOutcome(agent({ scheduleCron: "CRON_TZ=Asia/Kolkata 0 9 * * 1-5" }), NOW)).toMatchObject({ schedule: "CRON_TZ=Asia/Kolkata 0 9 * * 1-5" });
    expect(await legacyScheduleOutcome(agent({ scheduleCron: "daily" }), NOW)).toMatchObject({ schedule: "daily" });
  });
});

describe("Run now", () => {
  const viewer = { userId: "u-admin", organizationId: "org1", orgRole: "ADMIN", isAgent: false } as never;

  beforeEach(() => {
    st.agents = [agent({ createdById: "u-olivia" })];
    st.people["u-admin"] = person("u-admin", "ADMIN");
    st.people["u-olivia"] = person("u-olivia");
  });

  it("is a chat turn of the person who clicked, as themselves, never its creator", async () => {
    st.turn = { error: null, giveBack: false, proposedActionIds: ["x1"], text: "Asked to invite Lea." };
    const r = await runLegacyAgentNow({ id: "a1", slug: "deal-desk", name: "Deal desk" }, viewer);
    expect(r).toEqual({ ok: true, result: { runId: "run1", status: "SUCCEEDED", waiting: 1, chatHref: "/agents?chat=deal-desk" } });
    expect(st.claims).toEqual([expect.objectContaining({ userId: "u-admin", what: "AI teammate run now", trigger: "CHAT", sessionId: "chat:a1:u-admin", rateLimit: true, practice: false })]);
    expect(st.messages).toEqual([{ sessionId: "chat:a1:u-admin", role: "USER", content: "Flag deals stuck a week.", meta: { runNow: true } }]);
    expect(st.turns).toHaveLength(1);
    expect(st.turns[0]).toMatchObject({ trigger: "CHAT", userText: "Flag deals stuck a week.", userMessageId: "u1", streaming: false, practice: false, routine: null });
    expect((st.turns[0].person as Row).userId).toBe("u-admin");
    // Marked as the run's own end, which offers Run now again (review round 9).
    expect(st.published).toEqual([{ userId: "u-admin", event: { type: "agent.changed", agentId: "a1", runNowDone: true } }]);
  });

  it("refuses before spending anything when the person cannot be acted for or AI is not set up", async () => {
    st.people["u-admin"] = { ok: false, reason: "guest" };
    expect(await runLegacyAgentNow({ id: "a1", slug: "deal-desk", name: "Deal desk" }, viewer)).toMatchObject({ ok: false, status: 403, code: "person_cannot" });
    st.people["u-admin"] = person("u-admin", "ADMIN");
    st.configured = false;
    expect(await runLegacyAgentNow({ id: "a1", slug: "deal-desk", name: "Deal desk" }, viewer)).toMatchObject({ ok: false, status: 503, code: "not_configured" });
    expect(st.claims).toEqual([]);
  });

  it("saves nothing when the claim is refused", async () => {
    st.claim = { ok: false, code: "rate_limited", message: "Too many AI requests.", retryAfter: 12 };
    expect(await runLegacyAgentNow({ id: "a1", slug: "deal-desk", name: "Deal desk" }, viewer)).toEqual({ ok: false, status: 429, code: "rate_limited", error: "Too many AI requests.", retryAfter: 12 });
    st.claim = { ok: false, code: "agent_cap", message: "Deal desk has used its 40 AI questions for October." };
    expect(await runLegacyAgentNow({ id: "a1", slug: "deal-desk", name: "Deal desk" }, viewer)).toMatchObject({ ok: false, status: 403, code: "agent_cap" });
    expect(st.messages).toEqual([]);
    expect(st.turns).toEqual([]);
  });

  it("gives the question back when its message could not be saved, and runs nothing", async () => {
    st.failMessage = true;
    expect(await runLegacyAgentNow({ id: "a1", slug: "deal-desk", name: "Deal desk" }, viewer)).toMatchObject({ ok: false, status: 500, code: "not_saved" });
    expect(st.abandoned).toEqual(["run1"]);
    expect(st.turns).toEqual([]);
  });

  it("gives the question back only when the model never answered, and says the run failed", async () => {
    st.turn = { error: "The AI didn't answer.", giveBack: true, proposedActionIds: [], text: "" };
    const r = await runLegacyAgentNow({ id: "a1", slug: "deal-desk", name: "Deal desk" }, viewer);
    expect(r).toMatchObject({ ok: true, result: { status: "FAILED", errorText: "The AI didn't answer.", waiting: 0 } });
    expect(st.givenBack).toEqual(["run1"]);
  });
});
