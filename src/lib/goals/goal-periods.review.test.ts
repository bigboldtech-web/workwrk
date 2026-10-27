// Repeating goals, the step 2 review (6 medium, 11 low). Each `it` names the
// finding it proves. Same world as goal-periods.server.test.ts: the real
// routes, the real period module and rollup, over the in-memory database of
// goal-test-db.ts (its locks wait, its statements and iterations are
// counted), an Admin in one Asia/Kolkata workspace.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

const { patchSpy, activity } = vi.hoisted(() => ({
  patchSpy: vi.fn<(tx: unknown, periodId: string) => Promise<void>>(async () => {}),
  activity: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./goal-test-db")).goalDb.prisma }));
vi.mock("server-only", () => ({}));

const ORG = "org-1";
const BOSS = "u-boss";
const TWO = "u-two";
const session = legacyTestSession(BOSS, "COMPANY_ADMIN", ORG);

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session }),
  getOrgId: (s: { user: { organizationId: string } }) => s.user.organizationId,
  getUserId: (s: { user: { id: string } }) => s.user.id,
  isManager: () => true,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("next-auth", () => ({ getServerSession: async () => session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/preferences", () => ({ getEffectivePreferences: async () => null }));
vi.mock("@/lib/alignment-scope", () => ({
  goalRightsActor: async (s: { user: { id: string } }) => ({ callerId: s.user.id, admin: true, peopleTeam: true, manager: true, agent: false, chain: null, leadsPeople: true }),
  goalCreatorIds: async () => new Map(),
  isOrgWideAlignment: () => true,
  canEditGoal: async () => true,
  canDeleteGoal: async () => true,
}));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [BOSS] }));
vi.mock("@/lib/access/manager-lines", () => ({ effectiveDirectReportIds: async () => [], countedDottedReportIds: async () => [] }));
vi.mock("@/lib/goal-audience", () => ({
  addGoalAssignees: async () => {},
  canSeeGoal: async () => true,
  goalEditDenial: async () => null,
  memberVisibilityOr: () => [],
  seesUnownedGoals: () => true,
  summarizeGoalAudiences: async (_o: string, list: Array<{ id: string }>) => new Map(list.map((g) => [g.id, { members: [], totalMembers: 0, assigneeCount: 0 }])),
  syncGoalAssignees: async () => {},
  teamAudienceVisibilityOr: async () => [],
  validateGoalAssignees: async () => ({ ok: true, entries: [] }),
  goalVisibilityOr: async () => null,
}));
vi.mock("@/lib/user-tags", () => ({ getUserTagIds: async () => [] }));
vi.mock("@/lib/goals/goal-notify", () => ({ notifyGoalAssigned: async () => {} }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => {}, queueEmail: async () => {} }));
vi.mock("@/lib/email-templates", () => ({ genericNotificationTemplate: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/goal-effort", () => ({
  goalsWithLinkedWork: async () => new Set(),
  computeGoalEffortBatch: async () => new Map(),
  computeGoalEffort: async () => ({ hasLinkedWork: false, linkedKras: 0, linkedBoards: 0, totalHours: 0, hoursThisMonth: 0, tasksDone: 0, tasksOpen: 0, lastActivityAt: null, contributors: [] }),
}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/goals/goal-contributor", () => ({ isGoalContributor: async () => false }));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => {} }));
vi.mock("@/lib/activity", () => ({ logActivity: (a: Record<string, unknown>) => { activity.push(a); } }));
vi.mock("@/lib/goals/goal-period-score.server", () => ({ patchPeriodScore: patchSpy }));
vi.mock("@/lib/ai/ai-off-gate", () => ({ aiOffResponse: async () => true }));

import { goalDb as db, seedRow } from "./goal-test-db";
import { filterGoals, parseGoalsListQuery } from "./goal-list";
import * as okrsRoute from "@/app/api/okrs/route";
import * as okrRoute from "@/app/api/okrs/[id]/route";
import * as checkInRoute from "@/app/api/okrs/[id]/check-in/route";
import * as assessRoute from "@/app/api/okrs/[id]/assess/route";
import * as myOkrsRoute from "@/app/api/okrs/my-okrs/route";
import * as krsRoute from "@/app/api/okrs/[id]/key-results/route";
import * as krRoute from "@/app/api/okrs/[id]/key-results/[krId]/route";
import * as periodsRoute from "@/app/api/okrs/[id]/periods/route";
import * as cronRoute from "@/app/api/cron/goal-periods/route";
import * as homeRoute from "@/app/api/me/home/route";

// Read where called, so each test fails on its own against code without them.
const server = () => import("./goal-periods.server");
const verdictsModule = () => import("./goal-verdicts.server");
const alignment = () => import("@/lib/alignment");
const profile = () => import("@/lib/person-alignment");

const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);
const OCT_KEY = "2026-10-01";

type Json = Record<string, unknown> & { error?: string };
type Handler = (req: never, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(handler: unknown, url: string, init: { method?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<{ status: number; body: Json }> {
  const req = new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await (handler as Handler)(req as never, { params: Promise.resolve(init.params ?? {}) });
  return { status: res.status, body: (await res.json()) as Json };
}

const at = (t: Date) => vi.setSystemTime(t);
const rows = (model: string) => (db.rows[model] ?? []) as Array<Record<string, unknown>>;
const periodsOf = (okrId: string) => rows("goalPeriod").filter((p) => p.okrId === okrId).sort((a, b) => (a.startsAt as Date).getTime() - (b.startsAt as Date).getTime());
const rowOf = (krId: string, periodId: unknown) => rows("keyResultPeriod").find((r) => r.keyResultId === krId && r.periodId === periodId);
const okrRow = (id: string) => rows("oKR").find((o) => o.id === id)!;
const krsOf = (okrId: string) => rows("keyResult").filter((k) => k.okrId === okrId);
const ms = (d: unknown) => (d as Date).getTime();

async function createGoalAt(t: Date, body: Record<string, unknown>) {
  at(t);
  const r = await call(okrsRoute.POST, "/api/okrs", { method: "POST", body: { level: "INDIVIDUAL", ownerId: BOSS, ...body } });
  return { id: String(r.body.id), status: r.status, body: r.body };
}
async function patch(t: Date, body: Record<string, unknown>) {
  at(t);
  return call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body });
}
async function checkIn(t: Date, okrId: string, keyResultId: string, value: number, periodKey?: string) {
  at(t);
  return call(checkInRoute.POST, `/api/okrs/${okrId}/check-in`, { method: "POST", params: { id: okrId }, body: { keyResultId, value, ...(periodKey ? { periodKey } : {}) } });
}
async function runCron(t: Date) {
  at(t);
  return call(cronRoute.POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
}
async function list(t: Date) {
  at(t);
  const r = await call(okrsRoute.GET, "/api/okrs?page=1&includeCompleted=1");
  return r as { status: number; body: { data: Array<Json & { id: string; progress: number; verdict: string; isStale: boolean }> } & Json };
}

/** A repeating goal written straight into the store, with no period yet (as if every read since had failed). */
function seedMonthly(id: string, createdAt: Date, krs = 1, extra: Record<string, unknown> = {}) {
  seedRow(db, "oKR", { id, organizationId: ORG, title: id, level: "INDIVIDUAL", ownerId: BOSS, repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt, ...extra });
  for (let i = 0; i < krs; i++) seedRow(db, "keyResult", { id: `${id}-kr${i}`, okrId: id, title: `T${i}`, startValue: 0, targetValue: 10, currentValue: 0, createdAt });
}

function seedOneTime(id: string) {
  seedRow(db, "oKR", { id, organizationId: ORG, title: `Goal ${id}`, level: "INDIVIDUAL", ownerId: BOSS, startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), checkInCadence: "MONTHLY", createdAt: ist(2026, 9, 1) });
  seedRow(db, "keyResult", { id: `${id}-kr`, okrId: id, title: "Deals", startValue: 0, targetValue: 100, currentValue: 38, progress: 38, createdAt: ist(2026, 9, 1) });
  seedRow(db, "kRCheckIn", { id: `${id}-c1`, keyResultId: `${id}-kr`, value: 30, userId: BOSS, createdAt: ist(2026, 9, 30, 12) });
  seedRow(db, "kRCheckIn", { id: `${id}-c2`, keyResultId: `${id}-kr`, value: 38, userId: BOSS, createdAt: ist(2026, 10, 10, 12) });
}

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.reset();
  activity.length = 0;
  patchSpy.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.RECURRING_GOALS = "1";
  process.env.CRON_SECRET = "test-secret";
  seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
  seedRow(db, "user", { id: BOSS, organizationId: ORG, firstName: "Bo", lastName: "Ss", email: "boss@acme.test", status: "ACTIVE", deletedAt: null });
  seedRow(db, "user", { id: TWO, organizationId: ORG, firstName: "Tu", lastName: "Wo", email: "two@acme.test", status: "ACTIVE", deletedAt: null });
  seedRow(db, "kPI", { id: "kpi-1", organizationId: ORG, name: "Revenue", unit: null, direction: "HIGHER", lowerIsBetter: false, targetValue: 100, ownership: "OWNED", isNorthStar: false });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errors.mockRestore();
});

