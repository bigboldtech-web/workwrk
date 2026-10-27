// Repeating goals, step 6 (docs/plans/recurring-goals.md section 4, Step 6,
// "Must prove"): reminders, the score, reviews, effort and the outside
// readers. Each `it` names the item it proves.
//
// Through the real crons (goal-periods and okr-reminders), the real goal
// routes, the real performance score, review metrics and self assessment,
// the real effort module, Ask AI's search_okrs and the workspace export,
// over the in-memory database of goal-test-db.ts. The session, the access
// rules and the mailers are stand-ins, as in the step 2 suite.
//
// The workspace is Asia/Kolkata (IST, UTC+5:30), weeks from Monday, fiscal
// year from April. The SERVER runs on UTC, as production does: the score's
// month is the server's month (getCurrentPeriod), so at 01:00 IST on 1
// November the server is still in October.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const { mail } = vi.hoisted(() => ({ mail: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./goal-test-db")).goalDb.prisma }));
vi.mock("server-only", () => ({}));

const ORG = "org-1";
const BOSS = "u-boss";
const ANA = "u-ana";
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
vi.mock("@/lib/access/manager-lines", () => ({ effectiveDirectReportIds: async () => [], countedDottedReportIds: async () => [], effectiveManagersOf: async () => new Map() }));
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
vi.mock("@/lib/email", () => ({ sendEmail: async (m: Record<string, unknown>) => { mail.push(m); }, queueEmail: async () => {} }));
vi.mock("@/lib/email-templates", () => ({ genericNotificationTemplate: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/notify-prefs", () => ({ shouldEmail: async () => true }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null, viewerHeldIn: async () => null }));
// The effort module's List access: every List opens for the viewer the test hands it.
vi.mock("@/lib/access/node-access", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/node-access")>()),
  nodeCtxFromViewer: (v: unknown) => v,
  nodeRoleMap: async (_c: unknown, _k: string, ids: Iterable<string>) => new Map([...ids].map((id) => [id, "VIEW"])),
}));
vi.mock("@/lib/goals/goal-contributor", () => ({ isGoalContributor: async () => false }));
// The real score service; only its fire-and-forget trigger is quiet, so a test computes a month when it says.
vi.mock("@/services/performanceScoreService", async (orig) => ({ ...(await orig<typeof import("@/services/performanceScoreService")>()), triggerRecalculation: () => {} }));
vi.mock("@/lib/activity", () => ({ logActivity: () => {} }));
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => true }));

import { goalDb as db, seedRow } from "./goal-test-db";
import * as okrsRoute from "@/app/api/okrs/route";
import * as checkInRoute from "@/app/api/okrs/[id]/check-in/route";
// The new behaviour, read where a test calls it, so each item fails on its own words against the old code.
const goalPeriodsCron = () => import("@/app/api/cron/goal-periods/route");
const remindersCron = () => import("@/app/api/cron/okr-reminders/route");
const scoreService = () => import("@/services/performanceScoreService");
const reviewCycle = () => import("@/lib/performance/review-cycle.server");
const selfAssessment = () => import("@/app/api/reviews/[id]/self-assessment/route");
const effortModule = () => import("@/lib/goal-effort");
const agentTools = () => import("@/lib/agents/tools");
const workspaceExport = () => import("@/lib/export/workspace-export.server");

/** An instant given as IST wall-clock time. */
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
const krOf = (okrId: string) => String(rows("keyResult").find((k) => k.okrId === okrId)!.id);
const notes = (type?: string) => rows("notification").filter((n) => !type || n.type === type);
const scoreRow = (userId: string, period: string) => rows("performanceScore").find((r) => r.userId === userId && r.period === period);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function goal(t: Date, body: Record<string, unknown>): Promise<string> {
  at(t);
  const r = await call(okrsRoute.POST, "/api/okrs", { method: "POST", body: { level: "INDIVIDUAL", ownerId: BOSS, ...body } });
  expect(r.status, String(r.body.error)).toBe(201);
  return String(r.body.id);
}

const monthly = (t: Date, title: string, extra: Record<string, unknown> = {}) =>
  goal(t, { title, repeat: "MONTHLY", keyResults: [{ title: `${title} done`, startValue: 0, targetValue: 10 }], ...extra });

async function checkIn(t: Date, okrId: string, value: number, periodKey?: string) {
  at(t);
  const r = await call(checkInRoute.POST, `/api/okrs/${okrId}/check-in`, { method: "POST", params: { id: okrId }, body: { keyResultId: krOf(okrId), value, ...(periodKey ? { periodKey } : {}) } });
  expect(r.status, String(r.body.error)).toBe(200);
}

const CRON = { method: "POST", headers: { "x-cron-secret": "test-secret" } };
async function runCron(t: Date) {
  at(t);
  return call((await goalPeriodsCron()).POST, "/api/cron/goal-periods", CRON);
}
async function runReminders(t: Date) {
  at(t);
  return call((await remindersCron()).POST, "/api/cron/okr-reminders", CRON);
}
async function scoreAt(t: Date, userId = BOSS) {
  at(t);
  return (await scoreService()).calculatePerformanceScore(userId, ORG);
}

const realTz = process.env.TZ;
beforeAll(() => {
  // The server's clock, as production's (the score month is the server's).
  process.env.TZ = "UTC";
});

