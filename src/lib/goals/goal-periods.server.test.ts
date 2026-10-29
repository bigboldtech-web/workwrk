// Repeating goals on the server, step 2 (docs/plans/recurring-goals.md
// section 4, Step 2, "Must prove"). Each `it` names the item it proves.
//
// Through the real route handlers (POST, PATCH and GET /api/okrs, the
// check-in, the key-results routes, the periods route, the goal-periods
// cron and Home) and the real period server module, alignment rollup and
// period engine, over the in-memory database of goal-test-db.ts (its locks
// really wait, so the race items run two transactions against each other).
// The session, the access rules and the mailers are stand-ins: an Admin in
// one workspace, who may see and edit every goal.
//
// The workspace is Asia/Kolkata (IST, UTC+5:30), weeks from Monday, fiscal
// year from April: October 2026 runs from 30 Sep 18:30 UTC to 31 Oct 18:30
// UTC and takes late numbers until the end of 5 November IST.

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
// An Admin, as a real JWT carries the level (the access rules are stand-ins below).
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
vi.mock("@/lib/goal-effort", () => ({ goalsWithLinkedWork: async () => new Set(), computeGoalEffortBatch: async () => new Map(), computeGoalEffort: async () => ({}) }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/goals/goal-contributor", () => ({ isGoalContributor: async () => false }));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => {} }));
vi.mock("@/lib/activity", () => ({ logActivity: (a: Record<string, unknown>) => { activity.push(a); } }));
vi.mock("@/lib/goals/goal-period-score.server", () => ({ patchPeriodScore: patchSpy }));

import { goalDb as db, seedRow } from "./goal-test-db";
import * as okrsRoute from "@/app/api/okrs/route";
import * as checkInRoute from "@/app/api/okrs/[id]/check-in/route";
import * as krsRoute from "@/app/api/okrs/[id]/key-results/route";
import * as krRoute from "@/app/api/okrs/[id]/key-results/[krId]/route";
import * as homeRoute from "@/app/api/me/home/route";
// The period module is read where a test calls it directly (the race and
// lock items), so the route items still run, and fail on their own words,
// against code that has no such module.
const server = () => import("./goal-periods.server");
// The two new routes, the same way.
const periodsRoute = () => import("@/app/api/okrs/[id]/periods/route");
const cronRoute = () => import("@/app/api/cron/goal-periods/route");

/** An instant given as IST wall-clock time. */
const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);
const OCT_KEY = "2026-10-01";
const OCT_GRACE_END = ist(2026, 11, 6, 0, 0); // the first instant after 5 November IST

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

function at(t: Date) {
  vi.setSystemTime(t);
}

const rows = (model: string) => (db.rows[model] ?? []) as Array<Record<string, unknown>>;
const periodsOf = (okrId: string) => rows("goalPeriod").filter((p) => p.okrId === okrId).sort((a, b) => (a.startsAt as Date).getTime() - (b.startsAt as Date).getTime());
const rowOf = (krId: string, periodId: unknown) => rows("keyResultPeriod").find((r) => r.keyResultId === krId && r.periodId === periodId);
const okrRow = (id: string) => rows("oKR").find((o) => o.id === id)!;
const krsOf = (okrId: string) => rows("keyResult").filter((k) => k.okrId === okrId);

async function createGoalAt(t: Date, body: Record<string, unknown>): Promise<{ id: string; status: number; body: Json }> {
  at(t);
  const r = await call(okrsRoute.POST, "/api/okrs", { method: "POST", body: { level: "INDIVIDUAL", ownerId: BOSS, ...body } });
  return { id: String(r.body.id), status: r.status, body: r.body };
}

async function checkIn(t: Date, okrId: string, keyResultId: string, value: number, periodKey?: string) {
  at(t);
  return call(checkInRoute.POST, `/api/okrs/${okrId}/check-in`, { method: "POST", params: { id: okrId }, body: { keyResultId, value, ...(periodKey ? { periodKey } : {}) } });
}

async function runCron(t: Date) {
  at(t);
  return call((await cronRoute()).POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
}

async function list(t: Date) {
  at(t);
  const r = await call(okrsRoute.GET, "/api/okrs?page=1&includeCompleted=1");
  return r.body as { data: Array<Json & { id: string; progress: number; verdict: string; period: Json | null; status: string }>; recurringGoals: boolean };
}

beforeEach(() => {
  db.reset();
  activity.length = 0;
  patchSpy.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.RECURRING_GOALS = "1";
  process.env.CRON_SECRET = "test-secret";
  seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
  seedRow(db, "user", { id: BOSS, organizationId: ORG, firstName: "Bo", lastName: "Ss", email: "boss@acme.test", status: "ACTIVE", deletedAt: null });
  seedRow(db, "kPI", { id: "kpi-1", organizationId: ORG, name: "Revenue", unit: null, direction: "HIGHER", lowerIsBetter: false, targetValue: 100, ownership: "OWNED", isNorthStar: false });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  delete process.env.RECURRING_GOALS;
  delete process.env.CRON_SECRET;
});

describe("creating a repeating goal (A1, 2.0)", () => {
  it("a monthly goal posted with no endDate gets its first period", async () => {
    const t = ist(2026, 10, 10, 10, 0);
    const g = await createGoalAt(t, { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos booked", startValue: 0, targetValue: 40 }] });
    expect(g.status).toBe(201);
    expect(g.body.endDate).toBeNull();
    expect(new Date(String(g.body.startDate)).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect((g.body.period as Json).key).toBe(OCT_KEY);
    const [p] = periodsOf(g.id);
    expect(periodsOf(g.id)).toHaveLength(1);
    expect(p).toMatchObject({ key: OCT_KEY, cadence: "MONTHLY", status: "OPEN" });
    expect((p.startsAt as Date).toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect((p.endsAt as Date).toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect((p.trackedFrom as Date).getTime()).toBe(t.getTime());
    // Its target has its row in the period.
    expect(rowOf(String(krsOf(g.id)[0].id), p.id)).toMatchObject({ title: "Demos booked", startValue: 0, targetValue: 40, currentValue: 0 });
  });

  it("repeat with endDate is a 400 from POST", async () => {
    const g = await createGoalAt(ist(2026, 10, 10), { title: "Demos", repeat: "MONTHLY", endDate: "2026-12-31" });
    expect(g.status).toBe(400);
    expect(g.body.error).toBe("A repeating goal has no due date. Choose when it ends instead.");
    expect(rows("oKR")).toHaveLength(0);
  });

  it("while the switch is off, POST refuses repeat and settling stays a no-op", async () => {
    delete process.env.RECURRING_GOALS;
    const g = await createGoalAt(ist(2026, 10, 10), { title: "Demos", repeat: "MONTHLY" });
    expect(g.status).toBe(400);
    expect(g.body.error).toBe("Repeating goals are not turned on.");
    // A one-time goal is untouched, and the list writes no period while nothing repeats.
    const one = await createGoalAt(ist(2026, 10, 10), { title: "Launch", endDate: "2026-12-31" });
    expect(one.status).toBe(201);
    expect((await list(ist(2026, 10, 11))).recurringGoals).toBe(false);
    expect(rows("goalPeriod")).toHaveLength(0);
    expect(db.raw.filter((r) => /pg_advisory_xact_lock/.test(r))).toHaveLength(0);
  });
});

describe("check-ins (C1, B7, B8)", () => {
  it("a check-in lands in the current period and the goal shows that period's progress", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    const kr = String(krsOf(g.id)[0].id);
    const r = await checkIn(ist(2026, 10, 20), g.id, kr, 10);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ periodKey: OCT_KEY, krProgress: 25, progress: 25 });
    const [oct] = periodsOf(g.id);
    expect(rowOf(kr, oct.id)).toMatchObject({ currentValue: 10, progress: 25 });
    expect(rows("kRCheckIn").find((c) => c.keyResultId === kr)).toMatchObject({ value: 10, periodId: oct.id });
    const row = (await list(ist(2026, 10, 20, 13))).data.find((o) => o.id === g.id)!;
    expect(row.progress).toBe(25);
    expect(row.period).toMatchObject({ key: OCT_KEY, label: "October 2026", state: "open" });
  });

  it("a check-in after graceEndsAt is a 409 and one before it is accepted", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    const kr = String(krsOf(g.id)[0].id);
    const before = await checkIn(ist(2026, 11, 5, 23, 59), g.id, kr, 30, OCT_KEY);
    expect(before.status).toBe(200);
    expect(before.body.periodKey).toBe(OCT_KEY);
    const oct = periodsOf(g.id)[0];
    expect(rowOf(kr, oct.id)).toMatchObject({ currentValue: 30 });
    const after = await checkIn(new Date(OCT_GRACE_END.getTime() + 60_000), g.id, kr, 35, OCT_KEY);
    expect(after.status).toBe(409);
    expect(after.body.error).toBe("October took its last numbers on 5 Nov. Its numbers are final.");
    expect(rowOf(kr, oct.id)).toMatchObject({ currentValue: 30 });
    expect(rows("kRCheckIn").filter((c) => c.periodId === oct.id)).toHaveLength(1);
  });

  it("a check-in racing the close either lands before the freeze or gets the 409", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    const kr = String(krsOf(g.id)[0].id);
    const oct = periodsOf(g.id)[0];
    const lockKey = `row:GoalPeriod:${String(oct.id)}`;
    const justBefore = new Date(OCT_GRACE_END.getTime() - 1000);
    at(OCT_GRACE_END);

    // 1. The check-in holds the period row; the close waits, then freezes WITH it.
    let parked = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let held!: () => void;
    const holding = new Promise<void>((r) => { held = r; });
    db.afterLock = async (key) => {
      if (key !== lockKey || parked) return;
      parked = true;
      held();
      await gate;
    };
    const { checkInRepeating, closeDuePeriods } = await server();
    const checkin = checkInRepeating({ orgId: ORG, okrId: g.id, keyResultId: kr, value: 40, note: null, userId: BOSS, periodKey: OCT_KEY, now: justBefore });
    await holding;
    let closeDone = false;
    const close = closeDuePeriods(ORG, OCT_GRACE_END).then((r) => { closeDone = true; return r; });
    for (let i = 0; i < 200; i++) await new Promise((r) => setImmediate(r));
    expect(closeDone).toBe(false);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
    release();
    const [landed, closed] = await Promise.all([checkin, close]);
    expect(landed.periodKey).toBe(OCT_KEY);
    expect(closed.closed).toBe(1);
    const frozen = periodsOf(g.id)[0];
    expect(frozen).toMatchObject({ status: "CLOSED", progress: 100, result: "HIT" });
    expect(rowOf(kr, oct.id)).toMatchObject({ currentValue: 40 });
    expect(rowOf(kr, oct.id)!.frozenAt).toBeInstanceOf(Date);
    expect(rows("kRCheckIn").filter((c) => c.periodId === oct.id)).toHaveLength(1);
  });

  it("a check-in racing the close gets the 409 when the close holds the row first, and nothing half-lands", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    const kr = String(krsOf(g.id)[0].id);
    const oct = periodsOf(g.id)[0];
    const lockKey = `row:GoalPeriod:${String(oct.id)}`;
    at(OCT_GRACE_END);
    let parked = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let held!: () => void;
    const holding = new Promise<void>((r) => { held = r; });
    db.afterLock = async (key) => {
      if (key !== lockKey || parked) return;
      parked = true;
      held();
      await gate;
    };
    const { checkInRepeating, closeDuePeriods, GoalPeriodRefusal } = await server();
    const close = closeDuePeriods(ORG, OCT_GRACE_END);
    await holding;
    let outcome: unknown = null;
    const checkin = checkInRepeating({ orgId: ORG, okrId: g.id, keyResultId: kr, value: 40, note: null, userId: BOSS, periodKey: OCT_KEY, now: new Date(OCT_GRACE_END.getTime() - 1000) })
      .then((v) => { outcome = v; }, (e) => { outcome = e; });
    for (let i = 0; i < 200; i++) await new Promise((r) => setImmediate(r));
    expect(outcome).toBeNull();
    release();
    await Promise.all([close, checkin]);
    expect(outcome).toBeInstanceOf(GoalPeriodRefusal);
    expect((outcome as { status: number }).status).toBe(409);
    expect((outcome as { message: string }).message).toBe("October took its last numbers on 5 Nov. Its numbers are final.");
    expect(rows("kRCheckIn")).toHaveLength(0);
    expect(rowOf(kr, oct.id)).toMatchObject({ currentValue: 0 });
    expect(periodsOf(g.id)[0]).toMatchObject({ status: "CLOSED", result: "MISSED" });
  });

  it("a target counted automatically takes no check-in (isMeasuredAutomatically)", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Ship", endDate: "2026-12-31", keyResults: [{ title: "Tasks done", startValue: 0, targetValue: 10 }] });
    const kr = krsOf(g.id)[0];
    kr.source = { kind: "list", boardIds: ["b-1"] };
    const r = await checkIn(ist(2026, 10, 6), g.id, String(kr.id), 3);
    expect(r.status).toBe(409);
    expect(rows("kRCheckIn")).toHaveLength(0);
  });
});