afterAll(() => {
  delete process.env.RECURRING_GOALS;
  delete process.env.CRON_SECRET;
});

describe("M1: a conversion or a restart opens its first period inside the PATCH transaction", () => {
  it("a settle landing right after the update cannot open the conversion's October the ordinary way", async () => {
    seedOneTime("g-conv");
    const t = ist(2026, 10, 12, 10);
    // The gap the old code left: any settle between the update's commit and the opening.
    db.afterCommit = async () => { await (await server()).settleGoalPeriods(ORG, ["g-conv"], t); };
    const r = await patch(t, { id: "g-conv", repeat: "MONTHLY", firstPeriodStart: "change" });
    expect(r.status).toBe(200);
    const [oct] = periodsOf("g-conv");
    expect(periodsOf("g-conv")).toHaveLength(1);
    expect(rowOf("g-conv-kr", oct.id)).toMatchObject({ currentValue: 8 });
    expect(ms(oct.trackedFrom)).toBe(t.getTime());
  });

  it("a settle landing right after a restart cannot invent April to September", async () => {
    const g = await createGoalAt(ist(2026, 3, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    expect((await patch(ist(2026, 3, 20), { id: g.id, stopRepeating: true })).status).toBe(200);
    await runCron(ist(2026, 4, 6, 0, 5));
    expect(okrRow(g.id).completedAt).toBeInstanceOf(Date);
    const t = ist(2026, 10, 10, 10);
    db.afterCommit = async () => { await (await server()).settleGoalPeriods(ORG, [g.id], t); };
    expect((await patch(t, { id: g.id, repeatUntil: null })).status).toBe(200);
    expect(periodsOf(g.id).map((p) => p.key)).toEqual(["2026-03-01", OCT_KEY]);
    expect(ms(periodsOf(g.id)[1].trackedFrom)).toBe(t.getTime());
  });
});

describe("M2: one verdict everywhere, and staleness inside the period", () => {
  it("the same goal gives the same verdict on the list, the page, the profile and assess", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    await checkIn(ist(2026, 10, 6), g.id, String(krsOf(g.id)[0].id), 10);
    const t = ist(2026, 10, 25);
    const listed = (await list(t)).body.data.find((o) => o.id === g.id)!.verdict;
    at(t);
    const assessed = (await call(assessRoute.GET, `/api/okrs/${g.id}/assess`, { params: { id: g.id } })).body.verdict;
    const person = await (await profile()).buildPersonAlignment(ORG, BOSS);
    const profiled = (person.okrs as Array<{ id: string; verdict: string }>).find((o) => o.id === g.id)!.verdict;
    // The goal page reads goalVerdicts with the goal it loaded (its include) and the org rollup.
    const okr = await (db.prisma as never as { oKR: { findFirst: (a: unknown) => Promise<Record<string, unknown>> } }).oKR.findFirst({ where: { id: g.id }, include: { keyResults: true } });
    const ctx = await (await alignment()).computeGoalRollups(ORG, t);
    const paged = (await (await verdictsModule()).goalVerdicts(ctx, [okr as never], new Set(), t)).verdicts.get(g.id)!.verdict;
    // 25% done with three quarters of October used, paced from trackedFrom.
    expect(listed).toBe("off_track");
    expect([assessed, profiled, paged]).toEqual([listed, listed, listed]);
  });

  it("a 28 Oct check-in does not make November stale on 4 Nov", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    await checkIn(ist(2026, 10, 28, 9), g.id, String(krsOf(g.id)[0].id), 10);
    const row = (await list(ist(2026, 11, 4, 18))).body.data.find((o) => o.id === g.id)!;
    expect(row.isStale).toBe(false);
  });

  it("a late October check-in on 3 Nov does not count as fresh for November", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    expect((await checkIn(ist(2026, 11, 3), g.id, String(krsOf(g.id)[0].id), 30, OCT_KEY)).status).toBe(200);
    const row = (await list(ist(2026, 11, 9, 12))).body.data.find((o) => o.id === g.id)!;
    // Weekly reminders: 8 days into November with nothing checked into it.
    expect(row.isStale).toBe(true);
  });
});