beforeEach(() => {
  db.reset();
  mail.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.RECURRING_GOALS = "1";
  process.env.CRON_SECRET = "test-secret";
  seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
  seedRow(db, "user", { id: BOSS, organizationId: ORG, firstName: "Bo", lastName: "Ss", email: "boss@acme.test", status: "ACTIVE", deletedAt: null, ...legacyLevelRow("COMPANY_ADMIN") });
  seedRow(db, "user", { id: ANA, organizationId: ORG, firstName: "Ana", lastName: "Lee", email: "ana@acme.test", status: "ACTIVE", deletedAt: null, ...legacyLevelRow("EMPLOYEE") });
  seedRow(db, "kPI", { id: "kpi-1", organizationId: ORG, name: "Revenue", unit: null, direction: "HIGHER", lowerIsBetter: false, targetValue: 100, ownership: "OWNED", isNorthStar: false });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  delete process.env.RECURRING_GOALS;
  delete process.env.CRON_SECRET;
  if (realTz === undefined) delete process.env.TZ;
  else process.env.TZ = realTz;
});

/* ───────────────────────── F: the digests ───────────────────────── */

describe("the period digests (F)", () => {
  it("ten monthly goals send one 'started' row and one 'results' row", async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 10; i++) ids.push(await monthly(ist(2026, 10, 2), `Goal ${i}`));
    const anas = await monthly(ist(2026, 10, 2), "Ana's goal", { ownerId: ANA });
    for (const id of ids.slice(0, 3)) await checkIn(ist(2026, 10, 20), id, 10);
    await checkIn(ist(2026, 10, 20), anas, 8);

    // October began before these goals did: nothing to announce.
    await runCron(ist(2026, 10, 2, 13, 5));
    expect(notes("goal_period_started")).toHaveLength(0);

    // 00:35 IST on 1 November opens November for all eleven; every later run that day adds nothing.
    for (const t of [ist(2026, 11, 1, 0, 35), ist(2026, 11, 1, 1, 5), ist(2026, 11, 1, 23, 35)]) expect((await runCron(t)).status).toBe(200);
    const started = notes("goal_period_started");
    expect(started).toHaveLength(2);
    expect(started.find((n) => n.userId === BOSS)).toMatchObject({ title: "10 goals started November 2026", message: "Goal 1, Goal 2, Goal 3 and 7 more", link: "/okrs" });
    expect(started.find((n) => n.userId === ANA)).toMatchObject({ title: "1 goal started November 2026", link: "/okrs" });

    // 6 November 00:35 IST: October closes for all of them in one run, one results row per owner.
    const r = await runCron(ist(2026, 11, 6, 0, 35));
    expect(r.body).toMatchObject({ closed: 11, scorePatched: 11, failed: 0 });
    await runCron(ist(2026, 11, 6, 1, 5));
    const results = notes("goal_period_closed");
    expect(results).toHaveLength(2);
    expect(results.find((n) => n.userId === BOSS)).toMatchObject({ title: "October results: 3 hit, 7 missed", link: "/okrs" });
    // With one goal the row opens that goal at October.
    expect(results.find((n) => n.userId === ANA)).toMatchObject({ title: "October results: 1 partly hit", message: "Ana's goal", link: `/okrs/${anas}?period=${OCT_KEY}` });
  });

  it("no 'started' row for a goal made after its period began, or one measured only automatically", async () => {
    await goal(ist(2026, 10, 2), { title: "By KPI", repeat: "MONTHLY", keyResults: [{ title: "Revenue", startValue: 0, targetValue: 100, kpiId: "kpi-1" }] });
    // Made on 1 November at noon: November began before it, so its maker knows already.
    await monthly(ist(2026, 11, 1, 12), "Made today");
    await runCron(ist(2026, 11, 1, 12, 35));
    expect(notes("goal_period_started")).toHaveLength(0);
  });
});

/* ───────────────────────── F: the reminders ───────────────────────── */