describe("settling and closing under the locks (B3)", () => {
  it("two concurrent settles make one period, one close and one score patch", async () => {
    seedRow(db, "oKR", { id: "g-race", organizationId: ORG, title: "Race", level: "INDIVIDUAL", ownerId: BOSS, repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 10, 10) });
    seedRow(db, "keyResult", { id: "kr-race", okrId: "g-race", title: "Calls", startValue: 0, targetValue: 10, currentValue: 0, createdAt: ist(2026, 10, 10) });
    at(ist(2026, 10, 15));
    const { settleGoalPeriods } = await server();
    await Promise.all([settleGoalPeriods(ORG, ["g-race"]), settleGoalPeriods(ORG, ["g-race"])]);
    expect(periodsOf("g-race")).toHaveLength(1);
    expect(rows("keyResultPeriod")).toHaveLength(1);

    // Two cron runs at once after October's close: one opens November, one closes October, one patch.
    const [a, b] = await Promise.all([runCron(ist(2026, 11, 6, 0, 5)), runCron(ist(2026, 11, 6, 0, 5))]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Number(a.body.closed) + Number(b.body.closed)).toBe(1);
    expect(Number(a.body.scorePatched) + Number(b.body.scorePatched)).toBe(1);
    const ps = periodsOf("g-race");
    expect(ps.map((p) => p.key)).toEqual([OCT_KEY, "2026-11-01"]);
    expect(ps[0]).toMatchObject({ status: "CLOSED" });
    expect(ps[0].scorePatchedAt).toBeInstanceOf(Date);
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy.mock.calls[0][1]).toBe(ps[0].id);
    expect(rows("keyResultPeriod")).toHaveLength(2);
  });

  it("a weekly goal untouched for 40 days with the cron off opens its missing weeks on the first read (reading Closing) and the next cron run closes them Not measured and unscored", async () => {
    const g = await createGoalAt(ist(2026, 9, 14, 10, 0), { title: "Weekly report", repeat: "WEEKLY", keyResults: [{ title: "Reports", startValue: 0, targetValue: 1 }] });
    expect(periodsOf(g.id).map((p) => p.key)).toEqual(["2026-09-14"]);
    const readAt = ist(2026, 10, 24, 10, 0);
    await list(readAt);
    expect(periodsOf(g.id).map((p) => p.key)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]);
    at(readAt);
    const read = await call((await periodsRoute()).GET, `/api/okrs/${g.id}/periods`, { params: { id: g.id } });
    const states = (read.body.data as Array<{ key: string; state: string }>).map((p) => [p.key, p.state]);
    expect(states).toEqual([
      ["2026-10-19", "open"],
      ["2026-10-12", "closing"],
      ["2026-10-05", "closing"],
      ["2026-09-28", "closing"],
      ["2026-09-21", "closing"],
      ["2026-09-14", "closing"],
    ]);
    const cron = await runCron(ist(2026, 10, 24, 10, 5));
    expect(cron.body.closed).toBe(5);
    const ps = periodsOf(g.id);
    for (const p of ps.slice(1, 5)) expect(p).toMatchObject({ status: "CLOSED", result: "NOT_MEASURED", scored: false, progress: null });
    // The week that opened in time closes on its number (none was given: its start), and counts.
    expect(ps[0]).toMatchObject({ status: "CLOSED", result: "MISSED", scored: true, progress: 0 });
    expect(ps[5]).toMatchObject({ status: "OPEN" });
  });
});