describe("M3: settle in chunks, and no read path fails on it", () => {
  it("opens many goals in transactions of at most CHUNK goals, sorted", async () => {
    for (let i = 0; i < 350; i++) seedMonthly(`g-${String(i).padStart(3, "0")}`, ist(2026, 10, 2));
    at(ist(2026, 10, 15));
    const { settleGoalPeriods, CHUNK } = await server();
    const r = await settleGoalPeriods(ORG, null, ist(2026, 10, 15));
    expect(r.opened).toBe(350);
    expect(CHUNK).toBeGreaterThanOrEqual(100);
    expect(CHUNK).toBeLessThanOrEqual(200);
    const batches = db.raw.filter((t) => /pg_advisory_xact_lock\(s\.h\)/.test(t));
    expect(batches).toHaveLength(Math.ceil(350 / CHUNK));
    expect(db.raw.filter((t) => /pg_advisory_xact_lock\(hashtext\(/.test(t))).toHaveLength(0);
  });

  it("every read path carries on with the stored numbers when settling fails, and logs it once", async () => {
    // A legacy quarter label too, so my-okrs (which filters by it) reads the goal.
    seedMonthly("g-read", ist(2026, 10, 2), 1, { quarter: "x" });
    const t = ist(2026, 10, 15);
    const fail = () => { db.failNext = { what: "goalPeriod.createMany" }; };
    const logged = () => errors.mock.calls.filter((c) => String(c[0]).includes("[goal-periods] settling on")).length;

    fail();
    expect((await list(t)).status).toBe(200);
    expect(logged()).toBe(1);
    fail();
    at(t);
    expect((await call(okrRoute.GET, "/api/okrs/g-read", { params: { id: "g-read" } })).status).toBe(200);
    fail();
    expect((await call(assessRoute.GET, "/api/okrs/g-read/assess", { params: { id: "g-read" } })).status).toBe(200);
    fail();
    expect((await call(periodsRoute.GET, "/api/okrs/g-read/periods", { params: { id: "g-read" } })).status).toBe(200);
    fail();
    expect((await (myOkrsRoute.GET as (r: Request) => Promise<Response>)(new Request("http://localhost/api/okrs/my-okrs?quarter=x"))).status).toBe(200);
    fail();
    const home = (await (await (homeRoute.GET as () => Promise<Response>)()).json()) as { goals: { rows: Array<{ id: string }> } | null };
    expect(home.goals?.rows.map((r) => r.id)).toContain("g-read");
    fail();
    await expect((await profile()).buildPersonAlignment(ORG, BOSS)).resolves.toBeTruthy();
    expect(logged()).toBe(7);
    expect(periodsOf("g-read")).toHaveLength(0);
    // The next read opens it, once.
    await list(t);
    expect(periodsOf("g-read")).toHaveLength(1);
  });

  it("the cron closes due periods even when that workspace's settle failed", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    db.failNext = { what: "goalPeriod.createMany" };
    const r = await runCron(ist(2026, 11, 6, 0, 5));
    expect(r.status).toBe(500);
    expect(periodsOf(g.id)[0]).toMatchObject({ key: OCT_KEY, status: "CLOSED" });
  });

  it("a goal deleted between the locked re-read and the inserts is skipped, and the rest open", async () => {
    seedMonthly("g-keep", ist(2026, 10, 2));
    seedMonthly("g-gone", ist(2026, 10, 2));
    let deletion: Promise<unknown> | null = null;
    db.beforeStatement = (what) => {
      if (what !== "goalPeriod.createMany" || deletion) return;
      // A delete of the goal, started while the opening holds it.
      deletion = (db.prisma as never as { oKR: { delete: (a: unknown) => Promise<unknown> } }).oKR.delete({ where: { id: "g-gone" } });
    };
    at(ist(2026, 10, 15));
    await expect((await server()).settleGoalPeriods(ORG, ["g-keep", "g-gone"], ist(2026, 10, 15))).resolves.toMatchObject({ opened: 2 });
    db.beforeStatement = null;
    await deletion;
    expect(periodsOf("g-keep")).toHaveLength(1);
    expect(rows("oKR").some((o) => o.id === "g-gone")).toBe(false);
    expect(periodsOf("g-gone")).toHaveLength(0);
  });

  it("createGoal answers with the goal when its first period fails to open, and the next read opens it once", async () => {
    db.failNext = { what: "goalPeriod.createMany" };
    const g = await createGoalAt(ist(2026, 10, 10), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    expect(g.status).toBe(201);
    expect(g.body.period).toBeNull();
    expect(rows("oKR")).toHaveLength(1);
    await list(ist(2026, 10, 10, 13));
    await list(ist(2026, 10, 10, 14));
    expect(periodsOf(g.id)).toHaveLength(1);
  });
});

describe("M4: the cost of settling grows with the goals, not their square", () => {
  async function settleCost(n: number) {
    db.reset();
    seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
    for (let i = 0; i < n; i++) seedMonthly(`c-${String(i).padStart(5, "0")}`, ist(2026, 10, 2), 3);
    at(ist(2026, 10, 15));
    const before = { statements: db.stats.statements, iterations: db.stats.iterations };
    const r = await (await server()).settleGoalPeriods(ORG, null, ist(2026, 10, 15));
    expect(r.opened).toBe(n);
    return { statements: db.stats.statements - before.statements, iterations: db.stats.iterations - before.iterations };
  }

  it("2,000 repeating goals with 3 targets settle in a bounded number of statements, and the in-memory work stays linear", async () => {
    const small = await settleCost(500);
    const large = await settleCost(2000);
    expect(rows("keyResultPeriod")).toHaveLength(6000);
    // A fixed handful per chunk of goals and per settle, never one per goal.
    expect(large.statements).toBeLessThan(220);
    expect(large.statements - small.statements).toBeLessThan(140);
    // Four times the goals is about four times the work (a scan inside a loop would be sixteen).
    expect(large.iterations).toBeLessThan(small.iterations * 5);
    expect(large.iterations).toBeLessThan(2000 * 3 * 40);
  }, 60_000);
});

describe("M5: undoing a mistaken conversion", () => {
  it("with nothing checked into the period, the targets and the dates go back to what they were", async () => {
    seedOneTime("g-undo");
    expect((await patch(ist(2026, 10, 12, 10), { id: "g-undo", repeat: "MONTHLY", firstPeriodStart: "start" })).status).toBe(200);
    expect(krsOf("g-undo")[0]).toMatchObject({ currentValue: 0 });
    expect(okrRow("g-undo")).toMatchObject({ startDate: new Date("2026-10-01T00:00:00Z"), endDate: null });
    expect((await patch(ist(2026, 10, 12, 11), { id: "g-undo", repeat: null })).status).toBe(200);
    expect(periodsOf("g-undo")).toHaveLength(0);
    expect(krsOf("g-undo")[0]).toMatchObject({ currentValue: 38, progress: 38 });
    expect(okrRow("g-undo")).toMatchObject({ repeat: null, startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z") });
  });

  it("with check-ins in the period, the targets keep the period's numbers and Activity says so", async () => {
    seedOneTime("g-kept");
    await patch(ist(2026, 10, 12, 10), { id: "g-kept", repeat: "MONTHLY", firstPeriodStart: "start" });
    expect((await checkIn(ist(2026, 10, 13), "g-kept", "g-kept-kr", 12)).status).toBe(200);
    expect((await patch(ist(2026, 10, 14), { id: "g-kept", repeat: null })).status).toBe(200);
    expect(krsOf("g-kept")[0]).toMatchObject({ currentValue: 12 });
    expect(activity.map((a) => a.description)).toContain("Stopped repeating. Targets keep October 2026's numbers.");
    // The check-in stays in Activity with no period.
    expect(rows("kRCheckIn").find((c) => c.value === 12)).toMatchObject({ periodId: null });
  });
});

describe("M6: a KPI-held period reads the KPI and person it was opened for", () => {
  async function kpiGoal() {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Revenue", repeat: "MONTHLY", keyResults: [{ title: "Revenue", startValue: 0, targetValue: 100, kpiId: "kpi-1" }] });
    seedRow(db, "kPIRecord", { id: "r-boss", kpiId: "kpi-1", userId: BOSS, period: "2026-10", actualValue: 70, status: "APPROVED", updatedAt: ist(2026, 11, 2) });
    seedRow(db, "kPIRecord", { id: "r-two", kpiId: "kpi-1", userId: TWO, period: "2026-10", actualValue: 20, status: "APPROVED", updatedAt: ist(2026, 11, 2) });
    return { id: g.id, kr: String(krsOf(g.id)[0].id) };
  }

  it("reassigning the goal on 10 Nov doesn't change October", async () => {
    const g = await kpiGoal();
    expect(rowOf(g.kr, periodsOf(g.id)[0].id)).toMatchObject({ kpiId: "kpi-1", kpiUserId: BOSS });
    await list(ist(2026, 11, 2));
    expect((await patch(ist(2026, 11, 10), { id: g.id, ownerId: TWO })).status).toBe(200);
    const [oct, nov] = periodsOf(g.id);
    expect(rowOf(g.kr, oct.id)).toMatchObject({ kpiUserId: BOSS });
    // The period running now reads the new owner.
    expect(rowOf(g.kr, nov.id)).toMatchObject({ kpiUserId: TWO });
    await runCron(new Date("2026-12-01T14:05:00Z"));
    expect(periodsOf(g.id)[0]).toMatchObject({ status: "CLOSED", progress: 70 });
    expect(rowOf(g.kr, oct.id)).toMatchObject({ currentValue: 70 });
  });

  it("unlinking the KPI on 10 Nov doesn't change October", async () => {
    const g = await kpiGoal();
    await list(ist(2026, 11, 2));
    at(ist(2026, 11, 10));
    const r = await call(krRoute.PATCH, `/api/okrs/${g.id}/key-results/${g.kr}`, { method: "PATCH", params: { id: g.id, krId: g.kr }, body: { kpiId: null } });
    expect(r.status).toBe(200);
    const [oct, nov] = periodsOf(g.id);
    expect(ms(oct.closesAt)).toBe(Date.parse("2026-12-01T14:00:00Z"));
    expect(rowOf(g.kr, oct.id)).toMatchObject({ kpiId: "kpi-1" });
    expect(rowOf(g.kr, nov.id)).toMatchObject({ kpiId: null });
    await runCron(ist(2026, 11, 20));
    expect(periodsOf(g.id)[0]).toMatchObject({ status: "OPEN" });
    await runCron(new Date("2026-12-01T14:05:00Z"));
    expect(periodsOf(g.id)[0]).toMatchObject({ status: "CLOSED", progress: 70 });
  });
});

describe("the lows", () => {
  it("L1: a KPI-held child holds its parent's close for the same period", async () => {
    const parent = await createGoalAt(ist(2026, 10, 5), { title: "Company", level: "COMPANY", repeat: "MONTHLY" });
    const child = await createGoalAt(ist(2026, 10, 5), { title: "Sales", level: "DEPARTMENT", parentId: parent.id, repeat: "MONTHLY", keyResults: [{ title: "Revenue", startValue: 0, targetValue: 100, kpiId: "kpi-1" }] });
    expect(ms(periodsOf(parent.id)[0].closesAt)).toBe(Date.parse("2026-12-01T14:00:00Z"));
    seedRow(db, "kPIRecord", { id: "r-oct", kpiId: "kpi-1", userId: BOSS, period: "2026-10", actualValue: 80, status: "APPROVED", updatedAt: ist(2026, 11, 20) });
    await runCron(ist(2026, 11, 6, 0, 5));
    expect(periodsOf(parent.id)[0]).toMatchObject({ status: "OPEN" });
    await runCron(new Date("2026-12-01T14:05:00Z"));
    expect(periodsOf(child.id)[0]).toMatchObject({ status: "CLOSED", progress: 80 });
    expect(periodsOf(parent.id)[0]).toMatchObject({ status: "CLOSED", progress: 80 });
  });

  it("L2: a parent in grace reads a one-time child as of the period's end, repeating goals under it included, and freezes on that", async () => {
    const p = await createGoalAt(ist(2026, 10, 5), { title: "Company", level: "COMPANY", repeat: "MONTHLY" });
    const c = await createGoalAt(ist(2026, 10, 5), { title: "Launch", parentId: p.id, startDate: "2026-10-01", endDate: "2026-12-31", keyResults: [{ title: "Done", startValue: 0, targetValue: 100 }] });
    const gc = await createGoalAt(ist(2026, 10, 5), { title: "Weekly calls", parentId: c.id, repeat: "MONTHLY", keyResults: [{ title: "Calls", startValue: 0, targetValue: 100 }] });
    await checkIn(ist(2026, 10, 20), c.id, String(krsOf(c.id)[0].id), 50);
    await checkIn(ist(2026, 10, 20), gc.id, String(krsOf(gc.id)[0].id), 60);
    await checkIn(ist(2026, 11, 2), c.id, String(krsOf(c.id)[0].id), 90);
    at(ist(2026, 11, 3));
    const read = await call(periodsRoute.GET, `/api/okrs/${p.id}/periods`, { params: { id: p.id } });
    const oct = (read.body.data as Array<{ key: string; state: string; progress: number }>).find((x) => x.key === OCT_KEY)!;
    expect(oct.state).toBe("grace");
    // The one-time child as of 31 October: its target at 50, its repeating child's October at 60.
    expect(oct.progress).toBe(55);
    await runCron(ist(2026, 11, 6, 0, 5));
    expect(periodsOf(p.id)[0]).toMatchObject({ status: "CLOSED", progress: 55 });
  });

  it("L3: deleting a KPI target lets its period close on its grace again", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Two", repeat: "MONTHLY", keyResults: [{ title: "Revenue", startValue: 0, targetValue: 100, kpiId: "kpi-1" }, { title: "Calls", startValue: 0, targetValue: 10 }] });
    const kpiKr = String(krsOf(g.id).find((k) => k.kpiId)!.id);
    expect(ms(periodsOf(g.id)[0].closesAt)).toBe(Date.parse("2026-12-01T14:00:00Z"));
    at(ist(2026, 10, 20));
    expect((await call(krRoute.DELETE, `/api/okrs/${g.id}/key-results/${kpiKr}`, { method: "DELETE", params: { id: g.id, krId: kpiKr } })).status).toBe(200);
    expect(ms(periodsOf(g.id)[0].closesAt)).toBe(ist(2026, 11, 6, 0, 0).getTime());
  });

  it("L3: a KPI target added in November never moves the close of an October in its grace", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Calls", repeat: "MONTHLY", keyResults: [{ title: "Calls", startValue: 0, targetValue: 10 }] });
    await list(ist(2026, 11, 3));
    at(ist(2026, 11, 3, 13));
    const r = await call(krsRoute.POST, `/api/okrs/${g.id}/key-results`, { method: "POST", params: { id: g.id }, body: { title: "Revenue", targetValue: 100, kpiId: "kpi-1" } });
    expect(r.status).toBe(201);
    const [oct, nov] = periodsOf(g.id);
    expect(ms(oct.closesAt)).toBe(ist(2026, 11, 6, 0, 0).getTime());
    expect(rows("keyResultPeriod").filter((x) => x.periodId === oct.id)).toHaveLength(1);
    // November has the new row, and waits for November's KPI month.
    expect(ms(nov.closesAt)).toBe(Date.parse("2027-01-01T14:00:00Z"));
  });

  it("L4: one period failing to close never stops the others", async () => {
    const a = await createGoalAt(ist(2026, 10, 5), { title: "A", repeat: "MONTHLY", keyResults: [{ title: "A", startValue: 0, targetValue: 10 }] });
    const b = await createGoalAt(ist(2026, 10, 5), { title: "B", repeat: "MONTHLY", keyResults: [{ title: "B", startValue: 0, targetValue: 10 }] });
    await list(ist(2026, 11, 6, 0, 1));
    db.failNext = { what: "goalPeriod.findUnique" };
    const r = await runCron(ist(2026, 11, 6, 0, 5));
    expect(r.status).toBe(500);
    expect([periodsOf(a.id)[0].status, periodsOf(b.id)[0].status].sort()).toEqual(["CLOSED", "OPEN"]);
    await runCron(ist(2026, 11, 6, 0, 35));
    expect([periodsOf(a.id)[0].status, periodsOf(b.id)[0].status]).toEqual(["CLOSED", "CLOSED"]);
    expect(patchSpy).toHaveBeenCalledTimes(2);
  });

  it("L5: two callers whose chains cross write in id order", async () => {
    for (const id of ["g-a", "g-b"]) {
      seedRow(db, "oKR", { id, organizationId: ORG, title: id, level: "INDIVIDUAL", ownerId: BOSS, progress: 0, status: "ON_TRACK", createdAt: ist(2026, 10, 1) });
      seedRow(db, "keyResult", { id: `${id}-kr`, okrId: id, title: "T", startValue: 0, targetValue: 10, currentValue: 5, progress: 50, createdAt: ist(2026, 10, 1) });
    }
    at(ist(2026, 10, 2));
    const { persistGoalRollupChains } = await alignment();
    await Promise.all([persistGoalRollupChains(ORG, ["g-b", "g-a"]), persistGoalRollupChains(ORG, ["g-a", "g-b"])]);
    const order = db.log.filter((l) => l.startsWith("oKR.update"));
    expect(order).toEqual(["oKR.update g-a", "oKR.update g-b", "oKR.update g-a", "oKR.update g-b"]);
  });

  it("L6: the goal lock is hashtextextended, and a batch takes its locks in key order in one statement", async () => {
    seedMonthly("g-l6a", ist(2026, 10, 2));
    seedMonthly("g-l6b", ist(2026, 10, 2));
    at(ist(2026, 10, 15));
    await (await server()).settleGoalPeriods(ORG, null, ist(2026, 10, 15));
    const g = await createGoalAt(ist(2026, 10, 15), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    await checkIn(ist(2026, 10, 16), g.id, String(krsOf(g.id)[0].id), 4);
    expect(db.raw.some((t) => /SELECT pg_advisory_xact_lock\(s\.h\) FROM \(SELECT DISTINCT hashtextextended\('goal-periods:' \|\| k, 0\) AS h FROM unnest\(\?::text\[\]\) AS k ORDER BY h\) AS s/.test(t))).toBe(true);
    expect(db.raw.some((t) => /SELECT pg_advisory_xact_lock\(hashtextextended\('goal-periods:' \|\| \?, 0\)\)/.test(t))).toBe(true);
    expect(db.raw.some((t) => /hashtext\(/.test(t))).toBe(false);
  });

  it("L7: a hit repeating goal created before the quarter still shows; a stopped one does not", () => {
    const q = parseGoalsListQuery(new URLSearchParams("page=1"));
    const base = { title: "x", level: "INDIVIDUAL", ownerId: BOSS, endDate: null, createdAt: "2026-01-05T00:00:00Z", progress: 100, progressSource: "ROLLUP", verdict: "completed" as const, isStale: false, lastCheckInAt: null };
    const shown = filterGoals([
      { ...base, id: "running", repeat: "MONTHLY", completedAt: null },
      { ...base, id: "stopped", repeat: "MONTHLY", completedAt: "2026-03-06T00:00:00Z" },
      { ...base, id: "one-time", repeat: null, completedAt: null },
    ], q, { quarterStart: new Date("2026-10-01T00:00:00Z") });
    expect(shown.map((r) => r.id)).toEqual(["running"]);
  });

  it("L8: Ends on a goal that has not started is read against its first period", async () => {
    const g = await createGoalAt(ist(2026, 10, 27), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    expect(periodsOf(g.id)).toHaveLength(0);
    const r = await patch(ist(2026, 10, 28), { id: g.id, repeatUntil: "2026-10-31" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Ends is on or after the first period's last day, 30 Nov.");
    expect((await patch(ist(2026, 10, 28), { id: g.id, repeatUntil: "2026-11-30" })).status).toBe(200);
  });

  it("L9: completed together with a conversion is refused", async () => {
    seedOneTime("g-l9");
    const r = await patch(ist(2026, 10, 12), { id: "g-l9", repeat: "MONTHLY", completed: true });
    expect(r.status).toBe(400);
    expect(okrRow("g-l9")).toMatchObject({ repeat: null, completedAt: null });
  });

  // Superseded by the step 3 review's M4 (lead decision): a target added
  // after the period began held its start value at the start, so "What was
  // added since" counts all of it (38 here). A target that was there before
  // the start with no check-in before it still cannot be counted; that case
  // is goal-periods.step3-review.test.ts.
  it("L10, as M4 decided: What was added since counts a target added after the period began from its start value", async () => {
    seedRow(db, "oKR", { id: "g-l10", organizationId: ORG, title: "New", level: "INDIVIDUAL", ownerId: BOSS, startDate: new Date("2026-10-02T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), createdAt: ist(2026, 10, 2) });
    seedRow(db, "keyResult", { id: "g-l10-kr", okrId: "g-l10", title: "Deals", startValue: 0, targetValue: 100, currentValue: 38, progress: 38, createdAt: ist(2026, 10, 2) });
    seedRow(db, "kRCheckIn", { id: "g-l10-c", keyResultId: "g-l10-kr", value: 38, userId: BOSS, createdAt: ist(2026, 10, 10) });
    expect((await patch(ist(2026, 10, 12), { id: "g-l10", repeat: "MONTHLY", firstPeriodStart: "change" })).status).toBe(200);
    expect(rowOf("g-l10-kr", periodsOf("g-l10")[0].id)).toMatchObject({ currentValue: 38 });
  });
});