describe("the check-in reminders (F)", () => {
  it("the end nudge fires on the Friday when the month ends on a Sunday", async () => {
    // January 2027 ends on Sunday 31 January; the cron runs on weekdays only.
    const sales = await monthly(ist(2027, 1, 4), "Sales calls");
    const done = await monthly(ist(2027, 1, 4), "Checked in");
    await goal(ist(2027, 1, 4), { title: "Weekly", repeat: "WEEKLY", keyResults: [{ title: "Posts", startValue: 0, targetValue: 3 }] });
    await checkIn(ist(2027, 1, 20), done, 4);
    const ends = () => notes("okr_check_in_due").filter((n) => /ends/.test(String(n.title)));

    await runReminders(ist(2027, 1, 27, 9)); // Wednesday, 4 days left
    await runReminders(ist(2027, 1, 28, 9)); // Thursday, 3 days left
    expect(ends()).toHaveLength(0);
    // The weekly goal's week of 25 January (it ends on the same Sunday) is open too.
    await runCron(ist(2027, 1, 29, 0, 35));
    await runReminders(ist(2027, 1, 29, 9)); // Friday, inside the last 3 days
    await runReminders(ist(2027, 1, 29, 15)); // a second run that day
    await runReminders(ist(2027, 2, 1, 9)); // Monday: January has ended
    expect(ends()).toEqual([
      expect.objectContaining({ userId: BOSS, title: "January ends in 2 days. Add this month's numbers.", message: "Sales calls: a target has no check-in this month.", link: `/okrs/${sales}` }),
    ]);
  });

  it("reminders skip a KPI-linked target, and the row has no em dash and opens the goal", async () => {
    const once = await goal(ist(2026, 10, 1), { title: "Launch", endDate: "2026-12-31", keyResults: [{ title: "Revenue", startValue: 0, targetValue: 100, kpiId: "kpi-1" }, { title: "Demos", startValue: 0, targetValue: 10 }] });
    await goal(ist(2026, 10, 1), { title: "By KPI", repeat: "MONTHLY", keyResults: [{ title: "Revenue", startValue: 0, targetValue: 100, kpiId: "kpi-1" }] });
    await runReminders(ist(2026, 10, 20, 9));
    const due = notes("okr_check_in_due");
    expect(due).toEqual([expect.objectContaining({ userId: BOSS, link: `/okrs/${once}`, message: '"Launch": your last update was more than a week ago.' })]);
    const demos = rows("keyResult").find((k) => k.title === "Demos")!;
    expect(rows("keyResult").filter((k) => k.lastReminderAt).map((k) => k.id)).toEqual([demos.id]);
  });

  it("a repeating goal's staleness counts from the period it is in, not its last check-in before", async () => {
    const g = await monthly(ist(2026, 10, 2), "Demos");
    await checkIn(ist(2026, 10, 28), g, 7);
    await runCron(ist(2026, 11, 1, 0, 35));
    // 5 November: eight days since the October check-in, four since November began.
    await runReminders(ist(2026, 11, 5, 9));
    expect(notes("okr_check_in_due")).toHaveLength(0);
    // 9 November: eight days into November with nothing checked in.
    await runReminders(ist(2026, 11, 9, 9));
    expect(notes("okr_check_in_due")).toEqual([expect.objectContaining({ link: `/okrs/${g}` })]);
  });
});

/* ───────────────────────── G1, G2: the score ───────────────────────── */

describe("the performance score (G1, G2)", () => {
  it("October's score row reads October's period at 01:00 IST on 1 November", async () => {
    const g = await monthly(ist(2026, 10, 2), "Demos");
    await checkIn(ist(2026, 10, 20), g, 6);
    // November opens at 00:35 IST and reads 0.
    await runCron(ist(2026, 11, 1, 0, 35));
    await scoreAt(ist(2026, 11, 1, 1, 0));
    const row = scoreRow(BOSS, "2026-10")!;
    expect(row).toBeTruthy();
    const b = row.breakdown as Record<string, unknown>;
    expect(b.okrParts).toEqual([{ okrId: g, periodKey: OCT_KEY, progress: 60 }]);
    expect(b.okrScore).toBe(60);
  });

  it("a quarterly goal counts only in its last month", async () => {
    // Q3 FY27 runs October to December (fiscal year from April).
    const q = await goal(ist(2026, 10, 2), { title: "Quarter", repeat: "QUARTERLY", keyResults: [{ title: "Deals", startValue: 0, targetValue: 10 }] });
    const m = await monthly(ist(2026, 10, 2), "Month");
    await checkIn(ist(2026, 10, 10), q, 10);
    await checkIn(ist(2026, 10, 10), m, 5);
    await scoreAt(ist(2026, 10, 20));
    await checkIn(ist(2026, 11, 10), m, 4);
    await scoreAt(ist(2026, 11, 20));
    await checkIn(ist(2026, 12, 10), m, 8);
    await scoreAt(ist(2026, 12, 20));
    const parts = (period: string) => (scoreRow(BOSS, period)!.breakdown as { okrParts: Array<{ okrId: string; progress: number }> }).okrParts;
    expect(parts("2026-10")).toEqual([{ okrId: m, periodKey: OCT_KEY, progress: 50 }]);
    expect((scoreRow(BOSS, "2026-10")!.breakdown as Record<string, unknown>).okrScore).toBe(50);
    expect(parts("2026-11")).toEqual([{ okrId: m, periodKey: "2026-11-01", progress: 40 }]);
    expect(parts("2026-12")).toEqual(expect.arrayContaining([
      { okrId: q, periodKey: OCT_KEY, progress: 100 },
      { okrId: m, periodKey: "2026-12-01", progress: 80 },
    ]));
    expect(parts("2026-12")).toHaveLength(2);
  });

  it("a number entered on 3 November inside the grace changes October's goal part and nothing else", async () => {
    const a = await monthly(ist(2026, 10, 2), "Alpha");
    const b = await monthly(ist(2026, 10, 2), "Beta");
    await checkIn(ist(2026, 10, 20), a, 4);
    await checkIn(ist(2026, 10, 20), b, 8);
    seedRow(db, "kPIRecord", { id: "rec-oct", kpiId: "kpi-1", userId: BOSS, period: "2026-10", actualValue: 1, score: 60, status: "APPROVED", createdAt: ist(2026, 10, 15) });
    await scoreAt(ist(2026, 10, 31, 12));
    const before = clone(scoreRow(BOSS, "2026-10")!);
    expect(before.breakdown).toMatchObject({ kpiScore: 50, okrScore: 60, okrParts: [{ okrId: a, progress: 40 }, { okrId: b, progress: 80 }] });
    expect(before.score).toBe(52);

    // 3 November, inside October's grace: Alpha's October number. A November
    // KPI record that a full recompute of October would pick up arrives too.
    await checkIn(ist(2026, 11, 3), a, 10, OCT_KEY);
    seedRow(db, "kPIRecord", { id: "rec-nov", kpiId: "kpi-1", userId: BOSS, period: "2026-11", actualValue: 1, score: 120, status: "APPROVED", createdAt: ist(2026, 11, 3) });
    await scoreAt(ist(2026, 11, 3, 13));
    const november = clone(scoreRow(BOSS, "2026-11")!);

    await runCron(ist(2026, 11, 6, 0, 35));
    const after = scoreRow(BOSS, "2026-10")!;
    const { okrParts, okrScore, ...rest } = after.breakdown as Record<string, unknown>;
    const { okrParts: _p, okrScore: _s, ...restBefore } = before.breakdown as Record<string, unknown>;
    void _p;
    void _s;
    expect(okrParts).toEqual([{ okrId: a, periodKey: OCT_KEY, progress: 100 }, { okrId: b, periodKey: OCT_KEY, progress: 80 }]);
    expect(okrScore).toBe(90);
    // Nothing else in October's row moved: the KPI part is October's own.
    expect(clone(rest)).toEqual(restBefore);
    expect(after.score).toBe(58);
    // And November's row is November's alone.
    expect(clone(scoreRow(BOSS, "2026-11")!)).toEqual(november);
  });

  it("a row from before okrParts is left alone, while the close makes a row for an owner with none", async () => {
    const old = { kpiScore: 70, managerRating: null, peerRating: null, selfRating: null, sopCompliance: null, kudosBonus: 0, okrScore: 20, weights: { kpi: 40, manager: 25, peer: 10, self: 5, sopCompliance: 20 } };
    seedRow(db, "performanceScore", { id: "ps-ana-oct", userId: ANA, organizationId: ORG, period: "2026-10", score: 66, breakdown: clone(old), calculatedAt: ist(2026, 10, 30) });
    const anas = await monthly(ist(2026, 10, 2), "Ana's", { ownerId: ANA });
    const boss = await monthly(ist(2026, 10, 2), "Boss's");
    await checkIn(ist(2026, 10, 20), anas, 10);
    await checkIn(ist(2026, 10, 20), boss, 7);
    await runCron(ist(2026, 11, 6, 0, 35));
    expect(scoreRow(ANA, "2026-10")!.score).toBe(66);
    expect(scoreRow(ANA, "2026-10")!.breakdown).toEqual(old);
    expect(scoreRow(BOSS, "2026-10")).toMatchObject({ score: 70, breakdown: { okrScore: 70, okrParts: [{ okrId: boss, periodKey: OCT_KEY, progress: 70 }] } });
  });
});