describe("parents read their children's periods (D2)", () => {
  it("the Company goal with three monthly Department children closes October on its children's October numbers", async () => {
    const parent = await createGoalAt(ist(2026, 10, 5), { title: "Company", level: "COMPANY", repeat: "MONTHLY" });
    const kids: string[] = [];
    for (const name of ["Sales", "Support", "Ops"]) {
      const c = await createGoalAt(ist(2026, 10, 5), { title: name, level: "DEPARTMENT", parentId: parent.id, repeat: "MONTHLY", keyResults: [{ title: `${name} target`, startValue: 0, targetValue: 100 }] });
      kids.push(c.id);
    }
    const kr = (id: string) => String(krsOf(id)[0].id);
    await checkIn(ist(2026, 10, 20), kids[0], kr(kids[0]), 100);
    await checkIn(ist(2026, 10, 20), kids[1], kr(kids[1]), 50);
    // November starts; every child moves to 10 in November.
    for (const k of kids) await checkIn(ist(2026, 11, 2), k, kr(k), 10);
    expect((await list(ist(2026, 11, 2, 13))).data.find((o) => o.id === parent.id)!.progress).toBe(10);

    const cron = await runCron(ist(2026, 11, 6, 0, 5));
    expect(cron.body.closed).toBe(4);
    const octOf = (id: string) => periodsOf(id).find((p) => p.key === OCT_KEY)!;
    expect(kids.map((k) => octOf(k).progress)).toEqual([100, 50, 0]);
    expect(octOf(parent.id)).toMatchObject({ status: "CLOSED", progress: 50, result: "MISSED" });
    // Deepest first: every child was frozen before the parent.
    for (const k of kids) expect((octOf(k).closedAt as Date).getTime()).toBeLessThanOrEqual((octOf(parent.id).closedAt as Date).getTime());
  });

  it("a one-time parent does not drop on 1 November", async () => {
    const parent = await createGoalAt(ist(2026, 10, 1, 9), { title: "Year end", startDate: "2026-10-01", endDate: "2026-12-31" });
    const a = await createGoalAt(ist(2026, 10, 5), { title: "A", parentId: parent.id, repeat: "MONTHLY", keyResults: [{ title: "A", startValue: 0, targetValue: 100 }] });
    const b = await createGoalAt(ist(2026, 10, 5), { title: "B", parentId: parent.id, repeat: "MONTHLY", keyResults: [{ title: "B", startValue: 0, targetValue: 100 }] });
    await checkIn(ist(2026, 10, 20), a.id, String(krsOf(a.id)[0].id), 80);
    await checkIn(ist(2026, 10, 20), b.id, String(krsOf(b.id)[0].id), 60);
    const oct31 = await list(ist(2026, 10, 31, 20));
    expect(oct31.data.find((o) => o.id === parent.id)!.progress).toBe(70);

    const nov1 = await list(ist(2026, 11, 1, 10));
    // The children start November fresh...
    expect(nov1.data.find((o) => o.id === a.id)!.progress).toBe(0);
    expect(nov1.data.find((o) => o.id === b.id)!.progress).toBe(0);
    // ...and the one-time parent keeps their October.
    expect(nov1.data.find((o) => o.id === parent.id)!.progress).toBe(70);
    expect(okrRow(parent.id).progress).toBe(70);
  });
});

