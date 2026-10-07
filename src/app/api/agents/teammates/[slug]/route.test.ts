// Who may open, change and remove a teammate (docs/plans/ai-teammates.md 4),
// for the owner of a private one, another member, an Admin, the Owner, a
// Guest and an agent account; that another person's private teammate is the
// same 404 as a missing one on every route that names a teammate, and
// another person's routine, memory or request on every route that names one;
// and what removing, pausing and adding back do. The database is the
// routes' in-memory double; the engine, the queue and the runner are mocked
// at their boundaries.

import { beforeEach, describe, expect, it, vi } from "vitest";

const modules = vi.hoisted(() => ({ talkOn: true, tablesOn: true }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/agents/teammate-route-fixtures")).routeDb }));
vi.mock("@/lib/app-gate", async () => (await import("@/lib/agents/teammate-route-fixtures")).appGateFake);
vi.mock("@/lib/entitlements", () => ({
  isModuleActive: async (_organizationId: string, slug: string) => (slug === "workwrk-talk" ? modules.talkOn : modules.tablesOn),
}));
vi.mock("@/lib/ai-client", () => ({ isAiConfigured: async () => true }));

const mocks = vi.hoisted(() => ({
  audits: [] as Array<{ action: string; metadata?: Record<string, unknown> }>,
  cancelPendingActionsOf: vi.fn<(agent: { id: string; slug: string; name: string }, now?: Date) => Promise<number>>(async () => 0),
  pauseRoutine: vi.fn<(routine: { id: string }, reason: string) => Promise<boolean>>(async () => true),
  createRoutine: vi.fn(),
  claimTeammateTurn: vi.fn(),
  runTeammateTurn: vi.fn(),
  resolveActingPerson: vi.fn(),
}));
vi.mock("@/lib/agents/audit", () => ({ auditAgent: async (a: { action: string; metadata?: Record<string, unknown> }) => void mocks.audits.push(a) }));
vi.mock("@/lib/agents/actions", () => ({
  cancelPendingActionsOf: mocks.cancelPendingActionsOf,
  actionViews: async () => ({}),
  claimUnreportedOutcomes: async () => [],
}));
vi.mock("@/lib/agents/budget", () => ({
  agentMonthUsage: async () => ({ used: 4, monthStart: new Date("2026-10-01T00:00:00Z") }),
  claimTeammateTurn: mocks.claimTeammateTurn,
  giveBackTurn: vi.fn(),
}));
vi.mock("@/lib/agents/engine", () => ({
  getOrCreateTeammateSession: vi.fn(async () => ({ id: "s1", created: true })),
  runTeammateTurn: mocks.runTeammateTurn,
  teammateAgentFrom: (r: unknown) => r,
}));
vi.mock("@/lib/agents/acting", () => ({ resolveActingPerson: mocks.resolveActingPerson, personZone: async () => "UTC" }));
vi.mock("@/lib/agents/routines-server", async () => {
  // The routine's next slot, as the runner computes it (its cron's real next minute).
  const { nextCronRun, parseCron } = await import("@/lib/agents/cron");
  return {
    pauseRoutine: mocks.pauseRoutine,
    createRoutine: mocks.createRoutine,
    ROUTINE_RUN_SELECT: {},
    runRoutine: vi.fn(),
    nextRoutineRun: (schedule: string, now: Date) => (parseCron(schedule) ? nextCronRun(schedule, now) : new Date(now.getTime() + 3_600_000)),
    // The teammate as the person resumes it (review round 10).
    routineTeammatePrint: async () => "print-now",
  };
});
vi.mock("@/lib/agents/autonomous", () => ({ computeNextRunAt: () => new Date("2026-10-07T09:00:00Z") }));

import { DELETE as deleteTeammate, GET as getTeammate, PATCH as patchTeammate } from "./route";
import { GET as getActivity } from "./activity/route";
import { PUT as putApprovals } from "./approvals/route";
import { GET as getMemories, POST as postMemory } from "./memories/route";
import { GET as getMessages, POST as postMessage } from "./messages/route";
import { POST as markRead } from "./read/route";
import { GET as getRoutines, POST as postRoutine } from "./routines/route";
import { GET as getAction } from "../../actions/[id]/route";
import { DELETE as deleteMemory, PATCH as patchMemory } from "../../memories/[id]/route";
import { DELETE as deleteRoutine, PATCH as patchRoutine } from "../../routines/[id]/route";
import { POST as runRoutineNow } from "../../routines/[id]/run/route";
import { PEOPLE, db, jsonRequest, paramsOf, resetRouteDb, routeDb, seedAgent, type FakeViewer } from "@/lib/agents/teammate-route-fixtures";

const PRIVATE_SLUG = "t-planner-aaaaaa";
const SHARED_SLUG = "status-reporter";

function seedPrivate() {
  return seedAgent({ slug: PRIVATE_SLUG, name: "Planner", visibility: "PRIVATE", ownerId: "u-max" });
}

function seedShared(o: Record<string, unknown> = {}) {
  return seedAgent({ slug: SHARED_SLUG, name: "Status Reporter", ...o });
}

const slugged = (slug: string) => paramsOf({ slug });

async function call(res: Promise<Response>) {
  const r = await res;
  return { status: r.status, body: await r.json() };
}

beforeEach(() => {
  resetRouteDb();
  mocks.audits.length = 0;
  vi.clearAllMocks();
  modules.talkOn = true;
  modules.tablesOn = true;
});

type Expect = { get: number; patch: number; del: number; canManage?: boolean };

const PRIVATE_MATRIX: Array<[string, FakeViewer, Expect]> = [
  ["its owner", PEOPLE.max, { get: 200, patch: 200, del: 200, canManage: true }],
  ["another member", PEOPLE.lea, { get: 404, patch: 404, del: 404 }],
  ["an Admin", PEOPLE.admin, { get: 404, patch: 404, del: 404 }],
  ["the Owner", PEOPLE.owner, { get: 404, patch: 404, del: 404 }],
  ["a Guest", PEOPLE.guest, { get: 404, patch: 404, del: 404 }],
  ["an agent account", PEOPLE.bot, { get: 404, patch: 404, del: 404 }],
];

const SHARED_MATRIX: Array<[string, FakeViewer, Expect]> = [
  ["a member", PEOPLE.max, { get: 200, patch: 403, del: 403, canManage: false }],
  ["another member", PEOPLE.lea, { get: 200, patch: 403, del: 403, canManage: false }],
  ["an Admin", PEOPLE.admin, { get: 200, patch: 200, del: 200, canManage: true }],
  ["the Owner", PEOPLE.owner, { get: 200, patch: 200, del: 200, canManage: true }],
  ["a Guest", PEOPLE.guest, { get: 404, patch: 404, del: 404 }],
  ["an agent account", PEOPLE.bot, { get: 404, patch: 404, del: 404 }],
];

function runMatrix(rows: Array<[string, FakeViewer, Expect]>, seed: () => void, slug: string) {
  for (const [who, viewer, want] of rows) {
    it(`${who}: open ${want.get}, change ${want.patch}, remove ${want.del}`, async () => {
      seed();
      db.viewer = viewer;
      const got = await call(getTeammate(new Request("http://x"), slugged(slug)));
      expect(got.status).toBe(want.get);
      if (want.get === 200) expect(got.body.canManage).toBe(want.canManage);

      const before = db.agents[0].name;
      const patched = await call(patchTeammate(jsonRequest("PATCH", { name: "Renamed" }), slugged(slug)));
      expect(patched.status).toBe(want.patch);
      if (want.patch === 403) expect(patched.body).toEqual({ error: "An Owner or Admin manages this teammate.", code: "not_manager" });
      expect(db.agents[0].name).toBe(want.patch === 200 ? "Renamed" : before);

      const removed = await call(deleteTeammate(jsonRequest("DELETE"), slugged(slug)));
      expect(removed.status).toBe(want.del);
      expect(db.agents[0].status).toBe(want.del === 200 ? "ARCHIVED" : "ENABLED");
      if (want.patch !== 200 && want.del !== 200) expect(routeDb.writes).toEqual([]);
    });
  }
}

describe("a PRIVATE teammate", () => runMatrix(PRIVATE_MATRIX, seedPrivate, PRIVATE_SLUG));
describe("a WORKSPACE teammate", () => runMatrix(SHARED_MATRIX, () => seedShared(), SHARED_SLUG));

describe("another person's private teammate is not there", () => {
  const ROUTES: Array<[string, (slug: string) => Promise<Response>]> = [
    ["GET teammate", (s) => getTeammate(new Request("http://x"), slugged(s))],
    ["PATCH teammate", (s) => patchTeammate(jsonRequest("PATCH", { name: "Mine now" }), slugged(s))],
    ["DELETE teammate", (s) => deleteTeammate(jsonRequest("DELETE"), slugged(s))],
    ["GET messages", (s) => getMessages(new Request("http://x"), slugged(s))],
    ["POST a message", (s) => postMessage(jsonRequest("POST", { message: "Hello" }), slugged(s))],
    ["POST a continue", (s) => postMessage(jsonRequest("POST", { resume: true }), slugged(s))],
    ["POST read", (s) => markRead(jsonRequest("POST"), slugged(s))],
    ["PUT approvals", (s) => putApprovals(jsonRequest("PUT", { rules: { send_kudos: "always" } }), slugged(s))],
    ["GET memories", (s) => getMemories(new Request("http://x"), slugged(s))],
    ["POST a memory", (s) => postMemory(jsonRequest("POST", { key: "Report day", value: "Monday" }), slugged(s))],
    ["GET routines", (s) => getRoutines(new Request("http://x"), slugged(s))],
    ["POST a routine", (s) => postRoutine(jsonRequest("POST", { name: "Brief", prompt: "Brief me", schedule: "0 9 * * 1-5" }), slugged(s))],
    ["GET activity", (s) => getActivity(new Request("http://x"), slugged(s))],
  ];

  for (const [who, viewer] of [
    ["another member", PEOPLE.lea],
    ["an Admin", PEOPLE.admin],
    ["the Owner", PEOPLE.owner],
  ] as const) {
    it(`answers ${who} exactly as a slug that does not exist, on every route, and changes nothing`, async () => {
      seedPrivate();
      db.viewer = viewer;
      for (const [name, route] of ROUTES) {
        const theirs = await call(route(PRIVATE_SLUG));
        const missing = await call(route("no-such-teammate"));
        expect([name, theirs.status]).toEqual([name, 404]);
        expect([name, theirs.body]).toEqual([name, missing.body]);
        expect(theirs.body).toEqual({ error: "That teammate can't be found.", code: "not_found" });
      }
      expect(routeDb.writes).toEqual([]);
      expect(mocks.claimTeammateTurn).not.toHaveBeenCalled();
      expect(mocks.runTeammateTurn).not.toHaveBeenCalled();
      expect(mocks.createRoutine).not.toHaveBeenCalled();
      expect(mocks.audits).toEqual([]);
    });
  }

  it("resumes a routine only onto a real next time, and starts one paused for no time once it is given one (review round 2)", async () => {
    const agent = seedPrivate();
    db.routines.push({ id: "r1", organizationId: "org1", agentId: agent.id, actingForId: "u-max", name: "Brief", prompt: "Brief me", schedule: "CRON_TZ=UTC 0 9 31 2 *", status: "paused", pausedReason: "no_next_run", nextRunAt: null, lastRunAt: null, lastStatus: null, lastReason: null, createdVia: "chat", createdAt: new Date("2026-10-01T09:00:00Z"), updatedAt: new Date("2026-10-01T09:00:00Z"), agent: { name: agent.name, status: "ENABLED", organizationId: "org1", visibility: "PRIVATE", ownerId: "u-max" } });
    db.viewer = PEOPLE.max;
    const routine = paramsOf({ id: "r1" });
    // Before: Resume stored an hourly fallback, and the runner paused it again.
    const resumed = await call(patchRoutine(jsonRequest("PATCH", { status: "active" }), routine));
    expect(resumed.status).toBe(400);
    expect(resumed.body.code).toBe("invalid_schedule");
    expect(db.routines[0]).toMatchObject({ status: "paused", pausedReason: "no_next_run" });
    // Before: a new schedule left it paused, with a reason that no longer held.
    const fixed = await call(patchRoutine(jsonRequest("PATCH", { schedule: "0 9 * * 1-5" }), routine));
    expect(fixed.status).toBe(200);
    expect(db.routines[0]).toMatchObject({ status: "active", pausedReason: null });
    expect(db.routines[0].nextRunAt).toBeInstanceOf(Date);
  });

  it("answers anyone else's routine, memory and request like a missing one, an Admin's included", async () => {
    const agent = seedPrivate();
    db.routines.push({ id: "r1", organizationId: "org1", agentId: agent.id, actingForId: "u-max", name: "Brief", prompt: "Brief me", schedule: "0 9 * * 1-5", status: "active" });
    db.memories.push({ id: "mem1", agentId: agent.id, key: "Report day", value: "Monday", scope: "person", scopeId: "u-max", agent: { organizationId: "org1", visibility: "PRIVATE", ownerId: "u-max" } });
    db.actions.push({ id: "act1", organizationId: "org1", agentId: agent.id, actingForId: "u-max", status: "PENDING", expiresAt: new Date(Date.now() + 60_000) });
    for (const viewer of [PEOPLE.lea, PEOPLE.admin, PEOPLE.owner]) {
      db.viewer = viewer;
      const routine = paramsOf({ id: "r1" });
      const memory = paramsOf({ id: "mem1" });
      for (const res of [
        patchRoutine(jsonRequest("PATCH", { status: "paused" }), routine),
        deleteRoutine(jsonRequest("DELETE"), routine),
        runRoutineNow(jsonRequest("POST", {}), routine),
      ]) {
        expect(await call(res)).toEqual({ status: 404, body: { error: "That routine can't be found.", code: "not_found" } });
      }
      for (const res of [patchMemory(jsonRequest("PATCH", { value: "Friday" }), memory), deleteMemory(jsonRequest("DELETE"), memory)]) {
        expect(await call(res)).toEqual({ status: 404, body: { error: "That memory can't be found.", code: "not_found" } });
      }
      expect(await call(getAction(new Request("http://x"), paramsOf({ id: "act1" })))).toEqual({
        status: 404,
        body: { error: "That request can't be found.", code: "not_found" },
      });
    }
    expect(routeDb.writes).toEqual([]);
    expect(db.routines).toHaveLength(1);
    expect(db.memories).toHaveLength(1);
  });
});

describe("removing, pausing and adding back", () => {
  it("removes a teammate: ARCHIVED, what waits cancelled, every running routine paused, once", async () => {
    const agent = seedShared({ autonomousEnabled: true, scheduleCron: "0 9 * * 1-5", nextRunAt: new Date("2026-10-07T09:00:00Z") });
    db.routines.push(
      { id: "r-max", organizationId: "org1", agentId: agent.id, actingForId: "u-max", name: "Brief", status: "active" },
      { id: "r-lea", organizationId: "org1", agentId: agent.id, actingForId: "u-lea", name: "Digest", status: "active" },
      { id: "r-off", organizationId: "org1", agentId: agent.id, actingForId: "u-lea", name: "Old", status: "paused" },
    );
    db.viewer = PEOPLE.admin;
    expect(await call(deleteTeammate(jsonRequest("DELETE"), slugged(SHARED_SLUG)))).toEqual({ status: 200, body: { ok: true } });
    expect(db.agents[0]).toMatchObject({ status: "ARCHIVED", autonomousEnabled: false, nextRunAt: null });
    expect(mocks.cancelPendingActionsOf).toHaveBeenCalledWith(expect.objectContaining({ id: agent.id, slug: SHARED_SLUG, name: "Status Reporter" }), expect.any(Date));
    expect(mocks.pauseRoutine.mock.calls.map(([r, reason]) => [r.id, reason])).toEqual([
      ["r-max", "agent_removed"],
      ["r-lea", "agent_removed"],
    ]);
    expect(mocks.audits.map((a) => a.action)).toEqual(["removed"]);

    // A second click: already removed, nothing more happens.
    expect(await call(deleteTeammate(jsonRequest("DELETE"), slugged(SHARED_SLUG)))).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.audits.map((a) => a.action)).toEqual(["removed"]);
    expect(mocks.pauseRoutine).toHaveBeenCalledTimes(2);
  });

  it("stops an agent's own schedule when paused, and counts its next slot from now when turned on", async () => {
    seedShared({ slug: "deal-desk", toolNames: null, autonomousEnabled: true, scheduleCron: "0 9 * * 1-5", nextRunAt: new Date("2026-10-06T09:00:00Z") });
    db.viewer = PEOPLE.admin;
    expect((await call(patchTeammate(jsonRequest("PATCH", { status: "DISABLED" }), slugged("deal-desk")))).status).toBe(200);
    expect(db.agents[0]).toMatchObject({ status: "DISABLED", nextRunAt: null });
    expect((await call(patchTeammate(jsonRequest("PATCH", { status: "ENABLED" }), slugged("deal-desk")))).status).toBe(200);
    expect(db.agents[0]).toMatchObject({ status: "ENABLED", nextRunAt: new Date("2026-10-07T09:00:00Z") });
    expect(mocks.audits.map((a) => a.action)).toEqual(["paused", "turned_on"]);
  });

  it("stops an agent's old schedule in the open when its tools are first chosen here (review round 2)", async () => {
    // Before: it left Workspace agents and its schedule stopped with no word.
    seedShared({ slug: "deal-desk", toolNames: null, autonomousEnabled: true, scheduleCron: "0 9 * * 1-5", nextRunAt: new Date("2026-10-07T09:00:00Z") });
    db.viewer = PEOPLE.admin;
    const res = await call(patchTeammate(jsonRequest("PATCH", { toolNames: ["search_tasks"] }), slugged("deal-desk")));
    expect(res.status).toBe(200);
    expect(res.body.scheduleStopped).toBe(true);
    expect(db.agents[0]).toMatchObject({ toolNames: ["search_tasks"], autonomousEnabled: false, nextRunAt: null });
    expect(mocks.audits.find((a) => a.action === "edited")?.metadata).toEqual({ fields: ["tools", "schedule"] });
    // Its tools chosen again: nothing more to stop.
    const again = await call(patchTeammate(jsonRequest("PATCH", { toolNames: ["search_tasks", "create_task"] }), slugged("deal-desk")));
    expect(again.body.scheduleStopped).toBeUndefined();
  });

  it("keeps managers to tightening, and records what changed", async () => {
    seedShared();
    db.viewer = PEOPLE.admin;
    const res = await call(
      patchTeammate(jsonRequest("PATCH", { job: "Writes the weekly status.", agentRules: { create_task: "ask", send_kudos: "always" }, monthlyQuestionCap: 40 }), slugged(SHARED_SLUG)),
    );
    expect(res.status).toBe(200);
    expect(db.agents[0]).toMatchObject({ description: "Writes the weekly status.", approvalRules: { create_task: "ask" }, monthlyQuestionCap: 40 });
    expect(res.body.teammate).toMatchObject({ job: "Writes the weekly status.", monthlyQuestionCap: 40, usage: { month: "2026-10-01", used: 4, cap: 40 } });
    // No cost in cents anywhere in what the drawer reads.
    expect(JSON.stringify(res.body)).not.toMatch(/cents/i);
    expect(mocks.audits.map((a) => [a.action, a.metadata])).toEqual([
      ["edited", { fields: ["job", "monthlyQuestionCap"] }],
      ["approvals_changed", { scope: "agent" }],
    ]);
  });

  it("keeps what is stored for a tool whose module is off when its tools are saved", async () => {
    seedShared({ toolNames: ["post_in_talk", "read_talk", "search_tasks"] });
    db.viewer = PEOPLE.admin;
    modules.talkOn = false;
    // The tools tab sends what it shows: the Talk tools read as off while Talk is.
    const saved = await call(patchTeammate(jsonRequest("PATCH", { toolNames: ["search_tasks", "create_task"] }), slugged(SHARED_SLUG)));
    expect(saved.status).toBe(200);
    expect(db.agents[0].toolNames).toEqual(["create_task", "post_in_talk", "read_talk", "search_tasks"]);
    expect(saved.body.teammate.toolNames).toEqual(["create_task", "search_tasks"]);

    // Nor can a save add one while its module is off.
    seedShared({ slug: "digest", toolNames: ["search_tasks"] });
    await call(patchTeammate(jsonRequest("PATCH", { toolNames: ["search_tasks", "post_in_talk"] }), slugged("digest")));
    expect(db.agents[1].toolNames).toEqual(["search_tasks"]);

    // With Talk on, the save is what was sent.
    modules.talkOn = true;
    await call(patchTeammate(jsonRequest("PATCH", { toolNames: ["search_tasks"] }), slugged(SHARED_SLUG)));
    expect(db.agents[0].toolNames).toEqual(["search_tasks"]);
  });

  it("changes a removed teammate only by adding it back, within the plan's limit", async () => {
    seedPrivate().status = "ARCHIVED";
    db.viewer = PEOPLE.max;
    expect(await call(patchTeammate(jsonRequest("PATCH", { name: "Again" }), slugged(PRIVATE_SLUG)))).toEqual({
      status: 409,
      body: { error: "Planner was removed. Its chat is kept.", code: "agent_removed" },
    });
    for (const s of ["t-a-111111", "t-b-222222", "t-c-333333"]) seedAgent({ slug: s, visibility: "PRIVATE", ownerId: "u-max" });
    const full = await call(patchTeammate(jsonRequest("PATCH", { restore: true }), slugged(PRIVATE_SLUG)));
    expect(full.status).toBe(403);
    expect(full.body.code).toBe("limit");
    expect(db.agents[0].status).toBe("ARCHIVED");

    db.agents = db.agents.filter((a) => a.slug !== "t-c-333333");
    const back = await call(patchTeammate(jsonRequest("PATCH", { restore: true }), slugged(PRIVATE_SLUG)));
    expect(back.status).toBe(200);
    expect(db.agents[0].status).toBe("ENABLED");
    expect(mocks.audits.map((a) => [a.action, a.metadata])).toEqual([["added", { restored: true }]]);
  });
});