/* ───────────────────────── G3: review cycles ───────────────────────── */

describe("review cycles (G3)", () => {
  it("a Q3 review opened on 2 November reads July, August and September", async () => {
    const g = await monthly(ist(2026, 7, 1), "Demos");
    await checkIn(ist(2026, 7, 15), g, 10);
    await runCron(ist(2026, 8, 6, 0, 35)); // July closes
    await checkIn(ist(2026, 8, 15), g, 5);
    await runCron(ist(2026, 9, 6, 0, 35)); // August closes
    await checkIn(ist(2026, 9, 15), g, 6);
    await runCron(ist(2026, 10, 6, 0, 35)); // September closes
    await checkIn(ist(2026, 10, 15), g, 9);
    await runCron(ist(2026, 11, 1, 0, 35)); // November opens; October is in its grace
    await checkIn(ist(2026, 11, 2, 10), g, 2);

    const cycle = { start: new Date("2026-07-01T00:00:00.000Z"), end: new Date("2026-09-30T00:00:00.000Z") };
    at(ist(2026, 11, 2, 12));
    const metrics = await (await reviewCycle()).reviewMetrics(BOSS, ORG, cycle);
    expect(metrics.okrAvgProgress).toBe(70);

    seedRow(db, "review", {
      id: "rev-1", cycleId: "cyc-q3", subjectId: BOSS, reviewerId: BOSS, status: "PENDING", selfRatings: null,
      cycle: { id: "cyc-q3", name: "Q3 2026", status: "ACTIVE", startDate: cycle.start, endDate: cycle.end },
      subject: { id: BOSS, firstName: "Bo", lastName: "Ss" }, reviewer: { id: BOSS, firstName: "Bo", lastName: "Ss" },
    });
    const r = await call((await selfAssessment()).GET, "/api/reviews/cyc-q3/self-assessment", { params: { id: "cyc-q3" } });
    expect(r.status).toBe(200);
    const m = (r.body as { metrics: { okrAvgProgress: number; okrs: Array<{ id: string; progress: number; periods: Array<Record<string, unknown>> }> } }).metrics;
    expect(m.okrAvgProgress).toBe(70);
    const row = m.okrs.find((o) => o.id === g)!;
    expect(row.progress).toBe(70);
    expect(row.periods.map((p) => [p.label, p.resultLabel, p.progress, p.counted])).toEqual([
      ["July 2026", "Hit", 100, true],
      ["August 2026", "Missed", 50, true],
      ["September 2026", "Missed", 60, true],
    ]);
  });
});