describe("pace, scoring and status (E4, B6, B8)", () => {
  it("a goal created on 27 October is not Off track that day and its October is not scored", async () => {
    const t = ist(2026, 10, 27, 10, 0);
    const g = await createGoalAt(t, { title: "Demos", repeat: "MONTHLY", repeatStart: OCT_KEY, keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    expect(g.status).toBe(201);
    const row = (await list(t)).data.find((o) => o.id === g.id)!;
    expect(row.period).toMatchObject({ key: OCT_KEY, trackedFrom: t.toISOString() });
    expect(row.verdict).not.toBe("off_track");
    expect(row.verdict).toBe("on_track");
    await runCron(ist(2026, 11, 6, 0, 5));
    expect(periodsOf(g.id)[0]).toMatchObject({ status: "CLOSED", result: "MISSED", scored: false });
  });

  it("a hit monthly goal still shows on Home", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 10 }] });
    await checkIn(ist(2026, 10, 20), g.id, String(krsOf(g.id)[0].id), 10);
    expect(okrRow(g.id)).toMatchObject({ progress: 100, status: "ON_TRACK" });
    at(ist(2026, 10, 21));
    const res = await (homeRoute.GET as () => Promise<Response>)();
    const home = (await res.json()) as { goals: { rows: Array<{ id: string; progress: number }> } | null };
    expect(home.goals?.rows.map((r) => r.id)).toContain(g.id);
  });
});

describe("conversions and carry (A3, B4)", () => {
  function seedOneTime(id: string) {
    seedRow(db, "oKR", { id, organizationId: ORG, title: `Goal ${id}`, level: "INDIVIDUAL", ownerId: BOSS, startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), checkInCadence: "MONTHLY", createdAt: ist(2026, 9, 1) });
    seedRow(db, "keyResult", { id: `${id}-kr`, okrId: id, title: "Deals", startValue: 0, targetValue: 100, currentValue: 38, progress: 38, createdAt: ist(2026, 9, 1) });
    seedRow(db, "kRCheckIn", { id: `${id}-c1`, keyResultId: `${id}-kr`, value: 30, userId: BOSS, createdAt: ist(2026, 9, 30, 12) });
    seedRow(db, "kRCheckIn", { id: `${id}-c2`, keyResultId: `${id}-kr`, value: 38, userId: BOSS, createdAt: ist(2026, 10, 10, 12) });
  }

  it("converting a goal with \"38 now, 30 on 30 Sep\" opens October at 0, or at 8 when chosen", async () => {
    seedOneTime("g-zero");
    seedOneTime("g-eight");
    const t = ist(2026, 10, 12, 10);
    at(t);
    const zero = await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: "g-zero", repeat: "MONTHLY", firstPeriodStart: "start" } });
    const eight = await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: "g-eight", repeat: "MONTHLY", firstPeriodStart: "change" } });
    expect(zero.status).toBe(200);
    expect(eight.status).toBe(200);
    expect(rowOf("g-zero-kr", periodsOf("g-zero")[0].id)).toMatchObject({ currentValue: 0 });
    expect(rowOf("g-eight-kr", periodsOf("g-eight")[0].id)).toMatchObject({ currentValue: 8 });
    for (const id of ["g-zero", "g-eight"]) {
      expect(okrRow(id)).toMatchObject({ repeat: "MONTHLY", endDate: null });
      expect(periodsOf(id)[0]).toMatchObject({ key: OCT_KEY });
      expect((periodsOf(id)[0].trackedFrom as Date).getTime()).toBe(t.getTime());
      // Check-ins made before the change keep no period.
      expect(rows("kRCheckIn").filter((c) => String(c.keyResultId).startsWith(id)).every((c) => c.periodId == null)).toBe(true);
    }
    // Written with the change, in its transaction, with the dates the goal had (the undo reads them).
    const records = rows("activityLog").filter((a) => a.targetId === "g-zero");
    expect(records.map((a) => a.description)).toContain("Due date 31 Dec removed when this goal became monthly");
    expect(records[0].metadata).toMatchObject({ repeatChange: "became_repeating", previousStartDate: "2026-09-01T00:00:00.000Z", previousEndDate: "2026-12-31T00:00:00.000Z" });
  });

  it("a carried \"open bugs\" target opens November at October's final value", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Quality", repeat: "MONTHLY", keyResults: [{ title: "Open bugs", startValue: 30, targetValue: 5 }] });
    const kr = String(krsOf(g.id)[0].id);
    expect(rowOf(kr, periodsOf(g.id)[0].id)).toMatchObject({ currentValue: 30, carried: false });
    await checkIn(ist(2026, 10, 20), g.id, kr, 12);
    await list(ist(2026, 11, 2));
    const nov = periodsOf(g.id)[1];
    expect(nov.key).toBe("2026-11-01");
    expect(rowOf(kr, nov.id)).toMatchObject({ currentValue: 12, carried: true });
    // A late October number (inside the grace) is what November carries while nobody has checked in.
    await checkIn(ist(2026, 11, 3), g.id, kr, 10, OCT_KEY);
    expect(rowOf(kr, nov.id)).toMatchObject({ currentValue: 10, carried: true });
    expect(krsOf(g.id)[0]).toMatchObject({ currentValue: 10 });
  });
});