/* ───────────────────────── E4: effort per period ───────────────────────── */

describe("effort per period (E4)", () => {
  it("a repeating goal's hours are read inside its period, and this month is the workspace zone's", async () => {
    const g = await monthly(ist(2026, 10, 2), "Demos");
    seedRow(db, "entityLink", { id: "el-1", organizationId: ORG, sourceType: "OKR", sourceId: g, targetType: "BOARD", targetId: "b-1" });
    seedRow(db, "item", { id: "it-1", organizationId: ORG, boardId: "b-1", status: "TODO", archivedAt: null, parentItemId: null, metadata: {}, ownerId: BOSS, assigneeIds: [], updatedAt: ist(2026, 10, 20) });
    for (const [day, hours] of [["2026-09-30", 2], ["2026-10-15", 3], ["2026-11-01", 4]] as const) {
      seedRow(db, "timeEntry", { organizationId: ORG, itemId: "it-1", userId: BOSS, day: new Date(`${day}T00:00:00.000Z`), hours });
    }
    const viewer = { userId: BOSS, organizationId: ORG } as never;
    // 02:00 IST on 1 November: November in the workspace, still October in UTC.
    const now = ist(2026, 11, 1, 2);
    const { computeGoalEffortBatch } = await effortModule();
    const e = (await computeGoalEffortBatch(ORG, [g], now, viewer, new Map([[g, { firstKey: "2026-10-01", lastKey: "2026-10-31" }]]))).get(g)!;
    expect(e.totalHours).toBe(9);
    expect(e.periodHours).toBe(3);
    expect(e.hoursThisMonth).toBe(4);
  });
});

/* ───────────────────────── I: Ask AI ───────────────────────── */

describe("Ask AI search_okrs (I)", () => {
  it("names a repeating goal's current period, and leaves a one-time goal's row as it was", async () => {
    const g = await monthly(ist(2026, 10, 2), "Demos");
    const once = await goal(ist(2026, 10, 2), { title: "Launch", endDate: "2026-12-31", keyResults: [{ title: "Ship", startValue: 0, targetValue: 1 }] });
    await runCron(ist(2026, 11, 1, 0, 35));
    at(ist(2026, 11, 2));
    const { TOOLS } = await agentTools();
    const out = (await TOOLS.search_okrs.handler({ orgId: ORG, userId: BOSS }, { ownedByMe: true })) as { okrs: Array<Record<string, unknown>> };
    expect(out.okrs.find((o) => o.id === g)).toMatchObject({
      repeat: "MONTHLY",
      period: { label: "November 2026", startsAt: "2026-10-31T18:30:00.000Z", endsAt: "2026-11-30T18:30:00.000Z" },
    });
    const one = out.okrs.find((o) => o.id === once)!;
    expect(one).not.toHaveProperty("period");
    expect(one).not.toHaveProperty("repeat");
  });
});

/* ───────────────────────── Section 3: the export ───────────────────────── */

describe("the workspace export (section 3)", () => {
  it("carries repeat on goals and every period's result and target numbers in goal-periods.csv", async () => {
    const g = await monthly(ist(2026, 10, 2), "Demos");
    await checkIn(ist(2026, 10, 20), g, 12);
    await runCron(ist(2026, 11, 6, 0, 35));
    at(ist(2026, 11, 7));
    const prepared = await (await workspaceExport()).prepareWorkspaceExport(ORG, new Date(), () => {});
    const files = new Map<string, string>();
    for await (const entry of prepared.entries) {
      let text = "";
      if (typeof entry.data === "string") text = entry.data;
      else for await (const piece of entry.data as AsyncIterable<string>) text += piece;
      files.set(entry.name, text);
    }
    expect(files.get("goals.csv")!.split("\r\n")[0]).toMatch(/,repeat,repeatUntil$/);
    expect(files.get("goals.csv")).toMatch(new RegExp(`${g},Demos,.*,MONTHLY,`));
    const lines = files.get("goal-periods.csv")!.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("goalId,periodKey,period,cadence,startsAt,endsAt,status,result,progress,attainment,scored,targetId,target,unit,startValue,targetValue,value,targetProgress");
    expect(lines).toContain(`${g},2026-10-01,October 2026,MONTHLY,2026-09-30T18:30:00.000Z,2026-10-31T18:30:00.000Z,CLOSED,HIT,100,120,yes,${krOf(g)},Demos done,,0,10,12,100`);
    expect(lines.some((l) => l.startsWith(`${g},2026-11-01,November 2026,MONTHLY,`) && l.includes(",OPEN,"))).toBe(true);
    expect(prepared.counts.goalPeriods).toBe(2);
  });
});

/* ───────────────────────── The switch off (2.0) ───────────────────────── */

describe("with RECURRING_GOALS off, a one-time goal gets the three fixes (F, E4)", () => {
  it("its reminder skips a KPI-linked target, has no em dash and opens the goal", async () => {
    const once = await goal(ist(2026, 10, 1), { title: "Launch", endDate: "2026-12-31", keyResults: [{ title: "Revenue", startValue: 0, targetValue: 100, kpiId: "kpi-1" }, { title: "Demos", startValue: 0, targetValue: 10 }] });
    delete process.env.RECURRING_GOALS;
    await runReminders(ist(2026, 10, 20, 9));
    expect(notes("okr_check_in_due")).toEqual([expect.objectContaining({ link: `/okrs/${once}`, message: '"Launch": your last update was more than a week ago.' })]);
    expect(rows("keyResult").filter((k) => k.lastReminderAt).map((k) => k.title)).toEqual(["Demos"]);
  });

  it("this month's hours are the workspace zone's month", async () => {
    const g = await goal(ist(2026, 10, 1), { title: "Launch", endDate: "2026-12-31", keyResults: [{ title: "Ship", startValue: 0, targetValue: 1 }] });
    delete process.env.RECURRING_GOALS;
    seedRow(db, "entityLink", { id: "el-1", organizationId: ORG, sourceType: "OKR", sourceId: g, targetType: "BOARD", targetId: "b-1" });
    seedRow(db, "item", { id: "it-1", organizationId: ORG, boardId: "b-1", status: "TODO", archivedAt: null, parentItemId: null, metadata: {}, ownerId: BOSS, assigneeIds: [], updatedAt: ist(2026, 10, 20) });
    for (const [day, hours] of [["2026-10-15", 3], ["2026-11-01", 4]] as const) {
      seedRow(db, "timeEntry", { organizationId: ORG, itemId: "it-1", userId: BOSS, day: new Date(`${day}T00:00:00.000Z`), hours });
    }
    const { computeGoalEffortBatch } = await effortModule();
    // 02:00 IST on 1 November: November in the workspace, still October in UTC.
    const e = (await computeGoalEffortBatch(ORG, [g], ist(2026, 11, 1, 2), { userId: BOSS, organizationId: ORG } as never)).get(g)!;
    expect(e.hoursThisMonth).toBe(4);
    expect(e).not.toHaveProperty("periodHours");
  });

  // A guard (it passes on the old code too): the export only changes once a goal repeats.
  it("the export has no repeat columns and no goal-periods.csv while nothing repeats", async () => {
    await goal(ist(2026, 10, 1), { title: "Launch", endDate: "2026-12-31", keyResults: [{ title: "Ship", startValue: 0, targetValue: 1 }] });
    delete process.env.RECURRING_GOALS;
    at(ist(2026, 10, 2));
    const prepared = await (await workspaceExport()).prepareWorkspaceExport(ORG, new Date(), () => {});
    const names: string[] = [];
    let goalsCsv = "";
    for await (const entry of prepared.entries) {
      names.push(entry.name);
      if (entry.name === "goals.csv") goalsCsv = String(entry.data);
      else if (typeof entry.data !== "string") for await (const piece of entry.data as AsyncIterable<string>) void piece;
    }
    expect(names).not.toContain("goal-periods.csv");
    expect(goalsCsv.split("\r\n")[0]).toMatch(/,startDate,createdAt$/);
    expect(prepared.counts).not.toHaveProperty("goalPeriods");
  });
});

/* ───────────────────────── Step 6 review (M1, M2, L1 to L4) ───────────────────────── */

const periodsServer = () => import("./goal-periods.server");
const verdictModule = () => import("@/lib/goal-verdict");
const alignmentModule = () => import("@/lib/alignment");
const periodOf = (okrId: string, key: string) => rows("goalPeriod").find((p) => p.okrId === okrId && p.key === key)!;
const partsOf = (userId: string, period: string) => ((scoreRow(userId, period)?.breakdown ?? {}) as { okrParts?: Array<Record<string, unknown>> }).okrParts;

describe("the close patch credits the owner as of the period (M1)", () => {
  it("a goal handed over during the grace patches Alice's October row and makes nothing for Bob", async () => {
    const g = await monthly(ist(2026, 10, 2), "Hiring", { ownerId: ANA });
    await checkIn(ist(2026, 10, 20), g, 4);
    await scoreAt(ist(2026, 10, 31, 12), ANA);
    expect(partsOf(ANA, "2026-10")).toEqual([{ okrId: g, periodKey: OCT_KEY, progress: 40 }]);
    // 3 November: Alice's last October number, then the goal goes to Bob.
    await checkIn(ist(2026, 11, 3), g, 10, OCT_KEY);
    rows("oKR").find((o) => o.id === g)!.ownerId = BOSS;
    await runCron(ist(2026, 11, 6, 0, 35));
    expect(partsOf(ANA, "2026-10")).toEqual([{ okrId: g, periodKey: OCT_KEY, progress: 100 }]);
    expect(scoreRow(ANA, "2026-10")!.score).toBe(100);
    expect(scoreRow(BOSS, "2026-10")).toBeUndefined();
  });

  it("with no row holding it, the current owner's row gets it (guard: the old code did this too)", async () => {
    const x = await monthly(ist(2026, 10, 1, 8), "X");
    await checkIn(ist(2026, 10, 1, 8, 30), x, 5);
    await scoreAt(ist(2026, 10, 1, 9));
    expect(partsOf(BOSS, "2026-10")).toEqual([{ okrId: x, periodKey: OCT_KEY, progress: 50 }]);
    const y = await monthly(ist(2026, 10, 1, 10), "Y");
    await checkIn(ist(2026, 10, 20), y, 8);
    await runCron(ist(2026, 11, 6, 0, 35));
    expect(partsOf(BOSS, "2026-10")).toEqual([{ okrId: x, periodKey: OCT_KEY, progress: 50 }, { okrId: y, periodKey: OCT_KEY, progress: 80 }]);
  });
});