describe("KPI targets (C6, B7)", () => {
  it("a KPI-linked October stays open until 1 Dec 14:00 UTC while its hand-checked targets refuse check-ins after 5 Nov", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), {
      title: "Revenue", repeat: "MONTHLY",
      keyResults: [{ title: "Revenue", startValue: 0, targetValue: 100, kpiId: "kpi-1" }, { title: "Calls", startValue: 0, targetValue: 10 }],
    });
    const [kpiKr, handKr] = krsOf(g.id).map((k) => String(k.id));
    const oct = periodsOf(g.id)[0];
    expect((oct.closesAt as Date).toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect((oct.graceEndsAt as Date).getTime()).toBe(OCT_GRACE_END.getTime());

    const late = await checkIn(ist(2026, 11, 10), g.id, handKr, 5, OCT_KEY);
    expect(late.status).toBe(409);
    // Past its grace and held for its KPI month: hand check-ins are over, KPI numbers are not (final review M4).
    expect(late.body.error).toBe("October took its last check-ins on 5 Nov. Its KPI numbers are taken until 30 Nov.");

    // The manager records October's KPI on 20 November, as the KPI loop invites.
    seedRow(db, "kPIRecord", { id: "rec-oct", kpiId: "kpi-1", userId: BOSS, period: "2026-10", actualValue: 70, status: "APPROVED", updatedAt: ist(2026, 11, 20) });
    await runCron(ist(2026, 11, 20));
    expect(periodsOf(g.id)[0]).toMatchObject({ status: "OPEN" });
    await runCron(new Date("2026-12-01T13:55:00Z"));
    expect(periodsOf(g.id)[0]).toMatchObject({ status: "OPEN" });

    await runCron(new Date("2026-12-01T14:05:00Z"));
    const closed = periodsOf(g.id)[0];
    expect(closed).toMatchObject({ status: "CLOSED", progress: 35 });
    expect(rowOf(kpiKr, closed.id)).toMatchObject({ currentValue: 70, progress: 70 });
    expect(rowOf(handKr, closed.id)).toMatchObject({ currentValue: 0 });
  });

  it("a change to weekly is a 400 while a target links a KPI", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Revenue", repeat: "MONTHLY", keyResults: [{ title: "Revenue", startValue: 0, targetValue: 100, kpiId: "kpi-1" }] });
    at(ist(2026, 10, 10));
    const r = await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: g.id, repeat: "WEEKLY" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("A KPI is recorded monthly. Use it on a monthly, quarterly or yearly goal.");
    expect(okrRow(g.id).repeat).toBe("MONTHLY");
  });
});

describe("targets keep the past (B5, B8)", () => {
  it("deleting a target keeps its closed rows and leaves none in open or later periods", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Two", repeat: "MONTHLY", keyResults: [{ title: "X", startValue: 0, targetValue: 10 }, { title: "Y", startValue: 0, targetValue: 10 }] });
    const [x, y] = krsOf(g.id).map((k) => String(k.id));
    await checkIn(ist(2026, 10, 20), g.id, x, 5);
    await runCron(ist(2026, 11, 6, 0, 5));
    const [oct, nov] = periodsOf(g.id);
    expect(oct.status).toBe("CLOSED");
    expect(nov.status).toBe("OPEN");
    at(ist(2026, 11, 7));
    const del = await call(krRoute.DELETE, `/api/okrs/${g.id}/key-results/${x}`, { method: "DELETE", params: { id: g.id, krId: x } });
    expect(del.status).toBe(200);
    const octRows = rows("keyResultPeriod").filter((r) => r.periodId === oct.id);
    expect(octRows.find((r) => r.title === "X")).toMatchObject({ keyResultId: null, currentValue: 5, unit: null });
    expect(rows("keyResultPeriod").filter((r) => r.periodId === nov.id).map((r) => r.title)).toEqual(["Y"]);
    expect(rows("keyResultPeriod").filter((r) => r.periodId === nov.id && r.keyResultId == null)).toHaveLength(0);
    expect(rowOf(y, oct.id)).toBeTruthy();
    // The closed period's result is unchanged.
    expect(periodsOf(g.id)[0]).toMatchObject({ progress: 25 });
  });

  it("KR PATCH with currentValue on a repeating goal is a 409, and so is KR POST", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    const kr = String(krsOf(g.id)[0].id);
    at(ist(2026, 10, 6));
    const patch = await call(krRoute.PATCH, `/api/okrs/${g.id}/key-results/${kr}`, { method: "PATCH", params: { id: g.id, krId: kr }, body: { currentValue: 20 } });
    expect(patch.status).toBe(409);
    expect(patch.body.error).toBe("Check in to change this period's number.");
    expect(krsOf(g.id)[0]).toMatchObject({ currentValue: 0 });
    const post = await call(krsRoute.POST, `/api/okrs/${g.id}/key-results`, { method: "POST", params: { id: g.id }, body: { title: "More", targetValue: 5, currentValue: 3 } });
    expect(post.status).toBe(409);
  });

  it("editing a target reaches the current open period, never a closed one, and says so in Activity", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 60 }] });
    const kr = String(krsOf(g.id)[0].id);
    await checkIn(ist(2026, 10, 20), g.id, kr, 30);
    await runCron(ist(2026, 11, 6, 0, 5));
    at(ist(2026, 11, 7));
    const r = await call(krRoute.PATCH, `/api/okrs/${g.id}/key-results/${kr}`, { method: "PATCH", params: { id: g.id, krId: kr }, body: { targetValue: 40 } });
    expect(r.status).toBe(200);
    const [oct, nov] = periodsOf(g.id);
    expect(rowOf(kr, oct.id)).toMatchObject({ targetValue: 60, currentValue: 30 });
    expect(rowOf(kr, nov.id)).toMatchObject({ targetValue: 40 });
    // The line names its target: the goal's Activity card shows it (final review M5).
    expect(activity.map((a) => a.description)).toContain("Demos: target changed from 60 to 40 for November 2026");
  });
});