describe("the close patch under concurrency and in a running month (L1)", () => {
  it("two patches of one owner's goals at once make ONE row holding both, through locked reads", async () => {
    const a = await monthly(ist(2026, 10, 2), "A");
    const b = await monthly(ist(2026, 10, 2), "B");
    await checkIn(ist(2026, 10, 20), a, 3);
    await checkIn(ist(2026, 10, 20), b, 9);
    await runCron(ist(2026, 11, 6, 0, 35));
    // As if both closes had committed and neither patch had run yet.
    db.rows.performanceScore = [];
    for (const id of [a, b]) periodOf(id, OCT_KEY).scorePatchedAt = null;
    db.raw.length = 0;
    const { patchScoreOnce } = await periodsServer();
    at(ist(2026, 11, 6, 1, 5));
    const done = await Promise.allSettled([patchScoreOnce(String(periodOf(a, OCT_KEY).id)), patchScoreOnce(String(periodOf(b, OCT_KEY).id))]);
    expect(done.map((d) => d.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(rows("performanceScore").filter((r) => r.userId === BOSS)).toHaveLength(1);
    expect(partsOf(BOSS, "2026-10")).toEqual(expect.arrayContaining([{ okrId: a, periodKey: OCT_KEY, progress: 30 }, { okrId: b, periodKey: OCT_KEY, progress: 90 }]));
    expect(db.raw.some((r) => /FROM "PerformanceScore" .* FOR UPDATE/.test(r))).toBe(true);
  });

  it("a weekly goal in the score: mid-month its live week stays in, and the month ends at the mean of its weeks", async () => {
    // Weeks from Monday 5 October 2026: 5 to 11, 12 to 18 and 19 to 25 end in October; 26 October to 1 November ends in November.
    const w = await goal(ist(2026, 10, 5), { title: "Posts", repeat: "WEEKLY", keyResults: [{ title: "Posts", startValue: 0, targetValue: 10 }] });
    await checkIn(ist(2026, 10, 7), w, 10);
    await checkIn(ist(2026, 10, 13), w, 5);
    // 14 October: the first week closes while October still runs on the server.
    await runCron(ist(2026, 10, 14, 0, 35));
    expect(partsOf(BOSS, "2026-10")).toEqual([{ okrId: w, periodKey: "2026-10-12", progress: 75 }]);
    await checkIn(ist(2026, 10, 20), w, 6);
    await runCron(ist(2026, 10, 21, 0, 35));
    await runCron(ist(2026, 10, 28, 0, 35));
    expect(partsOf(BOSS, "2026-10")).toEqual([{ okrId: w, periodKey: "2026-10-19", progress: 70 }]);
  });
});

describe("a weekly goal's check-in comes due inside its week (M2)", () => {
  it("a weekly goal with no check-in this week is nudged on the first weekday run from day 5", async () => {
    const w = await goal(ist(2026, 10, 29), { title: "Posts", repeat: "WEEKLY", keyResults: [{ title: "Posts", startValue: 0, targetValue: 3 }] });
    await runCron(ist(2026, 11, 2, 0, 35)); // the week of Monday 2 November opens
    for (const d of [2, 3, 4, 5]) await runReminders(ist(2026, 11, d, 9));
    expect(notes("okr_check_in_due")).toHaveLength(0);
    await runReminders(ist(2026, 11, 6, 9)); // Friday, day 5
    expect(notes("okr_check_in_due")).toEqual([expect.objectContaining({ link: `/okrs/${w}` })]);
  });

  it("its verdict reads the check-in overdue from day 5 too", async () => {
    const { goalVerdictFor } = await verdictModule();
    const period = { trackedFrom: ist(2026, 11, 2, 0), startsAt: ist(2026, 11, 2, 0), endsAt: ist(2026, 11, 9, 0), lastCheckInAt: null };
    const base = { progress: 50, progressSource: "ROLLUP", startDate: null, endDate: null, createdAt: ist(2026, 10, 29), checkInCadence: "WEEKLY", lastCheckInAt: null, hasLinkedWork: true, period };
    expect(goalVerdictFor(base, ist(2026, 11, 5, 23)).signals.isStale).toBe(false);
    expect(goalVerdictFor(base, ist(2026, 11, 6, 1)).signals.isStale).toBe(true);
    // A monthly goal keeps its weekly rhythm.
    const month = { trackedFrom: ist(2026, 11, 1, 0), startsAt: ist(2026, 11, 1, 0), endsAt: ist(2026, 12, 1, 0), lastCheckInAt: null };
    expect(goalVerdictFor({ ...base, period: month }, ist(2026, 11, 7, 23)).signals.isStale).toBe(false);
    expect(goalVerdictFor({ ...base, period: month }, ist(2026, 11, 8, 1)).signals.isStale).toBe(true);
  });
});

describe("the end nudge is one row and one email per owner per period end (L2)", () => {
  it("ten goals ending the same day give one row and one email, run after run", async () => {
    for (let i = 1; i <= 10; i++) await monthly(ist(2027, 1, 4), `Goal ${i}`);
    await runReminders(ist(2027, 1, 29, 9));
    await runReminders(ist(2027, 1, 29, 15));
    await runReminders(ist(2027, 1, 30, 9));
    const ends = notes("okr_check_in_due").filter((n) => /ends/.test(String(n.title)));
    expect(ends).toEqual([expect.objectContaining({
      userId: BOSS,
      title: "January ends in 2 days. Add this month's numbers.",
      message: "Goal 1, Goal 2, Goal 3 and 7 more each have a target with no check-in this month.",
      link: "/okrs",
    })]);
    expect(String(ends[0].id)).toMatch(/^[A-Za-z0-9_-]{6,64}$/);
    // The end nudge was those goals' reminder: no stale-target rows, one email in all.
    expect(notes("okr_check_in_due")).toHaveLength(1);
    expect(mail).toHaveLength(1);
  });
});

describe("no score response carries okrParts (L3)", () => {
  it("the service, /api/performance-scores, /api/reviews/history and /api/employee-of-month leave them out", async () => {
    const g = await monthly(ist(2026, 10, 2), "Demos");
    await checkIn(ist(2026, 10, 20), g, 6);
    await scoreAt(ist(2026, 10, 31, 12));
    await runCron(ist(2026, 11, 6, 0, 35));
    const computed = await scoreAt(ist(2026, 11, 7));
    // The stored rows keep them: only the close patch reads them.
    expect(partsOf(BOSS, "2026-10")).toHaveLength(1);
    expect(partsOf(BOSS, "2026-11")).toHaveLength(1);
    const service = await scoreService();
    const leaks: Array<[string, unknown]> = [
      ["calculatePerformanceScore", computed],
      ["getLatestScore", await service.getLatestScore(BOSS)],
      ["getScoreHistory", await service.getScoreHistory(BOSS, 6)],
    ];
    const scores = await import("@/app/api/performance-scores/route");
    for (const url of ["/api/performance-scores?userId=" + BOSS, "/api/performance-scores?top=5", "/api/performance-scores"]) {
      const r = await call(scores.GET, url);
      expect(r.status, url).toBe(200);
      leaks.push([url, r.body]);
    }
    const post = await call(scores.POST, "/api/performance-scores", { method: "POST", body: { userId: BOSS } });
    expect(post.status).toBe(200);
    leaks.push(["POST /api/performance-scores", post.body]);
    const history = await call((await import("@/app/api/reviews/history/route")).GET, `/api/reviews/history?userId=${BOSS}`);
    expect(history.status).toBe(200);
    leaks.push(["/api/reviews/history", history.body]);
    const eom = await call((await import("@/app/api/employee-of-month/route")).GET, "/api/employee-of-month");
    expect(eom.status).toBe(200);
    expect((eom.body as { current: { userId: string } | null }).current?.userId).toBe(BOSS);
    leaks.push(["/api/employee-of-month", eom.body]);
    for (const [where, body] of leaks) {
      expect(JSON.stringify(body), where).toMatch(/okrScore/);
      expect(JSON.stringify(body), where).not.toMatch(/okrParts/);
    }
    expect(JSON.stringify(rows("employeeOfMonth"))).not.toMatch(/okrParts/);
  });
});

describe("one-time parity (L4)", () => {
  it("an owner with only one-time goals gets the okrScore and score the old calcOkrScore gave (guard: passes on the old code)", async () => {
    const a = await goal(ist(2026, 10, 1), { title: "Launch", endDate: "2026-12-31", keyResults: [{ title: "Ship", startValue: 0, targetValue: 10 }] });
    const b = await goal(ist(2026, 10, 1), { title: "Hire", endDate: "2026-12-31", keyResults: [{ title: "Hires", startValue: 0, targetValue: 10 }] });
    await checkIn(ist(2026, 10, 10), a, 4);
    await checkIn(ist(2026, 10, 10), b, 7);
    seedRow(db, "kPIRecord", { id: "rec-1", kpiId: "kpi-1", userId: BOSS, period: "2026-10", actualValue: 1, score: 60, status: "APPROVED", createdAt: ist(2026, 10, 15) });
    const r = await scoreAt(ist(2026, 10, 20));
    // The old calcOkrScore: the mean of the live rollup of every goal the person owns.
    const { computeGoalRollups, goalRollupFor } = await alignmentModule();
    const ctx = await computeGoalRollups(ORG);
    const owned = rows("oKR").filter((o) => o.ownerId === BOSS) as Array<{ id: string; progress: number; status: string }>;
    const old = Math.min(Math.round(owned.reduce((sum, o) => sum + goalRollupFor(ctx, o).progress, 0) / owned.length), 100);
    expect(old).toBe(55);
    expect((r.breakdown as unknown as Record<string, unknown>).okrScore).toBe(old);
    // KPI 50 at weight 40 and goals 55 at weight 10.
    expect(r.score).toBe(51);
    expect(scoreRow(BOSS, "2026-10")!.score).toBe(51);
  });
});