describe("cadence changes and restarts (A3, A4)", () => {
  it("every stretch of an open period recomputes its graceEndsAt and closesAt, so an October stretched by one day takes numbers until the end of 6 November", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    const kr = String(krsOf(g.id)[0].id);
    at(ist(2026, 10, 20));
    const r = await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: g.id, repeat: "WEEKLY" } });
    expect(r.status).toBe(200);
    const oct = periodsOf(g.id)[0];
    expect((oct.endsAt as Date).getTime()).toBe(ist(2026, 11, 2, 0, 0).getTime());
    expect((oct.graceEndsAt as Date).getTime()).toBe(ist(2026, 11, 7, 0, 0).getTime());
    expect((oct.closesAt as Date).getTime()).toBe(ist(2026, 11, 7, 0, 0).getTime());
    expect((await checkIn(ist(2026, 11, 6, 23, 0), g.id, kr, 12, OCT_KEY)).status).toBe(200);
    const after = await checkIn(ist(2026, 11, 7, 0, 1), g.id, kr, 13, OCT_KEY);
    expect(after.status).toBe(409);
    expect(after.body.error).toBe("October took its last numbers on 6 Nov. Its numbers are final.");
    // From 2 November the goal repeats weekly.
    expect(periodsOf(g.id)[1]).toMatchObject({ key: "2026-11-02", cadence: "WEEKLY" });

    // A coarser change that stretches a week by a day (Monday 23 November to 1 December) recomputes them too.
    const w = await createGoalAt(ist(2026, 11, 23, 10), { title: "Weekly", repeat: "WEEKLY", keyResults: [{ title: "W", startValue: 0, targetValue: 4 }] });
    at(ist(2026, 11, 25));
    expect((await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: w.id, repeat: "MONTHLY" } })).status).toBe(200);
    const week = periodsOf(w.id)[0];
    expect((week.endsAt as Date).getTime()).toBe(ist(2026, 12, 1, 0, 0).getTime());
    expect((week.graceEndsAt as Date).getTime()).toBe(ist(2026, 12, 3, 0, 0).getTime());
    expect((week.closesAt as Date).getTime()).toBe(ist(2026, 12, 3, 0, 0).getTime());
  });

  it("a restarted goal's first period does not overlap its last one after a zone change", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] });
    at(ist(2026, 10, 20));
    expect((await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: g.id, stopRepeating: true } })).status).toBe(200);
    expect(okrRow(g.id).repeatUntil).toBe("2026-10-31");
    await runCron(ist(2026, 11, 6, 0, 5));
    expect(periodsOf(g.id)).toHaveLength(1);
    expect(okrRow(g.id).completedAt).toBeInstanceOf(Date);
    expect(okrRow(g.id).status).toBe("COMPLETED");

    // The workspace moves east (Auckland's 1 November began before Kolkata's October ended).
    (rows("organization")[0].settings as Record<string, unknown>).timezone = "Pacific/Auckland";
    at(new Date("2026-11-10T00:00:00Z"));
    const r = await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: g.id, repeatUntil: null } });
    expect(r.status).toBe(200);
    const [last, restarted] = periodsOf(g.id);
    expect(restarted).toBeTruthy();
    expect((restarted.startsAt as Date).getTime()).toBeGreaterThanOrEqual((last.endsAt as Date).getTime());
    expect((restarted.startsAt as Date).toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect((restarted.endsAt as Date).toISOString()).toBe("2026-11-30T11:00:00.000Z");
    expect(restarted.key).toBe("2026-11-01");
    expect(okrRow(g.id).completedAt).toBeNull();
    expect((restarted.trackedFrom as Date).toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });
});

describe("the period read (I)", () => {
  it("GET /api/okrs/[id]/periods lists periods newest first with their targets, results and states", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40, }] });
    const kr = String(krsOf(g.id)[0].id);
    await checkIn(ist(2026, 10, 20), g.id, kr, 44);
    await runCron(ist(2026, 11, 6, 0, 5));
    at(ist(2026, 11, 7));
    const r = await call((await periodsRoute()).GET, `/api/okrs/${g.id}/periods`, { params: { id: g.id } });
    const data = r.body.data as Array<Json & { targets: Json[] }>;
    expect(data.map((p) => p.key)).toEqual(["2026-11-01", OCT_KEY]);
    expect(data[1]).toMatchObject({ label: "October 2026", state: "closed", result: "HIT", resultLabel: "Hit", progress: 100, attainment: 110 });
    expect(data[1].targets[0]).toMatchObject({ title: "Demos", currentValue: 44, targetValue: 40 });
    expect(data[0]).toMatchObject({ state: "open" });
  });
});
